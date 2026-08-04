"""Support tickets: customer-facing endpoints.

Authorisation is by ticket reference, the same trade the order-tracking
endpoint makes: 8 random characters from a 31-letter alphabet, never listed,
rate limited. That is what lets a guest follow up on a missing parcel without
being forced to create an account first.

Every read path here calls `support.thread()` WITHOUT `include_internal`, so a
staff note can never be served to a customer even if a future route forgets.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, EmailStr, Field

from app.services import support
from app.services.ratelimit import SlidingWindowLimiter, client_ip

log = logging.getLogger(__name__)
router = APIRouter(prefix="/support", tags=["support"])

# Opening a ticket sends staff a notification and costs their attention, so it
# is limited harder than reading one.
_create_limiter = SlidingWindowLimiter([(3, 600), (10, 86400)])
_read_limiter = SlidingWindowLimiter([(30, 60), (200, 3600)])
_reply_limiter = SlidingWindowLimiter([(10, 300), (60, 3600)])


class TicketIn(BaseModel):
    email: EmailStr
    subject: str = Field(min_length=3, max_length=300)
    body: str = Field(min_length=5, max_length=8000)
    name: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=20)
    category: str = Field(default="general", max_length=20)
    orderNumber: str | None = Field(default=None, max_length=20)


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
    name: str = Field(default="", max_length=120)


def _optional_customer(request: Request) -> dict | None:
    """Attach the ticket to an account when one is signed in, without requiring it."""
    from app.db.repo import customers as customers_repo

    return customers_repo.session_customer(request.cookies.get("cc_session"))


@router.post("", status_code=201)
def open_ticket(request: Request, body: TicketIn) -> dict:
    allowed, retry = _create_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests.", headers={"Retry-After": str(retry)})

    customer = _optional_customer(request)
    try:
        ticket = support.create(
            email=str(body.email), subject=body.subject, body=body.body,
            name=body.name or (customer or {}).get("name", ""),
            phone=body.phone, category=body.category,
            customer_id=(customer or {}).get("id"),
            order_number=body.orderNumber,
        )
    except support.TicketError as exc:
        raise HTTPException(422, str(exc)) from exc

    return {
        "ok": True,
        "ticket": support.public_view(ticket),
        "message": (
            f"Thanks — your reference is {ticket['reference']}. "
            "Keep it to follow up on this request."
        ),
    }


@router.get("/{reference}")
def read_ticket(
    request: Request,
    reference: str = Path(min_length=4, max_length=20),
) -> dict:
    allowed, retry = _read_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests.", headers={"Retry-After": str(retry)})

    ticket = support.get(reference)
    if ticket is None:
        raise HTTPException(404, "We could not find that reference.")
    return {
        "ticket": support.public_view(ticket),
        # Internal notes are excluded by the default, not by a flag set here.
        "messages": support.thread(reference),
    }


@router.post("/{reference}/reply")
def reply_to_ticket(
    request: Request,
    body: ReplyIn,
    reference: str = Path(min_length=4, max_length=20),
) -> dict:
    allowed, retry = _reply_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests.", headers={"Retry-After": str(retry)})

    customer = _optional_customer(request)
    try:
        support.reply(
            reference, body.body, author_kind="customer",
            author_id=(customer or {}).get("id"),
            author_name=body.name or (customer or {}).get("name", "") or "Customer",
        )
    except support.TicketError as exc:
        raise HTTPException(409, str(exc)) from exc

    return {"ok": True, "messages": support.thread(reference)}


@router.get("/mine/list", dependencies=[])
def my_tickets(request: Request) -> dict:
    customer = _optional_customer(request)
    if customer is None:
        raise HTTPException(401, "Not signed in")
    return {"tickets": support.for_customer(customer["id"], customer["email"])}


class OrderHelpIn(BaseModel):
    issue: str = Field(pattern="^(not_received|damaged|wrong_item|cancel|refund|invoice|other)$")
    body: str = Field(min_length=5, max_length=8000)


# What a customer can raise about an order, and the category each maps to.
# A fixed list rather than free text: it routes the ticket, sets the priority,
# and means the customer picks rather than composes.
_ISSUE_MAP = {
    "not_received": ("delivery", "Order not received", "high"),
    "damaged": ("delivery", "Item arrived damaged", "high"),
    "wrong_item": ("order", "Wrong item received", "high"),
    "cancel": ("order", "Request to cancel", "normal"),
    "refund": ("refund", "Refund request", "high"),
    "invoice": ("order", "Invoice query", "low"),
    "other": ("order", "Question about my order", "normal"),
}


@router.post("/order/{order_number}", status_code=201)
def order_help(
    request: Request,
    body: OrderHelpIn,
    order_number: str = Path(min_length=4, max_length=20),
) -> dict:
    """Raise a support request about one of YOUR orders. Requires a session.

    The ownership check is the point. Without it a signed-in customer could
    attach any order number they liked and then read the support replies about
    somebody else's purchase — the reference is guessable to whoever already
    has it, and support agents answer with delivery details.
    """
    allowed, retry = _create_limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests.", headers={"Retry-After": str(retry)})

    customer = _optional_customer(request)
    if customer is None:
        raise HTTPException(401, "Please sign in to get help with an order.")

    from app.db.conn import query_one

    # Owned via the account, OR via a verified email matching the order — the
    # same rule order history uses, so a guest order claimed after verifying
    # stays reachable. An UNVERIFIED email is deliberately not enough.
    owned = query_one(
        "SELECT id, status, total FROM orders"
        " WHERE order_number = ?"
        "   AND (customer_id = ? OR (LOWER(email) = ? AND ? IS NOT NULL))",
        (order_number, customer["id"], customer["email_norm"],
         customer["email_verified_at"]),
    )
    if owned is None:
        # Deliberately the same message as "no such order": confirming that an
        # order exists but is not theirs is an enumeration oracle.
        raise HTTPException(404, "We could not find that order on your account.")

    category, subject, priority = _ISSUE_MAP[body.issue]
    try:
        ticket = support.create(
            email=customer["email"], name=customer["name"],
            phone=customer["phone"],
            subject=f"{subject} — {order_number}",
            # Order context is attached automatically so support does not have
            # to ask what the customer already told the system.
            body=f"{body.body}\n\n---\nOrder: {order_number}\nStatus: {owned['status']}",
            category=category, customer_id=customer["id"],
            order_number=order_number,
        )
    except support.TicketError as exc:
        raise HTTPException(422, str(exc)) from exc

    if priority != "normal":
        support.set_priority(ticket["reference"], priority)

    return {
        "ok": True,
        "ticket": support.public_view(support.get(ticket["reference"])),
        "message": (
            f"Thanks — reference {ticket['reference']}. We have your order "
            "details, so there is no need to repeat them."
        ),
    }


@router.get("/order/{order_number}/options")
def order_help_options(
    request: Request,
    order_number: str = Path(min_length=4, max_length=20),
) -> dict:
    """Which issues make sense for this order's current state.

    Offering "cancel" on a delivered order, or "not received" on one that has
    not shipped, produces tickets support has to explain away.
    """
    customer = _optional_customer(request)
    if customer is None:
        raise HTTPException(401, "Please sign in.")

    from app.db.conn import query_one

    order = query_one(
        "SELECT status FROM orders WHERE order_number = ?"
        " AND (customer_id = ? OR (LOWER(email) = ? AND ? IS NOT NULL))",
        (order_number, customer["id"], customer["email_norm"],
         customer["email_verified_at"]),
    )
    if order is None:
        raise HTTPException(404, "We could not find that order on your account.")

    status = order["status"]
    options = ["other", "invoice"]
    if status in ("requested", "pending_payment", "confirmed", "processing", "packed"):
        options.insert(0, "cancel")
    if status in ("shipped", "out_for_delivery"):
        options.insert(0, "not_received")
    if status == "delivered":
        options = ["not_received", "damaged", "wrong_item", "refund", *options]

    labels = {k: v[1] for k, v in _ISSUE_MAP.items()}
    return {
        "orderNumber": order_number,
        "status": status,
        "options": [{"id": o, "label": labels[o]} for o in options],
    }
