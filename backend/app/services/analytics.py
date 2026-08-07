"""Admin dashboard analytics.

Aggregated on demand, with a deliberate ceiling: every query here is bounded by
a date range and the whole dashboard is one call. At this catalogue's size
(hundreds of orders) that is fast and exact, and it avoids a rollup table that
would need backfilling, invalidating and reconciling before it earned anything.

The plan calls for a `daily_metrics` rollup, and the trigger for building it is
written down rather than guessed: when the orders table passes roughly 50,000
rows, or the dashboard takes more than ~300 ms. `revenue_series()` below is
already shaped like the rollup's output, so that change is an implementation
swap rather than a redesign.

ONE RULE THROUGHOUT: **cancelled orders are not revenue.** Counting them
flatters every number on the screen, and the first person to notice is the
owner reconciling against their bank.
"""

from __future__ import annotations

import datetime as dt
import logging

from app.db.conn import query, query_one

log = logging.getLogger(__name__)

# Anything in this set never counts as a sale.
_VOID = ("cancelled", "refund_approved", "returned")


def _range(days: int = 30) -> tuple[str, str]:
    """The reporting window, aligned to whole days.

    Aligned rather than a rolling `now - days` so that every figure on the
    dashboard covers the SAME dates as the chart beside it. With a rolling
    window an order placed early on the oldest day falls inside the headline
    total but outside the series, and the chart quietly disagrees with the
    number above it — the kind of discrepancy that gets noticed once and
    destroys trust in the whole screen.

    `end` stays as "now" so today is included up to the current moment.
    """
    now = dt.datetime.now(dt.timezone.utc)
    first_day = now.date() - dt.timedelta(days=max(1, days) - 1)
    start = dt.datetime.combine(first_day, dt.time.min, tzinfo=dt.timezone.utc)
    return start.isoformat(), now.isoformat()


def _void_clause(alias: str = "o") -> str:
    marks = ",".join(f"'{s}'" for s in _VOID)
    return f"{alias}.status NOT IN ({marks})"


def summary(days: int = 30) -> dict:
    """Headline numbers for the period, each with its previous-period change."""
    start, end = _range(days)
    prev_start = (
        dt.datetime.fromisoformat(start) - dt.timedelta(days=days)
    ).isoformat()

    def totals(from_at: str, to_at: str) -> dict:
        row = query_one(
            f"SELECT COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS revenue"
            f"  FROM orders o"
            # `<=`, not `<`. The clock here has ~15 ms resolution, so an order
            # placed in the same tick as the window's end carries an identical
            # timestamp and a strict `<` drops it — the order appears to exist
            # one refresh later. Harmless in a month-long view, but it made the
            # revenue test fail roughly one run in three.
            f" WHERE o.created_at >= ? AND o.created_at <= ? AND {_void_clause()}",
            (from_at, to_at),
        )
        orders = row["orders"] or 0
        revenue = row["revenue"] or 0
        return {
            "orders": orders,
            "revenue": revenue,
            # Average order value. Guarded, because a period with no orders
            # would otherwise divide by zero on a dashboard.
            "aov": round(revenue / orders) if orders else 0,
        }

    current = totals(start, end)
    previous = totals(prev_start, start)

    def change(now: int, before: int) -> float | None:
        # None, not 0: "no comparison available" and "no change" are different
        # facts, and showing 0% for a first month is a lie.
        if not before:
            return None
        return round((now - before) / before * 100, 1)

    new_customers = query_one(
        "SELECT COUNT(*) n FROM customers WHERE created_at >= ? AND created_at < ?",
        (start, end),
    )["n"]

    return {
        "periodDays": days,
        "from": start,
        "to": end,
        "orders": current["orders"],
        "revenue": current["revenue"],
        "aov": current["aov"],
        "newCustomers": new_customers,
        "change": {
            "orders": change(current["orders"], previous["orders"]),
            "revenue": change(current["revenue"], previous["revenue"]),
            "aov": change(current["aov"], previous["aov"]),
        },
    }


def revenue_series(days: int = 30) -> list[dict]:
    """Daily revenue, with zero-filled gaps.

    A day with no orders must appear as 0 rather than be missing — a chart that
    silently skips empty days compresses time and makes a quiet week look busy.
    """
    # Date-aligned, NOT `now - days`. Two reasons, both visible on the chart:
    #
    #   * `now - 7 days` spans eight calendar dates, so a "7 day" view drew
    #     eight bars.
    #   * it also keeps the time of day, so the oldest bucket held only the
    #     orders placed after this hour — a partial day that renders as a
    #     genuinely quiet one. Undercounting the first bar is worse than the
    #     extra bar, because it looks like information.
    #
    # Today is still partial, which is unavoidable and is what a viewer expects
    # of the current day.
    last = dt.datetime.now(dt.timezone.utc).date()
    first = last - dt.timedelta(days=max(1, days) - 1)

    rows = query(
        f"SELECT substr(o.created_at, 1, 10) AS day, COUNT(*) AS orders,"
        f"       COALESCE(SUM(o.total),0) AS revenue"
        f"  FROM orders o"
        f" WHERE substr(o.created_at, 1, 10) >= ? AND {_void_clause()}"
        f" GROUP BY day ORDER BY day",
        (first.isoformat(),),
    )
    found = {r["day"]: r for r in rows}

    series = []
    day = first
    while day <= last:
        key = day.isoformat()
        row = found.get(key)
        series.append({
            "date": key,
            "orders": row["orders"] if row else 0,
            "revenue": row["revenue"] if row else 0,
        })
        day += dt.timedelta(days=1)
    return series


