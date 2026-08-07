"""Streaming e-book reader — page images instead of a downloadable file.

The delivery model asked for: nothing downloadable, pages served one at a time,
each stamped with the buyer, each request re-checked against the live order.

WHAT THIS ACHIEVES, honestly:

  * There is no file to pass around. A page URL is signed, expires in minutes
    and is bound to one order — sharing it gets someone a dead link.
  * Every page is watermarked with the buyer's name, email and order number, so
    a screenshot that does circulate identifies who took it.
  * Access is re-read from the order on EVERY page request, so a refund stops
    the book mid-chapter rather than at the next login.
  * Sequential scraping is rate-limited and logged.

WHAT IT DOES NOT ACHIEVE: it does not stop screenshots. Nothing served to a
browser can. Google Play Books' own web reader can be screenshotted; only a
native app with `FLAG_SECURE` blocks it. Anyone claiming otherwise about a web
reader is describing obfuscation, not protection.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import logging
import secrets

from app.config import settings
from app.db.conn import query_one
from app.services import ebook

log = logging.getLogger(__name__)

# Long enough to load a page on a slow connection, short enough that a copied
# URL is useless by the time it is pasted anywhere.
TOKEN_TTL_SECONDS = 180

# One reader session should not exceed roughly a page every second or two. A
# full-book sweep at machine speed is the scraping case this catches.
MAX_PAGES_PER_MINUTE = 40


class ReaderError(RuntimeError):
    pass


def _secret() -> bytes:
    # Reuses the admin session secret: it is already required at boot, so there
    # is no new configuration that could be left unset and silently weaken this.
    #
    # Typed as optional in settings, so the absence is checked rather than
    # allowed to surface as an AttributeError deep inside an HMAC call. Failing
    # loudly here beats signing every token with a fallback nobody chose.
    secret = settings.admin_session_secret
    if not secret:
        raise ReaderError(
            "The reader is not configured: ADMIN_SESSION_SECRET is unset."
        )
    return secret.encode("utf-8")


def _now() -> int:
    return int(dt.datetime.now(dt.timezone.utc).timestamp())


# --------------------------------------------------------------------------
# Signed page tokens
# --------------------------------------------------------------------------

def sign_page(order_number: str, slug: str, page_no: int, *, expires: int) -> str:
    """An HMAC over exactly the fields that must not be swapped.

    Page number is included deliberately: without it a token for page 1 would
    open page 400, and the whole book becomes readable from one legitimate
    request.
    """
    payload = f"{order_number}:{slug}:{page_no}:{expires}"
    mac = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{expires}.{mac[:32]}"


def verify_page(order_number: str, slug: str, page_no: int, token: str) -> None:
    """Raises ReaderError unless `token` is a live signature for this page."""
    try:
        expires_raw, _ = token.split(".", 1)
        expires = int(expires_raw)
    except (ValueError, AttributeError) as exc:
        raise ReaderError("That link is not valid.") from exc

    if expires < _now():
        raise ReaderError("That link has expired. Reload the page.")

    expected = sign_page(order_number, slug, page_no, expires=expires)
    # Constant-time: a fast reject on the first differing byte is a timing
    # oracle for forging the rest.
    if not hmac.compare_digest(expected, token):
        raise ReaderError("That link is not valid.")


def issue_manifest(
    order_number: str, slug: str, *, customer_id: str | None
) -> dict:
    """What the reader needs to render a book: page count and signed URLs.

    Entitlement is checked HERE and again on every page. Checking once and
    trusting the manifest would mean a refund left a working reader open for as
    long as the tab stayed put.
    """
    row = ebook._entitlement_row(order_number, slug)  # noqa: SLF001
    if row is None:
        raise ReaderError("We could not find that book on your account.")
    if customer_id and row["customer_id"] and row["customer_id"] != customer_id:
        raise ReaderError("We could not find that book on your account.")

    asset = query_one(
        "SELECT id, page_count FROM book_assets"
        " WHERE book_id = ? AND is_current = 1",
        (row["book_id"],),
    )
    if asset is None or not asset["page_count"]:
        raise ReaderError("This book is not ready to read yet.")

    expires = _now() + TOKEN_TTL_SECONDS
    pages = [
        {
            "page": n,
            "token": sign_page(order_number, slug, n, expires=expires),
        }
        for n in range(1, int(asset["page_count"]) + 1)
    ]

    return {
        "orderNumber": order_number,
        "slug": slug,
        "title": row["title"],
        "pageCount": int(asset["page_count"]),
        "expiresAt": expires,
        # Refreshed by the client before expiry. Short-lived tokens are only
        # useful if the reader can renew them without a reload.
        "ttlSeconds": TOKEN_TTL_SECONDS,
        "pages": pages,
    }


def watermark_for(order_number: str, slug: str) -> str:
    """The per-buyer stamp burned into every page image."""
    row = ebook._entitlement_row(order_number, slug)  # noqa: SLF001
    if row is None:
        raise ReaderError("We could not find that book on your account.")
    who = row["customer_name"] or "Licensed copy"
    email = row["email"] or ""
    return f"{who} · {email} · {order_number}"


def check_entitled(
    order_number: str, slug: str, *, customer_id: str | None
) -> dict:
    """Re-read entitlement from the order. Called on EVERY page request."""
    row = ebook._entitlement_row(order_number, slug)  # noqa: SLF001
    if row is None:
        raise ReaderError("We could not find that book on your account.")
    if customer_id and row["customer_id"] and row["customer_id"] != customer_id:
        raise ReaderError("We could not find that book on your account.")
    return dict(row)


def new_session_id() -> str:
    return secrets.token_urlsafe(12)
