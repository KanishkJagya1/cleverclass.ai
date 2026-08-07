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


def page(
    *,
    kind: str | None = None,
    handled: bool | None = None,
    page: int = 1,
    per_page: int = 50,
) -> dict:
    """A page of leads, counted before slicing.

    `handled` is a filter rather than a sort because the only question worth
    asking on this screen is "what has nobody dealt with yet" — and with a bare
    LIMIT the unhandled ones fall off the end as new leads arrive.
    """
    clauses = ["1=1"]
    params: list = []
    if kind:
        clauses.append("kind = ?")
        params.append(kind)
    if handled is not None:
        clauses.append("handled = ?")
        params.append(1 if handled else 0)
    where = " AND ".join(clauses)

    total = query(f"SELECT COUNT(*) AS n FROM leads WHERE {where}", params)[0]["n"]
    rows = query(
        f"SELECT * FROM leads WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [*params, int(per_page), (int(page) - 1) * int(per_page)],
    )
    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "perPage": per_page,
        "totalPages": (total + per_page - 1) // per_page if total else 0,
    }


def mark_handled(lead_id: str) -> bool:
    with transaction() as conn:
        return conn.execute(
            "UPDATE leads SET handled = 1 WHERE id = ?", (lead_id,)
        ).rowcount > 0
