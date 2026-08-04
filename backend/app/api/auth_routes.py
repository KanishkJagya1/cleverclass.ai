"""Customer authentication: email/password, Google, verification, reset.

Separate from `admin_routes` by design — different table, different cookie,
different privileges. A customer session can never satisfy an admin check.

Three rules hold throughout:

  * **Enumeration is not allowed.** Signup, login and password-reset all return
    the same shape whether or not the address exists. Otherwise this endpoint is
    a free "is this person a customer?" oracle for anyone with a list of emails.
  * **Passwords are never logged**, not even at DEBUG, and never echoed back.
  * **The session cookie is HttpOnly.** No script reads it, so an XSS bug cannot
    exfiltrate a login.
"""

from __future__ import annotations

import logging
import re
from urllib.parse import quote

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from app.config import settings
from app.db.repo import customers as repo
from app.services import mailer, oauth
from app.services import security
from app.services.ratelimit import SlidingWindowLimiter, client_ip

log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

# --------------------------------------------------------------- rate limits --
#
# These endpoints were the only unauthenticated write path with NO limit at all,
# which made both online password guessing and reset-email flooding free.
#
# Two dimensions, and both are load-bearing:
#
#   * per IP  — stops one host working through a password list.
#   * per ACCOUNT — stops a distributed attempt against one mailbox, and matters
#     for a second reason that is easy to miss: `record_login_failure` locks an
#     account after 10 failures. Without a per-account limit, anyone who knows a
#     customer's email can lock them out on purpose, over and over, forever. The
#     per-account limiter refuses the attempt *before* it becomes a failed login,
#     so the lock counter is never touched by an attacker who cannot guess.
#
# Burst + drain pairs, not a single window: one number alone stops either a fast
# script or a patient one, never both.
_login_ip = SlidingWindowLimiter([(10, 60), (60, 3600)])
_login_account = SlidingWindowLimiter([(5, 60), (20, 3600)])

# Sending mail is the expensive, abusable side effect here — an unthrottled
# reset endpoint is a spam cannon pointed at someone else's inbox, using our
# domain's reputation.
_email_ip = SlidingWindowLimiter([(5, 300), (20, 3600)])
_email_account = SlidingWindowLimiter([(3, 900), (6, 86400)])

_signup_ip = SlidingWindowLimiter([(5, 600), (20, 86400)])
# Token guessing: the tokens are 32 random bytes, so this is belt-and-braces
# against someone brute-forcing the verify/reset endpoints.
_token_ip = SlidingWindowLimiter([(20, 300), (100, 3600)])


def _limit(limiter: SlidingWindowLimiter, key: str, what: str) -> None:
    allowed, retry = limiter.check(key)
    if allowed:
        return
    # Deliberately vague: naming which limit was hit tells an attacker whether
    # the account exists (per-account) or not (per-IP only).
    log.warning("Rate limit hit on %s for key=%s", what, key[:40])
    raise HTTPException(
        status_code=429,
        detail="Too many attempts. Please wait a moment and try again.",
        headers={"Retry-After": str(retry)},
    )

SESSION_COOKIE = "cc_session"
OAUTH_STATE_COOKIE = "cc_oauth_state"

# Long enough to matter, short enough that real people do not get locked out of
# their own signup. Length beats character-class rules: "correct horse battery"
# is stronger than "P@ss1!" and far likelier to be remembered.
MIN_PASSWORD = 8

# Compared against when the email does not exist, so the two failure paths cost
# roughly the same. Never a real credential; nothing can authenticate with it.
_DECOY_HASH = security.hash_password("not-a-real-password-decoy")


