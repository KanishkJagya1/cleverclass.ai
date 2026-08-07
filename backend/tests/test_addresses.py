"""Saved delivery addresses.

Two invariants carry weight here:

  * **One default per customer.** Two defaults means checkout picks arbitrarily
    and the parcel goes to last year's address.
  * **Addresses are scoped to their owner.** Every function takes a
    customer_id, and guessing another customer's address id must achieve
    nothing — this is the closest thing in the app to a private record.

    python -m tests.test_addresses
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_addr_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query, query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import addresses  # noqa: E402

failures: list[str] = []
A, B = "cus_a", "cus_b"

VALID = {
    "label": "Home", "name": "Asha", "phone": "9876500000",
    "line1": "12 Shivaji Nagar", "line2": "Near the school",
    "city": "Nagpur", "state": "Maharashtra", "pincode": "440016",
    "landmark": "Opposite Ganesh temple",
}


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def seed() -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        for cid, email in ((A, "a@example.com"), (B, "b@example.com")):
            conn.execute(
                "INSERT INTO customers (id, email, email_norm, name, phone,"
                " status, created_at, updated_at)"
                " VALUES (?,?,?,'X','9000000000','active',?,?)",
                (cid, email, email, now, now),
            )


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    seed()

    print("=== creating ===")
    first = addresses.create(A, **VALID)
    check("it comes back with an id", bool(first["id"]), str(first))
    check("the landmark is kept",
          first["landmark"] == "Opposite Ganesh temple", str(first["landmark"]))
    check("the first address is the default",
          first["isDefault"] is True,
          "with one address, anything else means checkout has no address")

    print("\n=== ONE DEFAULT, ALWAYS ===")
    second = addresses.create(A, **{**VALID, "label": "Office", "isDefault": True})
    defaults = [a for a in addresses.list_for(A) if a["isDefault"]]
    check("exactly one default after adding a second",
          len(defaults) == 1, str([a["label"] for a in defaults]))
    check("and it is the new one",
          defaults and defaults[0]["id"] == second["id"], str(defaults))

    addresses.set_default(A, first["id"])
    defaults = [a for a in addresses.list_for(A) if a["isDefault"]]
    check("switching back still leaves exactly one",
          len(defaults) == 1 and defaults[0]["id"] == first["id"],
          str([a["label"] for a in defaults]))

    print("\n=== the customer mirror follows the default ===")
    row = query_one("SELECT address_line1, pincode FROM customers WHERE id = ?", (A,))
    check("the customer record carries the default address",
          row["pincode"] == "440016", str(dict(row)))

    print("\n=== validation ===")
    for bad, why in [
        ({"line1": ""}, "an empty street"),
        ({"city": ""}, "an empty city"),
        ({"pincode": "12"}, "a short pincode"),
        ({"pincode": "abcdef"}, "a non-numeric pincode"),
    ]:
        try:
            addresses.create(A, **{**VALID, **bad})
            check(f"{why} is refused", False, "it was accepted")
        except addresses.AddressError:
            check(f"{why} is refused", True)

    print("\n=== SCOPED TO THE OWNER ===")
    mine = addresses.get(A, first["id"])
    check("the owner can read it", mine is not None)
    check("another customer cannot",
          addresses.get(B, first["id"]) is None,
          "guessing an id must not expose someone's home address")

    try:
        addresses.update(B, first["id"], city="Hacked")
        check("another customer cannot edit it", False, "IT WAS EDITED")
    except addresses.AddressError:
        check("another customer cannot edit it", True)
    check("and the address is unchanged",
          addresses.get(A, first["id"])["city"] == "Nagpur",
          str(addresses.get(A, first["id"])["city"]))

    # Refusing outright and silently doing nothing are both acceptable; the
    # only unacceptable outcome is the address actually disappearing.
    try:
        addresses.remove(B, first["id"])
    except addresses.AddressError:
        pass
    check("another customer's delete does nothing",
          addresses.get(A, first["id"]) is not None,
          "scoping has to hold on every verb, not just read")

    print("\n=== updating ===")
    updated = addresses.update(A, first["id"], landmark="Behind the post office")
    check("the landmark changes",
          updated["landmark"] == "Behind the post office", str(updated["landmark"]))
    check("and untouched fields survive",
          updated["city"] == "Nagpur" and updated["pincode"] == "440016",
          str(updated))

    print("\n=== list is scoped too ===")
    check("B sees none of A's addresses",
          addresses.list_for(B) == [], str(addresses.list_for(B)))

    print("\n=== a soft-deleted address leaves the list ===")
    if hasattr(addresses, "remove"):
        addresses.remove(A, second["id"])
        check("it is gone from the list",
              all(a["id"] != second["id"] for a in addresses.list_for(A)),
              str([a["label"] for a in addresses.list_for(A)]))
        check("but a default still exists",
              any(a["isDefault"] for a in addresses.list_for(A)),
              "deleting one address must not leave the customer with none")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Addresses hold: one default, scoped to the owner.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
