"""Reviews: verified purchase, moderation, aggregates.

THE RULE THAT MATTERS

A review can only be written by someone whose **delivered** order contained that
product. Not "has an account", not "says they bought it" — a delivered order
line. That single constraint is the difference between a review section and a
comment box.

`reviews.verified` existed before this, with no `customer_id` and no `order_id`
to justify it, so it could only ever have been set by hand. It is now derived
from a fact.

PROVENANCE

`source` distinguishes `customer` from `seed`. The 1,106 seeded reviews stay
visible for now by explicit decision, but they are tagged, so the aggregate can
be recomputed over genuine reviews only — and hiding them is one UPDATE.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

STATUSES = ("pending", "published", "rejected")

# Only a delivered order proves the book arrived. `shipped` is not enough:
# reviewing something still in transit is exactly the pattern fake reviews take.
_ELIGIBLE_ORDER_STATUSES = ("delivered",)


class ReviewError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def eligible_order(customer_id: str, product_slug: str) -> str | None:
    """The order id that entitles this customer to review this product."""
    placeholders = ",".join("?" for _ in _ELIGIBLE_ORDER_STATUSES)
    row = query_one(
        f"""
        SELECT o.id
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
         WHERE o.customer_id = ?
           AND oi.slug = ?
           AND o.status IN ({placeholders})
         ORDER BY o.created_at DESC
         LIMIT 1
        """,
        (customer_id, product_slug, *_ELIGIBLE_ORDER_STATUSES),
    )
    return row["id"] if row else None


def can_review(customer_id: str, product_slug: str) -> dict:
    """Why the review button is enabled or disabled — shown in the UI."""
    order_id = eligible_order(customer_id, product_slug)
    if not order_id:
        return {
            "allowed": False,
            "reason": "Only customers who have received this book can review it.",
        }
    existing = query_one(
        "SELECT id, status FROM reviews WHERE product_slug = ? AND customer_id = ?",
        (product_slug, customer_id),
    )
    if existing:
        return {"allowed": False, "reason": "You have already reviewed this book."}
    return {"allowed": True, "reason": ""}


def submit(
    customer_id: str,
    product_slug: str,
    *,
    rating: int,
    title: str = "",
    body: str = "",
    author: str = "",
) -> dict:
    if not 1 <= rating <= 5:
        raise ReviewError("Rating must be between 1 and 5")

    order_id = eligible_order(customer_id, product_slug)
    if not order_id:
        raise ReviewError(
            "Only customers who have received this book can review it."
        )
    if query_one(
        "SELECT id FROM reviews WHERE product_slug = ? AND customer_id = ?",
        (product_slug, customer_id),
    ):
        raise ReviewError("You have already reviewed this book.")

    review_id = f"rev_{secrets.token_hex(8)}"
    with transaction() as conn:
        conn.execute(
            "INSERT INTO reviews"
            " (id, product_slug, author, rating, title, body, date, verified,"
            "  status, customer_id, order_id, source, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                review_id, product_slug, (author or "Verified buyer")[:80], rating,
                title[:120], body[:4000], _now()[:10],
                # Verified is DERIVED from the delivered order above, never
                # taken from the request.
                1,
                # Moderated before it appears. A shop cannot un-see a review
                # that went straight to the product page.
                "pending",
                customer_id, order_id, "customer", _now(),
            ),
        )
    log.info("Review %s submitted for %s", review_id, product_slug)
    try:
        from app.services import notifications

        notifications.review_pending(review_id, product_slug)
    except Exception:  # noqa: BLE001
        log.exception("Review notification failed for %s", review_id)
    return get(review_id) or {}


def get(review_id: str) -> dict | None:
    row = query_one("SELECT * FROM reviews WHERE id = ?", (review_id,))
    return dict(row) if row else None


def moderate(
    review_id: str, decision: str, *, actor_id: str, reply: str = ""
) -> dict:
    if decision not in {"published", "rejected"}:
        raise ReviewError(f"Unknown decision {decision!r}")
    review = get(review_id)
    if review is None:
        raise ReviewError("No such review")

    with transaction() as conn:
        conn.execute(
            "UPDATE reviews SET status = ?, admin_reply = COALESCE(NULLIF(?,''), admin_reply),"
            " replied_at = CASE WHEN ? <> '' THEN ? ELSE replied_at END"
            " WHERE id = ?",
            (decision, reply[:2000], reply, _now(), review_id),
        )
    recompute(review["product_slug"])
    log.info("Review %s %s by %s", review_id, decision, actor_id)
    return get(review_id) or {}


def pending(limit: int = 100) -> list[dict]:
    return [
        dict(r)
        for r in query(
            "SELECT * FROM reviews WHERE status = 'pending'"
            " ORDER BY created_at ASC LIMIT ?",
            (int(limit),),
        )
    ]


def for_product(product_slug: str, limit: int = 50) -> list[dict]:
    """Published reviews. Seeded and genuine both appear, by current decision."""
    return [
        dict(r)
        for r in query(
            "SELECT id, author, rating, title, body, date, verified, source,"
            "       admin_reply, replied_at"
            "  FROM reviews WHERE product_slug = ? AND status = 'published'"
            " ORDER BY verified DESC, date DESC LIMIT ?",
            (product_slug, int(limit)),
        )
    ]


def recompute(product_slug: str) -> dict:
    """Refresh the denormalised rating on the book.

    Computed over PUBLISHED reviews only — a pending or rejected review must not
    move the star rating, or moderation would be cosmetic.
    """
    row = query_one(
        "SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews"
        " WHERE product_slug = ? AND status = 'published'",
        (product_slug,),
    )
    count = row["n"] or 0
    average = round(row["avg"], 2) if row["avg"] is not None else 0

    with transaction() as conn:
        conn.execute(
            "UPDATE books SET rating = ?, review_count = ? WHERE slug = ?",
            (average, count, product_slug),
        )
    return {"slug": product_slug, "rating": average, "count": count}


def stats() -> dict:
    """Provenance breakdown — what the handover checklist needs to see."""
    rows = query(
        "SELECT source, status, COUNT(*) AS n FROM reviews GROUP BY source, status"
    )
    out: dict[str, dict[str, int]] = {}
    for row in rows:
        out.setdefault(row["source"], {})[row["status"]] = row["n"]
    return out
