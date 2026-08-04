"""Shipments, tracking links and zone quoting.

    python -m tests.test_shipping
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_ship_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import order_flow, shipping  # noqa: E402

failures: list[str] = []

CUSTOMER = {"name": "Ravi", "phone": "9876500000", "address1": "1 Road",
            "city": "Nagpur", "state": "Maharashtra", "pincode": "440016"}


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def make_order() -> str:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    if not query_one("SELECT id FROM books WHERE slug = 'ship-book'"):
        with transaction() as conn:
            conn.execute(
                "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
                " subject, price, status, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                ("ship-book", "ship-book", "Shippable", "kohinoor", "state", "10",
                 "english", "Science", 300, "published", now, now),
            )
    return orders_repo.create_order(
        items=[{"slug": "ship-book", "qty": 1}], customer=CUSTOMER
    )["orderNumber"]


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== carriers ship with working public tracking links ===")
    codes = {c["code"] for c in shipping.carriers()}
    check("the common Indian carriers are seeded",
          {"delhivery", "bluedart", "dtdc", "indiapost"} <= codes, str(sorted(codes)))
    url = shipping.tracking_url("delhivery", "1234567890")
    check("the AWB is substituted into the URL", "1234567890" in url, url)
    check("it is a real https link", url.startswith("https://"), url)
    check("an unknown carrier degrades to no link, not a crash",
          shipping.tracking_url("nonesuch", "123") == "")
    check("a carrier with no template degrades too",
          shipping.tracking_url("other", "123") == "")

    print("\n=== zones: longest prefix wins ===")
    with transaction() as conn:
        conn.execute(
            "INSERT INTO shipping_zones (id, name, pin_prefixes, rate, free_above,"
            " days_min, days_max, sort_order) VALUES (?,?,?,?,?,?,?,?)",
            ("z_all", "Rest of India", json.dumps(["4"]), 80, 1000, 5, 10, 100),
        )
        conn.execute(
            "INSERT INTO shipping_zones (id, name, pin_prefixes, rate, free_above,"
            " days_min, days_max, sort_order) VALUES (?,?,?,?,?,?,?,?)",
            ("z_ngp", "Nagpur local", json.dumps(["440", "441"]), 30, 300, 1, 2, 200),
        )
    zone = shipping.zone_for("440016")
    check("the more specific zone wins regardless of sort order",
          zone and zone["name"] == "Nagpur local", str(zone),
          )
    check("a broader pin falls to the wider zone",
          (shipping.zone_for("400001") or {}).get("name") == "Rest of India",
          str(shipping.zone_for("400001")))
    check("an unmatched pin has no zone", shipping.zone_for("999999") is None)
    check("an empty pin has no zone", shipping.zone_for("") is None)

    print("\n=== quoting ===")
    local = shipping.quote("440016", 100)
    check("local rate applied", local["charge"] == 30, str(local))
    check("and the local estimate", local["daysMax"] == 2, str(local))
    check("free above the zone threshold",
          shipping.quote("440016", 500)["charge"] == 0)
    check("a zone with no match falls back to the flat rate",
          shipping.quote("999999", 10)["charge"] > 0,
          "an unconfigured shop must not ship free by accident")

    print("\n=== creating a shipment ===")
    num = make_order()
    order_flow.transition(num, "confirmed")
    order_flow.transition(num, "packed")
    shipping.create(num, carrier_code="delhivery", awb="AWB111", charge=30)
    shipment = shipping.for_order(num)
    check("shipment attached", shipment["awb"] == "AWB111")
    check("it starts ready", shipment["status"] == "ready")
    check("the customer gets a tracking link", "AWB111" in shipment["trackingUrl"])

    try:
        shipping.create(num, carrier_code="delhivery", awb="")
        check("a blank AWB is refused", False, "accepted")
    except shipping.ShippingError:
        check("a blank AWB is refused", True)
    try:
        shipping.create(num, carrier_code="teleport", awb="X1")
        check("an unknown carrier is refused", False, "accepted")
    except shipping.ShippingError:
        check("an unknown carrier is refused", True)

    other = make_order()
    try:
        shipping.create(other, carrier_code="delhivery", awb="AWB111")
        check("a duplicate AWB on the same carrier is refused", False, "accepted")
    except shipping.ShippingError as exc:
        check("a duplicate AWB on the same carrier is refused", True)
        check("and the message names the order it is already on", num in str(exc), str(exc))
    check("the same number on a DIFFERENT carrier is fine",
          shipping.create(other, carrier_code="dtdc", awb="AWB111")["awb"] == "AWB111")

    print("\n=== shipment status drives the order ===")
    shipping.update_status(num, "dispatched", last_update="Picked up from Nagpur hub")
    check("order moved to shipped",
          query_one("SELECT status FROM orders WHERE order_number=?", (num,))["status"] == "shipped",
          "the parcel is the physical truth; the order must follow it")
    check("dispatch was stamped", shipping.for_order(num)["dispatched_at"] is not None)
    check("the courier's own note is kept",
          "Nagpur hub" in shipping.for_order(num)["last_update"])

    shipping.update_status(num, "out_for_delivery")
    check("order follows to out_for_delivery",
          query_one("SELECT status FROM orders WHERE order_number=?", (num,))["status"] == "out_for_delivery")

    shipping.update_status(num, "delivered")
    check("order marked delivered",
          query_one("SELECT status FROM orders WHERE order_number=?", (num,))["status"] == "delivered")
    check("delivery was stamped", shipping.for_order(num)["delivered_at"] is not None)

    print("\n=== an illegal order move does not break the shipment ===")
    # 'failed' has no order equivalent, and 'delivered' is already terminal for
    # forward movement — the shipment record must still update.
    shipping.update_status(num, "failed", last_update="nobody home")
    check("the shipment records the failure", shipping.for_order(num)["status"] == "failed")
    check("and the order was left alone rather than forced",
          query_one("SELECT status FROM orders WHERE order_number=?", (num,))["status"] == "delivered")

    print("\n=== what the customer sees ===")
    view = shipping.public_view(shipping.for_order(num))
    check("carrier is a human name, not a code", view["carrier"] == "Delhivery", str(view))
    check("no internal id is exposed", "id" not in view and "order_id" not in view, str(view))
    check("no staff id is exposed", "created_by" not in view, str(view))
    check("status has a readable label", view["statusLabel"] and "_" not in view["statusLabel"],
          str(view["statusLabel"]))

    print("\n=== the future seam exists ===")
    check("a carrier provider is selectable", shipping.provider().name == "manual")
    check("it satisfies the interface",
          all(hasattr(shipping.provider(), m) for m in ("create_shipment", "track", "cancel")))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Shipping holds: real tracking links, zones, order follows the parcel.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
