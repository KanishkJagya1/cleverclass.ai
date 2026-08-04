"""Stock ledger invariants.

    python -m tests.test_inventory
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_stock_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query, query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import inventory  # noqa: E402

failures: list[str] = []
SLUG = "__stock_fixture__"


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def make_book(book_id: str) -> str:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
            " subject, price, status, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (book_id, book_id, "Fixture", "kohinoor", "state", "10", "english",
             "Science", 100, "published", now, now),
        )
    return book_id


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== untracked books are never blocked ===")
    untracked = make_book(f"{SLUG}_untracked")
    check("a new book starts untracked", inventory.quantity(untracked) is None)
    check("is_tracked says so", inventory.is_tracked(untracked) is False)
    result = inventory.adjust(untracked, -5, "sold", reference="CC-TEST")
    check(
        "selling an untracked book is a no-op, not an error",
        result is None,
        f"got {result!r} — an untracked title must stay sellable",
    )
    check(
        "and it wrote no movement",
        query_one("SELECT COUNT(*) n FROM stock_movements WHERE book_id = ?", (untracked,))["n"] == 0,
    )
    check(
        "the book is still in stock",
        query_one("SELECT in_stock FROM books WHERE id = ?", (untracked,))["in_stock"] == 1,
    )

    print("\n=== tracking is deliberate ===")
    book = make_book(f"{SLUG}_tracked")
    inventory.start_tracking(book, 10, note="first count")
    check("opening balance set", inventory.quantity(book) == 10)
    check("opening movement recorded", len(inventory.history(book)) == 1)
    try:
        inventory.start_tracking(book, 5)
        check("tracking twice is refused", False, "it was allowed")
    except inventory.StockError:
        check("tracking twice is refused", True)

    zero = make_book(f"{SLUG}_zero")
    inventory.start_tracking(zero, 0)
    check("opening at zero is allowed", inventory.quantity(zero) == 0)
    check(
        "opening at zero writes NO fictional movement",
        len(inventory.history(zero)) == 0,
        "an audit trail must only contain things that happened",
    )
    check(
        "a zero-stock book is out of stock",
        query_one("SELECT in_stock FROM books WHERE id = ?", (zero,))["in_stock"] == 0,
    )

    print("\n=== the ledger is the truth ===")
    inventory.adjust(book, -3, "sold", reference="CC-AAA11111")
    inventory.adjust(book, +5, "received", note="restock")
    check("balance follows the movements", inventory.quantity(book) == 12)
    moves = inventory.history(book)
    check("every movement is retained", len(moves) == 3, str(len(moves)))
    check("each records the balance after itself", moves[0]["balance"] == 12, str(moves[0]))
    check("the reference is kept for tracing", any(m["reference"] == "CC-AAA11111" for m in moves))

    print("\n=== overselling is impossible ===")
    try:
        inventory.adjust(book, -100, "sold")
        check("cannot sell more than exists", False, "the oversell was allowed")
    except inventory.StockError:
        check("cannot sell more than exists", True)
    check("the failed attempt changed nothing", inventory.quantity(book) == 12)
    check(
        "and wrote no movement",
        len(inventory.history(book)) == 3,
        "a refused movement must not appear in the ledger",
    )

    print("\n=== going to zero flips in_stock ===")
    inventory.adjust(book, -12, "sold", reference="CC-BBB22222")
    check("balance is zero", inventory.quantity(book) == 0)
    check(
        "in_stock follows automatically",
        query_one("SELECT in_stock FROM books WHERE id = ?", (book,))["in_stock"] == 0,
    )
    inventory.adjust(book, +2, "cancelled", reference="CC-BBB22222")
    check("a cancellation restores stock", inventory.quantity(book) == 2)
    check(
        "and puts it back in stock",
        query_one("SELECT in_stock FROM books WHERE id = ?", (book,))["in_stock"] == 1,
    )

    print("\n=== low stock ===")
    low = [b["id"] for b in inventory.low_stock()]
    check("a book at 2 with threshold 5 is flagged", book in low, str(low))
    check("an untracked book is never flagged", untracked not in low)

    print("\n=== reconcile catches a cache written behind our back ===")
    with transaction() as conn:
        conn.execute("UPDATE books SET stock_qty = 999 WHERE id = ?", (book,))
    drift = inventory.reconcile(book)
    check("the drift is detected", len(drift) == 1, str(drift))
    check("and corrected from the ledger", inventory.quantity(book) == 2, str(inventory.quantity(book)))
    check("a clean catalogue reports no drift", inventory.reconcile(book) == [])
    check(
        "untracked books are not reported as drift",
        all(d["id"] != untracked for d in inventory.reconcile()),
    )

    print("\n=== invalid input ===")
    for delta, reason, label in [
        (0, "sold", "a zero movement is refused"),
        (1, "teleported", "an unknown reason is refused"),
    ]:
        try:
            inventory.adjust(book, delta, reason)
            check(label, False, "it was accepted")
        except inventory.StockError:
            check(label, True)

    # Clean up so re-running against a shared DB stays deterministic.
    with transaction() as conn:
        conn.execute("DELETE FROM books WHERE slug LIKE ?", (f"{SLUG}%",))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Stock ledger holds: the movements are the truth.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
