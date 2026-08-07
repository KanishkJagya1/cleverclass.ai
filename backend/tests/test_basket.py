"""The cart — including the print/download split added with e-books.

`basket.py` had no tests when its uniqueness key and pricing were rewritten to
carry `delivery`. That rewrite already broke one thing in production code (an
`ON CONFLICT` target that no longer matched an index), which is exactly the
class of bug a test here catches in a second.

    python -m tests.test_basket
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_basket_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import basket  # noqa: E402

failures: list[str] = []
CUS = "cus_basket"


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def seed() -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO customers (id, email, email_norm, name, phone, status,"
            " created_at, updated_at) VALUES (?,?,?,?,?,'active',?,?)",
            (CUS, "b@example.com", "b@example.com", "B", "9000000000", now, now),
        )
        for slug, price, ep, ea in [
            ("bk-both", 500, 200, 1),
            ("bk-print", 300, None, 0),
        ]:
            conn.execute(
                "INSERT INTO books (id, slug, title, series, board, class_id,"
                " medium, subject, price, ebook_price, ebook_available,"
                " physical_available, status, in_stock, stock_qty,"
                " created_at, updated_at)"
                " VALUES (?,?,?,'kohinoor','state','10','english','Science',"
                " ?,?,?,1,'published',1,10,?,?)",
                (slug, slug, f"Book {slug}", price, ep, ea, now, now),
            )


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    seed()

    print("=== adding ===")
    cart = basket.set_item(CUS, "bk-both", 2)
    check("the line is there", len(cart["items"]) == 1, str(cart["items"]))
    check("at the printed price", cart["items"][0]["price"] == 500, str(cart["items"][0]))
    check("subtotal follows quantity", cart["subtotal"] == 1000, str(cart["subtotal"]))
    check("and it defaults to physical",
          cart["items"][0]["delivery"] == "physical", str(cart["items"][0]))

    print("\n=== BOTH FORMATS COEXIST ===")
    cart = basket.set_item(CUS, "bk-both", 1, delivery="digital")
    check("two separate lines now", len(cart["items"]) == 2, str(len(cart["items"])))
    prices = sorted(i["price"] for i in cart["items"])
    check("each at its own price", prices == [200, 500], str(prices))
    check("subtotal is the sum", cart["subtotal"] == 1200, str(cart["subtotal"]))
    check("the printed line kept its quantity",
          any(i["delivery"] == "physical" and i["qty"] == 2 for i in cart["items"]),
          "adding the e-book must not overwrite the printed line")

    print("\n=== an e-book line is priced from ebook_price ===")
    digital = next(i for i in cart["items"] if i["delivery"] == "digital")
    check("200, not 500", digital["price"] == 200, str(digital["price"]))
    check("and carries no printed MRP", digital["mrp"] is None, str(digital["mrp"]))

    print("\n=== updating one format leaves the other alone ===")
    cart = basket.set_item(CUS, "bk-both", 5, delivery="digital")
    by = {i["delivery"]: i["qty"] for i in cart["items"]}
    check("the download changed", by.get("digital") == 5, str(by))
    check("the printed copy did not", by.get("physical") == 2, str(by))

    print("\n=== removing ===")
    cart = basket.remove_item(CUS, "bk-both", delivery="digital")
    check("only the download went",
          len(cart["items"]) == 1 and cart["items"][0]["delivery"] == "physical",
          str(cart["items"]))

    basket.set_item(CUS, "bk-both", 1, delivery="digital")
    cart = basket.remove_item(CUS, "bk-both")
    check("no delivery given removes BOTH formats",
          cart["items"] == [],
          "that is what 'remove this book' means from a row showing one of them")

    print("\n=== quantity zero removes the line ===")
    basket.set_item(CUS, "bk-print", 3)
    cart = basket.set_item(CUS, "bk-print", 0)
    check("gone", cart["items"] == [], str(cart["items"]))

    print("\n=== an e-book that is not offered is reported, not priced ===")
    # bk-print has ebook_available = 0. A digital line for it must not silently
    # bill the printed price.
    basket.set_item(CUS, "bk-print", 1, delivery="digital")
    cart = basket.cart(CUS)
    check("it is not a priced line",
          all(i["slug"] != "bk-print" for i in cart["items"]),
          str(cart["items"]))
    check("and the customer is told rather than left guessing",
          "bk-print" in cart["unavailable"], str(cart["unavailable"]))
    basket.remove_item(CUS, "bk-print")

    print("\n=== an unpublished book leaves the cart with a word ===")
    basket.set_item(CUS, "bk-both", 1)
    with transaction() as conn:
        conn.execute("UPDATE books SET status='draft' WHERE slug='bk-both'")
    cart = basket.cart(CUS)
    check("it is not billed", cart["items"] == [], str(cart["items"]))
    check("it is listed as unavailable",
          "bk-both" in cart["unavailable"],
          "a line vanishing silently is how someone orders the wrong thing")
    with transaction() as conn:
        conn.execute("UPDATE books SET status='published' WHERE slug='bk-both'")

    print("\n=== guest cart merge keeps both formats ===")
    basket.remove_item(CUS, "bk-both")
    merged = basket.merge_guest_cart(CUS, [
        {"slug": "bk-both", "qty": 1, "delivery": "physical"},
        {"slug": "bk-both", "qty": 2, "delivery": "digital"},
    ])
    check("both survive the merge", len(merged["items"]) == 2, str(merged["items"]))
    by = {i["delivery"]: i["qty"] for i in merged["items"]}
    check("with their own quantities", by == {"physical": 1, "digital": 2}, str(by))

    print("\n=== merging again takes the larger quantity, not the sum ===")
    merged = basket.merge_guest_cart(CUS, [
        {"slug": "bk-both", "qty": 1, "delivery": "digital"},
    ])
    by = {i["delivery"]: i["qty"] for i in merged["items"]}
    check("2 stays 2 rather than becoming 3",
          by.get("digital") == 2,
          f"{by} — signing in twice must not multiply the basket")

    print("\n=== a negative quantity is refused ===")
    try:
        basket.set_item(CUS, "bk-both", -1)
        check("refused", False, "it was allowed")
    except basket.BasketError:
        check("refused", True)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Basket holds: formats stay apart, unavailable lines are named.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
