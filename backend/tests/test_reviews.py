"""Verified-purchase reviews and moderation.

    python -m tests.test_reviews
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_rev_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import customers as customers_repo  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import order_flow, reviews  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def make_book(slug: str) -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
            " subject, price, status, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (slug, slug, f"Title {slug}", "kohinoor", "state", "10", "english",
             "Science", 200, "published", now, now),
        )


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    make_book("rev-book")
    make_book("rev-other")
    buyer = customers_repo.create(email="buyer@example.com", password="buyerpass123", name="Buyer")
    stranger = customers_repo.create(email="stranger@example.com", password="strangerpw1", name="Stranger")

    print("=== a stranger cannot review ===")
    verdict = reviews.can_review(stranger["id"], "rev-book")
    check("no order means no review", verdict["allowed"] is False, str(verdict))
    check("and the reason is explained", "received this book" in verdict["reason"])
    try:
        reviews.submit(stranger["id"], "rev-book", rating=5, body="Amazing!")
        check("submitting without a purchase is refused", False, "a fake review got through")
    except reviews.ReviewError:
        check("submitting without a purchase is refused", True)

    print("\n=== an undelivered order is not enough ===")
    num = orders_repo.create_order(
        items=[{"slug": "rev-book", "qty": 1}],
        customer={"name": "Buyer", "phone": "9876500000", "email": "buyer@example.com",
                  "address1": "1", "city": "Nagpur", "pincode": "440016"},
    )["orderNumber"]
    with transaction() as conn:
        conn.execute("UPDATE orders SET customer_id = ? WHERE order_number = ?",
                     (buyer["id"], num))
    check("an unconfirmed order does not entitle a review",
          reviews.can_review(buyer["id"], "rev-book")["allowed"] is False)

    order_flow.transition(num, "confirmed")
    order_flow.transition(num, "shipped")
    check("even a SHIPPED order does not — the book has not arrived",
          reviews.can_review(buyer["id"], "rev-book")["allowed"] is False,
          "reviewing something still in transit is the classic fake-review pattern")

    print("\n=== delivery unlocks it ===")
    order_flow.transition(num, "delivered")
    check("a delivered order entitles a review",
          reviews.can_review(buyer["id"], "rev-book")["allowed"] is True)
    check("but only for the product actually bought",
          reviews.can_review(buyer["id"], "rev-other")["allowed"] is False)

    review = reviews.submit(buyer["id"], "rev-book", rating=5, title="Great", body="Very useful.")
    check("verified is DERIVED, not claimed", review["verified"] == 1)
    check("the entitling order is recorded", bool(review["order_id"]))
    check("source is 'customer'", review["source"] == "customer")
    check("it starts pending, not live", review["status"] == "pending",
          "a shop cannot un-see a review that went straight to the page")

    try:
        reviews.submit(buyer["id"], "rev-book", rating=1, body="Second thoughts")
        check("one review per customer per product", False, "a duplicate was allowed")
    except reviews.ReviewError:
        check("one review per customer per product", True)

    print("\n=== moderation drives the rating ===")
    before = query_one("SELECT rating, review_count FROM books WHERE slug='rev-book'")
    check("a pending review does not move the rating",
          before["review_count"] == 0,
          f"{dict(before)} — moderation would be cosmetic")

    reviews.moderate(review["id"], "published", actor_id="admin1", reply="Thanks!")
    after = query_one("SELECT rating, review_count FROM books WHERE slug='rev-book'")
    check("publishing updates the count", after["review_count"] == 1, str(dict(after)))
    check("and the average", after["rating"] == 5.0, str(dict(after)))
    check("the admin reply is stored", reviews.get(review["id"])["admin_reply"] == "Thanks!")

    reviews.moderate(review["id"], "rejected", actor_id="admin1")
    after = query_one("SELECT rating, review_count FROM books WHERE slug='rev-book'")
    check("rejecting removes it from the aggregate", after["review_count"] == 0, str(dict(after)))

    print("\n=== seeded reviews stay distinguishable ===")
    with transaction() as conn:
        conn.execute(
            "INSERT INTO reviews (id, product_slug, author, rating, title, body,"
            " date, verified, status, source)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("rev_seed_1", "rev-book", "Old Seed", 4, "", "seeded", "2026-01-01",
             0, "published", "seed"),
        )
    stats = reviews.stats()
    check("seeded rows are tagged", "seed" in stats, str(stats))
    check("genuine rows are tagged separately", "customer" in stats, str(stats))
    listed = reviews.for_product("rev-book")
    check("seeded reviews still display (current decision)",
          any(r["source"] == "seed" for r in listed), str(listed))
    check("and carry their provenance in the payload",
          all("source" in r for r in listed),
          "without this the UI cannot ever label or hide them")

    print("\n=== invalid input ===")
    for rating in (0, 6):
        try:
            reviews.submit(buyer["id"], "rev-other", rating=rating)
            check(f"rating {rating} is refused", False, "accepted")
        except reviews.ReviewError:
            check(f"rating {rating} is refused", True)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Reviews hold: only delivered buyers, moderated before display.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
