"""Order exports for the admin panel.

STREAMED, NOT ASSEMBLED. Rows are yielded as they come off the cursor, so a
three-year export does not build a multi-megabyte string in memory on a box that
also runs the LMS. The generator is what makes an unbounded export merely slow
instead of an outage.

TWO SHAPES, BECAUSE TWO PEOPLE ASK DIFFERENT QUESTIONS

  * **order** — one row per order. "How many orders last month, worth what."
  * **line**  — one row per item. What an accountant reconciling GST needs, and
    the only shape that answers "how many copies of this title did we sell".

⚠ THIS IS THE LARGEST PII DISCLOSURE IN THE PRODUCT: every customer's name,
phone number and home address in one downloadable file. Hence a dedicated
`orders:export` permission (support can read an order and cannot download the
book), and an audit row per export recording the filters and the row count.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import logging
from typing import Iterator

from app.db.conn import query

log = logging.getLogger(__name__)

SHAPES = ("order", "line")
FORMATS = ("csv", "json")

ORDER_COLUMNS = [
    "order_number", "created_at", "status", "payment_status", "payment_ref",
    "invoice_number", "customer_name", "phone", "email",
    "address_line1", "address_line2", "city", "state", "pincode",
    "item_count", "items",
    "subtotal", "discount", "coupon_code", "shipping", "total",
    "source", "notes",
]

LINE_COLUMNS = [
    "order_number", "created_at", "status", "payment_status",
    "customer_name", "phone", "city", "state", "pincode",
    "slug", "title", "class_id", "medium", "hsn_code", "gst_rate",
    "unit_price", "qty", "line_total",
    "order_subtotal", "order_discount", "order_shipping", "order_total",
]


def _clamp_dates(date_from: str | None, date_to: str | None) -> tuple[str, str]:
    """A date range is REQUIRED.

    An unbounded export of every order the shop has ever taken is how someone
    ends up with a 200 MB file they cannot open, and how the whole customer list
    leaves the building in one click. Defaults to the last 31 days.
    """
    today = dt.datetime.now(dt.timezone.utc).date()
    start = date_from or (today - dt.timedelta(days=31)).isoformat()
    # Inclusive of the end day: a user asking for 1st–31st means the 31st too,
    # and comparing against a bare date would silently drop that day's orders.
    end = f"{date_to or today.isoformat()}T23:59:59.999999+00:00"
    return start, end


def _filtered_orders(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
    payment_status: str | None = None,
    coupon: str | None = None,
) -> list[dict]:
    start, end = _clamp_dates(date_from, date_to)
    clauses = ["o.created_at >= ?", "o.created_at <= ?"]
    params: list = [start, end]

    if status:
        clauses.append("o.status = ?")
        params.append(status)
    if payment_status:
        clauses.append("o.payment_status = ?")
        params.append(payment_status)
    if coupon:
        clauses.append("UPPER(o.coupon_code) = ?")
        params.append(coupon.strip().upper())

    return [
        dict(r)
        for r in query(
            "SELECT o.*, (SELECT i.invoice_number FROM invoices i"
            "               WHERE i.order_id = o.id) AS invoice_number"
            f"  FROM orders o WHERE {' AND '.join(clauses)}"
            " ORDER BY o.created_at",
            params,
        )
    ]


def _items_for(order_id: str) -> list[dict]:
    return [
        dict(r)
        for r in query(
            "SELECT oi.*, b.hsn_code, b.gst_rate"
            "  FROM order_items oi LEFT JOIN books b ON b.slug = oi.slug"
            " WHERE oi.order_id = ?",
            (order_id,),
        )
    ]


def rows(shape: str = "order", **filters) -> Iterator[dict]:
    """Yield export rows one at a time."""
    if shape not in SHAPES:
        raise ValueError(f"Unknown shape {shape!r}")

    for order in _filtered_orders(**filters):
        items = _items_for(order["id"])
        if shape == "order":
            yield {
                "order_number": order["order_number"],
                "created_at": order["created_at"],
                "status": order["status"],
                "payment_status": order["payment_status"],
                "payment_ref": order["payment_ref"] or "",
                "invoice_number": order["invoice_number"] or "",
                "customer_name": order["customer_name"],
                "phone": order["phone"],
                "email": order["email"] or "",
                "address_line1": order["address_line1"],
                "address_line2": order["address_line2"],
                "city": order["city"],
                "state": order["state"],
                "pincode": order["pincode"],
                "item_count": sum(i["qty"] for i in items),
                # Readable in one cell rather than a JSON blob a shop owner
                # cannot parse by eye.
                "items": "; ".join(f"{i['title']} x{i['qty']}" for i in items),
                "subtotal": order["subtotal"],
                "discount": order["discount"],
                "coupon_code": order["coupon_code"],
                "shipping": order["shipping"],
                "total": order["total"],
                "source": order["source"],
                "notes": order["notes"],
            }
        else:
            for item in items:
                yield {
                    "order_number": order["order_number"],
                    "created_at": order["created_at"],
                    "status": order["status"],
                    "payment_status": order["payment_status"],
                    "customer_name": order["customer_name"],
                    "phone": order["phone"],
                    "city": order["city"],
                    "state": order["state"],
                    "pincode": order["pincode"],
                    "slug": item["slug"],
                    "title": item["title"],
                    "class_id": item["class_id"],
                    "medium": item["medium"],
                    "hsn_code": item["hsn_code"] or "",
                    "gst_rate": item["gst_rate"] if item["gst_rate"] is not None else "",
                    "unit_price": item["unit_price"],
                    "qty": item["qty"],
                    "line_total": item["line_total"],
                    "order_subtotal": order["subtotal"],
                    "order_discount": order["discount"],
                    "order_shipping": order["shipping"],
                    "order_total": order["total"],
                }


def to_csv(shape: str = "order", **filters) -> Iterator[str]:
    """Stream CSV.

    Starts with a UTF-8 BOM. Excel on Windows assumes the system codepage
    otherwise, and every Devanagari book title in the file renders as mojibake —
    which is the first thing anyone opening this will notice.
    """
    columns = ORDER_COLUMNS if shape == "order" else LINE_COLUMNS
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")

    yield "﻿"
    writer.writeheader()
    yield buffer.getvalue()
    buffer.seek(0)
    buffer.truncate(0)

    for row in rows(shape, **filters):
        writer.writerow(row)
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)


def to_json(shape: str = "order", **filters) -> Iterator[str]:
    """Stream a JSON array without holding it all in memory."""
    yield "["
    first = True
    for row in rows(shape, **filters):
        yield ("" if first else ",") + json.dumps(row, default=str)
        first = False
    yield "]"


def summary(**filters) -> dict:
    """Counts for the audit record and the UI's 'this will export N rows'."""
    orders = _filtered_orders(**filters)
    start, end = _clamp_dates(filters.get("date_from"), filters.get("date_to"))
    return {
        "orders": len(orders),
        "revenue": sum(o["total"] for o in orders),
        "from": start,
        "to": end,
    }
