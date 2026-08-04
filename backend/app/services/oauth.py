"""Google Sign-In (OAuth 2.0 authorization code flow).

Stdlib `urllib` only — same approach as the Gemini client, no SDK and no extra
dependency for what is two HTTP calls.

WHY THE CODE FLOW, NOT THE ONE-TAP ID TOKEN
    The credential arrives at our server over the back channel, exchanged with
    our client secret. Nothing security-relevant is decided from a value the
    browser handed us.

WHY THE TOKENINFO ENDPOINT
    Verifying a Google ID token properly means fetching Google's JWKS, matching
    the `kid`, and checking an RS256 signature — which needs a crypto library we
    do not otherwise have. Google's `tokeninfo` endpoint does exactly that
    check server-side. It costs one extra HTTPS round trip on sign-in only, and
    it removes a whole class of "we implemented JWT validation ourselves" bugs.
    We still verify `aud` and `iss` on the result, because tokeninfo will
    happily describe a token minted for somebody else's app.
"""

from __future__ import annotations

import json
import logging
import secrets
import urllib.error
import urllib.parse
import urllib.request

from app.config import settings

log = logging.getLogger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 — a URL, not a secret
TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

VALID_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class OAuthError(RuntimeError):
    pass


def configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def redirect_uri() -> str:
    return f"{settings.public_base_url.rstrip('/')}/api/auth/google/callback"


def new_state() -> str:
    return secrets.token_urlsafe(24)


def authorize_url(state: str) -> str:
    """Where to send the browser to start sign-in."""
    if not configured():
        raise OAuthError("Google sign-in is not configured")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        # We only need identity, so no refresh token and no consent screen on
        # every visit.
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


def _post_form(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        log.error("Google token exchange failed (%s): %s", exc.code, detail)
        raise OAuthError("Google rejected the sign-in attempt") from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Google token exchange error")
        raise OAuthError("Could not reach Google") from exc


def _get_json(url: str) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            return json.loads(response.read())
    except Exception as exc:  # noqa: BLE001
        log.exception("Google tokeninfo error")
        raise OAuthError("Could not verify the Google token") from exc


def exchange_code(code: str) -> dict:
    """Swap the authorization code for a verified Google profile.

    Returns {sub, email, email_verified, name, picture}.
    """
    if not configured():
        raise OAuthError("Google sign-in is not configured")

    tokens = _post_form(
        TOKEN_URL,
        {
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": redirect_uri(),
            "grant_type": "authorization_code",
        },
    )
    id_token = tokens.get("id_token")
    if not id_token:
        raise OAuthError("Google did not return an id_token")

    claims = _get_json(f"{TOKENINFO_URL}?{urllib.parse.urlencode({'id_token': id_token})}")

    # tokeninfo validates the SIGNATURE. It does not care who the token was
    # minted for — so a token issued to a completely different application
    # comes back as perfectly valid. Checking `aud` is what ties it to us.
    if claims.get("aud") != settings.google_client_id:
        log.error("Google id_token aud mismatch: %r", claims.get("aud"))
        raise OAuthError("That Google sign-in was not issued for this site")
    if claims.get("iss") not in VALID_ISSUERS:
        raise OAuthError("Unexpected token issuer")

    sub = claims.get("sub")
    email = claims.get("email")
    if not sub or not email:
        raise OAuthError("Google did not return an email address")

    # Google returns this as the STRING "true"/"false", not a bool.
    verified = str(claims.get("email_verified", "")).lower() == "true"
    if not verified:
        # An unverified Google address would let someone claim an account for a
        # mailbox they do not control.
        raise OAuthError("That Google account has an unverified email address")

    return {
        "sub": sub,
        "email": email,
        "email_verified": verified,
        "name": claims.get("name") or "",
        "picture": claims.get("picture"),
    }
