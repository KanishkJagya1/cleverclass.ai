"""Analytics — the revenue arithmetic behind the dashboard.

The rule this module lives or dies by: **a voided order is not revenue.**
Cancelled, refunded and returned orders must never reach a total, a series
point, a top-product row or a coupon figure. A dashboard that overstates
takings is worse than no dashboard, because nobody double-checks a number that
looks plausible.

    python -m tests.test_analytics
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_analytics_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import analytics  # noqa: E402

failures: list[str] = []
_seq = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def make_order(
    *,
    total: int,
    status: str = "delivered",
    days_ago: int = 1,
    slug: str = "an-a",
    qty: int = 1,
    coupon: str = "",
    discount: int = 0,
) -> str:
    """One order with one line, placed `days_ago` days back."""
    global _seq
    _seq += 1
    when = (
        dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days_ago)
    ).isoformat()
    order_id = f"an-o{_seq}"
    with transaction() as conn:
        conn.execute(
            "INSERT INTO orders (id, order_number, status, customer_name, phone,"
            " total, subtotal, discount, coupon_code, created_at, updated_at)"
            " VALUES (?,?,?,'Buyer','9000000000',?,?,?,?,?,?)",
            (order_id, f"CC-AN{_seq:03d}", status, total, total, discount,
             coupon, when, when),
        )
        conn.execute(
            "INSERT INTO order_items (order_id, slug, title, qty, unit_price,"
            " line_total) VALUES (?,?,?,?,?,?)",
            (order_id, slug, f"Book {slug}", qty, total // max(1, qty), total),
        )
    return order_id


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== an empty period does not divide by zero ===")
    empty = analytics.summary(30)
    check("no orders", empty["orders"] == 0, str(empty["orders"]))
    check("no revenue", empty["revenue"] == 0, str(empty["revenue"]))
    check("aov is 0, not a crash", empty["aov"] == 0, str(empty["aov"]))
    check("change is None with nothing to compare to",
          empty["change"]["revenue"] is None,
          "0% for a first month is a lie, not a neutral default")

    print("\n=== revenue counts only what was actually earned ===")
    make_order(total=1000, status="delivered", days_ago=2)
    make_order(total=500, status="confirmed", days_ago=3)
    live = analytics.summary(30)
    check("two live orders", live["orders"] == 2, str(live["orders"]))
    check("their totals add up", live["revenue"] == 1500, str(live["revenue"]))
    check("aov is the mean", live["aov"] == 750, str(live["aov"]))

    print("\n=== VOIDED ORDERS ARE NOT REVENUE ===")
    before = analytics.summary(30)["revenue"]
    for status in ("cancelled", "refund_approved", "returned"):
        make_order(total=9999, status=status, days_ago=2)
    after = analytics.summary(30)
    check("a cancelled order adds nothing",
          after["revenue"] == before, f"{before} -> {after['revenue']}")
    check("and it is not counted as an order either",
          after["orders"] == 2, str(after["orders"]),)
    check("all three void statuses are excluded",
          set(analytics._VOID) == {"cancelled", "refund_approved", "returned"},
          str(analytics._VOID))

    print("\n=== the daily series is zero-filled, not sparse ===")
    series = analytics.revenue_series(7)
    check("one point per day", len(series) == 7, str(len(series)))
    check("every day has a revenue value",
          all("revenue" in p and p["revenue"] is not None for p in series))
    check("days with no orders are 0, not missing",
          any(p["revenue"] == 0 for p in series),
          "a sparse series makes a chart lie about its x-axis")
    dates = [p["date"] for p in series]
    check("dates are in order", dates == sorted(dates), str(dates[:3]))

    print("\n=== the series excludes voided orders too ===")
    total_series = sum(p["revenue"] for p in analytics.revenue_series(30))
    check("the series sums to the summary revenue",
          total_series == after["revenue"],
          f"series={total_series} summary={after['revenue']} — "
          "a chart that disagrees with the headline is the worst kind of wrong")

    print("\n=== top products ===")
    make_order(total=600, status="delivered", days_ago=1, slug="an-hot", qty=3)
    make_order(total=200, status="delivered", days_ago=1, slug="an-cold", qty=1)
    make_order(total=800, status="cancelled", days_ago=1, slug="an-void", qty=9)
    top = analytics.top_products(30)
    slugs = [t["slug"] for t in top]
    check("the best seller leads", slugs and slugs[0] == "an-hot", str(slugs))
    check("a cancelled order's items do not chart",
          "an-void" not in slugs,
          "9 units of a cancelled order would otherwise top the list")
    hot = next(t for t in top if t["slug"] == "an-hot")
    check("units are summed", hot["units"] == 3, str(hot["units"]))

    print("\n=== coupon usage ===")
    make_order(total=400, status="delivered", days_ago=1, coupon="SAVE10",
               discount=40)
    make_order(total=400, status="delivered", days_ago=1, coupon="SAVE10",
               discount=40)
    make_order(total=400, status="cancelled", days_ago=1, coupon="SAVE10",
               discount=40)
    usage = analytics.coupon_usage(30)
    save10 = next((c for c in usage if c["code"] == "SAVE10"), None)
    check("the coupon is reported", save10 is not None, str(usage))
    check("only live orders count toward uses",
          save10 and save10["uses"] == 2, str(save10))
    check("and toward the discount given",
          save10 and save10["discount"] == 80, str(save10))
    check("orders with no coupon are not a blank row",
          all(c["code"] for c in usage), str(usage))

    print("\n=== the period boundary is respected ===")
    make_order(total=7777, status="delivered", days_ago=60)
    week = analytics.summary(7)
    check("an old order is outside a 7-day window",
          week["revenue"] < 7777, str(week["revenue"]))
    year = analytics.summary(365)
    check("but inside a 365-day one",
          year["revenue"] >= 7777, str(year["revenue"]))

    print("\n=== period-over-period change ===")
    # 10 days ago sits in the previous 7-day period, 2 days ago in the current.
    make_order(total=100, status="delivered", days_ago=10)
    changed = analytics.summary(7)
    check("a change is computed once there is a prior period",
          changed["change"]["revenue"] is not None,
          str(changed["change"]))
    check("and it is a percentage, not a ratio",
          isinstance(changed["change"]["revenue"], float),
          str(type(changed["change"]["revenue"])))

    print("\n=== the dashboard assembles without error ===")
    board = analytics.dashboard(30)
    for key in ("summary", "series", "topProducts", "operational"):
        check(f"{key} present", key in board, str(list(board)))

    print("\n=== orders_by_status covers everything, including voids ===")
    by_status = {r["status"]: r["count"] for r in analytics.orders_by_status()}
    check("cancelled orders ARE visible here",
          by_status.get("cancelled", 0) >= 1,
          "excluded from revenue, but an operator still needs to see them")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Analytics holds: voided orders never become revenue.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
