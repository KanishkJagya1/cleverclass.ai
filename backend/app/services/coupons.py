"""Coupon validation and discount calculation.

THE RULE THIS MODULE EXISTS TO ENFORCE

**The discount is recomputed from the cart every single time, server-side.**
Never read from the request, never trusted from a previous step. A coupon
validated at cart time and believed at checkout is a discount vulnerability: the
customer changes the cart after validation and keeps the discount, or simply
posts `discount: 5000` and is believed.

So `evaluate()` takes a cart and returns an amount, and `redeem()` re-evaluates
before writing anything down.

ORDER OF OPERATIONS

Discount applies to the SUBTOTAL, before shipping. Free-shipping coupons zero
the shipping line instead. Applying a percentage to subtotal+shipping quietly
discounts delivery too, which is not what "10% off books" means to anyone.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import secrets

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

KINDS = ("percent", "flat", "free_shipping", "bxgy")


class CouponError(RuntimeError):
    """Why the coupon cannot be used. The message is shown to the customer."""


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def normalise(code: str) -> str:
    return (code or "").strip().upper()


def get(code: str) -> dict | None:
    row = query_one("SELECT * FROM coupons WHERE code = ?", (normalise(code),))
    if row is None:
        return None
    coupon = dict(row)
    for field in ("product_slugs", "class_ids", "series"):
        try:
            coupon[field] = json.loads(coupon[field] or "[]")
        except ValueError:
            coupon[field] = []
    return coupon


def _eligible_lines(coupon: dict, lines: list[dict]) -> list[dict]:
    """The cart lines this coupon applies to.

    An unscoped coupon covers everything. A scoped one covers only matching
    lines, and the discount is computed on those lines alone — otherwise
    "10% off Class 10 books" silently discounts the Class 9 book in the cart.
    """
    slugs = {s.lower() for s in coupon["product_slugs"]}
    classes = {str(c) for c in coupon["class_ids"]}
    series = {s.lower() for s in coupon["series"]}
    if not slugs and not classes and not series:
        return list(lines)

    out = []
    for line in lines:
        if slugs and line.get("slug", "").lower() in slugs:
            out.append(line)
        elif classes and str(line.get("classId", "")) in classes:
            out.append(line)
        elif series and str(line.get("series", "")).lower() in series:
            out.append(line)
    return out


def _usage_ok(coupon: dict, customer_id: str | None, phone: str) -> None:
    if coupon["usage_limit"] is not None and coupon["used_count"] >= coupon["usage_limit"]:
        raise CouponError("This coupon has been fully redeemed.")

    limit = coupon["per_user_limit"]
    if limit and (customer_id or phone):
        # Identity is the account when signed in, the phone number otherwise.
        # Guest checkout has no account, and no per-user limit at all would make
        # a one-per-customer coupon meaningless.
        if customer_id:
            used = query_one(
                "SELECT COUNT(*) n FROM coupon_redemptions"
                " WHERE coupon_id = ? AND customer_id = ?",
                (coupon["id"], customer_id),
            )["n"]
        else:
            used = query_one(
                "SELECT COUNT(*) n FROM coupon_redemptions"
                " WHERE coupon_id = ? AND phone = ?",
                (coupon["id"], phone),
            )["n"]
        if used >= limit:
            raise CouponError("You have already used this coupon.")


def _first_order_ok(coupon: dict, customer_id: str | None, phone: str) -> None:
    if not coupon["first_order_only"]:
        return
    if customer_id:
        prior = query_one(
            "SELECT COUNT(*) n FROM orders WHERE customer_id = ?"
            " AND status NOT IN ('cancelled')",
            (customer_id,),
        )["n"]
    elif phone:
        prior = query_one(
            "SELECT COUNT(*) n FROM orders WHERE phone = ?"
            " AND status NOT IN ('cancelled')",
            (phone,),
        )["n"]
    else:
        prior = 0
    if prior:
        raise CouponError("This coupon is for first orders only.")


def evaluate(
    code: str,
    lines: list[dict],
    *,
    shipping: int = 0,
    customer_id: str | None = None,
    phone: str = "",
) -> dict:
    """Validate and price a coupon against a cart.

    `lines` are dicts with slug, classId, series, qty and lineTotal — the
    server's own figures, never the client's.

    Raises CouponError with a customer-facing message; the caller shows it.
    """
    coupon = get(code)
    if coupon is None:
        raise CouponError("That coupon code is not valid.")
    if not coupon["is_active"]:
        raise CouponError("That coupon is no longer active.")

    now = _now()
    if coupon["starts_at"] and now < coupon["starts_at"]:
        raise CouponError("That coupon is not active yet.")
    if coupon["ends_at"] and now > coupon["ends_at"]:
        raise CouponError("That coupon has expired.")

    subtotal = sum(int(line.get("lineTotal", 0)) for line in lines)
    if subtotal < coupon["min_cart"]:
        raise CouponError(
            f"Add ₹{coupon['min_cart'] - subtotal} more to use this coupon."
        )

    _usage_ok(coupon, customer_id, phone)
    _first_order_ok(coupon, customer_id, phone)

    eligible = _eligible_lines(coupon, lines)
    if not eligible:
        raise CouponError("This coupon does not apply to anything in your cart.")
    eligible_total = sum(int(line.get("lineTotal", 0)) for line in eligible)

    kind = coupon["kind"]
    discount = 0
    free_shipping = False

    if kind == "percent":
        discount = round(eligible_total * coupon["value"] / 100)
    elif kind == "flat":
        discount = coupon["value"]
    elif kind == "free_shipping":
        free_shipping = True
        discount = 0
    elif kind == "bxgy":
        discount = _bxgy_discount(coupon, eligible)

    if coupon["max_discount"] is not None:
        discount = min(discount, coupon["max_discount"])
    # Never more than the goods are worth. A flat ₹100 coupon on a ₹80 cart
    # must not make the order free, and must never go negative.
    discount = max(0, min(discount, eligible_total))

    return {
        "code": coupon["code"],
        "kind": kind,
        "discount": discount,
        "freeShipping": free_shipping,
        "shipping": 0 if free_shipping else shipping,
        "description": coupon["description"],
        "couponId": coupon["id"],
    }


def _bxgy_discount(coupon: dict, lines: list[dict]) -> int:
    """Buy X get Y: the CHEAPEST qualifying units are the free ones.

    Giving away the most expensive would be generous in a way no shop intends,
    and it is the default if you simply take the first N.
    """
    buy, get = coupon["buy_qty"], coupon["get_qty"]
    if buy <= 0 or get <= 0:
        return 0

    # Expand to unit prices so a line of qty 3 counts as three units.
    units: list[int] = []
    for line in lines:
        qty = max(1, int(line.get("qty", 1)))
        unit = int(line.get("lineTotal", 0)) // qty
        units.extend([unit] * qty)

    units.sort()  # cheapest first
    groups = len(units) // (buy + get)
    free_units = groups * get
    return sum(units[:free_units])


def auto_apply_for(
    lines: list[dict],
    *,
    shipping: int = 0,
    customer_id: str | None = None,
    phone: str = "",
) -> dict | None:
    """The best automatic coupon for this cart, if any qualifies."""
    best = None
    for row in query(
        "SELECT code FROM coupons WHERE is_active = 1 AND auto_apply = 1"
    ):
        try:
            result = evaluate(
                row["code"], lines, shipping=shipping,
                customer_id=customer_id, phone=phone,
            )
        except CouponError:
            continue
        # Compare on real value to the customer, so a free-shipping coupon can
        # beat a small percentage one.
        value = result["discount"] + (shipping if result["freeShipping"] else 0)
        if best is None or value > best[0]:
            best = (value, result)
    return best[1] if best else None


def redeem(
    code: str,
    order_id: str,
    lines: list[dict],
    *,
    shipping: int = 0,
    customer_id: str | None = None,
    phone: str = "",
) -> dict:
    """Record a redemption. RE-EVALUATES first — never trusts an earlier result."""
    result = evaluate(
        code, lines, shipping=shipping, customer_id=customer_id, phone=phone
    )
    with transaction() as conn:
        conn.execute(
            "INSERT INTO coupon_redemptions"
            " (coupon_id, order_id, customer_id, phone, amount, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (result["couponId"], order_id, customer_id, phone,
             result["discount"], _now()),
        )
        conn.execute(
            "UPDATE coupons SET used_count = used_count + 1 WHERE id = ?",
            (result["couponId"],),
        )
    return result


# ------------------------------------------------------------------- admin --
def create(**fields) -> dict:
    code = normalise(fields.get("code", ""))
    if not code:
        raise CouponError("A coupon needs a code")
    if get(code):
        raise CouponError("That code is already in use")
    kind = fields.get("kind", "percent")
    if kind not in KINDS:
        raise CouponError(f"Unknown kind. Valid: {', '.join(KINDS)}")
    if kind == "percent" and not 0 < int(fields.get("value", 0)) <= 100:
        raise CouponError("A percentage coupon must be between 1 and 100")

    coupon_id = f"cpn_{secrets.token_hex(6)}"
    with transaction() as conn:
        conn.execute(
            "INSERT INTO coupons (id, code, description, kind, value, buy_qty,"
            " get_qty, min_cart, max_discount, starts_at, ends_at, usage_limit,"
            " per_user_limit, product_slugs, class_ids, series, first_order_only,"
            " auto_apply, is_active, created_at, created_by)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                coupon_id, code, fields.get("description", ""), kind,
                int(fields.get("value", 0)), int(fields.get("buyQty", 0)),
                int(fields.get("getQty", 0)), int(fields.get("minCart", 0)),
                fields.get("maxDiscount"), fields.get("startsAt"),
                fields.get("endsAt"), fields.get("usageLimit"),
                int(fields.get("perUserLimit", 1)),
                json.dumps(fields.get("productSlugs", [])),
                json.dumps(fields.get("classIds", [])),
                json.dumps(fields.get("series", [])),
                1 if fields.get("firstOrderOnly") else 0,
                1 if fields.get("autoApply") else 0,
                1, _now(), fields.get("createdBy"),
            ),
        )
    return get(code) or {}


def set_active(code: str, active: bool) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE coupons SET is_active = ? WHERE code = ?",
            (1 if active else 0, normalise(code)),
        )


def report() -> list[dict]:
    return [
        dict(r)
        for r in query(
            "SELECT c.code, c.kind, c.value, c.is_active, c.used_count,"
            "       c.usage_limit,"
            "       (SELECT COALESCE(SUM(amount),0) FROM coupon_redemptions r"
            "         WHERE r.coupon_id = c.id) AS total_discount"
            "  FROM coupons c ORDER BY c.created_at DESC"
        )
    ]
