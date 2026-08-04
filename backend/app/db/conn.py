"""SQLite connection management.

One database file, WAL mode, one connection per thread. FastAPI runs sync route
handlers in a threadpool, so a single shared connection would need a lock around
every call; thread-local connections avoid that entirely and SQLite is happy
with many readers under WAL.

Everything that writes goes through `transaction()`, which uses BEGIN IMMEDIATE.
Deferred transactions upgrade to a write lock only at the first write, which is
how you get SQLITE_BUSY *midway* through a multi-statement update — the one
failure mode that is genuinely hard to reason about.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from app.config import settings

log = logging.getLogger(__name__)

_local = threading.local()

# Applied to every connection. `foreign_keys` is per-connection in SQLite, not
# per-database — forgetting it here silently disables every ON DELETE CASCADE.
_PRAGMAS = (
    ("journal_mode", "WAL"),
    ("foreign_keys", "ON"),
    ("busy_timeout", "5000"),
    ("synchronous", "NORMAL"),  # WAL + NORMAL is durable across app crashes
    ("temp_store", "MEMORY"),
)


def db_path() -> Path:
    return Path(settings.db_path).expanduser()


def _configure(conn: sqlite3.Connection) -> None:
    for name, value in _PRAGMAS:
        conn.execute(f"PRAGMA {name} = {value}")
    conn.row_factory = sqlite3.Row


def get_conn() -> sqlite3.Connection:
    """The calling thread's connection, opened on first use."""
    conn: sqlite3.Connection | None = getattr(_local, "conn", None)
    if conn is not None:
        return conn

    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        str(path),
        timeout=5.0,
        # We manage transactions explicitly via transaction(); the implicit
        # commit-on-DML behaviour of the default isolation level fights that.
        isolation_level=None,
        check_same_thread=False,
    )
    _configure(conn)
    _local.conn = conn
    return conn


def close_conn() -> None:
    conn: sqlite3.Connection | None = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None


@contextmanager
def transaction(retries: int = 3) -> Iterator[sqlite3.Connection]:
    """A write transaction, retried on lock contention.

    BEGIN IMMEDIATE takes the write lock up front, so contention surfaces here
    rather than halfway through. Retries use a short backoff because the only
    competing writer is the PDF worker, which commits every 25 pages.
    """
    conn = get_conn()
    for attempt in range(retries):
        try:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except Exception:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
            return
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc).lower() and "busy" not in str(exc).lower():
                raise
            if attempt == retries - 1:
                log.error("SQLite still locked after %d attempts", retries)
                raise
            time.sleep(0.15 * (attempt + 1))


def query(sql: str, params: Any = ()) -> list[sqlite3.Row]:
    return get_conn().execute(sql, params).fetchall()


def query_one(sql: str, params: Any = ()) -> sqlite3.Row | None:
    return get_conn().execute(sql, params).fetchone()


def scalar(sql: str, params: Any = (), default: Any = None) -> Any:
    row = query_one(sql, params)
    return default if row is None else row[0]


def execute(sql: str, params: Any = ()) -> sqlite3.Cursor:
    """Single-statement write. Multi-statement writes must use transaction()."""
    with transaction() as conn:
        return conn.execute(sql, params)


# --- JSON column helpers ----------------------------------------------------
# Arrays in this schema (highlights, variants, chapters…) are JSON text. These
# two are the only places that knows that, so a malformed value degrades to an
# empty list instead of exploding three layers up in a route handler.


def load_json_list(raw: Any) -> list:
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        log.warning("Malformed JSON list column: %r", str(raw)[:120])
        return []
    return value if isinstance(value, list) else []


def dump_json_list(value: Any) -> str:
    if value is None:
        return "[]"
    if isinstance(value, str):
        return value
    return json.dumps(list(value), ensure_ascii=False)


def healthcheck() -> dict:
    """Reported by /health so a broken DB is visible, not silently degraded."""
    try:
        version = scalar("SELECT MAX(version) FROM schema_migrations", default=0) or 0
        books = scalar("SELECT COUNT(*) FROM books", default=0)
        return {"ok": True, "migration": int(version), "books": int(books)}
    except Exception as exc:  # noqa: BLE001 — health must never raise
        return {"ok": False, "error": str(exc)}
