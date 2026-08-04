"""Payments: a provider interface, with manual verification as the first
implementation.

WHY AN INTERFACE FOR SOMETHING A HUMAN DOES

The gateway is deferred, not cancelled. If the order code called "look up the
UTR the customer typed" directly, adding Razorpay later would mean editing every
place that touches payment — during a migration of a table holding real
financial records, which is the worst possible time to be changing call sites.

So orders talk to `PaymentService`, `PaymentService` talks to a `PaymentProvider`,
and `ManualProvider` is simply the provider whose "capture" step is a person
looking at a screenshot. Adding `RazorpayProvider` later is a new class and one
settings change.

WHAT IS DELIBERATELY NOT HERE

No amount is ever taken from the client. The payment's `amount` is copied from
`orders.total`, which the server computed from database prices. A client that
posts "I paid ₹1" against a ₹500 order gets a payment record for ₹500 that does
not match their claim — which is exactly the discrepancy the admin needs to see.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets
from typing import Protocol

from app.config import settings
from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

STATUSES = ("awaiting", "submitted", "approved", "rejected", "correction_requested")

# What a customer may do to a payment, and from where. Mirrors the order state
# machine: a payment already approved is not re-submittable, and a rejected one
# must be corrected rather than silently overwritten.
_CUSTOMER_SUBMITTABLE = {"awaiting", "rejected", "correction_requested"}


class PaymentError(RuntimeError):
    pass


class PaymentProvider(Protocol):
    """The seam. Razorpay/Stripe implement this without touching order code."""

    name: str

    def create_intent(self, order: dict) -> dict:
        """Everything the customer needs in order to pay."""
        ...

    def capture(self, payment: dict) -> dict:
        """Move money, or — for manual — record that a human confirmed it."""
        ...

    def refund(self, payment: dict, amount: int) -> dict:
        ...


class ManualProvider:
    """Bank transfer / UPI, verified by a person.

    `capture` does not contact anything: the "authorisation" is an admin who
    looked at a screenshot and pressed approve. Keeping it behind the same
    method as a gateway capture is what lets the order flow stay identical.
    """

    name = "manual"

    def create_intent(self, order: dict) -> dict:
        return {
            "provider": "manual",
            "amount": order["total"],
            "instructions": "upi_or_bank_transfer",
        }

    def capture(self, payment: dict) -> dict:
        return {"captured": True, "reference": payment.get("provider_ref")}

    def refund(self, payment: dict, amount: int) -> dict:
        # A manual refund is a bank transfer someone makes by hand; this records
        # the intent so the order can move on and the money is chased offline.
        return {"refunded": True, "amount": amount, "manual": True}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def provider() -> PaymentProvider:
    """The active provider — the one place gateway selection happens.

    `auto` prefers Razorpay when both keys are present and falls back to manual
    otherwise. The fallback is deliberate: a half-configured gateway must take
    bank transfers rather than show customers a checkout that cannot complete.
    """
    from app.services import razorpay as razorpay_service

    choice = settings.payment_provider
    if choice == "manual":
        return ManualProvider()
    if choice == "razorpay":
        if not razorpay_service.configured():
            # Explicit rather than silent: someone asked for Razorpay and it is
            # not set up, and quietly taking bank transfers instead would be
            # discovered by a customer.
            raise PaymentError(
                "PAYMENT_PROVIDER=razorpay but RAZORPAY_KEY_ID/SECRET are unset."
            )
        return razorpay_service.RazorpayProvider()
    return (
        razorpay_service.RazorpayProvider()
        if razorpay_service.configured()
        else ManualProvider()
    )


def get_for_order(order_number: str) -> dict | None:
    row = query_one(
        "SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id"
        " WHERE o.order_number = ? ORDER BY p.created_at DESC LIMIT 1",
        (order_number,),
    )
    return dict(row) if row else None


def start(order_number: str) -> dict:
    """Create (or return) the payment record for an order."""
    order = query_one(
        "SELECT id, total, order_number FROM orders WHERE order_number = ?",
        (order_number,),
    )
    if order is None:
        raise PaymentError("No such order")

    existing = get_for_order(order_number)
    # Anything already in flight or settled is left exactly as it is. Re-creating
    # a payment the customer has submitted, or one that is paid, would lose the
    # reference and the audit trail.
    if existing and existing["status"] in {"submitted", "approved"}:
        return existing

    if existing:
        active = provider()
        needs_gateway_order = (
            active.name != "manual" and not existing.get("provider_order_id")
        )
        provider_changed = existing["provider"] != active.name
        if not (needs_gateway_order or provider_changed):
            return existing

        # An untouched 'awaiting' record created under a DIFFERENT provider —
        # every order placed before the gateway was configured looks like this.
        # Left alone it has no gateway order id, so the checkout widget has
        # nothing to open and the customer simply cannot pay. Refresh it in
        # place rather than inserting a second payment row for one order.
        intent = active.create_intent(dict(order))
        with transaction() as conn:
            conn.execute(
                "UPDATE payments SET provider = ?, provider_order_id = ?,"
                " amount = ?, updated_at = ? WHERE id = ?",
                (intent["provider"], intent.get("providerOrderId"),
                 # Re-priced too: the order total may have changed since.
                 order["total"], _now(), existing["id"]),
            )
        log.info(
            "Upgraded payment for %s from %s to %s",
            order_number, existing["provider"], intent["provider"],
        )
        return get_for_order(order_number) or {}

    intent = provider().create_intent(dict(order))
    payment_id = f"pay_{secrets.token_hex(8)}"
    with transaction() as conn:
        conn.execute(
            "INSERT INTO payments"
            " (id, order_id, provider, amount, status, provider_order_id,"
            "  created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (payment_id, order["id"], intent["provider"],
             # Server-side total, never a client figure.
             order["total"], "awaiting",
             # The gateway's order id, kept so the callback can be checked
             # against the order WE created rather than the one the browser
             # claims to have paid.
             intent.get("providerOrderId"),
             _now(), _now()),
        )
    return get_for_order(order_number) or {}


def submit_proof(
    order_number: str,
    *,
    method: str = "upi",
    reference: str | None = None,
    proof_path: str | None = None,
    proof_sha256: str | None = None,
    note: str = "",
) -> dict:
    """The customer says they have paid."""
    payment = get_for_order(order_number) or start(order_number)

    if payment["status"] not in _CUSTOMER_SUBMITTABLE:
        raise PaymentError(
            "This payment has already been submitted and is being checked."
            if payment["status"] == "submitted"
            else "This order is already paid."
        )
    if not reference and not proof_path:
        raise PaymentError(
            "Enter the transaction reference or attach a screenshot."
        )

    with transaction() as conn:
        conn.execute(
            "UPDATE payments SET status='submitted', method=?, provider_ref=?,"
            " proof_path=COALESCE(?, proof_path), proof_sha256=COALESCE(?, proof_sha256),"
            " customer_note=?, updated_at=?"
            " WHERE id = ?",
            (method, reference, proof_path, proof_sha256, note[:500], _now(),
             payment["id"]),
        )
    log.info("Payment %s submitted for %s", payment["id"], order_number)
    try:
        from app.services import notifications

        notifications.payment_awaiting(order_number, payment["amount"])
    except Exception:  # noqa: BLE001
        log.exception("Payment notification failed for %s", order_number)
    return get_for_order(order_number) or {}


def review(
    order_number: str,
    decision: str,
    *,
    reviewer_id: str,
    note: str = "",
) -> dict:
    """Admin approves, rejects, or asks for a correction.

    Approval does NOT advance the order here. The caller does that through
    `order_flow.transition`, so stock deduction and the status machine stay the
    single path an order moves along — a payment service that also moved orders
    would be a second, divergent lifecycle.
    """
    if decision not in {"approved", "rejected", "correction_requested"}:
        raise PaymentError(f"Unknown decision {decision!r}")

    payment = get_for_order(order_number)
    if payment is None:
        raise PaymentError("This order has no payment to review")
    if payment["status"] == "approved":
        raise PaymentError("This payment is already approved")
    if decision != "approved" and not note.strip():
        # A rejection without a reason produces a support call. Requiring the
        # note here is cheaper than the phone ringing.
        raise PaymentError("Give a reason — the customer sees this message.")

    if decision == "approved":
        provider().capture(payment)

    with transaction() as conn:
        conn.execute(
            "UPDATE payments SET status=?, reviewed_by=?, reviewed_at=?,"
            " reviewer_note=?, updated_at=? WHERE id = ?",
            (decision, reviewer_id, _now(), note[:500], _now(), payment["id"]),
        )
        if decision == "approved":
            conn.execute(
                "UPDATE orders SET payment_status='paid', payment_ref=?,"
                " updated_at=? WHERE id = ?",
                (payment["provider_ref"], _now(), payment["order_id"]),
            )
    log.info("Payment for %s %s by %s", order_number, decision, reviewer_id)
    return get_for_order(order_number) or {}


def queue(limit: int = 100) -> list[dict]:
    """Payments waiting on a human, oldest first — the admin work list."""
    return [
        dict(r)
        for r in query(
            "SELECT p.*, o.order_number, o.customer_name, o.total AS order_total"
            "  FROM payments p JOIN orders o ON o.id = p.order_id"
            " WHERE p.status = 'submitted'"
            " ORDER BY p.updated_at ASC LIMIT ?",
            (int(limit),),
        )
    ]


def public_view(payment: dict | None) -> dict | None:
    """What the customer is allowed to see.

    Whitelisted: `proof_path` is a server filesystem path and `reviewed_by` is
    a staff id — neither is any of the customer's business.
    """
    if not payment:
        return None
    return {
        "status": payment["status"],
        "amount": payment["amount"],
        "method": payment["method"],
        "reference": payment["provider_ref"],
        "hasProof": bool(payment["proof_path"]),
        # Shown so a rejected customer knows what to fix.
        "message": payment["reviewer_note"] if payment["status"] in
        {"rejected", "correction_requested"} else "",
        "updatedAt": payment["updated_at"],
    }


def confirm_gateway_payment(
    order_number: str,
    *,
    provider_payment_id: str,
    provider_order_id: str,
    signature: str,
) -> dict:
    """Confirm a Razorpay checkout callback.

    The signature is the whole security boundary here. Without verifying it,
    anyone could POST a made-up payment id and mark their own order paid — this
    endpoint is reachable by definition, since the browser has to call it.
    """
    from app.services import razorpay as razorpay_service

    if not razorpay_service.verify_checkout_signature(
        provider_order_id, provider_payment_id, signature
    ):
        log.error(
            "Rejected an unsigned/forged payment callback for %s", order_number
        )
        raise PaymentError("That payment could not be verified.")

    payment = get_for_order(order_number)
    if payment is None:
        raise PaymentError("This order has no payment to confirm")

    # A VALID SIGNATURE IS NOT ENOUGH.
    #
    # It proves Razorpay signed that order/payment pair — it does not prove the
    # pair is ours. Without this check, someone can create their own ₹1 Razorpay
    # order, pay it, and post the genuinely-signed result here to settle a ₹5,000
    # basket. The signature would verify perfectly.
    expected = payment.get("provider_order_id")
    if expected and expected != provider_order_id:
        log.error(
            "Payment callback for %s carried order %s but we created %s",
            order_number, provider_order_id, expected,
        )
        raise PaymentError("That payment does not belong to this order.")
    if payment["status"] == "approved":
        return payment  # idempotent: the webhook and the callback both arrive

    with transaction() as conn:
        conn.execute(
            "UPDATE payments SET status='approved', provider_ref=?, method='razorpay',"
            " reviewed_by='razorpay', reviewed_at=?, updated_at=? WHERE id = ?",
            (provider_payment_id, _now(), _now(), payment["id"]),
        )
        conn.execute(
            "UPDATE orders SET payment_status='paid', payment_ref=?, updated_at=?"
            " WHERE id = ?",
            (provider_payment_id, _now(), payment["order_id"]),
        )
    log.info("Razorpay payment %s confirmed for %s", provider_payment_id, order_number)
    return get_for_order(order_number) or {}


def apply_webhook(event: dict) -> dict:
    """Apply a verified Razorpay webhook.

    The webhook — not the browser callback — is what makes this reliable. A
    customer who pays and immediately closes the tab never fires the callback,
    and without this their money is taken while their order sits unpaid.

    The caller MUST have verified the signature before calling this.
    """
    from app.services import razorpay as razorpay_service

    parsed = razorpay_service.payment_from_webhook(event)
    if not parsed or not parsed.get("orderNumber"):
        return {"applied": False, "reason": "no order reference in the event"}
    if parsed.get("status") != "captured":
        return {"applied": False, "reason": f"ignoring status {parsed.get('status')}"}

    payment = get_for_order(parsed["orderNumber"])
    if payment is None:
        return {"applied": False, "reason": "no payment record"}
    if payment["status"] == "approved":
        return {"applied": False, "reason": "already approved"}

    # Cross-check the amount. A captured amount that does not match the order
    # total means either a partial payment or a tampered flow, and it must not
    # silently mark the order paid.
    if parsed["amount"] != payment["amount"]:
        log.error(
            "Webhook amount mismatch for %s: paid %s, order %s",
            parsed["orderNumber"], parsed["amount"], payment["amount"],
        )
        return {"applied": False, "reason": "amount mismatch"}

    with transaction() as conn:
        conn.execute(
            "UPDATE payments SET status='approved', provider_ref=?, method=?,"
            " reviewed_by='razorpay-webhook', reviewed_at=?, updated_at=?"
            " WHERE id = ?",
            (parsed["paymentId"], parsed.get("method") or "razorpay",
             _now(), _now(), payment["id"]),
        )
        conn.execute(
            "UPDATE orders SET payment_status='paid', payment_ref=?, updated_at=?"
            " WHERE id = ?",
            (parsed["paymentId"], _now(), payment["order_id"]),
        )
    return {"applied": True, "orderNumber": parsed["orderNumber"]}
