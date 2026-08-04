"""Contact-form and newsletter capture.

Exists so the forms stop lying. Both previously resolved a `setTimeout` and then
told the user "Message sent" / "You're on the list" without any transport at
all — every enquiry since launch was silently discarded.
"""

from __future__ import annotations

import datetime as dt
import uuid

from app.db.conn import query, transaction


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def create(
    *,
    kind: str,
    name: str = "",
    email: str = "",
    phone: str = "",
    topic: str = "",
    message: str = "",
    ip: str | None = None,
) -> str:
    if kind not in ("contact", "newsletter", "callback"):
        raise ValueError(f"unknown lead kind: {kind}")

    lead_id = f"ld_{uuid.uuid4().hex[:12]}"
    with transaction() as conn:
        # Re-subscribing to the newsletter is not an error and must not create a
        # second row; the caller still gets a success response either way.
        if kind == "newsletter" and email:
            existing = conn.execute(
                "SELECT id FROM leads WHERE kind = 'newsletter' AND email = ?", (email,)
            ).fetchone()
            if existing:
                return existing[0]

        conn.execute(
            "INSERT INTO leads (id, kind, name, email, phone, topic, message, ip, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (lead_id, kind, name, email, phone, topic, message[:4000], ip, _now()),
        )
    return lead_id


def recent(kind: str | None = None, limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM leads"
    params: list = []
    if kind:
        sql += " WHERE kind = ?"
        params.append(kind)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(int(limit))
    return [dict(r) for r in query(sql, params)]


def mark_handled(lead_id: str) -> bool:
    with transaction() as conn:
        return conn.execute(
            "UPDATE leads SET handled = 1 WHERE id = ?", (lead_id,)
        ).rowcount > 0
