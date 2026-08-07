"""Schema migrations.

Migration 1 is `schema.sql` — the whole current shape, written idempotently
(CREATE TABLE IF NOT EXISTS) so applying it to an existing database is a no-op.
Later migrations are numbered .sql files in `migrations/` and run in order.

Run:  python -m app.db.migrate
"""

from __future__ import annotations

import datetime as dt
import logging
import re
from pathlib import Path

from app.db.conn import db_path, get_conn, query, transaction

log = logging.getLogger(__name__)

HERE = Path(__file__).resolve().parent
BASE_SCHEMA = HERE / "schema.sql"
MIGRATIONS_DIR = HERE / "migrations"


def _applied() -> set[int]:
    get_conn().execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
    )
    return {int(r["version"]) for r in query("SELECT version FROM schema_migrations")}


def _pending() -> list[tuple[int, str, Path]]:
    out: list[tuple[int, str, Path]] = [(1, "base_schema", BASE_SCHEMA)]
    if MIGRATIONS_DIR.is_dir():
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            m = re.match(r"^(\d+)[_-](.+)\.sql$", path.name)
            if not m:
                log.warning("Skipping unnumbered migration file: %s", path.name)
                continue
            version = int(m.group(1))
            if version <= 1:
                raise ValueError(
                    f"{path.name}: versions 0 and 1 are reserved for the base schema"
                )
            out.append((version, m.group(2), path))
    out.sort(key=lambda t: t[0])
    return out


def migrate() -> int:
    """Apply every unapplied migration. Returns how many ran."""
    applied = _applied()
    ran = 0
    for version, name, path in _pending():
        if version in applied:
            continue
        sql = path.read_text(encoding="utf-8")
        log.info("Applying migration %d (%s)", version, name)
        # executescript() issues its own COMMIT, so it cannot run inside our
        # BEGIN IMMEDIATE. Run the DDL first, then record it — the base schema
        # and every migration are written idempotently to make that safe.
        get_conn().executescript(sql)
        with transaction() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO schema_migrations(version, name, applied_at)"
                " VALUES (?,?,?)",
                (version, name, dt.datetime.now(dt.timezone.utc).isoformat()),
            )
        ran += 1
    if ran == 0:
        log.info("Database is up to date")

    _seed_masters_once()
    return ran


def _seed_masters_once() -> None:
    """Fill the masters table from values already on `books`.

    Runs after every migrate rather than inside migration 020, because the SQL
    file cannot express "derive rows from existing data" and an empty masters
    table is worse than useless: every picker in the admin would be blank while
    324 books quietly use codes nothing knows about.

    Idempotent and cheap — one COUNT when there is nothing to do.
    """
    try:
        row = get_conn().execute("SELECT COUNT(*) AS n FROM masters").fetchone()
        if row and row["n"]:
            return
        from app.services import masters

        created = masters.seed_from_books()
        if any(created.values()):
            log.info("Seeded master data from books: %s", created)
    except Exception:  # noqa: BLE001 — never block startup on this
        log.exception("Could not seed master data")


def main() -> None:
    logging.basicConfig(level="INFO", format="%(levelname)-8s %(message)s")
    print(f"database: {db_path()}")
    ran = migrate()
    version = query("SELECT MAX(version) AS v FROM schema_migrations")[0]["v"]
    print(f"applied {ran} migration(s); schema version {version}")


if __name__ == "__main__":
    main()
