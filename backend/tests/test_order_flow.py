"""Order lifecycle: legal transitions and stock effects.

    python -m tests.test_order_flow
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_orderflow_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import inventory, order_flow  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


CUSTOMER = {
    "name": "Test Buyer",
    "phone": "9876500000",
    "email": "buyer@example.com",
    "address1": "1 Road",
    "city": "Nagpur",
    "pincode": "440016",
}


def make_book(slug: str, stock: int | None) -> str:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
            " subject, price, status, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (slug, slug, f"Book {slug}", "kohinoor", "state", "10", "english",
             "Science", 100, "published", now, now),
        )
    if stock is not None:
        inventory.start_tracking(slug, stock)
    return slug


def make_order(slug: str, qty: int) -> str:
    result = orders_repo.create_order(
        items=[{"slug": slug, "qty": qty}],
        customer=CUSTOMER,
    )
    return result["orderNumber"]


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== illegal transitions are refused ===")
    book = make_book("flow-tracked", 10)
    num = make_order("flow-tracked", 2)

    try:
        order_flow.transition(num, "delivered")
        check("cannot jump straight to delivered", False, "the jump was allowed")
    except order_flow.TransitionError as exc:
        check("cannot jump straight to delivered", True)
        check("the error names what IS allowed", "Allowed from here" in str(exc), str(exc))

    check("legal moves are listed", "confirmed" in order_flow.allowed_from("requested"))
    check("terminal states have no exits", order_flow.allowed_from("cancelled") == ())

    print("\n=== confirming deducts stock, once ===")
    order_flow.transition(num, "confirmed", actor="tester")
    check("stock deducted on confirm", inventory.quantity(book) == 8, str(inventory.quantity(book)))
    check(
        "the deduction is stamped",
        query_one("SELECT stock_applied_at FROM orders WHERE order_number=?", (num,))["stock_applied_at"] is not None,
    )

    order_flow.transition(num, "processing")
    order_flow.transition(num, "packed")
    check(
        "moving further through the pipeline does NOT deduct again",
        inventory.quantity(book) == 8,
        f"{inventory.quantity(book)} — a second deduction lost real inventory",
    )

    print("\n=== cancelling restores stock, once ===")
    order_flow.transition(num, "cancelled", note="customer changed their mind")
    check("stock restored on cancel", inventory.quantity(book) == 10, str(inventory.quantity(book)))
    check(
        "the stamp is cleared",
        query_one("SELECT stock_applied_at FROM orders WHERE order_number=?", (num,))["stock_applied_at"] is None,
    )
    try:
        order_flow.transition(num, "confirmed")
        check("a cancelled order is terminal", False, "it was reopened")
    except order_flow.TransitionError:
        check("a cancelled order is terminal", True)

    print("\n=== cancelling an order that never deducted invents nothing ===")
    num2 = make_order("flow-tracked", 3)
    order_flow.transition(num2, "cancelled")
    check(
        "stock unchanged by cancelling an unconfirmed order",
        inventory.quantity(book) == 10,
        f"{inventory.quantity(book)} — inventory was created from nothing",
    )

    print("\n=== a confirm that cannot reserve stock does not happen ===")
    scarce = make_book("flow-scarce", 1)
    num3 = make_order("flow-scarce", 5)
    try:
        order_flow.transition(num3, "confirmed")
        check("overselling is refused at confirm", False, "the order confirmed anyway")
    except inventory.StockError:
        check("overselling is refused at confirm", True)
    check(
        "the order stayed unconfirmed",
        query_one("SELECT status FROM orders WHERE order_number=?", (num3,))["status"] == "requested",
    )
    check("and stock was untouched", inventory.quantity(scarce) == 1, str(inventory.quantity(scarce)))

    print("\n=== a partial failure rolls back the lines it already took ===")
    # Two lines: the first has plenty, the second cannot be satisfied. The
    # first line's deduction must be given back, not silently kept.
    plenty = make_book("flow-plenty", 50)
    tiny = make_book("flow-tiny", 0)
    num4 = orders_repo.create_order(
        items=[{"slug": "flow-plenty", "qty": 2}, {"slug": "flow-tiny", "qty": 1}],
        customer=CUSTOMER,
    )["orderNumber"]
    try:
        order_flow.transition(num4, "confirmed")
        check("the multi-line confirm failed", False, "it succeeded despite no stock")
    except inventory.StockError:
        check("the multi-line confirm failed", True)
    check(
        "the first line's stock was returned",
        inventory.quantity(plenty) == 50,
        f"{inventory.quantity(plenty)} of 50 — a partial deduction was kept",
    )

    print("\n=== untracked books never block an order ===")
    untracked = make_book("flow-untracked", None)
    num5 = make_order("flow-untracked", 99)
    order_flow.transition(num5, "confirmed")
    check("an untracked title confirms fine", True)
    check("and stays untracked", inventory.quantity(untracked) is None)

    print("\n=== timeline + idempotency ===")
    events = order_flow.timeline(num)
    check("every transition is on the timeline", len(events) >= 4, str(len(events)))
    check("events carry a customer-facing label", all(e["label"] for e in events))
    check("the note is kept", any("changed their mind" in e["note"] for e in events))

    before = len(order_flow.timeline(num5))
    order_flow.transition(num5, "confirmed")  # same status again
    check(
        "re-applying the same status is a no-op, not an error",
        len(order_flow.timeline(num5)) == before,
        "a duplicate event was written",
    )

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Order flow holds: status and stock move together.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