def orders_by_status() -> list[dict]:
    return [
        {"status": r["status"], "count": r["n"]}
        for r in query(
            "SELECT status, COUNT(*) n FROM orders GROUP BY status ORDER BY n DESC"
        )
    ]


def top_products(days: int = 30, limit: int = 10) -> list[dict]:
    start, _ = _range(days)
    return [
        {
            "slug": r["slug"], "title": r["title"],
            "units": r["units"], "revenue": r["revenue"],
        }
        for r in query(
            f"SELECT oi.slug, oi.title, SUM(oi.qty) AS units,"
            f"       SUM(oi.line_total) AS revenue"
            f"  FROM order_items oi JOIN orders o ON o.id = oi.order_id"
            f" WHERE o.created_at >= ? AND {_void_clause()}"
            f" GROUP BY oi.slug, oi.title"
            f" ORDER BY units DESC, revenue DESC LIMIT ?",
            (start, int(limit)),
        )
    ]


def coupon_usage(days: int = 30) -> list[dict]:
    start, _ = _range(days)
    return [
        {"code": r["coupon_code"], "uses": r["uses"], "discount": r["discount"]}
        for r in query(
            f"SELECT o.coupon_code, COUNT(*) AS uses,"
            f"       COALESCE(SUM(o.discount),0) AS discount"
            f"  FROM orders o"
            f" WHERE o.created_at >= ? AND o.coupon_code <> '' AND {_void_clause()}"
            f" GROUP BY o.coupon_code ORDER BY uses DESC",
            (start,),
        )
    ]


def operational() -> dict:
    """What needs a human right now — the reason to open the dashboard."""
    def count(sql: str, params: tuple = ()) -> int:
        return query_one(sql, params)["n"]

    return {
        "ordersToConfirm": count(
            "SELECT COUNT(*) n FROM orders WHERE status IN ('requested','pending_payment')"
        ),
        "paymentsToVerify": count(
            "SELECT COUNT(*) n FROM payments WHERE status = 'submitted'"
        ),
        "ordersToDispatch": count(
            "SELECT COUNT(*) n FROM orders WHERE status IN ('confirmed','processing','packed')"
        ),
        "openTickets": count(
            "SELECT COUNT(*) n FROM tickets WHERE status IN ('open','pending_customer')"
        ),
        "ticketsAwaitingFirstReply": count(
            "SELECT COUNT(*) n FROM tickets WHERE first_response_at IS NULL"
            " AND status NOT IN ('closed','resolved')"
        ),
        "reviewsToModerate": count(
            "SELECT COUNT(*) n FROM reviews WHERE status = 'pending'"
        ),
        "lowStock": count(
            "SELECT COUNT(*) n FROM books WHERE stock_qty IS NOT NULL"
            " AND stock_qty <= low_stock_threshold AND status = 'published'"
        ),
        "refundRequests": count(
            "SELECT COUNT(*) n FROM orders WHERE status = 'refund_requested'"
        ),
    }


def catalogue_health() -> dict:
    """The content gaps that quietly cost sales."""
    def count(sql: str) -> int:
        return query_one(sql)["n"]

    published = count("SELECT COUNT(*) n FROM books WHERE status = 'published'")
    with_sample = count(
        "SELECT COUNT(DISTINCT book_id) n FROM free_page_ranges"
    )
    with_cover = count(
        "SELECT COUNT(DISTINCT book_id) n FROM book_images"
    )
    return {
        "published": published,
        "withSample": with_sample,
        # Surfaced because it is the single biggest conversion gap in the
        # catalogue right now: a book with no sample cannot show "Read N pages
        # free", and 323 of 324 titles are in that state.
        "withoutSample": published - with_sample,
        "withCover": with_cover,
        "withoutCover": published - with_cover,
        "tracked": count(
            "SELECT COUNT(*) n FROM books WHERE stock_qty IS NOT NULL"
        ),
    }


def dashboard(days: int = 30) -> dict:
    """One call for the whole screen."""
    return {
        "summary": summary(days),
        "series": revenue_series(days),
        "ordersByStatus": orders_by_status(),
        "topProducts": top_products(days),
        "coupons": coupon_usage(days),
        "operational": operational(),
        "catalogue": catalogue_health(),
    }
