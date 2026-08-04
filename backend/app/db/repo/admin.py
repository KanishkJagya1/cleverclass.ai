"""Admin users, sessions and the audit trail.

Sessions are stored by SHA-256 fingerprint, never in the clear — see
`app/services/security.py:token_fingerprint`.
"""

from __future__ import annotations

import datetime as dt
import json
import uuid
from typing import Any

from app.config import settings
from app.db.conn import query, query_one, transaction
from app.services import security


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(value: dt.datetime) -> str:
    return value.isoformat()


# --------------------------------------------------------------------------
# Users
# --------------------------------------------------------------------------

def create_user(email: str, password: str, name: str = "", role: str = "admin") -> str:
    email = email.strip().lower()
    if not email or "@" not in email:
        raise ValueError("A valid email is required")
    user_id = f"usr_{uuid.uuid4().hex[:12]}"
    with transaction() as conn:
        existing = conn.execute(
            "SELECT id FROM admin_users WHERE email = ?", (email,)
        ).fetchone()
        if existing:
            raise ValueError(f"An admin with {email} already exists")
        conn.execute(
            "INSERT INTO admin_users (id, email, name, password_hash, role, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (user_id, email, name, security.hash_password(password), role, _iso(_now())),
        )
    return user_id


def set_password(email: str, password: str) -> bool:
    with transaction() as conn:
        return conn.execute(
            "UPDATE admin_users SET password_hash = ? WHERE email = ?",
            (security.hash_password(password), email.strip().lower()),
        ).rowcount > 0


def get_user_by_email(email: str) -> dict | None:
    row = query_one("SELECT * FROM admin_users WHERE email = ?", (email.strip().lower(),))
    return dict(row) if row else None


def list_users() -> list[dict]:
    return [
        dict(r)
        for r in query(
            "SELECT id, email, name, role, is_active, last_login_at, created_at"
            " FROM admin_users ORDER BY created_at"
        )
    ]


def count_users() -> int:
    row = query_one("SELECT COUNT(*) AS n FROM admin_users")
    return int(row["n"]) if row else 0


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------

def create_session(user_id: str, ip: str | None, user_agent: str | None) -> tuple[str, str]:
    """Returns (session_token, csrf_token). Only the caller ever sees the token
    itself; the database keeps its fingerprint."""
    token = security.new_token()
    csrf = security.new_token(24)
    expires = _now() + dt.timedelta(hours=settings.admin_session_hours)

    with transaction() as conn:
        conn.execute(
            "INSERT INTO admin_sessions (id, user_id, csrf_token, ip, user_agent,"
            " created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
            (
                security.token_fingerprint(token),
                user_id,
                csrf,
                ip,
                (user_agent or "")[:300],
                _iso(_now()),
                _iso(expires),
            ),
        )
        conn.execute(
            "UPDATE admin_users SET last_login_at = ? WHERE id = ?", (_iso(_now()), user_id)
        )
    return token, csrf


def resolve_session(token: str | None) -> dict | None:
    """The session and its user, or None if missing, expired or revoked."""
    if not token:
        return None
    row = query_one(
        "SELECT s.id AS sid, s.csrf_token, s.expires_at, s.revoked_at,"
        "       u.id, u.email, u.name, u.role, u.is_active"
        " FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id"
        " WHERE s.id = ?",
        (security.token_fingerprint(token),),
    )
    if row is None or row["revoked_at"] or not row["is_active"]:
        return None
    try:
        if dt.datetime.fromisoformat(row["expires_at"]) < _now():
            return None
    except ValueError:
        return None
    return dict(row)


def revoke_session(token: str | None) -> None:
    if not token:
        return
    with transaction() as conn:
        conn.execute(
            "UPDATE admin_sessions SET revoked_at = ? WHERE id = ?",
            (_iso(_now()), security.token_fingerprint(token)),
        )


def purge_expired_sessions() -> int:
    with transaction() as conn:
        return conn.execute(
            "DELETE FROM admin_sessions WHERE expires_at < ?", (_iso(_now()),)
        ).rowcount


# --------------------------------------------------------------------------
# Audit
# --------------------------------------------------------------------------

def audit(
    *,
    user_id: str | None,
    action: str,
    entity: str | None = None,
    entity_id: str | None = None,
    detail: Any = None,
    ip: str | None = None,
) -> None:
    """Best-effort. An audit write must never fail the operation it records —
    but it is logged loudly if it does, because a silent audit gap is worse
    than a noisy one."""
    try:
        with transaction() as conn:
            conn.execute(
                "INSERT INTO admin_audit (user_id, action, entity, entity_id, detail, ip, created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (
                    user_id,
                    action,
                    entity,
                    entity_id,
                    json.dumps(detail or {}, ensure_ascii=False, default=str),
                    ip,
                    _iso(_now()),
                ),
            )
    except Exception as exc:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).error("AUDIT WRITE FAILED for %s: %s", action, exc)


def recent_audit(limit: int = 100) -> list[dict]:
    return [
        dict(r)
        for r in query(
            "SELECT a.*, u.email FROM admin_audit a"
            " LEFT JOIN admin_users u ON u.id = a.user_id"
            " ORDER BY a.created_at DESC LIMIT ?",
            (int(limit),),
        )
    ]