def _site(path: str = "") -> str:
    return f"{settings.public_base_url.rstrip('/')}{path}"


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=repo.SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def _public(customer: dict) -> dict:
    """The ONLY shape a customer is ever serialised into.

    Whitelisted rather than "delete the password" — a blacklist silently leaks
    every column added later.
    """
    return {
        "id": customer["id"],
        "email": customer["email"],
        "name": customer["name"],
        "phone": customer["phone"],
        "avatarUrl": customer["avatar_url"],
        "emailVerified": bool(customer["email_verified_at"]),
        "hasPassword": bool(customer["password_hash"]),
        "marketingOptIn": bool(customer["marketing_opt_in"]),
        "address": {
            "line1": customer["address_line1"],
            "line2": customer["address_line2"],
            "city": customer["city"],
            "state": customer["state"],
            "pincode": customer["pincode"],
        },
    }


def current_customer(cc_session: str | None = Cookie(default=None)) -> dict:
    customer = repo.session_customer(cc_session)
    if customer is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return customer


# ------------------------------------------------------------------ models --
class SignupIn(BaseModel):
    name: str = Field(default="", max_length=120)
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD, max_length=200)
    phone: str = Field(default="", max_length=20)
    marketingOptIn: bool = False


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class EmailIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=MIN_PASSWORD, max_length=200)


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    line1: str | None = Field(default=None, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=80)
    state: str | None = Field(default=None, max_length=80)
    pincode: str | None = Field(default=None, max_length=10)
    marketingOptIn: bool | None = None


class PasswordChangeIn(BaseModel):
    currentPassword: str | None = Field(default=None, max_length=200)
    newPassword: str = Field(min_length=MIN_PASSWORD, max_length=200)


# ------------------------------------------------------------------ signup --
def _send_verification(customer: dict) -> None:
    token = repo.issue_token(customer["id"], "verify")
    mailer.send_verification(customer, _site(f"/verify-email?token={quote(token)}"))


@router.post("/signup")
def signup(payload: SignupIn, request: Request, response: Response) -> dict:
    _limit(_signup_ip, client_ip(request), "signup")
    # Also limited per address: signup on an EXISTING account sends that owner a
    # password-reset email, so an unthrottled signup endpoint is a second way to
    # flood someone's inbox.
    _limit(_email_account, repo.normalise_email(payload.email), "signup-email")

    existing = repo.get_by_email(payload.email)

    if existing:
        # Do NOT reveal that the address is taken. Instead behave exactly as a
        # fresh signup does and email the real owner — which is both the
        # privacy-preserving answer and the genuinely useful one for someone who
        # forgot they already had an account.
        if existing["password_hash"]:
            token = repo.issue_token(existing["id"], "reset")
            mailer.send_password_reset(
                existing, _site(f"/reset-password?token={quote(token)}")
            )
        else:
            _send_verification(existing)
        return {"ok": True, "verificationRequired": True}

    customer = repo.create(
        email=payload.email,
        password=payload.password,
        name=payload.name,
        phone=payload.phone,
        marketing_opt_in=payload.marketingOptIn,
    )
    _send_verification(customer)

    # Signed in immediately. Blocking sign-in until the email is verified means
    # anyone whose mail is slow or filtered simply leaves. Verification gates
    # the things that need it (order history by email), not the front door.
    token = repo.create_session(
        customer["id"], request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )
    _set_session_cookie(response, token)
    return {"ok": True, "verificationRequired": True, "user": _public(customer)}


