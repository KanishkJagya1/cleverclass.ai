"""Shipments, tracking links and delivery zones.

MANUAL AWB BY DECISION. Real carrier APIs need a per-carrier business contract
or an aggregator account, and neither exists. What this delivers with zero
credentials is what customers actually ask for: a tracking number, a working
link to the carrier's own page, and a status that changes when the parcel moves.

The `CarrierProvider` protocol at the bottom is the seam. When a Shiprocket
account exists, that becomes an implementation — the order flow, the customer
tracking page and the emails do not change.

ZONES

Prefix matching, longest first, because India has ~19,000 pincodes and this shop
needs to distinguish "Nagpur", "rest of Maharashtra" and "rest of India" — which
the first one to three digits answer. A full pincode table would be 19,000 rows
maintained by hand to express three rules.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import secrets

from app.config import settings
from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

STATUSES = (
    "ready", "dispatched", "in_transit", "out_for_delivery",
    "delivered", "failed", "returned",
)

# Which order status a shipment status implies. Shipping is the physical world
# reporting back, so it drives the order rather than the other way round.
_ORDER_STATUS_FOR = {
    "dispatched": "shipped",
    "in_transit": "shipped",
    "out_for_delivery": "out_for_delivery",
    "delivered": "delivered",
    "returned": "returned",
}

LABELS = {
    "ready": "Ready to dispatch",
    "dispatched": "Dispatched",
    "in_transit": "In transit",
    "out_for_delivery": "Out for delivery",
    "delivered": "Delivered",
    "failed": "Delivery attempt failed",
    "returned": "Returned to us",
}


class ShippingError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# ---------------------------------------------------------------- carriers --
def carriers(active_only: bool = True) -> list[dict]:
    sql = "SELECT * FROM carriers"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort_order, name"
    return [dict(r) for r in query(sql)]


def tracking_url(carrier_code: str, awb: str) -> str:
    """The carrier's public tracking page for this AWB, or '' if unknown."""
    row = query_one("SELECT tracking_url FROM carriers WHERE code = ?", (carrier_code,))
    template = (row["tracking_url"] if row else "") or ""
    if not template or not awb:
        return ""
    # Substitution, not formatting: a carrier URL containing a stray brace
    # would make str.format raise, and an unknown carrier should degrade to "no
    # link" rather than break the customer's tracking page.
    return template.replace("{awb}", awb.strip())


# ------------------------------------------------------------------- zones --
def zones() -> list[dict]:
    out = []
    for row in query(
        "SELECT * FROM shipping_zones WHERE is_active = 1 ORDER BY sort_order"
    ):
        zone = dict(row)
        try:
            zone["pin_prefixes"] = json.loads(zone["pin_prefixes"] or "[]")
        except ValueError:
            zone["pin_prefixes"] = []
        out.append(zone)
    return out


def zone_for(pincode: str) -> dict | None:
    """Longest matching prefix wins.

    So a zone for "440" (Nagpur) beats one for "4" (western India) without
    depending on row order, which would otherwise silently change when someone
    re-sorts the list in the admin panel.
    """
    pin = (pincode or "").strip()
    if not pin:
        return None
    best = None
    best_len = -1
    for zone in zones():
        for prefix in zone["pin_prefixes"]:
            prefix = str(prefix)
            if pin.startswith(prefix) and len(prefix) > best_len:
                best, best_len = zone, len(prefix)
    return best


def quote(pincode: str, subtotal: int) -> dict:
    """Shipping charge and delivery estimate for a destination.

    Falls back to the global flat rate when no zone matches, so an unconfigured
    shop still charges something sensible instead of shipping free by accident.
    """
    zone = zone_for(pincode)
    if zone is None:
        free = subtotal >= settings.free_shipping_threshold
        return {
            "zone": None,
            "charge": 0 if free else settings.shipping_flat_rate,
            "daysMin": 3,
            "daysMax": 7,
            "freeApplied": free,
        }

    free_above = zone["free_above"]
    free = free_above is not None and subtotal >= free_above
    return {
        "zone": zone["name"],
        "charge": 0 if free else zone["rate"],
        "daysMin": zone["days_min"],
        "daysMax": zone["days_max"],
        "freeApplied": free,
    }


# --------------------------------------------------------------- shipments --
def for_order(order_number: str) -> dict | None:
    row = query_one(
        "SELECT s.* FROM shipments s JOIN orders o ON o.id = s.order_id"
        " WHERE o.order_number = ? ORDER BY s.created_at DESC LIMIT 1",
        (order_number,),
    )
    if row is None:
        return None
    shipment = dict(row)
    shipment["trackingUrl"] = tracking_url(shipment["carrier_code"], shipment["awb"])
    shipment["statusLabel"] = LABELS.get(shipment["status"], shipment["status"])
    return shipment


