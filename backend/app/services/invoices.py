"""Invoice generation with Indian GST handling.

TAX, BRIEFLY, BECAUSE GETTING IT WRONG IS EXPENSIVE

  * **Printed books are nil-rated.** HSN 4901. The invoices this shop issues
    will normally show zero tax, and that is correct, not a bug. `gst_rate` is
    per book so a future non-exempt product is charged properly.
  * **Intra-state splits into CGST + SGST; inter-state is IGST.** The test is
    seller state versus buyer state. Charging IGST on a Maharashtra-to-
    Maharashtra sale is a filing error even when the total is identical.
  * **Rounding is per line, then summed.** Computing tax on the order total
    instead produces totals that disagree with the line items by a rupee, and
    an invoice whose lines do not add up to its total is not a document anyone
    will accept.

NUMBERING

Sequential and gapless within an Indian financial year (April–March), allocated
from a counter row inside the same transaction that writes the invoice. Nothing
reuses a number, ever: a cancelled order keeps its invoice and gets a credit
note, because a hole in an invoice series is what an auditor asks about first.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import secrets

from app.config import settings
from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)


class InvoiceError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def financial_year(when: dt.date | None = None) -> str:
    """Indian FY runs April to March. 2026-08-04 is in "2026-27"."""
    day = when or dt.datetime.now(dt.timezone.utc).date()
    start = day.year if day.month >= 4 else day.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def _next_number(conn, year: str) -> tuple[str, int]:
    """Allocate the next sequence inside the caller's transaction."""
    conn.execute(
        "INSERT INTO invoice_counters (financial_year, last_sequence)"
        " VALUES (?, 0) ON CONFLICT(financial_year) DO NOTHING",
        (year,),
    )
    conn.execute(
        "UPDATE invoice_counters SET last_sequence = last_sequence + 1"
        " WHERE financial_year = ?",
        (year,),
    )
    row = conn.execute(
        "SELECT last_sequence FROM invoice_counters WHERE financial_year = ?",
        (year,),
    ).fetchone()
    sequence = row["last_sequence"]
    return f"{settings.invoice_prefix}/{year}/{sequence:04d}", sequence


def _split_tax(taxable: int, rate: int, interstate: bool) -> tuple[int, int, int]:
    """(cgst, sgst, igst) in whole rupees for one line."""
    if rate <= 0:
        return (0, 0, 0)
    tax = round(taxable * rate / 100)
    if interstate:
        return (0, 0, tax)
    # Half each, and the odd rupee goes to CGST so the two always sum to `tax`.
    half = tax // 2
    return (tax - half, half, 0)


def build(order_number: str) -> dict:
    """Compute the invoice for an order without persisting it."""
    order = query_one(
        "SELECT * FROM orders WHERE order_number = ?", (order_number,)
    )
    if order is None:
        raise InvoiceError("No such order")

    items = query(
        "SELECT oi.*, b.hsn_code, b.gst_rate"
        "  FROM order_items oi LEFT JOIN books b ON b.slug = oi.slug"
        " WHERE oi.order_id = ?",
        (order["id"],),
    )
    if not items:
        raise InvoiceError("This order has no line items")

    seller_state = (settings.seller_state or "").strip().lower()
    buyer_state = (order["state"] or "").strip().lower()
    # Unknown buyer state is treated as intra-state: this shop is local, an
    # unfilled state field is almost always a Maharashtra address, and the
    # alternative (defaulting to IGST) misfiles the common case.
    interstate = bool(buyer_state) and buyer_state != seller_state

    lines = []
    subtotal = cgst_total = sgst_total = igst_total = 0
    for item in items:
        taxable = item["line_total"]
        rate = item["gst_rate"] if item["gst_rate"] is not None else 0
        cgst, sgst, igst = _split_tax(taxable, rate, interstate)
        subtotal += taxable
        cgst_total += cgst
        sgst_total += sgst
        igst_total += igst
        lines.append(
            {
                "title": item["title"],
                "hsn": item["hsn_code"] or "4901",
                "qty": item["qty"],
                "rate": item["unit_price"],
                "taxable": taxable,
                "gstRate": rate,
                "cgst": cgst,
                "sgst": sgst,
                "igst": igst,
                "total": taxable + cgst + sgst + igst,
            }
        )

    shipping = order["shipping"] or 0
    total = subtotal + cgst_total + sgst_total + igst_total + shipping

    address = ", ".join(
        p for p in [order["address_line1"], order["address_line2"], order["city"],
                    order["state"], order["pincode"]] if p
    )
    return {
        "orderNumber": order_number,
        "orderId": order["id"],
        "seller": {
            "name": settings.company_name,
            "gstin": settings.seller_gstin,
            "state": settings.seller_state,
        },
        "buyer": {
            "name": order["customer_name"],
            "address": address,
            "state": order["state"] or "",
            "gstin": "",
        },
        "lines": lines,
        "subtotal": subtotal,
        "cgst": cgst_total,
        "sgst": sgst_total,
        "igst": igst_total,
        "shipping": shipping,
        "total": total,
        "interstate": interstate,
        # Surfaced so the template can explain a zero-tax invoice rather than
        # leaving the customer wondering whether tax was forgotten.
        "taxExempt": (cgst_total + sgst_total + igst_total) == 0,
    }


