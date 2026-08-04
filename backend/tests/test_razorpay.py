"""Razorpay signature verification and provider selection.

No network: every test here is about the crypto and the wiring, which is where
a payment integration actually goes wrong. Calls to Razorpay's API are not
exercised — that needs live keys and is verified once against test keys.

    python -m tests.test_razorpay
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_rzp_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.config import settings  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import payments  # noqa: E402
from app.services import razorpay as rzp  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== unconfigured is inert, never half-working ===")
    settings.razorpay_key_id = ""
    settings.razorpay_key_secret = ""
    settings.payment_provider = "auto"
    check("reports unconfigured", rzp.configured() is False)
    check("mode says so", rzp.mode() == "unconfigured")
    check("auto falls back to manual", payments.provider().name == "manual")
    check(
        "an unconfigured signature never validates",
        rzp.verify_checkout_signature("order_x", "pay_x", "anything") is False,
        "an empty secret must not produce a passing HMAC",
    )

    print("\n=== asking for razorpay without keys fails LOUDLY ===")
    settings.payment_provider = "razorpay"
    try:
        payments.provider()
        check("explicit razorpay without keys is refused", False, "it silently used manual")
    except payments.PaymentError as exc:
        check("explicit razorpay without keys is refused", True)
        check("and the message names the missing settings", "RAZORPAY_KEY_ID" in str(exc), str(exc))

    print("\n=== configured selection ===")
    settings.razorpay_key_id = "rzp_test_ABC123"
    settings.razorpay_key_secret = "secret_shhh"
    settings.payment_provider = "auto"
    check("auto now picks razorpay", payments.provider().name == "razorpay")
    check("mode reports test", rzp.mode() == "test")
    settings.razorpay_key_id = "rzp_live_ABC123"
    check("and live when the key says live", rzp.mode() == "live")
    settings.razorpay_key_id = "rzp_test_ABC123"
    settings.payment_provider = "manual"
    check("manual can be forced even with keys present", payments.provider().name == "manual")
    settings.payment_provider = "auto"

    print("\n=== checkout signature ===")
    order_id, payment_id = "order_ABC", "pay_XYZ"
    good = hmac.new(
        settings.razorpay_key_secret.encode(),
        f"{order_id}|{payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    check("a correct signature verifies", rzp.verify_checkout_signature(order_id, payment_id, good))
    check("a tampered payment id is rejected",
          rzp.verify_checkout_signature(order_id, "pay_FORGED", good) is False,
          "this is what stops a customer marking their own order paid")
    check("a tampered order id is rejected",
          rzp.verify_checkout_signature("order_FORGED", payment_id, good) is False)
    check("a garbage signature is rejected",
          rzp.verify_checkout_signature(order_id, payment_id, "deadbeef") is False)
    check("an empty signature is rejected",
          rzp.verify_checkout_signature(order_id, payment_id, "") is False)

    print("\n=== webhook signature uses a DIFFERENT secret ===")
    body = b'{"event":"payment.captured","payload":{}}'
    settings.razorpay_webhook_secret = ""
    check("no webhook secret means no verification passes",
          rzp.verify_webhook_signature(body, "anything") is False)

    settings.razorpay_webhook_secret = "wh_secret"
    wh = hmac.new(b"wh_secret", body, hashlib.sha256).hexdigest()
    check("a correct webhook signature verifies", rzp.verify_webhook_signature(body, wh))
    check("a modified body is rejected",
          rzp.verify_webhook_signature(body + b" ", wh) is False,
          "why the RAW body must be used, not re-serialised JSON")
    api_sig = hmac.new(
        settings.razorpay_key_secret.encode(), body, hashlib.sha256
    ).hexdigest()
    check("the API secret does NOT validate a webhook",
          rzp.verify_webhook_signature(body, api_sig) is False,
          "the two secrets must not be interchangeable")

    print("\n=== webhook parsing converts paise to rupees ===")
    event = {
        "event": "payment.captured",
        "payload": {"payment": {"entity": {
            "id": "pay_1", "order_id": "order_1", "amount": 25000,
            "status": "captured", "method": "upi",
            "notes": {"order_number": "CC-TESTTEST"},
        }}},
    }
    parsed = rzp.payment_from_webhook(event)
    check("amount is converted to rupees", parsed["amount"] == 250,
          f"{parsed['amount']} — a stray factor of 100 in payments is not a rounding bug")
    check("our order number is recovered", parsed["orderNumber"] == "CC-TESTTEST")
    check("an unrecognised payload returns None", rzp.payment_from_webhook({}) is None)

    print("\n=== webhook application is defensive ===")
    check("an uncaptured event is ignored",
          payments.apply_webhook({"event": "payment.failed", "payload": {"payment": {
              "entity": {"id": "p", "amount": 100, "status": "failed",
                         "notes": {"order_number": "CC-NOPE"}}}}})["applied"] is False)
    check("an event with no order reference is ignored",
          payments.apply_webhook({"event": "payment.captured", "payload": {}})["applied"] is False)

    print()
    print("=== a valid signature for SOMEONE ELSE'S order is refused ===")
    # The subtle one. Razorpay really did sign the attacker's own cheap order,
    # so the HMAC verifies — what stops the exploit is comparing the order id
    # against the one WE created.
    import datetime as _dt

    from app.db.conn import transaction as _tx
    from app.services import payments as _pay

    settings.razorpay_key_id = "rzp_test_ABC123"
    settings.razorpay_key_secret = "secret_shhh"
    settings.payment_provider = "manual"     # avoid a network call in start()
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    with _tx() as conn:
        conn.execute(
            "INSERT INTO orders (id, order_number, status, customer_name, phone,"
            " subtotal, shipping, total, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("ord_sig", "CC-SIGTEST1", "requested", "T", "9876500000",
             5000, 0, 5000, now, now),
        )
    _pay.start("CC-SIGTEST1")
    with _tx() as conn:
        conn.execute(
            "UPDATE payments SET provider='razorpay', provider_order_id='order_OURS'"
            " WHERE order_id = 'ord_sig'"
        )

    attacker_order, attacker_payment = "order_THEIRS", "pay_THEIRS"
    genuine = hmac.new(
        settings.razorpay_key_secret.encode(),
        f"{attacker_order}|{attacker_payment}".encode(),
        hashlib.sha256,
    ).hexdigest()
    check(
        "the attacker's signature is genuinely valid",
        rzp.verify_checkout_signature(attacker_order, attacker_payment, genuine),
        "if this fails the test proves nothing",
    )
    try:
        _pay.confirm_gateway_payment(
            "CC-SIGTEST1",
            provider_payment_id=attacker_payment,
            provider_order_id=attacker_order,
            signature=genuine,
        )
        check("but it is refused for THIS order", False,
              "a 5000 basket was settled with someone else's payment")
    except _pay.PaymentError as exc:
        check("but it is refused for THIS order", True)
        check("and says why", "does not belong" in str(exc), str(exc))

    from app.db.conn import query_one as _q
    check(
        "the order was NOT marked paid",
        _q("SELECT payment_status FROM orders WHERE order_number='CC-SIGTEST1'")["payment_status"] == "unpaid",
    )

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Razorpay holds: signatures verified, selection explicit.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
