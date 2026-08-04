"""Coupon validation and discount arithmetic.

    python -m tests.test_coupons
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_cpn_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import coupons  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def line(slug: str, total: int, qty: int = 1, class_id: str = "10", series: str = "kohinoor") -> dict:
    return {"slug": slug, "lineTotal": total, "qty": qty,
            "classId": class_id, "series": series}


def refused(code: str, lines: list[dict], **kw) -> str | None:
    try:
        coupons.evaluate(code, lines, **kw)
        return None
    except coupons.CouponError as exc:
        return str(exc)


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    cart = [line("a", 500), line("b", 300)]  # subtotal 800

    print("=== percentage and flat ===")
    coupons.create(code="save10", kind="percent", value=10)
    result = coupons.evaluate("SAVE10", cart)
    check("10% of 800 is 80", result["discount"] == 80, str(result))
    check("codes are case-insensitive", coupons.evaluate("save10", cart)["discount"] == 80)

    coupons.create(code="flat50", kind="flat", value=50)
    check("flat takes off its face value", coupons.evaluate("FLAT50", cart)["discount"] == 50)

    print("\n=== a discount can never exceed the goods ===")
    coupons.create(code="huge", kind="flat", value=100000)
    result = coupons.evaluate("HUGE", cart)
    check("capped at the cart value", result["discount"] == 800, str(result))
    check("and never negative", result["discount"] >= 0)

    print("\n=== max_discount caps a percentage ===")
    coupons.create(code="big20", kind="percent", value=20, maxDiscount=100)
    check("20% of 800 would be 160, capped to 100",
          coupons.evaluate("BIG20", cart)["discount"] == 100,
          "this is what stops a bulk school order costing thousands")

    print("\n=== minimum cart ===")
    coupons.create(code="min1000", kind="flat", value=100, minCart=1000)
    message = refused("MIN1000", cart)
    check("a small cart is refused", message is not None)
    check("and told exactly how much more is needed", "200" in (message or ""), message or "")
    check("a big enough cart works",
          coupons.evaluate("MIN1000", [line("a", 1200)])["discount"] == 100)

    print("\n=== validity window ===")
    past = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)).isoformat()
    future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).isoformat()
    coupons.create(code="expired", kind="flat", value=50, endsAt=past)
    coupons.create(code="notyet", kind="flat", value=50, startsAt=future)
    check("an expired coupon is refused", "expired" in (refused("EXPIRED", cart) or "").lower())
    check("a future coupon is refused", "not active yet" in (refused("NOTYET", cart) or "").lower())

    print("\n=== scoping applies to matching lines ONLY ===")
    coupons.create(code="class9", kind="percent", value=50, classIds=["9"])
    mixed = [line("x", 400, class_id="9"), line("y", 600, class_id="10")]
    result = coupons.evaluate("CLASS9", mixed)
    check("50% applies to the Class 9 line only", result["discount"] == 200,
          f"{result['discount']} — a scoped coupon must not discount the whole cart")
    check("a cart with nothing eligible is refused",
          refused("CLASS9", [line("y", 600, class_id="10")]) is not None)

    print("\n=== free shipping ===")
    coupons.create(code="freeship", kind="free_shipping", value=0)
    result = coupons.evaluate("FREESHIP", cart, shipping=40)
    check("shipping is zeroed", result["shipping"] == 0 and result["freeShipping"] is True, str(result))
    check("but the goods are not discounted", result["discount"] == 0,
          "'free shipping' must not also take money off the books")

    print("\n=== buy X get Y gives away the CHEAPEST ===")
    coupons.create(code="b2g1", kind="bxgy", value=0, buyQty=2, getQty=1)
    three = [line("cheap", 100), line("mid", 200), line("dear", 300)]
    result = coupons.evaluate("B2G1", three)
    check("one free unit, and it is the cheapest", result["discount"] == 100,
          f"{result['discount']} — giving away the dearest is generous in a way no shop intends")
    six = [line("a", 100), line("b", 100), line("c", 200),
           line("d", 200), line("e", 300), line("f", 300)]
    check("two groups give two free units", coupons.evaluate("B2G1", six)["discount"] == 200,
          str(coupons.evaluate("B2G1", six)["discount"]))
    check("a qty-3 line counts as three units",
          coupons.evaluate("B2G1", [line("bulk", 300, qty=3)])["discount"] == 100)

    print("\n=== usage limits ===")
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO orders (id, order_number, status, customer_name, phone,"
            " subtotal, shipping, total, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("ord1", "CC-TEST0001", "requested", "T", "9876500000",
             800, 0, 800, now, now),
        )
    coupons.create(code="once", kind="flat", value=50, perUserLimit=1)
    coupons.redeem("ONCE", "ord1", cart, phone="9876500000")
    check("the second use by the same phone is refused",
          "already used" in (refused("ONCE", cart, phone="9876500000") or "").lower())
    check("a different customer can still use it",
          coupons.evaluate("ONCE", cart, phone="9999999999")["discount"] == 50)

    coupons.create(code="limited", kind="flat", value=10, usageLimit=1)
    with transaction() as conn:
        conn.execute(
            "INSERT INTO orders (id, order_number, status, customer_name, phone,"
            " subtotal, shipping, total, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("ord2", "CC-TEST0002", "requested", "T", "8888888888",
             800, 0, 800, now, now),
        )
    coupons.redeem("LIMITED", "ord2", cart, phone="8888888888")
    check("a globally exhausted coupon is refused",
          "fully redeemed" in (refused("LIMITED", cart, phone="7777777777") or "").lower())

    print("\n=== redeem re-evaluates; it never trusts an earlier answer ===")
    # The classic exploit: validate a big cart, then check out with a small one.
    coupons.create(code="recheck", kind="flat", value=100, minCart=1000)
    big = [line("a", 1500)]
    coupons.evaluate("RECHECK", big)  # passes
    with transaction() as conn:
        conn.execute(
            "INSERT INTO orders (id, order_number, status, customer_name, phone,"
            " subtotal, shipping, total, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("ord3", "CC-TEST0003", "requested", "T", "6666666666",
             100, 0, 100, now, now),
        )
    small = [line("a", 100)]
    try:
        coupons.redeem("RECHECK", "ord3", small, phone="6666666666")
        check("shrinking the cart after validation is caught", False,
              "the discount survived a cart change — this is free money")
    except coupons.CouponError:
        check("shrinking the cart after validation is caught", True)

    print("\n=== auto-apply picks the best ===")
    coupons.create(code="auto5", kind="percent", value=5, autoApply=True)
    coupons.create(code="auto15", kind="percent", value=15, autoApply=True)
    best = coupons.auto_apply_for(cart, shipping=40)
    check("the most valuable automatic coupon wins", best["code"] == "AUTO15", str(best))
    check("an inactive coupon is not auto-applied",
          (coupons.set_active("auto15", False),
           coupons.auto_apply_for(cart, shipping=40)["code"] == "AUTO5")[1])

    print("\n=== bad input ===")
    check("an unknown code is refused", refused("NOPE", cart) is not None)
    for bad in ({"code": "p0", "kind": "percent", "value": 0},
                {"code": "p200", "kind": "percent", "value": 200},
                {"code": "weird", "kind": "teleport", "value": 5}):
        try:
            coupons.create(**bad)
            check(f"invalid coupon {bad['code']} refused", False, "accepted")
        except coupons.CouponError:
            check(f"invalid coupon {bad['code']} refused", True)
    try:
        coupons.create(code="save10", kind="flat", value=1)
        check("a duplicate code is refused", False, "accepted")
    except coupons.CouponError:
        check("a duplicate code is refused", True)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Coupons hold: recomputed server-side, capped, and never free money.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