def create(
    order_number: str,
    *,
    carrier_code: str,
    awb: str,
    charge: int = 0,
    weight_grams: int | None = None,
    expected_at: str | None = None,
    notes: str = "",
    actor_id: str | None = None,
) -> dict:
    awb = (awb or "").strip()
    if not awb:
        raise ShippingError("An AWB / tracking number is required")
    if query_one("SELECT code FROM carriers WHERE code = ?", (carrier_code,)) is None:
        raise ShippingError("Unknown carrier")

    order = query_one("SELECT id FROM orders WHERE order_number = ?", (order_number,))
    if order is None:
        raise ShippingError("No such order")

    clash = query_one(
        "SELECT s.id, o.order_number FROM shipments s"
        " JOIN orders o ON o.id = s.order_id"
        " WHERE s.carrier_code = ? AND s.awb = ?",
        (carrier_code, awb),
    )
    if clash:
        # Caught here with a useful message rather than as a UNIQUE violation,
        # because the usual cause is a typo and the useful answer names the
        # order the number is already on.
        raise ShippingError(
            f"That AWB is already on order {clash['order_number']}."
        )

    shipment_id = f"shp_{secrets.token_hex(8)}"
    with transaction() as conn:
        conn.execute(
            "INSERT INTO shipments (id, order_id, carrier_code, awb, status,"
            " expected_at, weight_grams, charge, notes, created_at, updated_at,"
            " created_by)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (shipment_id, order["id"], carrier_code, awb, "ready", expected_at,
             weight_grams, charge, notes[:500], _now(), _now(), actor_id),
        )
    log.info("Shipment %s created for %s (%s %s)", shipment_id, order_number,
             carrier_code, awb)
    return for_order(order_number) or {}


def update_status(
    order_number: str,
    status: str,
    *,
    last_update: str = "",
    actor_id: str | None = None,
    advance_order: bool = True,
) -> dict:
    if status not in STATUSES:
        raise ShippingError(f"Unknown shipment status {status!r}")

    shipment = for_order(order_number)
    if shipment is None:
        raise ShippingError("This order has no shipment")

    stamps = {}
    if status == "dispatched" and not shipment["dispatched_at"]:
        stamps["dispatched_at"] = _now()
    if status == "delivered" and not shipment["delivered_at"]:
        stamps["delivered_at"] = _now()

    sets = ["status = ?", "last_update = ?", "updated_at = ?"]
    params: list = [status, last_update[:500], _now()]
    for column, value in stamps.items():
        sets.append(f"{column} = ?")
        params.append(value)
    params.append(shipment["id"])

    with transaction() as conn:
        conn.execute(f"UPDATE shipments SET {', '.join(sets)} WHERE id = ?", params)

    # Move the order to match. The parcel is the physical truth; an order still
    # reading "packed" while the courier says delivered is the discrepancy
    # customers phone about.
    if advance_order:
        target = _ORDER_STATUS_FOR.get(status)
        if target:
            from app.services import order_flow

            try:
                order_flow.transition(
                    order_number, target,
                    note=f"shipment {status}" + (f": {last_update}" if last_update else ""),
                    actor=actor_id,
                )
            except Exception as exc:  # noqa: BLE001 — includes TransitionError
                # Non-fatal: the shipment record is still correct, and forcing
                # an illegal order transition would corrupt the state machine.
                log.info(
                    "Shipment %s updated but the order did not move to %s: %s",
                    order_number, target, exc,
                )
    return for_order(order_number) or {}


def public_view(shipment: dict | None) -> dict | None:
    """What the customer sees on their tracking page."""
    if not shipment:
        return None
    carrier = query_one(
        "SELECT name FROM carriers WHERE code = ?", (shipment["carrier_code"],)
    )
    return {
        "carrier": carrier["name"] if carrier else shipment["carrier_code"],
        "awb": shipment["awb"],
        "trackingUrl": shipment["trackingUrl"],
        "status": shipment["status"],
        "statusLabel": shipment["statusLabel"],
        "lastUpdate": shipment["last_update"],
        "expectedAt": shipment["expected_at"],
        "dispatchedAt": shipment["dispatched_at"],
        "deliveredAt": shipment["delivered_at"],
    }


# ------------------------------------------------------------------- seam --
class CarrierProvider:
    """What an aggregator integration implements.

    Deliberately declared before anything needs it: `create_shipment` returning
    an AWB from an API is the same shape as a human typing one in, and keeping
    that shape now is what stops Shiprocket becoming a rewrite of the order flow
    later.
    """

    name: str

    def create_shipment(self, order: dict) -> dict:  # pragma: no cover - future
        raise NotImplementedError

    def track(self, awb: str) -> dict:  # pragma: no cover - future
        raise NotImplementedError

    def cancel(self, awb: str) -> dict:  # pragma: no cover - future
        raise NotImplementedError


class ManualCarrier(CarrierProvider):
    """Staff enter the AWB from the courier's own receipt."""

    name = "manual"

    def create_shipment(self, order: dict) -> dict:
        return {"manual": True}

    def track(self, awb: str) -> dict:
        # Nothing to poll: the status is whatever staff last recorded.
        return {"manual": True, "awb": awb}

    def cancel(self, awb: str) -> dict:
        return {"manual": True, "awb": awb}


def provider() -> CarrierProvider:
    return ManualCarrier()
