"""Support tickets.

Replaces a contact form that wrote a row and did nothing else — no reply, no
status, no way for the customer to see what happened.

TWO RULES THAT PROTECT THE CUSTOMER

  * **Internal notes never leave the building.** Staff notes live in the same
    thread so the timeline reads as one story, and are filtered on every read
    path that a customer can reach. A separate table would drift out of
    chronological order, which is how "the customer saw our internal note" bugs
    happen in the first place.
  * **A ticket reference is a credential**, exactly like an order number: a
    guest with the reference can read their own thread. So it is 8 random
    characters from an unambiguous alphabet, never sequential — a counter would
    let anyone read every other customer's support history by counting.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

STATUSES = ("open", "pending_customer", "resolved", "closed")
PRIORITIES = ("low", "normal", "high", "urgent")
CATEGORIES = ("general", "order", "delivery", "payment", "refund", "product",
              "technical")

# Same alphabet as order numbers: no O/0, no I/1/L, because these get read out
# over the phone.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

STATUS_LABELS = {
    "open": "Open",
    "pending_customer": "Waiting for your reply",
    "resolved": "Resolved",
    "closed": "Closed",
}


class TicketError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _new_reference() -> str:
    return "TK-" + "".join(secrets.choice(_ALPHABET) for _ in range(8))


def create(
    *,
    email: str,
    subject: str,
    body: str,
    name: str = "",
    phone: str = "",
    category: str = "general",
    customer_id: str | None = None,
    order_number: str | None = None,
) -> dict:
    if not subject.strip():
        raise TicketError("A subject is required")
    if not body.strip():
        raise TicketError("Tell us what the problem is")
    if category not in CATEGORIES:
        category = "general"

    order_id = None
    if order_number:
        row = query_one(
            "SELECT id FROM orders WHERE order_number = ?", (order_number.strip(),)
        )
        # An unknown order number does not reject the ticket — the customer may
        # have mistyped it, and refusing to accept a support request over that
        # is how someone gives up and phones instead.
        order_id = row["id"] if row else None

    ticket_id = f"tkt_{secrets.token_hex(8)}"
    reference = _new_reference()

    with transaction() as conn:
        while conn.execute(
            "SELECT 1 FROM tickets WHERE reference = ?", (reference,)
        ).fetchone():
            reference = _new_reference()

        conn.execute(
            "INSERT INTO tickets (id, reference, customer_id, order_id, email,"
            " name, phone, subject, category, status, priority, created_at,"
            " updated_at, last_customer_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,'open','normal',?,?,?)",
            (ticket_id, reference, customer_id, order_id, email.strip().lower(),
             name[:120], phone[:20], subject[:300], category,
             _now(), _now(), _now()),
        )
        conn.execute(
            "INSERT INTO ticket_messages (id, ticket_id, author_kind, author_id,"
            " author_name, body, is_internal, created_at)"
            " VALUES (?,?,'customer',?,?,?,0,?)",
            (f"msg_{secrets.token_hex(8)}", ticket_id, customer_id,
             name[:120] or "Customer", body[:8000], _now()),
        )
    log.info("Ticket %s opened (%s)", reference, category)
    try:
        from app.services import notifications

        notifications.ticket_opened(reference, subject[:80])
    except Exception:  # noqa: BLE001
        log.exception("Ticket notification failed for %s", reference)

    ticket = get(reference) or {}

    # Email is best-effort and deliberately AFTER the commit: the ticket is
    # already saved, so a mail failure loses a notification, never the
    # customer's message. Both are queued rather than sent inline — SMTP from
    # inside a request is how a form ends up taking eight seconds.
    try:
        from app.services import mailer

        mailer.send_ticket_opened_staff(ticket, message=body[:8000])
    except Exception:  # noqa: BLE001
        log.exception("Staff ticket email failed for %s", reference)
    try:
        from app.services import mailer

        mailer.send_ticket_ack(ticket)
    except Exception:  # noqa: BLE001
        log.exception("Ticket acknowledgement failed for %s", reference)

    return ticket


def get(reference: str) -> dict | None:
    row = query_one("SELECT * FROM tickets WHERE reference = ?", (reference.strip(),))
    if row is None:
        return None
    ticket = dict(row)
    ticket["statusLabel"] = STATUS_LABELS.get(ticket["status"], ticket["status"])
    return ticket


def thread(reference: str, *, include_internal: bool = False) -> list[dict]:
    """Messages, oldest first.

    `include_internal` defaults to FALSE. Every customer-facing caller gets the
    safe answer without having to remember to ask for it — the reverse default
    would leak an internal note the first time someone forgot.
    """
    ticket = get(reference)
    if ticket is None:
        return []
    sql = "SELECT * FROM ticket_messages WHERE ticket_id = ?"
    if not include_internal:
        sql += " AND is_internal = 0"
    sql += " ORDER BY created_at, id"
    return [
        {
            "id": m["id"],
            "author": m["author_name"],
            "kind": m["author_kind"],
            "body": m["body"],
            "isInternal": bool(m["is_internal"]),
            "at": m["created_at"],
        }
        for m in query(sql, (ticket["id"],))
    ]


def reply(
    reference: str,
    body: str,
    *,
    author_kind: str,
    author_id: str | None = None,
    author_name: str = "",
    is_internal: bool = False,
) -> dict:
    if author_kind not in ("customer", "staff", "system"):
        raise TicketError("Unknown author kind")
    if not body.strip():
        raise TicketError("An empty reply is not a reply")
    if is_internal and author_kind != "staff":
        # Only staff can write staff-only notes. Without this a crafted customer
        # request could hide its own message from the support queue.
        raise TicketError("Only staff can add internal notes")

    ticket = get(reference)
    if ticket is None:
        raise TicketError("No such ticket")
    if ticket["status"] == "closed" and author_kind == "customer":
        raise TicketError(
            "This ticket is closed. Please open a new one and we will pick it up."
        )

    with transaction() as conn:
        conn.execute(
            "INSERT INTO ticket_messages (id, ticket_id, author_kind, author_id,"
            " author_name, body, is_internal, created_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (f"msg_{secrets.token_hex(8)}", ticket["id"], author_kind, author_id,
             author_name[:120] or ("Support" if author_kind == "staff" else "Customer"),
             body[:8000], 1 if is_internal else 0, _now()),
        )

        sets = ["updated_at = ?"]
        params: list = [_now()]

        if author_kind == "customer":
            sets.append("last_customer_at = ?")
            params.append(_now())
            # A customer reply reopens a resolved ticket. "Resolved" is our
            # opinion; the customer writing back is evidence against it.
            if ticket["status"] in ("resolved", "pending_customer"):
                sets.append("status = 'open'")
        elif author_kind == "staff" and not is_internal:
            sets.append("last_staff_at = ?")
            params.append(_now())
            # First response time is the number support is judged on, and it
            # cannot be reconstructed once a ticket has been reopened.
            if not ticket["first_response_at"]:
                sets.append("first_response_at = ?")
                params.append(_now())
            if ticket["status"] == "open":
                sets.append("status = 'pending_customer'")

        params.append(ticket["id"])
        conn.execute(f"UPDATE tickets SET {', '.join(sets)} WHERE id = ?", params)

    return get(reference) or {}


def set_status(
    reference: str, status: str, *, actor_id: str | None = None,
    actor_name: str = "Support",
) -> dict:
    if status not in STATUSES:
        raise TicketError(f"Unknown status {status!r}")
    ticket = get(reference)
    if ticket is None:
        raise TicketError("No such ticket")
    if ticket["status"] == status:
        return ticket

    sets = ["status = ?", "updated_at = ?"]
    params: list = [status, _now()]
    if status == "resolved" and not ticket["resolved_at"]:
        sets.append("resolved_at = ?")
        params.append(_now())
    if status == "closed" and not ticket["closed_at"]:
        sets.append("closed_at = ?")
        params.append(_now())
    params.append(ticket["id"])

    with transaction() as conn:
        conn.execute(f"UPDATE tickets SET {', '.join(sets)} WHERE id = ?", params)
        # Recorded in the thread itself, so the customer sees "marked resolved"
        # in sequence rather than the status silently changing under them.
        conn.execute(
            "INSERT INTO ticket_messages (id, ticket_id, author_kind, author_id,"
            " author_name, body, is_internal, created_at)"
            " VALUES (?,?,'system',?,?,?,0,?)",
            (f"msg_{secrets.token_hex(8)}", ticket["id"], actor_id, actor_name,
             f"Ticket marked {STATUS_LABELS.get(status, status).lower()}.",
             _now()),
        )
    return get(reference) or {}


def assign(reference: str, assignee_id: str | None) -> dict:
    ticket = get(reference)
    if ticket is None:
        raise TicketError("No such ticket")
    with transaction() as conn:
        conn.execute(
            "UPDATE tickets SET assignee_id = ?, updated_at = ? WHERE id = ?",
            (assignee_id, _now(), ticket["id"]),
        )
    return get(reference) or {}


def set_priority(reference: str, priority: str) -> dict:
    if priority not in PRIORITIES:
        raise TicketError(f"Unknown priority {priority!r}")
    ticket = get(reference)
    if ticket is None:
        raise TicketError("No such ticket")
    with transaction() as conn:
        conn.execute(
            "UPDATE tickets SET priority = ?, updated_at = ? WHERE id = ?",
            (priority, _now(), ticket["id"]),
        )
    return get(reference) or {}


def queue(status: str | None = None, limit: int = 100) -> list[dict]:
    """The admin work list. Urgent first, then oldest-updated."""
    sql = "SELECT * FROM tickets"
    params: list = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += (
        " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1"
        " WHEN 'normal' THEN 2 ELSE 3 END, updated_at ASC LIMIT ?"
    )
    params.append(int(limit))
    return [
        {
            **dict(r),
            "statusLabel": STATUS_LABELS.get(r["status"], r["status"]),
            "messageCount": query_one(
                "SELECT COUNT(*) n FROM ticket_messages WHERE ticket_id = ?",
                (r["id"],),
            )["n"],
        }
        for r in query(sql, params)
    ]


def for_customer(customer_id: str, email: str = "") -> list[dict]:
    """A signed-in customer's tickets, including any opened as a guest.

    Matched on the account OR its email, so someone who wrote in before
    registering still sees that conversation.
    """
    rows = query(
        "SELECT * FROM tickets WHERE customer_id = ? OR (email = ? AND ? <> '')"
        " ORDER BY updated_at DESC",
        (customer_id, (email or "").lower(), email or ""),
    )
    return [
        {
            "reference": r["reference"],
            "subject": r["subject"],
            "category": r["category"],
            "status": r["status"],
            "statusLabel": STATUS_LABELS.get(r["status"], r["status"]),
            "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
        }
        for r in rows
    ]


def public_view(ticket: dict | None) -> dict | None:
    """Whitelisted. `assignee_id` is a staff id and is nobody's business."""
    if not ticket:
        return None
    return {
        "reference": ticket["reference"],
        "subject": ticket["subject"],
        "category": ticket["category"],
        "status": ticket["status"],
        "statusLabel": ticket["statusLabel"],
        "createdAt": ticket["created_at"],
        "updatedAt": ticket["updated_at"],
    }


def stats() -> dict:
    rows = query("SELECT status, COUNT(*) n FROM tickets GROUP BY status")
    by_status = {r["status"]: r["n"] for r in rows}
    unanswered = query_one(
        "SELECT COUNT(*) n FROM tickets WHERE first_response_at IS NULL"
        " AND status NOT IN ('closed','resolved')"
    )["n"]
    return {"byStatus": by_status, "awaitingFirstReply": unanswered}