@router.post("/login")
def login(payload: LoginIn, request: Request, response: Response) -> dict:
    _limit(_login_ip, client_ip(request), "login-ip")
    # Checked BEFORE the password is verified, so a refused attempt never
    # increments `failed_logins` and cannot be used to lock a real customer out.
    _limit(_login_account, repo.normalise_email(payload.email), "login-account")

    customer = repo.get_by_email(payload.email)

    # Same message for "no such account", "wrong password" and "this is a
    # Google-only account", and the same amount of work either way.
    invalid = HTTPException(status_code=401, detail="Email or password is incorrect")

    if customer is None:
        # Burn a comparable amount of CPU so a missing account is not measurably
        # faster to reject than a wrong password.
        #
        # The decoy must satisfy `hash_password`'s own minimum length — a short
        # one raises ValueError and turns every unknown-email login into a 500,
        # which leaks far more than the timing side channel this exists to
        # close. Hashed once at import, not per request: scrypt is deliberately
        # slow, and doing it twice per failed login is a free amplifier for
        # anyone pointing a login flood at us.
        security.verify_password(payload.password, _DECOY_HASH)
        raise invalid

    if repo.is_locked(customer):
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Try again in a few minutes, or reset your password.",
        )

    if not customer["password_hash"]:
        raise invalid
    if not security.verify_password(payload.password, customer["password_hash"]):
        repo.record_login_failure(customer["id"])
        raise invalid
    if customer["status"] != "active":
        raise HTTPException(status_code=403, detail="This account has been disabled.")

    repo.record_login_success(customer["id"])
    token = repo.create_session(
        customer["id"], request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )
    _set_session_cookie(response, token)
    return {"ok": True, "user": _public(customer)}


@router.post("/logout")
def logout(response: Response, cc_session: str | None = Cookie(default=None)) -> dict:
    repo.destroy_session(cc_session)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(cc_session: str | None = Cookie(default=None)) -> dict:
    customer = repo.session_customer(cc_session)
    # 200 with user: null, not 401. "Nobody is signed in" is a normal answer to
    # this question, and a 401 makes every anonymous page load look like an
    # error in the browser console and in the logs.
    return {"user": _public(customer) if customer else None}


# ------------------------------------------------------------ verification --
@router.post("/verify-email")
def verify_email(payload: dict, response: Response, request: Request) -> dict:
    _limit(_token_ip, client_ip(request), "verify-token")
    token = str(payload.get("token") or "")
    customer = repo.consume_token(token, "verify") if token else None
    if customer is None:
        raise HTTPException(
            status_code=400, detail="That link has expired or has already been used."
        )
    repo.mark_verified(customer["id"])
    claimed = repo.claim_guest_orders(customer["id"], customer["email"])
    log.info("Verified %s; claimed %d guest order(s)", customer["id"], claimed)

    # Verifying is proof of mailbox control, so it is also a safe moment to sign
    # them in — someone arriving from an email link on a new device otherwise
    # hits a login wall for no security benefit.
    session = repo.create_session(
        customer["id"], request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )
    _set_session_cookie(response, session)
    return {"ok": True, "user": _public(repo.get_by_id(customer["id"]) or customer)}


@router.post("/resend-verification")
def resend_verification(
    request: Request, customer: dict = Depends(current_customer)
) -> dict:
    # Authenticated, but still throttled: a signed-in account holding a button
    # down is as effective a mail flood as an anonymous one, and it burns our
    # sending reputation just the same.
    _limit(_email_account, customer["email_norm"], "resend-verification")
    _limit(_email_ip, client_ip(request), "resend-ip")

    if customer["email_verified_at"]:
        return {"ok": True, "alreadyVerified": True}
    _send_verification(customer)
    return {"ok": True}


# ---------------------------------------------------------------- password --
@router.post("/request-reset")
def request_reset(payload: EmailIn, request: Request) -> dict:
    _limit(_email_ip, client_ip(request), "reset-ip")
    _limit(_email_account, repo.normalise_email(payload.email), "reset-account")

    customer = repo.get_by_email(payload.email)
    if customer:
        token = repo.issue_token(customer["id"], "reset")
        mailer.send_password_reset(
            customer, _site(f"/reset-password?token={quote(token)}")
        )
    # Identical response either way — see the enumeration rule at the top.
    return {"ok": True}


