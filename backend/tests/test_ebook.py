"""E-book support: print and download priced independently.

The rules that cost money if they break:

  * a download is never billed at the print price
  * shipping is charged on printed lines only
  * stock moves for printed lines only
  * the same title in both formats is two lines, not one

    python -m tests.test_ebook
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_ebook_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.config import settings  # noqa: E402
from app.db.conn import query, query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import order_flow  # noqa: E402

failures: list[str] = []

BUYER = {
    "name": "Buyer", "phone": "9876500000", "address1": "1",
    "city": "Nagpur", "pincode": "440016",
}


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def seed() -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    rows = [
        # slug,          price, ebook_price, ebook_avail, phys_avail, stock
        ("eb-both",        500,         200,           1,          1,    10),
        ("eb-print-only",  300,        None,           0,          1,    10),
        ("eb-digital-only",400,         150,           1,          0,  None),
        # Flagged as an e-book but nobody set a price — must not be sellable.
        ("eb-no-price",    250,        None,           1,          1,    10),
    ]
    with transaction() as conn:
        for slug, price, ep, ea, pa, stock in rows:
            conn.execute(
                "INSERT INTO books (id, slug, title, series, board, class_id,"
                " medium, subject, price, ebook_price, ebook_available,"
                " physical_available, status, in_stock, stock_qty,"
                " created_at, updated_at)"
                " VALUES (?,?,?,'kohinoor','state','10','english','Science',"
                " ?,?,?,?,'published',1,?,?,?)",
                (slug, slug, f"Book {slug}", price, ep, ea, pa, stock, now, now),
            )


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    seed()

    print("=== a download is billed at the E-BOOK price ===")
    lines, subtotal = orders_repo.price_lines(
        [{"slug": "eb-both", "qty": 1, "delivery": "digital"}]
    )
    check("one line", len(lines) == 1, str(lines))
    check("priced at 200, not 500",
          lines and lines[0]["unitPrice"] == 200,
          f"{lines[0]['unitPrice'] if lines else '?'} — billing the print price "
          "for a download overcharges every digital sale")
    check("subtotal follows", subtotal == 200, str(subtotal))

    print("\n=== and a printed copy at the print price ===")
    lines, subtotal = orders_repo.price_lines(
        [{"slug": "eb-both", "qty": 1, "delivery": "physical"}]
    )
    check("priced at 500", lines and lines[0]["unitPrice"] == 500, str(lines))

    print("\n=== both formats of one title are TWO lines ===")
    lines, subtotal = orders_repo.price_lines([
        {"slug": "eb-both", "qty": 1, "delivery": "physical"},
        {"slug": "eb-both", "qty": 1, "delivery": "digital"},
    ])
    check("two separate lines", len(lines) == 2, str(len(lines)))
    check("each at its own price",
          {line["unitPrice"] for line in lines} == {500, 200},
          str([line["unitPrice"] for line in lines]))
    check("subtotal is the sum", subtotal == 700, str(subtotal))
    check("the delivery is recorded on each",
          {line["delivery"] for line in lines} == {"physical", "digital"},
          str([line["delivery"] for line in lines]))

    print("\n=== a format that is not offered is not sold ===")
    lines, _ = orders_repo.price_lines(
        [{"slug": "eb-print-only", "qty": 1, "delivery": "digital"}]
    )
    check("no e-book for a print-only title", lines == [], str(lines))

    lines, _ = orders_repo.price_lines(
        [{"slug": "eb-digital-only", "qty": 1, "delivery": "physical"}]
    )
    check("no printed copy for a digital-only title", lines == [], str(lines))

    lines, _ = orders_repo.price_lines(
        [{"slug": "eb-no-price", "qty": 1, "delivery": "digital"}]
    )
    check("an e-book with no price of its own is refused",
          lines == [],
          "falling back to the print price would charge for something "
          "nobody meant to list")

    print("\n=== an unknown delivery falls back to physical, not to free ===")
    lines, _ = orders_repo.price_lines(
        [{"slug": "eb-both", "qty": 1, "delivery": "teleport"}]
    )
    check("it is billed as printed",
          lines and lines[0]["unitPrice"] == 500 and lines[0]["delivery"] == "physical",
          str(lines))

    print("\n=== SHIPPING IS FOR PRINTED LINES ONLY ===")
    digital_only = orders_repo.create_order(
        items=[{"slug": "eb-both", "qty": 1, "delivery": "digital"}],
        customer=BUYER,
    )
    check("an all-digital order ships free",
          digital_only["shipping"] == 0,
          f"{digital_only['shipping']} — charging delivery on a download is a "
          "support ticket every time")
    check("and its total is just the e-book",
          digital_only["total"] == 200, str(digital_only["total"]))

    mixed = orders_repo.create_order(
        items=[
            {"slug": "eb-both", "qty": 1, "delivery": "digital"},
            {"slug": "eb-print-only", "qty": 1, "delivery": "physical"},
        ],
        customer=BUYER,
    )
    printed_subtotal = 300
    expected_shipping = (
        0 if printed_subtotal >= settings.free_shipping_threshold
        else settings.shipping_flat_rate
    )
    check("a mixed order ships on the printed part",
          mixed["shipping"] == expected_shipping,
          f"{mixed['shipping']} vs {expected_shipping}")

    print("\n=== free-shipping threshold judges the PRINTED subtotal ===")
    # A pile of e-books must not buy free delivery on a cheap printed book.
    big_digital = orders_repo.create_order(
        items=[
            {"slug": "eb-both", "qty": 20, "delivery": "digital"},
            {"slug": "eb-print-only", "qty": 1, "delivery": "physical"},
        ],
        customer=BUYER,
    )
    check("digital value does not unlock free shipping",
          big_digital["shipping"] == expected_shipping,
          f"{big_digital['shipping']} — 20 e-books should not post a book free")

    print("\n=== STOCK MOVES FOR PRINTED LINES ONLY ===")
    before = query_one("SELECT stock_qty FROM books WHERE slug='eb-both'")["stock_qty"]
    digital_order = orders_repo.create_order(
        items=[{"slug": "eb-both", "qty": 3, "delivery": "digital"}],
        customer=BUYER,
    )
    order_flow.transition(digital_order["orderNumber"], "confirmed")
    after = query_one("SELECT stock_qty FROM books WHERE slug='eb-both'")["stock_qty"]
    check("confirming a download does not touch stock",
          after == before,
          f"{before} -> {after} — a download cannot sell out, and deducting "
          "would walk a printed title to zero")

    printed_order = orders_repo.create_order(
        items=[{"slug": "eb-both", "qty": 2, "delivery": "physical"}],
        customer=BUYER,
    )
    order_flow.transition(printed_order["orderNumber"], "confirmed")
    after_print = query_one(
        "SELECT stock_qty FROM books WHERE slug='eb-both'"
    )["stock_qty"]
    check("but confirming a printed copy does",
          after_print == before - 2, f"{before} -> {after_print}")

    print("\n=== delivery is stored on the order line ===")
    rows = query(
        "SELECT oi.delivery, oi.qty FROM order_items oi"
        " JOIN orders o ON o.id = oi.order_id WHERE o.order_number = ?",
        (digital_order["orderNumber"],),
    )
    check("the line remembers it was a download",
          rows and rows[0]["delivery"] == "digital", str([dict(r) for r in rows]))

    print("\n=== existing behaviour is unchanged when nobody asks for a format ===")
    plain = orders_repo.price_lines([{"slug": "eb-print-only", "qty": 1}])[0]
    check("no delivery given means printed at the print price",
          plain and plain[0]["unitPrice"] == 300
          and plain[0]["delivery"] == "physical",
          str(plain))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("E-books hold: priced apart, no shipping, no stock.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
