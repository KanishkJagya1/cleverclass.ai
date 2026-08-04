"""Razorpay, implementing the same `PaymentProvider` protocol as manual payment.

Stdlib `urllib` + `hmac`. No SDK: the whole integration is three HTTP calls and
two signature checks, and the official package would pull in dependencies for
functionality this shop does not use.

THE TWO SIGNATURES, AND WHY BOTH EXIST

  1. **Checkout callback** — the browser posts back `razorpay_order_id`,
     `razorpay_payment_id` and `razorpay_signature`. The signature is
     HMAC-SHA256 of `order_id|payment_id` keyed with the API secret. Verifying
     it is what stops a customer opening devtools and posting a made-up payment
     id to mark their order paid.
  2. **Webhook** — Razorpay POSTs the authoritative event, signed with a
     SEPARATE webhook secret over the RAW request body. This is the one that
     matters operationally: a customer who closes the tab after paying never
     fires the callback, and without the webhook their money is taken and their
     order sits unpaid.

Amounts are integer PAISE at the Razorpay boundary and integer RUPEES
everywhere else in this codebase. The conversion happens here and nowhere else,
because a stray factor of 100 in a payment integration is not a rounding bug.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from app.config import settings

log = logging.getLogger(__name__)

API_BASE = "https://api.razorpay.com/v1"


class RazorpayError(RuntimeError):
    pass


def configured() -> bool:
    return bool(settings.razorpay_key_id and settings.razorpay_key_secret)


def mode() -> str:
    """'test', 'live' or 'unconfigured' — surfaced by /health."""
    if not configured():
        return "unconfigured"
    return "live" if settings.razorpay_key_id.startswith("rzp_live") else "test"


def _auth_header() -> str:
    raw = f"{settings.razorpay_key_id}:{settings.razorpay_key_secret}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _call(method: str, path: str, payload: dict | None = None) -> dict:
    if not configured():
        raise RazorpayError("Razorpay is not configured")

    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"{API_BASE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": _auth_header(),
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        # Never log the secret, and never return Razorpay's raw error to the
        # customer — it can contain account configuration details.
        log.error("Razorpay %s %s failed (%s): %s", method, path, exc.code, detail)
        raise RazorpayError(f"Razorpay rejected the request ({exc.code})") from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Razorpay %s %s error", method, path)
        raise RazorpayError("Could not reach Razorpay") from exc


class RazorpayProvider:
    """Satisfies `payments.PaymentProvider`."""

    name = "razorpay"

    def create_intent(self, order: dict) -> dict:
        """Create a Razorpay order the checkout widget can open."""
        created = _call(
            "POST",
            "/orders",
            {
                # Rupees -> paise. The single conversion point.
                "amount": int(order["total"]) * 100,
                "currency": "INR",
                # Our own order number, so a Razorpay dashboard entry can be
                # traced back without a database lookup.
                "receipt": order["order_number"],
                "notes": {"order_number": order["order_number"]},
                # Capture immediately: this shop ships goods, it does not need
                # a two-stage auth/capture flow, and an uncaptured authorisation
                # silently expires after five days.
                "payment_capture": 1,
            },
        )
        return {
            "provider": "razorpay",
            "amount": order["total"],
            "providerOrderId": created["id"],
            # The publishable key. Safe to send to the browser — it is designed
            # to be public; the SECRET never leaves this process.
            "keyId": settings.razorpay_key_id,
        }

    def capture(self, payment: dict) -> dict:
        """Payment is captured automatically at authorisation time.

        Kept so the protocol is satisfied and so a future switch to manual
        capture is a change here rather than in the order flow.
        """
        return {"captured": True, "reference": payment.get("provider_ref")}

    def refund(self, payment: dict, amount: int) -> dict:
        reference = payment.get("provider_ref")
        if not reference:
            raise RazorpayError("This payment has no Razorpay payment id to refund")
        refunded = _call(
            "POST",
            f"/payments/{reference}/refund",
            {"amount": int(amount) * 100, "speed": "normal"},
        )
        return {"refunded": True, "amount": amount, "refundId": refunded.get("id")}


# ----------------------------------------------------------------- signatures --

def verify_checkout_signature(
    razorpay_order_id: str, razorpay_payment_id: str, signature: str
) -> bool:
    """The browser callback. HMAC-SHA256 of `order_id|payment_id`."""
    if not configured() or not signature:
        return False
    expected = hmac.new(
        settings.razorpay_key_secret.encode(),
        f"{razorpay_order_id}|{razorpay_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    # Constant time: a fast-fail comparison leaks the signature byte by byte.
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    """The server-to-server event, signed with the SEPARATE webhook secret.

    Must be given the RAW body. Re-serialising the parsed JSON changes key
    order and whitespace, and the signature then never matches — a mistake that
    presents as "webhooks randomly fail" rather than as an obvious bug.
    """
    secret = settings.razorpay_webhook_secret
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def payment_from_webhook(event: dict) -> dict | None:
    """Pull the bits we care about out of a webhook payload."""
    entity = (
        event.get("payload", {}).get("payment", {}).get("entity")
        or event.get("payload", {}).get("order", {}).get("entity")
        or {}
    )
    if not entity:
        return None
    return {
        "event": event.get("event"),
        "paymentId": entity.get("id"),
        "orderId": entity.get("order_id"),
        # Back to rupees at the boundary.
        "amount": int(entity.get("amount") or 0) // 100,
        "status": entity.get("status"),
        "orderNumber": (entity.get("notes") or {}).get("order_number"),
        "method": entity.get("method"),
    }