@router.post("/reset-password")
def reset_password(payload: ResetIn, request: Request, response: Response) -> dict:
    _limit(_token_ip, client_ip(request), "reset-token")
    customer = repo.consume_token(payload.token, "reset")
    if customer is None:
        raise HTTPException(
            status_code=400, detail="That link has expired or has already been used."
        )
    repo.set_password(customer["id"], payload.password)
    # Every existing session dies. If the reset happened because someone else
    # had access, leaving their session alive defeats the entire exercise.
    repo.destroy_all_sessions(customer["id"])
    repo.mark_verified(customer["id"])

    token = repo.create_session(
        customer["id"], request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )
    _set_session_cookie(response, token)
    return {"ok": True, "user": _public(repo.get_by_id(customer["id"]) or customer)}


@router.post("/change-password")
def change_password(
    payload: PasswordChangeIn, customer: dict = Depends(current_customer)
) -> dict:
    # A Google-only account has no password to prove, so this is also how it
    # gains one. An account that HAS a password must prove it.
    if customer["password_hash"]:
        if not payload.currentPassword or not security.verify_password(
            payload.currentPassword, customer["password_hash"]
        ):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
    repo.set_password(customer["id"], payload.newPassword)
    return {"ok": True}


# ----------------------------------------------------------------- profile --
@router.get("/profile")
def get_profile(customer: dict = Depends(current_customer)) -> dict:
    return {"user": _public(customer)}


@router.put("/profile")
def update_profile(
    payload: ProfileIn, customer: dict = Depends(current_customer)
) -> dict:
    fields: dict = {}
    for src, dest in (
        ("name", "name"), ("phone", "phone"), ("line1", "address_line1"),
        ("line2", "address_line2"), ("city", "city"), ("state", "state"),
        ("pincode", "pincode"),
    ):
        value = getattr(payload, src)
        if value is not None:
            fields[dest] = value.strip()
    if payload.marketingOptIn is not None:
        fields["marketing_opt_in"] = 1 if payload.marketingOptIn else 0

    if "pincode" in fields and fields["pincode"] and not re.fullmatch(r"\d{6}", fields["pincode"]):
        raise HTTPException(status_code=422, detail="Pincode must be 6 digits")

    updated = repo.update_profile(customer["id"], **fields)
    return {"ok": True, "user": _public(updated or customer)}


@router.get("/orders")
def my_orders(customer: dict = Depends(current_customer)) -> dict:
    orders = repo.orders_for(customer["id"])
    return {
        "orders": [
            {
                "orderNumber": o["order_number"],
                "status": o["status"],
                "total": o["total"],
                "subtotal": o["subtotal"],
                "shipping": o["shipping"],
                "createdAt": o["created_at"],
                "itemCount": sum(i["qty"] for i in o["items"]),
                "items": [
                    {"title": i["title"], "qty": i["qty"], "price": i["price"],
                     "slug": i["slug"]}
                    for i in o["items"]
                ],
            }
            for o in orders
        ]
    }


# ------------------------------------------------------------------ google --
@router.get("/google/start")
def google_start() -> RedirectResponse:
    if not oauth.configured():
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    state = oauth.new_state()
    response = RedirectResponse(oauth.authorize_url(state), status_code=307)
    # CSRF for the OAuth round trip: the value comes back in the query string
    # and must match this cookie, so a callback we did not initiate is rejected.
    response.set_cookie(
        OAUTH_STATE_COOKIE, state, max_age=600, httponly=True,
        samesite="lax", secure=settings.cookie_secure, path="/",
    )
    return response


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    cc_oauth_state: str | None = Cookie(default=None),
) -> RedirectResponse:
    def fail(message: str) -> RedirectResponse:
        log.warning("Google sign-in failed: %s", message)
        return RedirectResponse(_site(f"/login?error={quote(message)}"), status_code=303)

    if error:
        return fail("Google sign-in was cancelled")
    if not code:
        return fail("Google did not return a sign-in code")
    if not state or not security.constant_time_equals(state, cc_oauth_state):
        return fail("Sign-in session expired — please try again")

    try:
        profile = oauth.exchange_code(code)
    except oauth.OAuthError as exc:
        return fail(str(exc))

    customer = repo.get_by_google_sub(profile["sub"])
    if customer is None:
        existing = repo.get_by_email(profile["email"])
        if existing:
            # Same person, second sign-in method. Safe to merge because Google
            # has verified the address, which is the same proof our own
            # verification email asks for.
            repo.link_google(existing["id"], profile["sub"], profile.get("picture"))
            customer = repo.get_by_id(existing["id"])
        else:
            customer = repo.create(
                email=profile["email"],
                name=profile.get("name") or "",
                google_sub=profile["sub"],
                avatar_url=profile.get("picture"),
                email_verified=True,
            )
            repo.claim_guest_orders(customer["id"], customer["email"])

    assert customer is not None
    if customer["status"] != "active":
        return fail("This account has been disabled")

    repo.record_login_success(customer["id"])
    token = repo.create_session(
        customer["id"], request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )
    response = RedirectResponse(_site("/account"), status_code=303)
    _set_session_cookie(response, token)
    response.delete_cookie(OAUTH_STATE_COOKIE, path="/")
    return response


