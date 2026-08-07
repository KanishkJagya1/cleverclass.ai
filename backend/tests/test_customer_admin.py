"""Customer administration — export and anonymisation especially.

`anonymise` is the function with real consequences: it is irreversible, it must
scrub personal data, and it must NOT destroy the order history the business is
legally required to keep. Getting either half wrong is a serious problem in a
different direction, which is why both are asserted here.

    python -m tests.test_customer_admin
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_cadmin_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import customer_admin  # noqa: E402

failures: list[str] = []
CUS = "cus_ca"


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def seed() -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO customers (id, email, email_norm, name, phone, status,"
            " address_line1, city, pincode, created_at, updated_at)"
            " VALUES (?,?,?,?,?,'active','12 Shivaji Nagar','Nagpur','440016',?,?)",
            (CUS, "Asha@Example.com", "asha@example.com", "Asha Patil",
             "9876500000", now, now),
        )
        conn.execute(
            "INSERT INTO orders (id, order_number, status, customer_id,"
            " customer_name, phone, email, total, subtotal, created_at, updated_at)"
            " VALUES ('o-ca','CC-CA01','delivered',?,'Asha Patil','9876500000',"
            " 'asha@example.com',500,500,?,?)",
            (CUS, now, now),
        )


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    seed()

    print("=== search ===")
    found = customer_admin.search("asha")
    check("finds by name", found["total"] >= 1, str(found["total"]))
    check("by email too", customer_admin.search("asha@example.com")["total"] >= 1)
    check("and by phone", customer_admin.search("9876500000")["total"] >= 1)
    check("a stranger's term finds nothing",
          customer_admin.search("zzzz-nobody")["total"] == 0)

    print("\n=== the list row carries no address ===")
    row = found["customers"][0]
    check("no street on a list screen",
          not any("line1" in k or "address" in k.lower() for k in row),
          f"{list(row)} — a screenshot of a list should not leak addresses")

    print("\n=== detail brings the order history ===")
    detail = customer_admin.detail(CUS)
    check("the customer is found", detail is not None)
    check("with their orders",
          detail and len(detail.get("orders", [])) == 1, str(detail and detail.get("orders")))

    print("\n=== export gives the customer everything about them ===")
    export = customer_admin.export_one(CUS)
    blob = str(export)
    check("it includes their email", "asha@example.com" in blob)
    check("and their orders", "CC-CA01" in blob, blob[:200])

    print("\n=== blocking ===")
    customer_admin.set_status(CUS, "disabled", actor_id="admin1")
    check("the status sticks",
          query_one("SELECT status FROM customers WHERE id=?", (CUS,))["status"]
          == "disabled")
    customer_admin.set_status(CUS, "active", actor_id="admin1")

    print("\n=== ANONYMISATION ===")
    customer_admin.anonymise(CUS, actor_id="admin1")
    after = query_one("SELECT * FROM customers WHERE id = ?", (CUS,))

    check("the row still exists", after is not None,
          "deleting it would orphan the orders")
    check("the name is gone",
          "Asha" not in (after["name"] or ""), str(after["name"]))
    check("the real email is gone",
          "asha@example.com" not in (after["email"] or "").lower(),
          str(after["email"]))
    check("the phone is gone",
          "9876500000" not in (after["phone"] or ""), str(after["phone"]))
    check("and the street address with it",
          "Shivaji" not in (after["address_line1"] or ""),
          str(after["address_line1"]))

    print("\n=== but the ORDER survives ===")
    order = query_one("SELECT * FROM orders WHERE order_number = 'CC-CA01'")
    check("the order is still there", order is not None,
          "a business must keep its sales records")
    check("with its total intact", order and order["total"] == 500, str(order["total"]))

    print("\n=== and they can no longer sign in ===")
    check("the account is not active",
          after["status"] != "active", str(after["status"]))

    print("\n=== anonymising twice does not explode ===")
    try:
        customer_admin.anonymise(CUS, actor_id="admin1")
        check("second call is handled", True)
    except Exception as exc:  # noqa: BLE001
        check("second call is handled", False, f"{type(exc).__name__}: {exc}")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Customer admin holds: scrubbed personal data, intact sales records.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
