"""E-book delivery: entitlement, watermarking and the download cap.

The honest claim being tested is NOT "this cannot be copied" — it can. It is
that every delivered copy is attributable to the buyer, that access follows the
order rather than a separate record that can drift from it, and that a link
cannot become an unlimited mirror.

    python -m tests.test_ebook_delivery
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_ROOT = pathlib.Path(tempfile.mkdtemp(prefix="cc_ebdl_"))
os.environ["DB_PATH"] = str(_ROOT / "test.db")
os.environ["MEDIA_ROOT"] = str(_ROOT / "media")

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import ebook, order_flow, storage  # noqa: E402

failures: list[str] = []

BUYER = {
    "name": "Asha Patil", "phone": "9876500000", "email": "asha@example.com",
    "address1": "1", "city": "Nagpur", "pincode": "440016",
}


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def make_pdf(path: pathlib.Path, pages: int = 3) -> None:
    import fitz

    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text(fitz.Point(72, 100), f"Chapter {i + 1}")
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(path))
    doc.close()


def seed() -> str:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
            " subject, price, ebook_price, ebook_available, physical_available,"
            " status, in_stock, stock_qty, created_at, updated_at)"
            " VALUES ('edb','ed-book','Ed Book','kohinoor','state','10','english',"
            " 'Science',500,200,1,1,'published',1,10,?,?)",
            (now, now),
        )
    source = storage.root() / "pdfs" / "ed-book.pdf"
    make_pdf(source)
    with transaction() as conn:
        conn.execute(
            "INSERT INTO book_assets (id, book_id, original_name, storage_path,"
            " sha256, page_count, process_state, is_current, created_at,"
            " updated_at) VALUES ('ast1','edb','ed.pdf',?,'abc',3,'ready',1,?,?)",
            (storage.relative(source), now, now),
        )
    return "ed-book"


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    slug = seed()

    print("=== an unpaid order grants nothing ===")
    order = orders_repo.create_order(
        items=[{"slug": slug, "qty": 1, "delivery": "digital"}], customer=BUYER,
    )
    number = order["orderNumber"]
    try:
        ebook.prepare_download(number, slug, customer_id=None)
        check("a 'requested' order cannot download", False, "IT DOWNLOADED")
    except ebook.EbookError:
        check("a 'requested' order cannot download", True)

    print("\n=== confirming the order grants the download ===")
    order_flow.transition(number, "confirmed")
    path, filename = ebook.prepare_download(number, slug, customer_id=None,
                                            ip="1.2.3.4")
    check("a file is produced", path.exists(), str(path))
    check("named after the book", filename == "ed-book.pdf", filename)
    check("and it is a real PDF", path.read_bytes()[:5] == b"%PDF-", "not a PDF")

    print("\n=== every page names the buyer ===")
    import fitz

    doc = fitz.open(str(path))
    try:
        stamped = [p for p in doc if "Asha Patil" in p.get_text()]
        check("the buyer's name is on every page",
              len(stamped) == doc.page_count,
              f"{len(stamped)}/{doc.page_count} — an unstamped page is a clean "
              "copy to share")
        first = doc[0].get_text()
        check("with their email", "asha@example.com" in first, first[:120])
        check("and the order number", number in first, first[:120])
    finally:
        doc.close()

    print("\n=== the copy is per order, never shared ===")
    other = orders_repo.create_order(
        items=[{"slug": slug, "qty": 1, "delivery": "digital"}],
        customer={**BUYER, "name": "Ravi Kumar", "email": "ravi@example.com"},
    )
    order_flow.transition(other["orderNumber"], "confirmed")
    other_path, _ = ebook.prepare_download(
        other["orderNumber"], slug, customer_id=None
    )
    check("a different order gets a different file",
          other_path != path,
          "one shared file would leak the first buyer's details to everyone")
    doc = fitz.open(str(other_path))
    try:
        text = doc[0].get_text()
        check("stamped with the SECOND buyer", "Ravi Kumar" in text, text[:120])
        check("and not the first", "Asha Patil" not in text, text[:120])
    finally:
        doc.close()

    print("\n=== downloads are counted ===")
    rows = ebook.download_history(number, slug)
    check("the download was logged", len(rows) == 1, str(len(rows)))
    check("with the IP, so a leak can be traced",
          rows and rows[0]["ip"] == "1.2.3.4", str(rows))

    print("\n=== and capped ===")
    for _ in range(ebook.MAX_DOWNLOADS - 1):
        ebook.prepare_download(number, slug, customer_id=None)
    try:
        ebook.prepare_download(number, slug, customer_id=None)
        check("the cap is enforced", False, "past the limit and still going")
    except ebook.EbookError as exc:
        check("the cap is enforced", True)
        check("and the message says what to do",
              "limit" in str(exc).lower(), str(exc))

    print("\n=== A REFUND REVOKES ACCESS ===")
    # Entitlement is derived from the order, so this needs no separate cleanup.
    refunded = orders_repo.create_order(
        items=[{"slug": slug, "qty": 1, "delivery": "digital"}], customer=BUYER,
    )
    rnum = refunded["orderNumber"]
    order_flow.transition(rnum, "confirmed")
    ebook.prepare_download(rnum, slug, customer_id=None)  # works while valid
    order_flow.transition(rnum, "cancelled")
    try:
        ebook.prepare_download(rnum, slug, customer_id=None)
        check("a cancelled order stops downloading", False, "STILL DOWNLOADING")
    except ebook.EbookError:
        check("a cancelled order stops downloading", True)

    print("\n=== a printed-only purchase is not a download ===")
    printed = orders_repo.create_order(
        items=[{"slug": slug, "qty": 1, "delivery": "physical"}], customer=BUYER,
    )
    order_flow.transition(printed["orderNumber"], "confirmed")
    try:
        ebook.prepare_download(printed["orderNumber"], slug, customer_id=None)
        check("buying the printed copy does not grant the file", False,
              "a print sale must not hand over the PDF")
    except ebook.EbookError:
        check("buying the printed copy does not grant the file", True)

    print("\n=== an unknown order says nothing useful ===")
    try:
        ebook.prepare_download("CC-NOPE01", slug, customer_id=None)
        check("an unknown order is refused", False)
    except ebook.EbookError as exc:
        check("an unknown order is refused", True)
        check("and the message does not reveal whether it exists",
              "not find that download" in str(exc), str(exc))

    print("\n=== entitlements list what was bought ===")
    with transaction() as conn:
        conn.execute(
            "INSERT INTO customers (id, email, email_norm, name, phone, status,"
            " created_at, updated_at) VALUES ('cus1','asha@example.com',"
            " 'asha@example.com','Asha','9876500000','active',?,?)",
            (dt.datetime.now(dt.timezone.utc).isoformat(),) * 2,
        )
        conn.execute("UPDATE orders SET customer_id = 'cus1' WHERE order_number = ?",
                     (number,))
    mine = ebook.entitlements("cus1")
    check("the purchase is listed", any(e["slug"] == slug for e in mine), str(mine))
    entry = next(e for e in mine if e["slug"] == slug)
    check("it reports the download count", entry["downloads"] > 0, str(entry))
    check("and how many are left",
          entry["downloadsLeft"] == max(0, ebook.MAX_DOWNLOADS - entry["downloads"]),
          str(entry))
    check("and that the file is ready", entry["ready"] is True, str(entry))

    print("\n=== a cancelled order is not in the list ===")
    check("refunded purchases disappear",
          all(e["orderNumber"] != rnum for e in ebook.entitlements("cus1")),
          "entitlement is derived from the order, so this needs no cleanup")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("E-book delivery holds: stamped, per-order, revocable, capped.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
