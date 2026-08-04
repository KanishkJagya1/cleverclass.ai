"""Customer accounts, sessions and email tokens.

The only module that writes to `customers`, `customer_sessions` and
`email_tokens`. Route handlers call these; they never build SQL themselves.

Two rules run through everything here:

  * **Email is matched on `email_norm`, never on `email`.** People do not type
    their address consistently, and a UNIQUE index on the raw column would
    cheerfully create a second account for the same person.
  * **Nothing bearer-shaped is stored in the clear.** Session cookies and email
    tokens are kept as SHA-256 fingerprints, so a leaked database yields no
    usable credentials.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets

from app.db.conn import query, query_one, transaction
from app.services import security

log = logging.getLogger(__name__)

SESSION_DAYS = 30
VERIFY_TOKEN_HOURS = 48
RESET_TOKEN_MINUTES = 60

# After this many consecutive failures the account stops accepting passwords for
# LOCK_MINUTES. Deliberately generous — the goal is to make online guessing
# pointless, not to help an attacker lock a real customer out of their account
# by failing five times on purpose.
MAX_FAILED_LOGINS = 10
LOCK_MINUTES = 15


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _later(**delta) -> str:
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(**delta)).isoformat()


def normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


# ---------------------------------------------------------------- accounts --
def get_by_email(email: str) -> dict | None:
    row = query_one(
        "SELECT * FROM customers WHERE email_norm = ?", (normalise_email(email),)
    )
    return dict(row) if row else None


def get_by_id(customer_id: str) -> dict | None:
    row = query_one("SELECT * FROM customers WHERE id = ?", (customer_id,))
    return dict(row) if row else None


def get_by_google_sub(sub: str) -> dict | None:
    row = query_one("SELECT * FROM customers WHERE google_sub = ?", (sub,))
    return dict(row) if row else None


def create(
    *,
    email: str,
    password: str | None = None,
    name: str = "",
    phone: str = "",
    google_sub: str | None = None,
    avatar_url: str | None = None,
    email_verified: bool = False,
    marketing_opt_in: bool = False,
) -> dict:
    customer_id = _new_id("cus")
    now = _now()
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO customers
              (id, email, email_norm, email_verified_at, password_hash, google_sub,
               name, phone, avatar_url, marketing_opt_in, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                customer_id,
                (email or "").strip(),
                normalise_email(email),
                now if email_verified else None,
                security.hash_password(password) if password else None,
                google_sub,
                (name or "").strip(),
                (phone or "").strip(),
                avatar_url,
                1 if marketing_opt_in else 0,
                now,
                now,
            ),
        )
    created = get_by_id(customer_id)
    assert created is not None
    return created


def update_profile(customer_id: str, **fields) -> dict | None:
    """Update a whitelisted subset of profile columns.

    The whitelist is the point. Without it a `**fields` update is one typo in a
    request body away from letting a customer set their own `status`,
    `password_hash` or `email_verified_at`.
    """
    allowed = {
        "name",
        "phone",
        "address_line1",
        "address_line2",
        "city",
        "state",
        "pincode",
        "marketing_opt_in",
    }
    sets = {k: v for k, v in fields.items() if k in allowed}
    if not sets:
        return get_by_id(customer_id)

    assignments = ", ".join(f"{k} = ?" for k in sets)
    with transaction() as conn:
        conn.execute(
            f"UPDATE customers SET {assignments}, updated_at = ? WHERE id = ?",
            (*sets.values(), _now(), customer_id),
        )
    return get_by_id(customer_id)


def set_password(customer_id: str, password: str) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE customers SET password_hash = ?, failed_logins = 0, "
            "locked_until = NULL, updated_at = ? WHERE id = ?",
            (security.hash_password(password), _now(), customer_id),
        )


def link_google(customer_id: str, sub: str, avatar_url: str | None = None) -> None:
    """Attach a Google identity to an existing email/password account.

    This is what stops "sign in with Google" from creating a duplicate account
    for someone who originally signed up with a password and later clicks the
    Google button. It also verifies the email: Google has already proven it.
    """
    with transaction() as conn:
        conn.execute(
            "UPDATE customers SET google_sub = ?, "
            "avatar_url = COALESCE(?, avatar_url), "
            "email_verified_at = COALESCE(email_verified_at, ?), "
            "updated_at = ? WHERE id = ?",
            (sub, avatar_url, _now(), _now(), customer_id),
        )


def mark_verified(customer_id: str) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE customers SET email_verified_at = COALESCE(email_verified_at, ?), "
            "updated_at = ? WHERE id = ?",
            (_now(), _now(), customer_id),
        )


def is_locked(customer: dict) -> bool:
    until = customer.get("locked_until")
    return bool(until and until > _now())


def record_login_failure(customer_id: str) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE customers SET failed_logins = failed_logins + 1 WHERE id = ?",
            (customer_id,),
        )
        conn.execute(
            "UPDATE customers SET locked_until = ? "
            "WHERE id = ? AND failed_logins >= ?",
            (_later(minutes=LOCK_MINUTES), customer_id, MAX_FAILED_LOGINS),
        )


def record_login_success(customer_id: str) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE customers SET failed_logins = 0, locked_until = NULL, "
            "last_login_at = ? WHERE id = ?",
            (_now(), customer_id),
        )


# ---------------------------------------------------------------- sessions --
def create_session(customer_id: str, ip: str | None, user_agent: str | None) -> str:
    """Returns the RAW cookie value. Only its fingerprint is stored."""
    token = security.new_token()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO customer_sessions"
            " (id, customer_id, created_at, expires_at, last_seen_at, ip, user_agent)"
            " VALUES (?,?,?,?,?,?,?)",
            (
                security.token_fingerprint(token),
                customer_id,
                _now(),
                _later(days=SESSION_DAYS),
                _now(),
                ip,
                (user_agent or "")[:300],
            ),
        )
    return token


def session_customer(token: str | None) -> dict | None:
    if not token:
        return None
    row = query_one(
        "SELECT c.* FROM customer_sessions s"
        " JOIN customers c ON c.id = s.customer_id"
        " WHERE s.id = ? AND s.expires_at > ? AND c.status = 'active'",
        (security.token_fingerprint(token), _now()),
    )
    return dict(row) if row else None


def destroy_session(token: str | None) -> None:
    if not token:
        return
    with transaction() as conn:
        conn.execute(
            "DELETE FROM customer_sessions WHERE id = ?",
            (security.token_fingerprint(token),),
        )


def destroy_all_sessions(customer_id: str) -> None:
    """Used after a password reset — a reset must log out any stolen session."""
    with transaction() as conn:
        conn.execute(
            "DELETE FROM customer_sessions WHERE customer_id = ?", (customer_id,)
        )


def purge_expired_sessions() -> int:
    with transaction() as conn:
        cur = conn.execute(
            "DELETE FROM customer_sessions WHERE expires_at <= ?", (_now(),)
        )
        return cur.rowcount or 0


# ------------------------------------------------------------ email tokens --
def issue_token(customer_id: str, kind: str) -> str:
    """Returns the RAW token for the email link. Only its hash is stored."""
    token = security.new_token()
    with transaction() as conn:
        # One live token per kind. Re-requesting a reset must invalidate the
        # previous link, or an old email in an inbox stays usable.
        conn.execute(
            "DELETE FROM email_tokens WHERE customer_id = ? AND kind = ?",
            (customer_id, kind),
        )
        expires = (
            _later(hours=VERIFY_TOKEN_HOURS)
            if kind == "verify"
            else _later(minutes=RESET_TOKEN_MINUTES)
        )
        conn.execute(
            "INSERT INTO email_tokens (id, customer_id, kind, expires_at, created_at)"
            " VALUES (?,?,?,?,?)",
            (security.token_fingerprint(token), customer_id, kind, expires, _now()),
        )
    return token


def consume_token(token: str, kind: str) -> dict | None:
    """Validate and burn a token. Returns the customer, or None."""
    fingerprint = security.token_fingerprint(token)
    row = query_one(
        "SELECT * FROM email_tokens WHERE id = ? AND kind = ?", (fingerprint, kind)
    )
    if row is None or row["used_at"] or row["expires_at"] <= _now():
        return None
    with transaction() as conn:
        conn.execute(
            "UPDATE email_tokens SET used_at = ? WHERE id = ?", (_now(), fingerprint)
        )
    return get_by_id(row["customer_id"])


# ------------------------------------------------------------------ orders --
def orders_for(customer_id: str, limit: int = 50) -> list[dict]:
    """Order history for the signed-in account.

    Matched on `customer_id` OR the account's own verified email, so orders
    placed as a guest before signing up still appear. The email side is
    restricted to VERIFIED accounts — otherwise registering with someone else's
    address would show you their order history.
    """
    customer = get_by_id(customer_id)
    if customer is None:
        return []

    if customer["email_verified_at"]:
        rows = query(
            "SELECT * FROM orders WHERE customer_id = ? OR LOWER(email) = ?"
            " ORDER BY created_at DESC LIMIT ?",
            (customer_id, customer["email_norm"], int(limit)),
        )
    else:
        rows = query(
            "SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?",
            (customer_id, int(limit)),
        )

    out = []
    for row in rows:
        order = dict(row)
        order["items"] = [
            dict(i)
            for i in query(
                "SELECT title, qty, price, slug FROM order_items WHERE order_id = ?",
                (order["id"],),
            )
        ]
        out.append(order)
    return out


def claim_guest_orders(customer_id: str, email: str) -> int:
    """Attach past guest orders to a newly verified account."""
    with transaction() as conn:
        cur = conn.execute(
            "UPDATE orders SET customer_id = ? WHERE customer_id IS NULL"
            " AND LOWER(email) = ?",
            (customer_id, normalise_email(email)),
        )
        return cur.rowcount or 0
