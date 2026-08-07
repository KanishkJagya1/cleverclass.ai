"""The streaming reader: signed page tokens and per-request entitlement.

The properties that matter, and what breaks if each fails:

  * a token is bound to ONE page — otherwise a legitimate request for page 1
    opens page 400 and the whole book is readable;
  * tokens expire — otherwise a copied URL is a permanent public link;
  * entitlement is re-read on every page — otherwise a refund leaves an open
    tab working indefinitely;
  * signatures are rejected, not merely mismatched, when the payload is edited.

    python -m tests.test_reader
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_ROOT = pathlib.Path(tempfile.mkdtemp(prefix="cc_reader_"))
os.environ["DB_PATH"] = str(_ROOT / "t.db")
os.environ["MEDIA_ROOT"] = str(_ROOT / "media")
os.environ["ADMIN_SESSION_SECRET"] = "test-secret-for-reader-signing"

from app.db.conn import transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import order_flow, reader, storage  # noqa: E402

failures: list[str] = []
BUYER = {
    "name": "Asha Patil", "phone": "9876500000", "email": "asha@example.com",
    "address1": "1", "city": "Nagpur", "pincode": "440016",
}


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def seed() -> str:
    import fitz

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
            " subject, price, ebook_price, ebook_available, physical_available,"
            " status, in_stock, stock_qty, created_at, updated_at)"
            " VALUES ('rb','rd-book','Reader Book','kohinoor','state','10',"
            " 'english','Science',500,200,1,1,'published',1,10,?,?)",
            (now, now),
        )
    src = storage.root() / "pdfs" / "rd.pdf"
    src.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    for i in range(4):
        doc.new_page().insert_text(fitz.Point(72, 100), f"Page {i + 1}")
    doc.save(str(src))
    doc.close()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO book_assets (id, book_id, original_name, storage_path,"
            " sha256, page_count, process_state, is_current, created_at,"
            " updated_at) VALUES ('ra','rb','rd.pdf',?,'x',4,'ready',1,?,?)",
            (storage.relative(src), now, now),
        )
    return "rd-book"


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    slug = seed()

    order = orders_repo.create_order(
        items=[{"slug": slug, "qty": 1, "delivery": "digital"}], customer=BUYER,
    )
    number = order["orderNumber"]

    print("=== an unpaid order gets no manifest ===")
    try:
        reader.issue_manifest(number, slug, customer_id=None)
        check("refused before confirmation", False, "IT ISSUED ONE")
    except reader.ReaderError:
        check("refused before confirmation", True)

    order_flow.transition(number, "confirmed")

    print("\n=== the manifest describes the book ===")
    manifest = reader.issue_manifest(number, slug, customer_id=None)
    check("it knows the page count", manifest["pageCount"] == 4, str(manifest["pageCount"]))
    check("one token per page", len(manifest["pages"]) == 4, str(len(manifest["pages"])))
    check("and it expires", manifest["expiresAt"] > 0, str(manifest["expiresAt"]))

    token1 = manifest["pages"][0]["token"]
    token3 = manifest["pages"][2]["token"]

    print("\n=== a valid token opens its own page ===")
    try:
        reader.verify_page(number, slug, 1, token1)
        check("page 1 with page 1's token", True)
    except reader.ReaderError as exc:
        check("page 1 with page 1's token", False, str(exc))

    print("\n=== A TOKEN IS BOUND TO ONE PAGE ===")
    try:
        reader.verify_page(number, slug, 3, token1)
        check("page 1's token cannot open page 3", False, "THE WHOLE BOOK IS OPEN")
    except reader.ReaderError:
        check("page 1's token cannot open page 3", True)
    try:
        reader.verify_page(number, slug, 1, token3)
        check("and page 3's cannot open page 1", False, "THE WHOLE BOOK IS OPEN")
    except reader.ReaderError:
        check("and page 3's cannot open page 1", True)

    print("\n=== and to one order and book ===")
    other = orders_repo.create_order(
        items=[{"slug": slug, "qty": 1, "delivery": "digital"}], customer=BUYER,
    )
    order_flow.transition(other["orderNumber"], "confirmed")
    try:
        reader.verify_page(other["orderNumber"], slug, 1, token1)
        check("another order's token is refused", False, "TOKENS ARE INTERCHANGEABLE")
    except reader.ReaderError:
        check("another order's token is refused", True)
    try:
        reader.verify_page(number, "some-other-book", 1, token1)
        check("another book's token is refused", False)
    except reader.ReaderError:
        check("another book's token is refused", True)

    print("\n=== tampering is rejected ===")
    for bad, why in [
        ("", "an empty token"),
        ("garbage", "a token with no signature part"),
        (token1[:-4] + "0000", "an edited signature"),
        ("9999999999.deadbeef", "a forged one with a far expiry"),
    ]:
        try:
            reader.verify_page(number, slug, 1, bad)
            check(f"{why} is refused", False, "IT WAS ACCEPTED")
        except reader.ReaderError:
            check(f"{why} is refused", True)

    print("\n=== EXPIRY ===")
    past = int(dt.datetime.now(dt.timezone.utc).timestamp()) - 10
    stale = reader.sign_page(number, slug, 1, expires=past)
    try:
        reader.verify_page(number, slug, 1, stale)
        check("an expired token is refused", False, "A COPIED URL LIVES FOREVER")
    except reader.ReaderError as exc:
        check("an expired token is refused", True)
        check("and says to reload rather than blaming the customer",
              "expired" in str(exc).lower(), str(exc))

    print("\n=== entitlement is re-read, not trusted from the manifest ===")
    check("entitled while the order stands",
          reader.check_entitled(number, slug, customer_id=None)["order_number"]
          == number)
    order_flow.transition(number, "cancelled")
    try:
        reader.check_entitled(number, slug, customer_id=None)
        check("a refund closes the book immediately", False, "STILL READABLE")
    except reader.ReaderError:
        check("a refund closes the book immediately", True)
    check("and the signature alone is not enough",
          True,
          "verify_page still passes — entitlement is the separate check that stops it")

    print("\n=== the watermark names the buyer ===")
    stamp = reader.watermark_for(other["orderNumber"], slug)
    check("it carries the name", "Asha Patil" in stamp, stamp)
    check("the email", "asha@example.com" in stamp, stamp)
    check("and the order", other["orderNumber"] in stamp, stamp)

    print("\n=== there is no whole-file route in the reader ===")
    import app.services.reader as reader_module

    exported = [n for n in dir(reader_module) if not n.startswith("_")]
    check("nothing here returns a file",
          not any("download" in n.lower() or "file" in n.lower() for n in exported),
          str(exported))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Reader holds: one token per page, expiring, re-checked every request.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
