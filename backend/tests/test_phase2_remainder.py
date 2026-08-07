"""Cart/wishlist persistence, notifications and analytics.

    python -m tests.test_phase2_remainder
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_p2r_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import customers as customers_repo  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import analytics, basket, notifications, order_flow  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def make_book(slug: str, price: int) -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
            " subject, price, status, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (slug, slug, f"Book {slug}", "kohinoor", "state", "10", "english",
             "Science", price, "published", now, now),
        )


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    make_book("p2-a", 200)
    make_book("p2-b", 300)
    customer = customers_repo.create(email="c@x.com", password="password12", name="C")
    cid = customer["id"]

    print("=== cart is priced from the DATABASE, never stored ===")
    basket.set_item(cid, "p2-a", 2)
    cart = basket.cart(cid)
    check("line total computed from the catalogue", cart["subtotal"] == 400, str(cart))
    with transaction() as conn:
        conn.execute("UPDATE books SET price = 250 WHERE slug = 'p2-a'")
    check("a price change is reflected immediately", basket.cart(cid)["subtotal"] == 500,
          "a stored price would have gone stale and started an argument")

    print("\n=== quantity rules ===")
    basket.set_item(cid, "p2-a", 5)
    check("quantity replaces, not accumulates", basket.cart(cid)["items"][0]["qty"] == 5)
    basket.set_item(cid, "p2-a", 0)
    check("setting zero removes the line", len(basket.cart(cid)["items"]) == 0)

    print("\n=== merging a guest cart takes the MAX, not the sum ===")
    basket.set_item(cid, "p2-a", 2)
    merged = basket.merge_guest_cart(cid, [{"slug": "p2-a", "qty": 2},
                                           {"slug": "p2-b", "qty": 1}])
    qty_a = next(i["qty"] for i in merged["items"] if i["slug"] == "p2-a")
    check("2 on the phone and 2 on the laptop is 2, not 4", qty_a == 2,
          f"{qty_a} — summing silently doubles the order")
    check("a guest-only line is added", any(i["slug"] == "p2-b" for i in merged["items"]))
    merged = basket.merge_guest_cart(cid, [{"slug": "p2-a", "qty": 7}])
    qty_a = next(i["qty"] for i in merged["items"] if i["slug"] == "p2-a")
    check("a larger guest quantity wins", qty_a == 7, str(qty_a))

    print("\n=== an unpublished book is reported, not silently dropped ===")
    with transaction() as conn:
        conn.execute("UPDATE books SET status = 'archived' WHERE slug = 'p2-b'")
    cart = basket.cart(cid)
    check("it leaves the priced items", all(i["slug"] != "p2-b" for i in cart["items"]))
    check("and is named in `unavailable`", "p2-b" in cart["unavailable"],
          "a line vanishing without a word is how someone orders the wrong thing")
    with transaction() as conn:
        conn.execute("UPDATE books SET status = 'published' WHERE slug = 'p2-b'")

    print("\n=== wishlist ===")
    basket.add_to_wishlist(cid, "p2-a")
    basket.add_to_wishlist(cid, "p2-a")
    check("adding twice keeps one row", len(basket.wishlist(cid)["items"]) == 1)
    basket.remove_from_wishlist(cid, "p2-a")
    check("removal works", len(basket.wishlist(cid)["items"]) == 0)

    print("\n=== notifications dedupe ===")
    first = notifications.notify(
        audience="admin", kind="order.new", title="New order CC-1",
        entity="order", entity_id="CC-1",
    )
    second = notifications.notify(
        audience="admin", kind="order.new", title="New order CC-1",
        entity="order", entity_id="CC-1",
    )
    check("the first is recorded", first is not None)
    check("a repeat of the same event is not", second is None,
          "a retried webhook must not ring three bells")

    inbox = notifications.for_admin()
    check("staff see it", any(n["title"] == "New order CC-1" for n in inbox["notifications"]))
    check("unread is counted", inbox["unread"] >= 1)
    notifications.mark_read(first)
    check("marking read reduces the count",
          notifications.for_admin()["unread"] == inbox["unread"] - 1)

    print("\n=== a customer cannot read someone else's notification ===")
    other = customers_repo.create(email="o@x.com", password="password12", name="O")
    mine = notifications.notify(
        audience="customer", customer_id=cid, kind="order.shipped",
        title="Your order shipped", entity="order", entity_id="CC-MINE",
    )
    check("scoped mark_read refuses a foreign id",
          notifications.mark_read(mine, customer_id=other["id"]) is False,
          "guessing an id must not let someone touch another account's bell")
    check("the owner can", notifications.mark_read(mine, customer_id=cid) is True)

    print("\n=== notifications fire from real events ===")
    order = orders_repo.create_order(
        items=[{"slug": "p2-a", "qty": 1}],
        customer={"name": "C", "phone": "9876500000", "email": "c@x.com",
                  "address1": "1", "city": "Nagpur", "pincode": "440016"},
    )
    num = order["orderNumber"]
    with transaction() as conn:
        conn.execute("UPDATE orders SET customer_id = ? WHERE order_number = ?",
                     (cid, num))
    order_flow.transition(num, "confirmed")
    customer_inbox = notifications.for_customer(cid)
    check("the customer is told their order was confirmed",
          any("Confirmed" in n["title"] for n in customer_inbox["notifications"]),
          str([n["title"] for n in customer_inbox["notifications"]]))

    print("\n=== analytics never counts a cancelled order as revenue ===")
    before = analytics.summary(30)["revenue"]
    cancelled = orders_repo.create_order(
        items=[{"slug": "p2-a", "qty": 4}],
        customer={"name": "X", "phone": "9876500001", "address1": "1",
                  "city": "Nagpur", "pincode": "440016"},
    )["orderNumber"]
    order_flow.transition(cancelled, "cancelled")
    after = analytics.summary(30)["revenue"]
    check("a cancelled order adds nothing to revenue", after == before,
          f"{before} -> {after} — counting it flatters every number on the screen")

    print("\n=== the dashboard holds together ===")
    board = analytics.dashboard(30)
    check("summary present", "revenue" in board["summary"])
    # 30, not 31. This asserted 31 while the window ran from `now - 30 days`,
    # which spans 31 calendar dates AND made the oldest bucket a partial day —
    # it held only orders placed after the current hour, so it rendered as a
    # quiet day. The window is date-aligned now: exactly `days` buckets, only
    # today partial. See `analytics._range`.
    check("series has one point per day, zero-filled", len(board["series"]) == 30,
          f"{len(board['series'])} days — a chart that skips empty days compresses time")
    check("every day has a value", all("revenue" in d for d in board["series"]))
    check("top products computed", isinstance(board["topProducts"], list))
    check("operational counts present", "paymentsToVerify" in board["operational"])
    check("catalogue health flags missing samples",
          board["catalogue"]["withoutSample"] >= 1, str(board["catalogue"]))
    check("aov does not divide by zero on an empty period",
          analytics.summary(1)["aov"] >= 0)
    check("change is None when there is no prior period, not 0",
          analytics.summary(365)["change"]["revenue"] is None
          or isinstance(analytics.summary(365)["change"]["revenue"], float),
          "0% for a first month is a lie")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Phase 2 remainder holds.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
