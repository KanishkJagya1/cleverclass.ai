"""Server-side cart and wishlist.

THE RULE: quantities are stored, prices never are.

Every read re-prices from `books`. A stored price is a second source of truth
that goes stale the moment someone edits the catalogue, and "but the cart said
₹250" is an argument no shop wants. `orders.create_order` already re-prices for
the same reason; this simply does not create the discrepancy in the first place.

MERGING ON LOGIN

A guest fills a basket, then signs in. Quantities are taken as the MAXIMUM of
the two sides rather than the sum: someone who put 2 copies in on their phone
and 2 on the laptop wants 2, not 4. Adding is the intuitive implementation and
the wrong one — it silently doubles orders.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

MAX_QTY = 20
MAX_LINES = 40


class BasketError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# ------------------------------------------------------------------- cart --
def cart(customer_id: str) -> dict:
    """The cart, priced from the database at read time."""
    rows = query(
        "SELECT c.*, b.title, b.price, b.mrp, b.ebook_price, b.ebook_available,"
        "       b.class_id, b.medium, b.in_stock,"
        "       b.status,"
        "       (SELECT src FROM book_images i WHERE i.book_id = b.id"
        "         ORDER BY i.position LIMIT 1) AS cover"
        "  FROM cart_items c LEFT JOIN books b ON b.slug = c.slug"
        " WHERE c.customer_id = ? ORDER BY c.added_at",
        (customer_id,),
    )

    items = []
    subtotal = 0
    unavailable = []
    for row in rows:
        # A book that was unpublished or deleted while it sat in the cart is
        # reported rather than silently dropped — a line vanishing without a
        # word is how a customer ends up ordering the wrong thing.
        if row["title"] is None or row["status"] != "published":
            unavailable.append(row["slug"])
            continue
        # An e-book line is priced from `ebook_price`. Using `price` here
        # would show the printed cost in the basket and the real one at
        # checkout — the discrepancy customers notice last and trust least.
        delivery = row["delivery"] or "physical"
        if delivery == "digital":
            if not row["ebook_available"] or row["ebook_price"] is None:
                unavailable.append(row["slug"])
                continue
            unit_price = int(row["ebook_price"])
        else:
            unit_price = int(row["price"])

        line_total = unit_price * row["qty"]
        subtotal += line_total
        items.append({
            "slug": row["slug"],
            "format": row["format"],
            "delivery": delivery,
            "title": row["title"],
            "classId": row["class_id"],
            "medium": row["medium"],
            "price": unit_price,
            "mrp": row["mrp"] if delivery != "digital" else None,
            "qty": row["qty"],
            "lineTotal": line_total,
            "inStock": bool(row["in_stock"]),
            "cover": row["cover"],
            "addedAt": row["added_at"],
        })

    return {"items": items, "subtotal": subtotal, "count": sum(i["qty"] for i in items),
            "unavailable": unavailable}


def set_item(customer_id: str, slug: str, qty: int, fmt: str = "book",
             delivery: str = "physical") -> dict:
    if qty < 0:
        raise BasketError("Quantity cannot be negative")
    delivery = delivery if delivery in ("physical", "digital") else "physical"
    if qty == 0:
        return remove_item(customer_id, slug, fmt, delivery)

    qty = min(qty, MAX_QTY)
    existing = query_one(
        "SELECT id FROM cart_items WHERE customer_id = ? AND slug = ?"
        " AND format = ? AND delivery = ?",
        (customer_id, slug, fmt, delivery),
    )
    if existing is None:
        lines = query_one(
            "SELECT COUNT(*) n FROM cart_items WHERE customer_id = ?", (customer_id,)
        )["n"]
        if lines >= MAX_LINES:
            raise BasketError(f"A cart can hold {MAX_LINES} different titles.")

    with transaction() as conn:
        conn.execute(
            "INSERT INTO cart_items (id, customer_id, slug, format, delivery,"
            " qty, added_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
            # Must match idx_cart_unique exactly, delivery included — SQLite
            # rejects an ON CONFLICT target that is not a real unique index.
            " ON CONFLICT(customer_id, slug, format, delivery)"
            " DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at",
            (f"crt_{secrets.token_hex(8)}", customer_id, slug, fmt, delivery, qty,
             _now(), _now()),
        )
    return cart(customer_id)


def remove_item(customer_id: str, slug: str, fmt: str = "book",
                delivery: str | None = None) -> dict:
    with transaction() as conn:
        if delivery is None:
            # No delivery given removes BOTH formats of the title. That is the
            # honest reading of "remove this book from my cart".
            conn.execute(
                "DELETE FROM cart_items WHERE customer_id = ? AND slug = ?"
                " AND format = ?",
                (customer_id, slug, fmt),
            )
        else:
            conn.execute(
                "DELETE FROM cart_items WHERE customer_id = ? AND slug = ?"
                " AND format = ? AND delivery = ?",
                (customer_id, slug, fmt, delivery),
            )
    return cart(customer_id)


def clear(customer_id: str) -> dict:
    with transaction() as conn:
        conn.execute("DELETE FROM cart_items WHERE customer_id = ?", (customer_id,))
    return cart(customer_id)


def merge_guest_cart(customer_id: str, guest_items: list[dict]) -> dict:
    """Fold a guest basket into the account's cart at sign-in.

    MAX, not sum. Two copies added on a phone and two on a laptop is a customer
    who wants two — summing would quietly double the order, and the customer
    would only find out from the invoice.
    """
    if not guest_items:
        return cart(customer_id)

    current = {
        (r["slug"], r["format"]): r["qty"]
        for r in query(
            "SELECT slug, format, qty FROM cart_items WHERE customer_id = ?",
            (customer_id,),
        )
    }
    with transaction() as conn:
        for item in guest_items[:MAX_LINES]:
            slug = str(item.get("slug", "")).strip()
            if not slug:
                continue
            fmt = str(item.get("format", "book"))
            delivery = str(item.get("delivery") or "physical")
            if delivery not in ("physical", "digital"):
                delivery = "physical"
            qty = max(1, min(MAX_QTY, int(item.get("qty", 1))))
            merged = max(qty, current.get((slug, fmt), 0))
            conn.execute(
                "INSERT INTO cart_items (id, customer_id, slug, format, delivery,"
                " qty, added_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
                " ON CONFLICT(customer_id, slug, format, delivery)"
                " DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at",
                (f"crt_{secrets.token_hex(8)}", customer_id, slug, fmt, delivery,
                 merged, _now(), _now()),
            )
    log.info("Merged %d guest line(s) into cart for %s", len(guest_items), customer_id)
    return cart(customer_id)


# --------------------------------------------------------------- wishlist --
def wishlist(customer_id: str) -> dict:
    rows = query(
        "SELECT w.*, b.title, b.price, b.mrp, b.class_id, b.medium, b.in_stock,"
        "       (SELECT src FROM book_images i WHERE i.book_id = b.id"
        "         ORDER BY i.position LIMIT 1) AS cover"
        "  FROM wishlist_items w LEFT JOIN books b ON b.slug = w.slug"
        " WHERE w.customer_id = ? AND b.status = 'published'"
        " ORDER BY w.added_at DESC",
        (customer_id,),
    )
    return {
        "items": [
            {
                "slug": r["slug"], "title": r["title"], "price": int(r["price"]),
                "mrp": r["mrp"], "classId": r["class_id"], "medium": r["medium"],
                "inStock": bool(r["in_stock"]), "cover": r["cover"],
                "addedAt": r["added_at"],
            }
            for r in rows
        ]
    }


def add_to_wishlist(customer_id: str, slug: str) -> dict:
    with transaction() as conn:
        conn.execute(
            "INSERT INTO wishlist_items (id, customer_id, slug, added_at)"
            " VALUES (?,?,?,?) ON CONFLICT(customer_id, slug) DO NOTHING",
            (f"wsh_{secrets.token_hex(8)}", customer_id, slug, _now()),
        )
    return wishlist(customer_id)


def remove_from_wishlist(customer_id: str, slug: str) -> dict:
    with transaction() as conn:
        conn.execute(
            "DELETE FROM wishlist_items WHERE customer_id = ? AND slug = ?",
            (customer_id, slug),
        )
    return wishlist(customer_id)


def merge_guest_wishlist(customer_id: str, slugs: list[str]) -> dict:
    with transaction() as conn:
        for slug in slugs[:200]:
            if not str(slug).strip():
                continue
            conn.execute(
                "INSERT INTO wishlist_items (id, customer_id, slug, added_at)"
                " VALUES (?,?,?,?) ON CONFLICT(customer_id, slug) DO NOTHING",
                (f"wsh_{secrets.token_hex(8)}", customer_id, str(slug), _now()),
            )
    return wishlist(customer_id)


def abandoned(hours: int = 24, limit: int = 100) -> list[dict]:
    """Carts untouched for `hours`, for a reminder job.

    Only accounts with a VERIFIED email — an abandoned-cart email to an
    unverified address is mail to someone who may not own that mailbox.
    """
    cutoff = (
        dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)
    ).isoformat()
    rows = query(
        "SELECT c.customer_id, cu.email, cu.name, MAX(c.updated_at) AS last_touch,"
        "       COUNT(*) AS lines"
        "  FROM cart_items c JOIN customers cu ON cu.id = c.customer_id"
        " WHERE cu.status = 'active' AND cu.email_verified_at IS NOT NULL"
        " GROUP BY c.customer_id"
        " HAVING MAX(c.updated_at) < ?"
        " ORDER BY last_touch DESC LIMIT ?",
        (cutoff, int(limit)),
    )
    return [dict(r) for r in rows]
