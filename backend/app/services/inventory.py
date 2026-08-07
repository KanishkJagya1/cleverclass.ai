"""Stock, as an append-only ledger.

`stock_movements` is the truth; `books.stock_qty` is a cache of its running
total, rewritten in the same transaction. Nothing outside this module writes
either — the same single-writer rule that keeps `corpus.py` honest about the
vector store.

TWO STATES, AND THE DIFFERENCE MATTERS

  * **Untracked** (`stock_qty IS NULL`) — the shop does not count this title.
    It is always sellable and orders never deduct it. Every book in the
    catalogue starts here, which is why enabling this feature did not take 324
    books out of stock.
  * **Tracked** — a real count. Orders deduct on confirm and restore on cancel,
    and it goes out of stock at zero.

Moving a book into tracking is a deliberate act (`start_tracking`), never a side
effect of an order.
"""

from __future__ import annotations

import datetime as dt
import logging

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

REASONS = (
    "opening", "received", "sold", "cancelled", "returned",
    "damaged", "correction", "recount",
)


class StockError(RuntimeError):
    """Raised when a movement would break an invariant (e.g. oversell)."""


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def is_tracked(book_id: str) -> bool:
    row = query_one("SELECT stock_qty FROM books WHERE id = ?", (book_id,))
    return bool(row) and row["stock_qty"] is not None


def quantity(book_id: str) -> int | None:
    """Current quantity, or None when the book is untracked."""
    row = query_one("SELECT stock_qty FROM books WHERE id = ?", (book_id,))
    return None if row is None else row["stock_qty"]


def start_tracking(
    book_id: str, opening: int, *, actor_id: str | None = None, note: str = ""
) -> int:
    """Begin counting this title, with an opening balance."""
    if opening < 0:
        raise StockError("Opening stock cannot be negative")
    row = query_one("SELECT stock_qty FROM books WHERE id = ?", (book_id,))
    if row is None:
        raise StockError("No such book")
    if row["stock_qty"] is not None:
        raise StockError("This book is already tracked — use adjust() instead")

    with transaction() as conn:
        # An opening balance of zero writes no movement: `delta` is CHECKed
        # non-zero, and inventing a +1/-1 pair to represent "there were none"
        # would put two fictitious events in an audit trail whose whole value is
        # that everything in it happened. A zero cache with a zero ledger sum is
        # already consistent, and `reconcile()` agrees.
        if opening:
            conn.execute(
                "INSERT INTO stock_movements"
                " (book_id, delta, balance, reason, note, actor_id, created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (book_id, opening, opening, "opening", note, actor_id, _now()),
            )
        conn.execute(
            "UPDATE books SET stock_qty = ?, in_stock = ? WHERE id = ?",
            (opening, 1 if opening > 0 else 0, book_id),
        )
    return opening


def adjust(
    book_id: str,
    delta: int,
    reason: str,
    *,
    reference: str | None = None,
    note: str = "",
    actor_id: str | None = None,
    allow_negative: bool = False,
) -> int | None:
    """Append a movement and return the new balance, or None if untracked.

    `None` is the meaningful answer for an untracked book, not an error: the
    order path calls this for every line, and a shop that has chosen not to
    count a title must not be blocked from selling it.
    """
    if delta == 0:
        raise StockError("A movement must change the quantity")
    if reason not in REASONS:
        raise StockError(f"Unknown reason {reason!r}")

    # One statement, so the read and the write cannot interleave with another
    # order confirming the last copy.
    with transaction() as conn:
        row = conn.execute(
            "SELECT stock_qty FROM books WHERE id = ?", (book_id,)
        ).fetchone()
        if row is None:
            raise StockError("No such book")
        current = row["stock_qty"]
        if current is None:
            # Untracked: nothing to deduct, no movement recorded.
            return None

        new_balance = current + delta
        if new_balance < 0 and not allow_negative:
            raise StockError(
                f"Only {current} in stock; cannot move {delta}."
            )
        new_balance = max(new_balance, 0)

        conn.execute(
            "INSERT INTO stock_movements"
            " (book_id, delta, balance, reason, reference, note, actor_id, created_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (book_id, delta, new_balance, reason, reference, note, actor_id, _now()),
        )
        conn.execute(
            "UPDATE books SET stock_qty = ?, in_stock = ? WHERE id = ?",
            (new_balance, 1 if new_balance > 0 else 0, book_id),
        )
    return new_balance


def history(book_id: str, limit: int = 100) -> list[dict]:
    return [
        dict(r)
        for r in query(
            "SELECT * FROM stock_movements WHERE book_id = ?"
            " ORDER BY id DESC LIMIT ?",
            (book_id, int(limit)),
        )
    ]


def low_stock(limit: int = 50) -> list[dict]:
    """Tracked books at or below their own threshold, worst first."""
    return [
        dict(r)
        for r in query(
            "SELECT id, slug, title, stock_qty, low_stock_threshold"
            "  FROM books"
            " WHERE stock_qty IS NOT NULL"
            "   AND stock_qty <= low_stock_threshold"
            "   AND status = 'published' AND deleted_at IS NULL"
            " ORDER BY stock_qty ASC, title LIMIT ?",
            (int(limit),),
        )
    ]


def reconcile(book_id: str | None = None) -> list[dict]:
    """Rebuild the cached quantity from the ledger.

    The ledger is authoritative. If the cache and the sum of movements ever
    disagree, something wrote `books.stock_qty` outside this module — this both
    reports that and fixes it. Worth running from a scheduled job: a silent
    drift here means the shop oversells.
    """
    scope = "WHERE b.id = ?" if book_id else ""
    params: tuple = (book_id,) if book_id else ()
    rows = query(
        f"""
        SELECT b.id, b.slug, b.stock_qty AS cached,
               (SELECT COALESCE(SUM(m.delta), 0) FROM stock_movements m
                 WHERE m.book_id = b.id) AS ledger,
               (SELECT COUNT(*) FROM stock_movements m WHERE m.book_id = b.id) AS moves
          FROM books b
          {scope}
        """,
        params,
    )

    drifted = []
    for row in rows:
        # Untracked books legitimately have no movements — not a drift.
        if row["cached"] is None and row["moves"] == 0:
            continue
        if row["cached"] != row["ledger"]:
            drifted.append(
                {"id": row["id"], "slug": row["slug"],
                 "cached": row["cached"], "ledger": row["ledger"]}
            )
            with transaction() as conn:
                conn.execute(
                    "UPDATE books SET stock_qty = ?, in_stock = ? WHERE id = ?",
                    (row["ledger"], 1 if row["ledger"] > 0 else 0, row["id"]),
                )
            log.error(
                "Stock drift on %s: cache said %s, ledger says %s — corrected",
                row["slug"], row["cached"], row["ledger"],
            )
    return drifted