def issue(order_number: str, *, issued_by: str | None = None) -> dict:
    """Persist an invoice for an order. Idempotent per order."""
    existing = for_order(order_number)
    if existing:
        return existing

    data = build(order_number)
    year = financial_year()
    invoice_id = f"inv_{secrets.token_hex(8)}"

    with transaction() as conn:
        number, sequence = _next_number(conn, year)
        conn.execute(
            "INSERT INTO invoices"
            " (id, order_id, invoice_number, financial_year, sequence,"
            "  seller_name, seller_gstin, seller_state,"
            "  buyer_name, buyer_address, buyer_state, buyer_gstin,"
            "  subtotal, cgst, sgst, igst, shipping, total, lines_json,"
            "  issued_at, issued_by)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                invoice_id, data["orderId"], number, year, sequence,
                data["seller"]["name"], data["seller"]["gstin"], data["seller"]["state"],
                data["buyer"]["name"], data["buyer"]["address"], data["buyer"]["state"], "",
                data["subtotal"], data["cgst"], data["sgst"], data["igst"],
                data["shipping"], data["total"], json.dumps(data["lines"]),
                _now(), issued_by,
            ),
        )
    log.info("Issued invoice %s for %s", number, order_number)
    return for_order(order_number) or {}


def for_order(order_number: str) -> dict | None:
    row = query_one(
        "SELECT i.* FROM invoices i JOIN orders o ON o.id = i.order_id"
        " WHERE o.order_number = ?",
        (order_number,),
    )
    if row is None:
        return None
    invoice = dict(row)
    invoice["lines"] = json.loads(invoice.pop("lines_json") or "[]")
    return invoice


def render_html(invoice: dict) -> str:
    """The invoice as HTML. Also the source for the PDF."""
    rows = "".join(
        f"<tr><td>{line['title']}</td><td class='c'>{line['hsn']}</td>"
        f"<td class='r'>{line['qty']}</td><td class='r'>{line['rate']}</td>"
        f"<td class='r'>{line['taxable']}</td>"
        f"<td class='r'>{line['gstRate']}%</td>"
        f"<td class='r'>{line['total']}</td></tr>"
        for line in invoice["lines"]
    )
    tax_rows = ""
    if invoice["igst"]:
        tax_rows = f"<tr><td>IGST</td><td class='r'>{invoice['igst']}</td></tr>"
    elif invoice["cgst"] or invoice["sgst"]:
        tax_rows = (
            f"<tr><td>CGST</td><td class='r'>{invoice['cgst']}</td></tr>"
            f"<tr><td>SGST</td><td class='r'>{invoice['sgst']}</td></tr>"
        )

    exempt_note = (
        "<p class='note'>Printed books are exempt from GST (HSN 4901). "
        "No tax has been charged on this invoice.</p>"
        if invoice["cgst"] + invoice["sgst"] + invoice["igst"] == 0
        else ""
    )
    issued = str(invoice["issued_at"])[:10]

    return f"""<html><head><style>
      body {{ font-family: sans-serif; font-size: 10pt; color: #111; }}
      h1 {{ font-size: 15pt; margin: 0 0 2pt; }}
      .muted {{ color: #555; font-size: 9pt; }}
      table {{ width: 100%; border-collapse: collapse; margin-top: 10pt; }}
      th, td {{ border: 1px solid #bbb; padding: 4pt 5pt; text-align: left; }}
      th {{ background: #eee; font-size: 9pt; }}
      .r {{ text-align: right; }} .c {{ text-align: center; }}
      .totals {{ width: 45%; margin-left: 55%; margin-top: 8pt; }}
      .totals td {{ border: none; padding: 2pt 5pt; }}
      .grand td {{ border-top: 1px solid #333; font-weight: bold; }}
      .note {{ margin-top: 10pt; font-size: 8.5pt; color: #555; }}
    </style></head><body>
      <h1>Tax Invoice</h1>
      <p class="muted">{invoice['invoice_number']} &middot; {issued}</p>

      <table><tr>
        <td style="width:50%">
          <strong>{invoice['seller_name']}</strong><br>
          {('GSTIN: ' + invoice['seller_gstin'] + '<br>') if invoice['seller_gstin'] else ''}
          {invoice['seller_state']}
        </td>
        <td>
          <strong>Bill to</strong><br>
          {invoice['buyer_name']}<br>
          <span class="muted">{invoice['buyer_address']}</span>
        </td>
      </tr></table>

      <table>
        <tr><th>Item</th><th class="c">HSN</th><th class="r">Qty</th>
            <th class="r">Rate</th><th class="r">Taxable</th>
            <th class="r">GST</th><th class="r">Amount</th></tr>
        {rows}
      </table>

      <table class="totals">
        <tr><td>Subtotal</td><td class="r">{invoice['subtotal']}</td></tr>
        {tax_rows}
        <tr><td>Shipping</td><td class="r">{invoice['shipping']}</td></tr>
        <tr class="grand"><td>Total (INR)</td><td class="r">{invoice['total']}</td></tr>
      </table>

      {exempt_note}
      <p class="note">This is a computer-generated invoice.</p>
    </body></html>"""


def render_pdf(invoice: dict) -> bytes:
    """HTML to PDF via PyMuPDF's Story — no extra dependency.

    Deliberately not a headless browser: this runs on a 2 vCPU box that also
    hosts the LMS, and starting Chromium per invoice download is not a cost
    this deployment can absorb.
    """
    import io

    import fitz

    story = fitz.Story(html=render_html(invoice))
    buffer = io.BytesIO()
    writer = fitz.DocumentWriter(buffer)
    # A4 in points, with a 40pt margin.
    page_rect = fitz.paper_rect("a4")
    content_rect = page_rect + (40, 40, -40, -40)

    more = True
    while more:
        device = writer.begin_page(page_rect)
        more, _ = story.place(content_rect)
        story.draw(device)
        writer.end_page()
    writer.close()
    return buffer.getvalue()
