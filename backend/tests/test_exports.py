"""Order export: filters, shapes, encoding, and who is allowed to run it.

    python -m tests.test_exports
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_exp_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import exports, permissions  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        for slug, title, price in [
            ("exp-a", "Kohinoor इयत्ता १० वी विज्ञान", 250),   # Devanagari on purpose
            ("exp-b", "Spark Class 12 Physics", 400),
        ]:
            conn.execute(
                "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
                " subject, price, status, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (slug, slug, title, "kohinoor", "state", "10", "marathi",
                 "Science", price, "published", now, now),
            )

    customer = {"name": "Ravi Kumar", "phone": "9876500000", "email": "r@example.com",
                "address1": "12 Main Road", "city": "Nagpur", "state": "Maharashtra",
                "pincode": "440016"}
    first = orders_repo.create_order(
        items=[{"slug": "exp-a", "qty": 2}, {"slug": "exp-b", "qty": 1}],
        customer=customer,
    )["orderNumber"]
    orders_repo.create_order(items=[{"slug": "exp-a", "qty": 1}], customer=customer)

    print("=== a date range is always applied ===")
    stats = exports.summary()
    check("the default range is bounded", bool(stats["from"]) and bool(stats["to"]), str(stats))
    check("today's orders are included", stats["orders"] == 2, str(stats))
    check("revenue is summed", stats["revenue"] > 0, str(stats))

    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=400)).date().isoformat()
    older = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=390)).date().isoformat()
    check("a range with no orders returns none",
          exports.summary(date_from=old, date_to=older)["orders"] == 0)

    print("\n=== the end date is inclusive ===")
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    check("orders placed today are in a range ending today",
          exports.summary(date_from=today, date_to=today)["orders"] == 2,
          "a bare date comparison silently drops the final day's orders")

    print("\n=== order shape ===")
    text = "".join(exports.to_csv("order"))
    check("starts with a UTF-8 BOM", text.startswith("﻿"),
          "without it Excel renders every Devanagari title as mojibake")
    reader = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    check("one row per order", len(reader) == 2, str(len(reader)))
    row = next(r for r in reader if r["order_number"] == first)
    check("items are readable in one cell", "x2" in row["items"], row["items"])
    check("item_count sums quantities", row["item_count"] == "3", row["item_count"])
    check("the address is included", row["pincode"] == "440016")
    check("totals are present", int(row["total"]) > 0, row["total"])

    print("\n=== line shape ===")
    lines = list(csv.DictReader(io.StringIO("".join(exports.to_csv("line")).lstrip("﻿"))))
    check("one row per item", len(lines) == 3, str(len(lines)))
    check("GST columns are present for the accountant",
          all("hsn_code" in r and "gst_rate" in r for r in lines))
    check("the Devanagari title survives the round trip",
          any("विज्ञान" in r["title"] for r in lines),
          str([r["title"] for r in lines]))
    check("line totals are per item", all(int(r["line_total"]) > 0 for r in lines))

    print("\n=== json ===")
    payload = json.loads("".join(exports.to_json("order")))
    check("valid json array", isinstance(payload, list) and len(payload) == 2, str(type(payload)))
    check("an empty result is still valid json",
          json.loads("".join(exports.to_json("order", date_from=old, date_to=older))) == [])

    print("\n=== filters ===")
    check("filtering by a status nothing has returns nothing",
          exports.summary(status="delivered")["orders"] == 0)
    check("filtering by the real status returns everything",
          exports.summary(status="requested")["orders"] == 2)
    check("filtering by an unused coupon returns nothing",
          exports.summary(coupon="NOSUCH")["orders"] == 0)

    print("\n=== it streams rather than assembling ===")
    generator = exports.to_csv("order")
    first_chunk = next(generator)
    check("output begins before the whole file is built",
          first_chunk.startswith("﻿"),
          "a non-generator would have materialised everything first")

    print("\n=== who may export ===")
    check("support can read orders", permissions.has_permission({"role": "support"}, permissions.ORDERS_READ))
    check("but support CANNOT export them",
          not permissions.has_permission({"role": "support"}, permissions.ORDERS_EXPORT),
          "one order is one address; the export is every customer's address")
    check("editor cannot export", not permissions.has_permission({"role": "editor"}, permissions.ORDERS_EXPORT))
    check("store_manager can", permissions.has_permission({"role": "store_manager"}, permissions.ORDERS_EXPORT))
    check("admin can", permissions.has_permission({"role": "admin"}, permissions.ORDERS_EXPORT))

    print("\n=== bad input ===")
    try:
        list(exports.rows("sideways"))
        check("an unknown shape is refused", False, "accepted")
    except ValueError:
        check("an unknown shape is refused", True)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Exports hold: bounded, streamed, permissioned, Excel-safe.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
