"""In-app notifications.

The pull channel, next to email's push. It matters more than usual here: SMTP
is not configured, so this is currently the ONLY way a new order or a waiting
payment reaches the shop owner. It keeps working when mail does not.

DEDUPED BY (audience, kind, entity_id). A retried webhook, a double-clicked
admin action or a job that runs twice produces one bell, not three — enforced by
a partial unique index rather than by remembering to check first.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

SEVERITIES = ("info", "warning", "urgent")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def notify(
    *,
    audience: str,
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    severity: str = "info",
    entity: str | None = None,
    entity_id: str | None = None,
    admin_id: str | None = None,
    customer_id: str | None = None,
) -> str | None:
    """Create a notification. Returns its id, or None if it was a duplicate.

    NEVER raises. A notification is a side effect of something more important —
    an order being placed, a payment arriving — and failing to record the bell
    must not fail the thing itself.
    """
    if audience not in ("admin", "customer"):
        return None
    if severity not in SEVERITIES:
        severity = "info"

    notification_id = f"ntf_{secrets.token_hex(8)}"
    try:
        with transaction() as conn:
            cursor = conn.execute(
                "INSERT INTO notifications (id, audience, admin_id, customer_id,"
                " kind, title, body, link, severity, entity, entity_id, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT DO NOTHING",
                (notification_id, audience, admin_id, customer_id, kind,
                 title[:200], body[:1000], link[:300], severity, entity,
                 entity_id, _now()),
            )
            if cursor.rowcount == 0:
                return None
    except Exception:  # noqa: BLE001
        log.exception("Could not record notification %s/%s", audience, kind)
        return None
    return notification_id


def for_admin(admin_id: str | None = None, *, unread_only: bool = False,
              limit: int = 50, page: int = 1) -> dict:
    """Staff notifications: those addressed to everyone, plus this admin's own."""
    clauses = ["audience = 'admin'"]
    params: list = []
    if admin_id:
        clauses.append("(admin_id IS NULL OR admin_id = ?)")
        params.append(admin_id)
    else:
        clauses.append("admin_id IS NULL")
    if unread_only:
        clauses.append("read_at IS NULL")

    where = " AND ".join(clauses)
    total = query_one(
        f"SELECT COUNT(*) n FROM notifications WHERE {where}", params
    )["n"]
    rows = query(
        f"SELECT * FROM notifications WHERE {where}"
        " ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [*params, int(limit), (int(page) - 1) * int(limit)],
    )
    # Counted across ALL unread, not just this page — it drives the bell badge,
    # which must not shrink because the operator turned to page two.
    unread = query_one(
        "SELECT COUNT(*) n FROM notifications WHERE audience = 'admin'"
        " AND read_at IS NULL"
    )["n"]
    items = [_public(dict(r)) for r in rows]
    return {
        "items": items,
        "notifications": items,  # legacy key, kept while the UI migrates
        "unread": unread,
        "total": total,
        "page": page,
        "perPage": limit,
        "totalPages": (total + limit - 1) // limit if total else 0,
    }


def for_customer(customer_id: str, *, unread_only: bool = False,
                 limit: int = 50) -> dict:
    clauses = ["audience = 'customer'", "customer_id = ?"]
    params: list = [customer_id]
    if unread_only:
        clauses.append("read_at IS NULL")
    rows = query(
        f"SELECT * FROM notifications WHERE {' AND '.join(clauses)}"
        " ORDER BY created_at DESC LIMIT ?",
        [*params, int(limit)],
    )
    unread = query_one(
        "SELECT COUNT(*) n FROM notifications WHERE customer_id = ?"
        " AND read_at IS NULL",
        (customer_id,),
    )["n"]
    return {"notifications": [_public(dict(r)) for r in rows], "unread": unread}


def _public(row: dict) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "title": row["title"],
        "body": row["body"],
        "link": row["link"],
        "severity": row["severity"],
        "entity": row["entity"],
        "entityId": row["entity_id"],
        "read": row["read_at"] is not None,
        "createdAt": row["created_at"],
    }


def mark_read(notification_id: str, *, customer_id: str | None = None) -> bool:
    """Mark one as read.

    When `customer_id` is given the update is SCOPED to it, so a customer
    cannot mark somebody else's notification read by guessing an id.
    """
    sql = "UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL"
    params: list = [_now(), notification_id]
    if customer_id:
        sql += " AND customer_id = ?"
        params.append(customer_id)
    with transaction() as conn:
        return (conn.execute(sql, params).rowcount or 0) > 0


def mark_all_read(*, audience: str, customer_id: str | None = None) -> int:
    sql = "UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND audience = ?"
    params: list = [_now(), audience]
    if customer_id:
        sql += " AND customer_id = ?"
        params.append(customer_id)
    with transaction() as conn:
        return conn.execute(sql, params).rowcount or 0


# ----------------------------------------------------------- event helpers --
#
# Named helpers rather than raw notify() calls at each site, so the wording and
# the link shape for an event are defined once.

def order_placed(order_number: str, total: int, customer_name: str) -> None:
    notify(
        audience="admin", kind="order.new",
        title=f"New order {order_number}",
        body=f"{customer_name} · ₹{total}",
        link=f"/admin/orders/{order_number}",
        severity="info", entity="order", entity_id=order_number,
    )


def payment_awaiting(order_number: str, amount: int) -> None:
    notify(
        audience="admin", kind="payment.awaiting",
        title=f"Payment to verify for {order_number}",
        body=f"₹{amount} submitted by the customer",
        link="/admin/payments",
        severity="warning", entity="payment", entity_id=order_number,
    )


def low_stock(slug: str, title: str, qty: int) -> None:
    notify(
        audience="admin", kind="stock.low",
        title=f"Low stock: {title}",
        body=f"{qty} left",
        link=f"/admin/books/{slug}",
        severity="warning", entity="book", entity_id=slug,
    )


def ticket_opened(reference: str, subject: str, priority: str = "normal") -> None:
    notify(
        audience="admin", kind="ticket.new",
        title=f"Support: {subject}",
        body=reference,
        link=f"/admin/support/{reference}",
        severity="urgent" if priority in ("high", "urgent") else "info",
        entity="ticket", entity_id=reference,
    )


def review_pending(review_id: str, product_slug: str) -> None:
    notify(
        audience="admin", kind="review.pending",
        title="A review is waiting for moderation",
        body=product_slug,
        link="/admin/reviews",
        severity="info", entity="review", entity_id=review_id,
    )


def order_status_changed(
    customer_id: str | None, order_number: str, status_label: str
) -> None:
    if not customer_id:
        return  # guest orders have nowhere to show a bell
    notify(
        audience="customer", customer_id=customer_id,
        kind=f"order.{status_label.lower().replace(' ', '_')}",
        title=f"Order {order_number}: {status_label}",
        link=f"/account/orders",
        severity="info", entity="order", entity_id=f"{order_number}:{status_label}",
    )
