"""Order requests.

There is no payment gateway. An "order" here is a request the shop confirms by
phone, so the language everywhere — API, UI, emails — says *requested*, never
*placed*.

TWO RULES THAT ARE NOT NEGOTIABLE
---------------------------------
1. **Totals are recomputed server-side from `books.price`.** The client's
   numbers are read for nothing except comparison. A cart total posted by the
   browser is a suggestion from a stranger.

2. **The order number is a credential.** The assistant can look up an order by
   number alone, which means anyone holding a number can see that order. So it
   is 8 random base32 characters (~40 bits), not a timestamp — a sequential or
   time-derived number would let someone enumerate other people's orders by
   counting. Even so, a lookup returns status and items only: never the phone
   number, never the full address.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets
import uuid

from app.config import settings
from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

# Unambiguous alphabet: no O/0, no I/1/L. These get read aloud over the phone.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

STATUSES = ("requested", "confirmed", "packed", "shipped", "delivered", "cancelled")

# What a customer is told each status means. The bot reads these verbatim rather
# than improvising, so the story never changes between channels.
STATUS_TEXT = {
    "requested": "received — we will call you to confirm the books and the total",
    "confirmed": "confirmed and being packed",
    "packed": "packed and waiting for the courier",
    "shipped": "shipped and on its way to you",
    "delivered": "delivered",
    "cancelled": "cancelled",
}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _new_number() -> str:
    return "CC-" + "".join(secrets.choice(_ALPHABET) for _ in range(8))


def price_lines(items: list[dict]) -> tuple[list[dict], int]:
    """Resolve cart items to priced lines using the DATABASE's prices.

    Extracted so order creation and the checkout coupon preview cannot drift:
    a preview that priced lines differently would quote a discount the real
    order does not honour, which the customer would rightly call a bait.

    Unsellable slugs are dropped rather than raising — the caller decides
    whether an empty result is an error.
    """
    wanted: dict[str, int] = {}
    for item in items:
        slug = str(item.get("slug", "")).strip()
        qty = max(1, min(20, int(item.get("qty", 1))))
        if slug:
            wanted[slug] = wanted.get(slug, 0) + qty
    if not wanted:
        return [], 0

    marks = ",".join("?" * len(wanted))
    rows = query(
        f"SELECT slug, title, price, class_id, medium, series, in_stock FROM books"
        f" WHERE slug IN ({marks}) AND status = 'published'",
        list(wanted),
    )
    found = {r["slug"]: r for r in rows}

    lines: list[dict] = []
    subtotal = 0
    for slug, qty in wanted.items():
        row = found.get(slug)
        if row is None:
            continue  # not sellable, so not billed
        line_total = int(row["price"]) * qty
        subtotal += line_total
        lines.append(
            {
                "slug": slug,
                "title": row["title"],
                "classId": row["class_id"],
                "medium": row["medium"],
                # Carried for coupon scoping ("20% off Kohinoor").
                "series": row["series"],
                # Snapshot: a later price change must not rewrite history.
                "unitPrice": int(row["price"]),
                "qty": qty,
                "lineTotal": line_total,
            }
        )
    return lines, subtotal


def create_order(
    *,
    items: list[dict],
    customer: dict,
    coupon: str | None = None,
    source: str = "checkout",
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """Create an order from slugs and quantities. Prices come from the database.

    Raises ValueError if nothing in the cart resolves to a sellable book — which
    is the correct outcome, because an order for nothing is not an order.
    """
    lines, subtotal = price_lines(items)
    if not lines:
        raise ValueError("None of those books are available.")

    shipping = 0 if subtotal >= settings.free_shipping_threshold else settings.shipping_flat_rate

    # Coupon, applied HERE and nowhere else.
    #
    # The discount is recomputed from the lines this function just priced from
    # the database — never taken from the request. A coupon validated on the
    # cart page and believed at checkout is free money: change the cart after
    # validation, keep the discount. `coupons.evaluate` runs again against the
    # real basket, and an invalid code is dropped rather than failing the order,
    # because losing a sale over an expired coupon is the worse outcome.
    discount = 0
    coupon_code = ""
    if coupon:
        from app.services import coupons as coupons_service

        try:
            applied = coupons_service.evaluate(
                coupon, lines, shipping=shipping,
                customer_id=customer.get("customerId"),
                phone=str(customer.get("phone", "")),
            )
            discount = applied["discount"]
            coupon_code = applied["code"]
            if applied["freeShipping"]:
                shipping = 0
        except Exception as exc:  # noqa: BLE001 — includes CouponError
            log.info("Coupon %r not applied to a new order: %s", coupon, exc)

    total = subtotal - discount + shipping

    order_id = f"ord_{uuid.uuid4().hex[:12]}"
    number = _new_number()

    with transaction() as conn:
        # Astronomically unlikely, but a collision would attach one customer's
        # order to another's number — worth one extra query to rule out.
        while conn.execute(
            "SELECT 1 FROM orders WHERE order_number = ?", (number,)
        ).fetchone():
            number = _new_number()

        conn.execute(
            "INSERT INTO orders (id, order_number, status, customer_name, phone, email,"
            " address_line1, address_line2, city, state, pincode, notes,"
            " subtotal, shipping, total, source, ip, user_agent, created_at, updated_at,"
            " coupon_code, discount)"
            " VALUES (?,?,'requested',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                order_id, number,
                customer.get("name", "")[:120], customer.get("phone", "")[:20],
                customer.get("email", "")[:200], customer.get("address1", "")[:300],
                customer.get("address2", "")[:300], customer.get("city", "")[:100],
                customer.get("state", "")[:100], customer.get("pincode", "")[:10],
                customer.get("notes", "")[:1000],
                subtotal, shipping, total, source, ip, (user_agent or "")[:300],
                _now(), _now(), coupon_code, discount,
            ),
        )
        for line in lines:
            conn.execute(
                "INSERT INTO order_items (order_id, slug, format, title, class_id, medium,"
                " unit_price, qty, line_total) VALUES (?,?,'book',?,?,?,?,?,?)",
                (
                    order_id, line["slug"], line["title"], line["classId"],
                    line["medium"], line["unitPrice"], line["qty"], line["lineTotal"],
                ),
            )
        conn.execute(
            "INSERT INTO order_events (order_id, from_status, to_status, note, actor, created_at)"
            " VALUES (?,NULL,'requested','Created from the storefront',?,?)",
            (order_id, source, _now()),
        )

    return {
        "id": order_id,
        "orderNumber": number,
        "status": "requested",
        "items": lines,
        "subtotal": subtotal,
        "shipping": shipping,
        "total": total,
    }


def lookup(order_number: str) -> dict | None:
    """Public-safe order status, for the assistant and the tracking page.

    Deliberately narrow. Status, items, dates, and the city only — never the
    phone number, never the street address, never the email. The order number
    alone is enough to reach this, so it must not be enough to harvest anyone's
    contact details.
    """
    number = (order_number or "").strip().upper()
    if not number.startswith("CC-"):
        number = f"CC-{number}"
    if len(number) != 11:
        return None

    row = query_one("SELECT * FROM orders WHERE order_number = ?", (number,))
    if row is None:
        return None

    items = query(
        "SELECT title, qty, line_total FROM order_items WHERE order_id = ?", (row["id"],)
    )
    events = query(
        "SELECT to_status, note, created_at FROM order_events"
        " WHERE order_id = ? ORDER BY created_at",
        (row["id"],),
    )

    return {
        "orderNumber": row["order_number"],
        "status": row["status"],
        "statusText": STATUS_TEXT.get(row["status"], row["status"]),
        "placedOn": row["created_at"],
        "updatedOn": row["updated_at"],
        # A first name is enough to confirm "yes, this is your order" without
        # handing over anything useful to someone who guessed a number.
        "customerFirstName": (row["customer_name"] or "").split(" ")[0],
        "city": row["city"],
        "itemCount": sum(int(i["qty"]) for i in items),
        "items": [{"title": i["title"], "qty": i["qty"]} for i in items],
        "total": row["total"],
        "history": [
            {"status": e["to_status"], "note": e["note"], "at": e["created_at"]}
            for e in events
        ],
    }


def set_status(order_number: str, status: str, note: str = "", actor: str | None = None) -> bool:
    if status not in STATUSES:
        raise ValueError(f"Unknown status: {status}")
    row = query_one("SELECT id, status FROM orders WHERE order_number = ?", (order_number,))
    if row is None:
        return False
    with transaction() as conn:
        conn.execute(
            "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
            (status, _now(), row["id"]),
        )
        conn.execute(
            "INSERT INTO order_events (order_id, from_status, to_status, note, actor, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (row["id"], row["status"], status, note[:500], actor, _now()),
        )
    return True


# Matches CC-ABCD2345 anywhere in a sentence, with or without the prefix.
import re  # noqa: E402

ORDER_NUMBER = re.compile(r"\b(?:CC[-\s]?)?([" + _ALPHABET + r"]{8})\b", re.IGNORECASE)


def extract_number(text: str) -> str | None:
    """Pull an order number out of a chat message.

    Requires the CC- prefix OR a standalone 8-character token from the order
    alphabet. Without that constraint, ordinary words would match and every
    other message would be treated as an order lookup.
    """
    if not text:
        return None
    explicit = re.search(r"\bCC[-\s]?([" + _ALPHABET + r"]{8})\b", text, re.IGNORECASE)
    if explicit:
        return f"CC-{explicit.group(1).upper()}"
    return None
