"""Invoice numbering, GST split, and PDF rendering.

    python -m tests.test_invoices
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_inv_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.config import settings  # noqa: E402
from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import invoices  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def make_book(slug: str, price: int, gst_rate: int = 0, hsn: str = "4901") -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
            " subject, price, status, hsn_code, gst_rate, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (slug, slug, f"Title {slug}", "kohinoor", "state", "10", "english",
             "Science", price, "published", hsn, gst_rate, now, now),
        )


def make_order(slug: str, qty: int, state: str) -> str:
    return orders_repo.create_order(
        items=[{"slug": slug, "qty": qty}],
        customer={
            "name": "Buyer", "phone": "9876500000", "email": "b@example.com",
            "address1": "1 Road", "city": "Somewhere", "state": state,
            "pincode": "440016",
        },
    )["orderNumber"]


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== financial year runs April to March ===")
    check("August 2026 is FY 2026-27", invoices.financial_year(dt.date(2026, 8, 4)) == "2026-27")
    check("March 2026 is still FY 2025-26", invoices.financial_year(dt.date(2026, 3, 31)) == "2025-26")
    check("April 2026 starts FY 2026-27", invoices.financial_year(dt.date(2026, 4, 1)) == "2026-27")

    print("\n=== printed books are GST-exempt ===")
    make_book("inv-book", 250)  # defaults: HSN 4901, 0%
    num = make_order("inv-book", 2, settings.seller_state)
    data = invoices.build(num)
    check("no tax charged on a printed book", data["cgst"] + data["sgst"] + data["igst"] == 0, str(data))
    check("flagged as exempt so the template can explain it", data["taxExempt"] is True)
    check("HSN defaults to 4901", data["lines"][0]["hsn"] == "4901")
    check("total = subtotal + shipping", data["total"] == data["subtotal"] + data["shipping"], str(data))

    print("\n=== intra-state splits CGST/SGST, inter-state is IGST ===")
    make_book("inv-taxed", 1000, gst_rate=18, hsn="4820")
    local = invoices.build(make_order("inv-taxed", 1, settings.seller_state))
    check("intra-state charges CGST and SGST", local["cgst"] > 0 and local["sgst"] > 0, str(local))
    check("intra-state charges no IGST", local["igst"] == 0)
    check("the two halves sum to the full tax",
          local["cgst"] + local["sgst"] == round(local["subtotal"] * 18 / 100),
          f"{local['cgst']}+{local['sgst']} vs {round(local['subtotal']*18/100)}")

    away = invoices.build(make_order("inv-taxed", 1, "Karnataka"))
    check("inter-state charges IGST", away["igst"] > 0, str(away))
    check("inter-state charges no CGST/SGST", away["cgst"] == 0 and away["sgst"] == 0)
    check("both routes cost the customer the same", away["total"] == local["total"],
          f"{away['total']} vs {local['total']}")

    print("\n=== an odd rupee is not lost in the split ===")
    make_book("inv-odd", 105, gst_rate=5)   # 5% of 105 = 5.25 -> 5
    odd = invoices.build(make_order("inv-odd", 1, settings.seller_state))
    tax = odd["cgst"] + odd["sgst"]
    check("cgst+sgst equals the line tax exactly", tax == round(105 * 5 / 100), f"{tax}")
    check("the odd rupee goes to CGST", odd["cgst"] >= odd["sgst"], str(odd))

    print("\n=== unknown buyer state is treated as local ===")
    blank = invoices.build(make_order("inv-taxed", 1, ""))
    check("a blank state does not misfile as inter-state", blank["igst"] == 0, str(blank))

    print("\n=== numbering is sequential and gapless ===")
    first = invoices.issue(num)
    second = invoices.issue(make_order("inv-book", 1, "Maharashtra"))
    check("numbers follow the configured format",
          first["invoice_number"].startswith(f"{settings.invoice_prefix}/"), first["invoice_number"])
    check("they increment", second["sequence"] == first["sequence"] + 1,
          f"{first['sequence']} -> {second['sequence']}")
    check("no gap between them", second["sequence"] - first["sequence"] == 1)

    print("\n=== issuing twice returns the same invoice ===")
    again = invoices.issue(num)
    check("idempotent per order", again["invoice_number"] == first["invoice_number"],
          f"{again['invoice_number']} vs {first['invoice_number']} — a duplicate would break the series")
    check("and did not burn a number",
          query_one("SELECT last_sequence s FROM invoice_counters WHERE financial_year=?",
                    (invoices.financial_year(),))["s"] == second["sequence"])

    print("\n=== the invoice is a snapshot, not a live view ===")
    with transaction() as conn:
        conn.execute("UPDATE books SET price = 9999 WHERE slug = 'inv-book'")
    reloaded = invoices.for_order(num)
    check("a later price change does not rewrite the invoice",
          reloaded["total"] == first["total"],
          f"{reloaded['total']} vs {first['total']} — history was rewritten")

    print("\n=== rendering ===")
    html = invoices.render_html(reloaded)
    check("html carries the invoice number", reloaded["invoice_number"] in html)
    check("html explains a zero-tax invoice", "exempt from GST" in html, html[:200])
    pdf = invoices.render_pdf(reloaded)
    check("a real PDF is produced", pdf[:5] == b"%PDF-", str(pdf[:20]))
    check("it is not empty", len(pdf) > 800, f"{len(pdf)} bytes")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Invoices hold: numbered, taxed correctly, frozen at issue.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