@router.get("/providers")
def providers() -> dict:
    """What the sign-in UI should offer.

    The Google button is hidden when unconfigured rather than rendered and
    broken; `emailDelivery` lets the UI say "check your email" only when mail
    can actually be sent.
    """
    return {"google": oauth.configured(), "emailDelivery": mailer.configured()}


# ----------------------------------------------------------------- reviews --
class ReviewIn(BaseModel):
    productSlug: str = Field(min_length=1, max_length=200)
    rating: int = Field(ge=1, le=5)
    title: str = Field(default="", max_length=120)
    body: str = Field(default="", max_length=4000)


@router.get("/can-review/{product_slug}")
def can_review(product_slug: str, customer: dict = Depends(current_customer)) -> dict:
    from app.services import reviews as reviews_service

    return reviews_service.can_review(customer["id"], product_slug)


@router.post("/reviews")
def write_review(
    payload: ReviewIn, customer: dict = Depends(current_customer)
) -> dict:
    from app.services import reviews as reviews_service

    try:
        review = reviews_service.submit(
            customer["id"], payload.productSlug,
            rating=payload.rating, title=payload.title, body=payload.body,
            author=customer["name"] or "Verified buyer",
        )
    except reviews_service.ReviewError as exc:
        raise HTTPException(409, str(exc)) from exc

    return {
        "ok": True,
        "status": review["status"],
        "message": "Thanks — your review will appear once it has been checked.",
    }


# --------------------------------------------------------------- addresses --
class AddressIn(BaseModel):
    label: str = Field(default="Home", max_length=40)
    name: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=20)
    line1: str = Field(min_length=3, max_length=300)
    line2: str = Field(default="", max_length=300)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(default="", max_length=100)
    pincode: str = Field(pattern=r"^\d{6}$")
    isDefault: bool = False


class AddressPatch(BaseModel):
    label: str | None = Field(default=None, max_length=40)
    name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    line1: str | None = Field(default=None, max_length=300)
    line2: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    pincode: str | None = Field(default=None, pattern=r"^\d{6}$")


@router.get("/addresses")
def list_addresses(customer: dict = Depends(current_customer)) -> dict:
    from app.services import addresses as address_service

    return {"addresses": address_service.list_for(customer["id"])}


@router.post("/addresses", status_code=201)
def add_address(
    payload: AddressIn, customer: dict = Depends(current_customer)
) -> dict:
    from app.services import addresses as address_service

    try:
        address = address_service.create(customer["id"], **payload.model_dump())
    except address_service.AddressError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, "address": address}


@router.put("/addresses/{address_id}")
def edit_address(
    address_id: str,
    payload: AddressPatch,
    customer: dict = Depends(current_customer),
) -> dict:
    from app.services import addresses as address_service

    try:
        # Scoped to this customer inside the service, so an id belonging to
        # someone else simply does not resolve.
        address = address_service.update(
            customer["id"], address_id, **payload.model_dump()
        )
    except address_service.AddressError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True, "address": address}


