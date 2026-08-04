"""Order requests and public order tracking.

There is no payment gateway. These endpoints record a request the shop confirms
by phone — the copy says "requested", never "placed", everywhere.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Path, Request, Response

from pydantic import BaseModel, EmailStr, Field

from app.config import settings
from app.db.repo import orders as orders_repo
from app.services import invoices
from app.services import payments

from app.services import revalidate  # noqa: F401  (kept for future stock sync)

from app.services.ratelimit import SlidingWindowLimiter, client_ip

log = logging.getLogger(__name__)
router = APIRouter(prefix="/orders", tags=["orders"])

# 5 an hour per IP. A real person places one; anything more is a script.
_limiter = SlidingWindowLimiter([(settings.order_rph, 3600)])
_lookup_limiter = SlidingWindowLimiter([(30, 60), (200, 3600)])


class OrderItemIn(BaseModel):
    slug: str = Field(min_length=1, max_length=200)
    qty: int = Field(default=1, ge=1, le=20)


class OrderIn(BaseModel):
    items: list[OrderItemIn] = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    # Indian mobile numbers. A generic min(1) here produces undeliverable
    # orders, which is a real cost rather than a nicety.
    phone: str = Field(pattern=r"^[6-9]\d{9}$")
    email: EmailStr | None = None
    address1: str = Field(min_length=5, max_length=300)
    address2: str = Field(default="", max_length=300)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(default="", max_length=100)
    pincode: str = Field(pattern=r"^\d{6}$")
    notes: str = Field(default="", max_length=1000)
    coupon: str = Field(default="", max_length=40)
    source: str = Field(default="checkout", max_length=20)


@router.post("", status_code=201)
def create_order(request: Request, body: OrderIn) -> dict:
    """Record an order request.

    NOTE the contract with the UI: this returns only after the row exists. The
    frontend must not show a confirmation before this responds — a checkout
    that says "received" without persisting anything loses real orders and you
    find out from an angry phone call.
    """
    ip = client_ip(request)
    allowed, retry = _limiter.check(ip)
    if not allowed:
        raise HTTPException(
            429,
            "That is a lot of orders in one hour. Please call us instead.",
            headers={"Retry-After": str(retry)},
        )

    try:
        order = orders_repo.create_order(
            items=[i.model_dump() for i in body.items],
            customer={
                "name": body.name,
                "phone": body.phone,
                "email": str(body.email) if body.email else "",
                "address1": body.address1,
                "address2": body.address2,
                "city": body.city,
                "state": body.state,
                "pincode": body.pincode,
                "notes": body.notes,
            },
            coupon=(body.coupon or "").strip() or None,
            source=body.source,
            ip=ip,
            user_agent=request.headers.get("user-agent"),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    log.info(
        "Order %s requested: %d item(s), total %s",
        order["orderNumber"],
        len(order["items"]),
        order["total"],
    )
    return {
        **order,
        # Said once, here, so every surface repeats the same thing.
        "message": (
            "Order request received. We will call you to confirm the books, "
            "the total and delivery before anything ships."
        ),
        "whatsapp": (
            f"https://wa.me/{settings.company_whatsapp}"
            f"?text=Hi%2C%20about%20my%20order%20{order['orderNumber']}"
        ),
    }


@router.get("/{order_number}")
def track_order(
    request: Request,
    order_number: str = Path(min_length=8, max_length=16),
) -> dict:
    """Public order tracking.

    The order number is the only credential, which is why it is 8 random
    characters and why this response carries no phone number, email or street
    address — see `orders_repo.lookup`.
    """
    allowed, retry = _lookup_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many lookups", headers={"Retry-After": str(retry)})

    order = orders_repo.lookup(order_number)
    if order is None:
        # Same response for "does not exist" and "malformed", so this cannot be
        # used to probe which numbers are real.
        raise HTTPException(404, "No order found with that number")
    return order


# --------------------------------------------------------------------------
# Manual payment
# --------------------------------------------------------------------------

class PaymentSubmitIn(BaseModel):
    method: str = Field(default="upi", pattern="^(upi|bank_transfer|cash|card)$")
    reference: str | None = Field(default=None, max_length=60)
    note: str = Field(default="", max_length=500)


# Submitting proof is cheap to abuse and each attempt is a row plus an admin's
# attention, so it is limited harder than order lookup.
_payment_limiter = SlidingWindowLimiter([(5, 300), (20, 3600)])


@router.get("/{order_number}/payment")
def payment_status(
    request: Request,
    order_number: str = Path(min_length=4, max_length=20),
) -> dict:
    """What the customer needs in order to pay, and where their payment stands.

    Guessing an order number gets you a payment status and nothing else — the
    number is 8 random base32 characters and the response carries no personal
    data, same reasoning as the tracking endpoint.
    """
    allowed, retry = _lookup_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests.", headers={"Retry-After": str(retry)})

    order = orders_repo.lookup(order_number)
    if order is None:
        raise HTTPException(404, "We could not find that order number.")

    try:
        payment = payments.start(order_number)
    except payments.PaymentError as exc:
        raise HTTPException(404, str(exc)) from exc

    body: dict = {
        "orderNumber": order_number,
        "provider": payment.get("provider", "manual"),
        "payment": payments.public_view(payment),
    }

    if payment.get("provider") == "razorpay":
        # What Razorpay Checkout needs to open. `keyId` is the PUBLISHABLE key
        # and is designed to be public; the secret never leaves the server.
        body["gateway"] = {
            "keyId": settings.razorpay_key_id,
            "orderId": payment.get("provider_order_id"),
            # Paise, because that is what the Checkout widget expects. The
            # single other place this conversion happens is razorpay.py.
            "amount": int(payment["amount"]) * 100,
            "currency": "INR",
            "name": settings.company_name,
            "prefill": {"contact": "", "email": ""},
        }
    else:
        # Manual: where to send the money. From settings so the owner can change
        # bank details without a deploy.
        body["payTo"] = {
            "upi": settings.payment_upi_id,
            "accountName": settings.payment_account_name,
            "note": f"Quote {order_number} in the payment reference.",
        }
    return body


@router.post("/{order_number}/payment")
def submit_payment(
    request: Request,
    body: PaymentSubmitIn,
    order_number: str = Path(min_length=4, max_length=20),
) -> dict:
    allowed, retry = _payment_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many attempts.", headers={"Retry-After": str(retry)})

    if orders_repo.lookup(order_number) is None:
        raise HTTPException(404, "We could not find that order number.")

    try:
        payment = payments.submit_proof(
            order_number,
            method=body.method,
            reference=(body.reference or "").strip() or None,
            note=body.note,
        )
    except payments.PaymentError as exc:
        raise HTTPException(409, str(exc)) from exc

    return {
        "ok": True,
        "payment": payments.public_view(payment),
        "message": (
            "Thank you — we will check this against our bank records and "
            "confirm your order. You will get an email when it is verified."
        ),
    }


@router.get("/{order_number}/invoice")
def download_invoice(
    request: Request,
    order_number: str = Path(min_length=4, max_length=20),
    format: str = "pdf",
) -> Response:
    """The customer's invoice.

    Authorised by knowing the order number, exactly like tracking: it is 8
    random base32 characters and is not enumerable. That is a deliberate,
    limited trade — the invoice does contain the delivery address, so it is
    rate-limited and never listed anywhere.
    """
    allowed, retry = _lookup_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests.", headers={"Retry-After": str(retry)})

    invoice = invoices.for_order(order_number)
    if invoice is None:
        # Not an error: an invoice exists once the order is confirmed. Saying so
        # is more useful than a bare 404.
        raise HTTPException(
            404,
            "No invoice yet — one is issued when the order is confirmed.",
        )

    if format == "html":
        return Response(invoices.render_html(invoice), media_type="text/html")

    pdf = invoices.render_pdf(invoice)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition":
                f'attachment; filename="{invoice["invoice_number"].replace("/", "-")}.pdf"',
            # Never cached by a shared proxy: this document contains a home
            # address and a phone number.
            "Cache-Control": "private, no-store",
        },
    )


class GatewayConfirmIn(BaseModel):
    razorpayPaymentId: str = Field(min_length=4, max_length=80)
    razorpayOrderId: str = Field(min_length=4, max_length=80)
    razorpaySignature: str = Field(min_length=16, max_length=200)


@router.post("/{order_number}/payment/confirm")
def confirm_gateway(
    request: Request,
    body: GatewayConfirmIn,
    order_number: str = Path(min_length=4, max_length=20),
) -> dict:
    """Razorpay checkout callback from the browser."""
    allowed, retry = _payment_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many attempts.", headers={"Retry-After": str(retry)})

    try:
        payment = payments.confirm_gateway_payment(
            order_number,
            provider_payment_id=body.razorpayPaymentId,
            provider_order_id=body.razorpayOrderId,
            signature=body.razorpaySignature,
        )
    except payments.PaymentError as exc:
        raise HTTPException(400, str(exc)) from exc

    return {"ok": True, "payment": payments.public_view(payment)}


@router.post("/webhook/razorpay", include_in_schema=False)
async def razorpay_webhook(request: Request) -> dict:
    """Server-to-server payment events.

    Reads the RAW body: re-serialising the parsed JSON changes whitespace and
    key order, and the HMAC then never matches — which presents as "webhooks
    randomly fail" rather than as an obvious bug.
    """
    from app.services import razorpay as razorpay_service

    raw = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")

    if not razorpay_service.verify_webhook_signature(raw, signature):
        # 400, not 401: Razorpay retries on 5xx, and retrying a forged or
        # misconfigured request forever helps nobody.
        log.warning("Rejected a Razorpay webhook with a bad signature")
        raise HTTPException(400, "Invalid signature")

    try:
        event = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(400, "Malformed payload") from exc

    result = payments.apply_webhook(event)
    # Always 200 once the signature is valid. A non-2xx makes Razorpay retry,
    # and "this event is not one we act on" is not a failure worth retrying.
    return {"received": True, **result}


class CouponPreviewIn(BaseModel):
    items: list[OrderItemIn] = Field(min_length=1, max_length=40)
    coupon: str = Field(default="", max_length=40)
    phone: str = Field(default="", max_length=20)


@router.post("/coupon/preview")
def preview_coupon(request: Request, body: CouponPreviewIn) -> dict:
    """Price a coupon against a cart, for the checkout page.

    This is a PREVIEW and is treated as one. `create_order` re-evaluates the
    coupon against the basket it prices itself, so a customer who changes the
    cart after seeing this number does not keep the discount.
    """
    allowed, retry = _lookup_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests.", headers={"Retry-After": str(retry)})

    from app.services import coupons as coupons_service

    # Priced from the database, never from the request: a preview that trusted
    # client line totals would report a discount the real order will not honour.
    lines, subtotal = orders_repo.price_lines(
        [i.model_dump() for i in body.items]
    )
    if not lines:
        raise HTTPException(422, "None of those books are available.")

    shipping = 0 if subtotal >= settings.free_shipping_threshold else settings.shipping_flat_rate

    if not body.coupon.strip():
        auto = coupons_service.auto_apply_for(lines, shipping=shipping, phone=body.phone)
        if not auto:
            return {"subtotal": subtotal, "discount": 0, "shipping": shipping,
                    "total": subtotal + shipping, "coupon": None}
        return {
            "subtotal": subtotal, "discount": auto["discount"],
            "shipping": auto["shipping"], "automatic": True,
            "total": subtotal - auto["discount"] + auto["shipping"],
            "coupon": {"code": auto["code"], "description": auto["description"]},
        }

    try:
        applied = coupons_service.evaluate(
            body.coupon, lines, shipping=shipping, phone=body.phone
        )
    except coupons_service.CouponError as exc:
        # 200 with a reason, not an error status: "that code has expired" is a
        # normal answer to "is this code any good", and a 4xx makes the UI show
        # a failure banner for an ordinary outcome.
        return {"subtotal": subtotal, "discount": 0, "shipping": shipping,
                "total": subtotal + shipping, "coupon": None, "reason": str(exc)}

    return {
        "subtotal": subtotal,
        "discount": applied["discount"],
        "shipping": applied["shipping"],
        "total": subtotal - applied["discount"] + applied["shipping"],
        "coupon": {"code": applied["code"], "description": applied["description"]},
    }


@router.get("/{order_number}/shipment")
def track_shipment(
    request: Request,
    order_number: str = Path(min_length=4, max_length=20),
) -> dict:
    """Where the parcel is, and a link to the carrier's own tracking page."""
    allowed, retry = _lookup_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests.", headers={"Retry-After": str(retry)})

    if orders_repo.lookup(order_number) is None:
        raise HTTPException(404, "We could not find that order number.")

    from app.services import shipping

    shipment = shipping.public_view(shipping.for_order(order_number))
    if shipment is None:
        # Not an error: most orders have no shipment yet, and saying so is more
        # useful than a 404 the UI has to special-case.
        return {"orderNumber": order_number, "shipment": None,
                "message": "This order has not been dispatched yet."}
    return {"orderNumber": order_number, "shipment": shipment}
