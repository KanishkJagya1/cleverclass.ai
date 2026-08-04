"""Contact form and newsletter signup.

Small, but load-bearing: before this existed both forms showed a success message
after a `setTimeout` and stored nothing.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, EmailStr, Field

from app.db.repo import leads as leads_repo

log = logging.getLogger(__name__)
router = APIRouter(prefix="/leads", tags=["leads"])


def client_ip(request: Request) -> str | None:
    """First hop of X-Forwarded-For, since this runs behind nginx."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: str = Field(default="", max_length=20)
    topic: str = Field(default="", max_length=60)
    message: str = Field(min_length=1, max_length=4000)


class NewsletterIn(BaseModel):
    email: EmailStr


class LeadOut(BaseModel):
    ok: bool
    id: str


@router.post("/contact", response_model=LeadOut)
def contact(body: ContactIn, request: Request) -> dict:
    lead_id = leads_repo.create(
        kind="contact",
        name=body.name,
        email=str(body.email),
        phone=body.phone,
        topic=body.topic,
        message=body.message,
        ip=client_ip(request),
    )
    log.info("Contact enquiry %s from %s (%s)", lead_id, body.email, body.topic or "general")
    return {"ok": True, "id": lead_id}


@router.post("/newsletter", response_model=LeadOut)
def newsletter(body: NewsletterIn, request: Request) -> dict:
    lead_id = leads_repo.create(
        kind="newsletter", email=str(body.email), ip=client_ip(request)
    )
    return {"ok": True, "id": lead_id}