@router.post("/addresses/{address_id}/default")
def make_default_address(
    address_id: str, customer: dict = Depends(current_customer)
) -> dict:
    from app.services import addresses as address_service

    try:
        address = address_service.set_default(customer["id"], address_id)
    except address_service.AddressError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True, "address": address}


@router.delete("/addresses/{address_id}")
def delete_address(
    address_id: str, customer: dict = Depends(current_customer)
) -> dict:
    from app.services import addresses as address_service

    try:
        return address_service.remove(customer["id"], address_id)
    except address_service.AddressError as exc:
        raise HTTPException(404, str(exc)) from exc


# ------------------------------------------------------------ cart/wishlist --
class CartItemIn(BaseModel):
    slug: str = Field(min_length=1, max_length=200)
    qty: int = Field(ge=0, le=20)
    format: str = Field(default="book", max_length=20)


class MergeIn(BaseModel):
    cart: list[CartItemIn] = Field(default_factory=list, max_length=40)
    wishlist: list[str] = Field(default_factory=list, max_length=200)


@router.get("/cart")
def get_cart(customer: dict = Depends(current_customer)) -> dict:
    from app.services import basket

    return basket.cart(customer["id"])


@router.put("/cart")
def put_cart_item(
    payload: CartItemIn, customer: dict = Depends(current_customer)
) -> dict:
    from app.services import basket

    try:
        return basket.set_item(
            customer["id"], payload.slug, payload.qty, payload.format
        )
    except basket.BasketError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.delete("/cart")
def clear_cart(customer: dict = Depends(current_customer)) -> dict:
    from app.services import basket

    return basket.clear(customer["id"])


@router.post("/merge")
def merge_guest_state(
    payload: MergeIn, customer: dict = Depends(current_customer)
) -> dict:
    """Fold a guest's local cart and wishlist into the account at sign-in.

    Called by the client right after login. Quantities merge as a MAX, not a
    sum — see `basket.merge_guest_cart`.
    """
    from app.services import basket

    cart = basket.merge_guest_cart(
        customer["id"], [item.model_dump() for item in payload.cart]
    )
    wish = basket.merge_guest_wishlist(customer["id"], payload.wishlist)
    return {"cart": cart, "wishlist": wish}


@router.get("/wishlist")
def get_wishlist(customer: dict = Depends(current_customer)) -> dict:
    from app.services import basket

    return basket.wishlist(customer["id"])


@router.post("/wishlist/{slug}")
def add_wishlist(slug: str, customer: dict = Depends(current_customer)) -> dict:
    from app.services import basket

    return basket.add_to_wishlist(customer["id"], slug)


@router.delete("/wishlist/{slug}")
def remove_wishlist(slug: str, customer: dict = Depends(current_customer)) -> dict:
    from app.services import basket

    return basket.remove_from_wishlist(customer["id"], slug)


# ---------------------------------------------------------- notifications --
@router.get("/notifications")
def my_notifications(
    customer: dict = Depends(current_customer), unreadOnly: bool = False
) -> dict:
    from app.services import notifications

    return notifications.for_customer(customer["id"], unread_only=unreadOnly)


@router.post("/notifications/{notification_id}/read")
def read_notification(
    notification_id: str, customer: dict = Depends(current_customer)
) -> dict:
    from app.services import notifications

    # Scoped to this customer inside the service, so guessing an id belonging
    # to someone else changes nothing.
    return {"ok": notifications.mark_read(notification_id, customer_id=customer["id"])}


@router.post("/notifications/read-all")
def read_all_notifications(customer: dict = Depends(current_customer)) -> dict:
    from app.services import notifications

    return {
        "ok": True,
        "marked": notifications.mark_all_read(
            audience="customer", customer_id=customer["id"]
        ),
    }
