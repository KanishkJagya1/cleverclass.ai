"""Customer administration: search, detail, and the destructive actions.

Distinct from staff management, which decides who can log into the ADMIN. This
is about the people who buy books.

THE RULE THAT SHAPES THE DELETE PATH

**Anonymise, never delete.** A customer's right to erasure is real, and so is
the shop's legal duty to keep records of what it sold and to whom it invoiced.
`anonymise()` scrubs the identifying columns and leaves the order rows, their
totals and their invoices intact — so a tax audit still reconciles and the
person is gone. A hard DELETE would cascade through `orders` and silently
destroy the financial history the business is required to hold.

Everything here is read through a whitelist. `password_hash` exists on the row
and must never appear in a response, not even to an admin: staff have no use
for it and a leaked panel response should not carry one.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)


class CustomerAdminError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _summary(row: dict) -> dict:
    """List-row shape. Deliberately no address — a list screen does not need
    every customer's home address on it, and a screenshot of one is a leak."""
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "emailVerified": bool(row["email_verified_at"]),
        "status": row["status"],
        "marketingOptIn": bool(row["marketing_opt_in"]),
        "createdAt": row["created_at"],
        "lastLoginAt": row["last_login_at"],
        "orderCount": row["order_count"],
        "totalSpend": row["total_spend"] or 0,
    }


def search(
    term: str = "",
    *,
    status: str | None = None,
    marketing_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Find customers by name, email or phone.

    Spend counts only orders that were not cancelled — showing a refunded or
    abandoned order as revenue makes the "top customers" list a lie.
    """
    clauses: list[str] = []
    params: list = []

    if term.strip():
        like = f"%{term.strip().lower()}%"
        clauses.append(
            "(LOWER(c.name) LIKE ? OR c.email_norm LIKE ? OR c.phone LIKE ?)"
        )
        params.extend([like, like, like])
    if status:
        clauses.append("c.status = ?")
        params.append(status)
    if marketing_only:
        clauses.append("c.marketing_opt_in = 1")

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = query(
        f"""
        SELECT c.*,
               (SELECT COUNT(*) FROM orders o
                 WHERE o.customer_id = c.id AND o.status != 'cancelled')
                 AS order_count,
               (SELECT COALESCE(SUM(o.total), 0) FROM orders o
                 WHERE o.customer_id = c.id AND o.status != 'cancelled')
                 AS total_spend
          FROM customers c
          {where}
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?
        """,
        [*params, int(limit), int(offset)],
    )
    total = query_one(
        f"SELECT COUNT(*) n FROM customers c {where}", params
    )["n"]
    return {"customers": [_summary(dict(r)) for r in rows], "total": total}


def detail(customer_id: str) -> dict | None:
    """Everything staff need on one screen, and nothing they do not."""
    row = query_one("SELECT * FROM customers WHERE id = ?", (customer_id,))
    if row is None:
        return None
    customer = dict(row)

    orders = [
        {
            "orderNumber": o["order_number"], "status": o["status"],
            "paymentStatus": o["payment_status"], "total": o["total"],
            "discount": o["discount"], "couponCode": o["coupon_code"],
            "createdAt": o["created_at"],
        }
        for o in query(
            "SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC"
            " LIMIT 100",
            (customer_id,),
        )
    ]
    reviews = [
        {"id": r["id"], "productSlug": r["product_slug"], "rating": r["rating"],
         "status": r["status"], "date": r["date"]}
        for r in query(
            "SELECT * FROM reviews WHERE customer_id = ? ORDER BY date DESC LIMIT 50",
            (customer_id,),
        )
    ]
    tickets = [
        {"reference": t["reference"], "subject": t["subject"],
         "status": t["status"], "updatedAt": t["updated_at"]}
        for t in query(
            "SELECT * FROM tickets WHERE customer_id = ? ORDER BY updated_at DESC"
            " LIMIT 50",
            (customer_id,),
        )
    ]
    sessions = query_one(
        "SELECT COUNT(*) n FROM customer_sessions WHERE customer_id = ?"
        " AND expires_at > ?",
        (customer_id, _now()),
    )["n"]

    return {
        "customer": {
            "id": customer["id"],
            "name": customer["name"],
            "email": customer["email"],
            "phone": customer["phone"],
            "emailVerified": bool(customer["email_verified_at"]),
            "hasPassword": bool(customer["password_hash"]),
            "hasGoogle": bool(customer["google_sub"]),
            "status": customer["status"],
            "marketingOptIn": bool(customer["marketing_opt_in"]),
            "address": {
                "line1": customer["address_line1"],
                "line2": customer["address_line2"],
                "city": customer["city"],
                "state": customer["state"],
                "pincode": customer["pincode"],
            },
            "createdAt": customer["created_at"],
            "lastLoginAt": customer["last_login_at"],
            "failedLogins": customer["failed_logins"],
            "lockedUntil": customer["locked_until"],
            "activeSessions": sessions,
        },
        "orders": orders,
        "reviews": reviews,
        "tickets": tickets,
        "stats": {
            "orderCount": len([o for o in orders if o["status"] != "cancelled"]),
            "totalSpend": sum(
                o["total"] for o in orders if o["status"] != "cancelled"
            ),
        },
    }


def set_status(customer_id: str, status: str, *, actor_id: str) -> dict:
    if status not in ("active", "disabled"):
        raise CustomerAdminError("Status must be active or disabled")
    if query_one("SELECT id FROM customers WHERE id = ?", (customer_id,)) is None:
        raise CustomerAdminError("No such customer")

    with transaction() as conn:
        conn.execute(
            "UPDATE customers SET status = ?, updated_at = ? WHERE id = ?",
            (status, _now(), customer_id),
        )
        if status == "disabled":
            # Access ends now, not whenever the cookie expires. Leaving live
            # sessions after disabling an account is the same mistake as not
            # revoking a sacked employee's badge until it wears out.
            conn.execute(
                "DELETE FROM customer_sessions WHERE customer_id = ?", (customer_id,)
            )
    log.info("Customer %s set to %s by %s", customer_id, status, actor_id)
    return detail(customer_id) or {}


def set_marketing(customer_id: str, opted_in: bool, *, actor_id: str) -> dict:
    """Change marketing consent on the customer's behalf.

    Audited by the caller. Consent is a legal record: an admin turning it ON
    without the customer asking is the kind of thing a regulator asks to see
    evidence for, which is exactly why the audit row is not optional.
    """
    with transaction() as conn:
        conn.execute(
            "UPDATE customers SET marketing_opt_in = ?, updated_at = ? WHERE id = ?",
            (1 if opted_in else 0, _now(), customer_id),
        )
    return detail(customer_id) or {}


def export_one(customer_id: str) -> dict:
    """Everything held about one person — a data-subject access request.

    Deliberately complete where the admin screens are selective: the point of
    this file is that it IS everything, so a partial export would defeat it.
    """
    data = detail(customer_id)
    if data is None:
        raise CustomerAdminError("No such customer")

    customer = query_one("SELECT * FROM customers WHERE id = ?", (customer_id,))
    email_norm = customer["email_norm"]

    return {
        "exportedAt": _now(),
        "customer": data["customer"],
        "orders": [
            dict(o)
            for o in query(
                "SELECT * FROM orders WHERE customer_id = ? OR LOWER(email) = ?",
                (customer_id, email_norm),
            )
        ],
        "reviews": data["reviews"],
        "tickets": data["tickets"],
        "emails": [
            {"subject": e["subject"], "kind": e["kind"], "status": e["status"],
             "createdAt": e["created_at"]}
            for e in query(
                "SELECT * FROM email_outbox WHERE LOWER(to_email) = ?", (email_norm,)
            )
        ],
    }


def anonymise(customer_id: str, *, actor_id: str) -> dict:
    """Erase the person, keep the accounting.

    Identifying columns are scrubbed and every session and token destroyed. The
    ORDERS SURVIVE, with their totals and invoices — a shop is legally required
    to keep records of what it sold, and a hard delete would cascade through
    `orders` and destroy them. The order rows keep an anonymous name so an
    invoice issued last year still reconciles.

    Not reversible. The caller confirms.
    """
    customer = query_one("SELECT * FROM customers WHERE id = ?", (customer_id,))
    if customer is None:
        raise CustomerAdminError("No such customer")
    if customer["status"] == "deleted":
        raise CustomerAdminError("This customer is already anonymised")

    tombstone = f"deleted-{secrets.token_hex(6)}@removed.invalid"
    with transaction() as conn:
        conn.execute(
            "UPDATE customers SET"
            "  name = 'Removed', email = ?, email_norm = ?, phone = '',"
            "  password_hash = NULL, google_sub = NULL, avatar_url = NULL,"
            "  address_line1 = '', address_line2 = '', city = '', state = '',"
            "  pincode = '', marketing_opt_in = 0, status = 'disabled',"
            "  updated_at = ?"
            " WHERE id = ?",
            (tombstone, tombstone, _now(), customer_id),
        )
        conn.execute("DELETE FROM customer_sessions WHERE customer_id = ?", (customer_id,))
        conn.execute("DELETE FROM email_tokens WHERE customer_id = ?", (customer_id,))
        # Saved addresses hold the person's name, phone and street — exactly
        # what this function exists to remove. They do NOT cascade, because the
        # customer row is updated rather than deleted, so they have to be dealt
        # with explicitly. Scrubbed AND soft-deleted rather than dropped:
        # `orders.address_id` points here, and a hard delete would break the
        # link on the financial records we are deliberately keeping.
        conn.execute(
            "UPDATE addresses SET label = 'Removed', name = 'Removed', phone = '',"
            "  line1 = '', line2 = '', city = '', state = '', pincode = '',"
            "  is_default = 0, deleted_at = COALESCE(deleted_at, ?), updated_at = ?"
            " WHERE customer_id = ?",
            (_now(), _now(), customer_id),
        )
        # Orders keep their financial columns and lose the personal ones.
        conn.execute(
            "UPDATE orders SET customer_name = 'Removed', phone = '', email = '',"
            "  address_line1 = '', address_line2 = '', notes = ''"
            " WHERE customer_id = ?",
            (customer_id,),
        )
        # Reviews stay published — they are about the book, not the person —
        # but stop carrying a name.
        conn.execute(
            "UPDATE reviews SET author = 'Removed' WHERE customer_id = ?",
            (customer_id,),
        )
        conn.execute(
            "UPDATE tickets SET name = 'Removed', email = ?, phone = ''"
            " WHERE customer_id = ?",
            (tombstone, customer_id),
        )
    log.warning("Customer %s anonymised by %s", customer_id, actor_id)
    return {"ok": True, "id": customer_id}


def stats() -> dict:
    total = query_one("SELECT COUNT(*) n FROM customers")["n"]
    verified = query_one(
        "SELECT COUNT(*) n FROM customers WHERE email_verified_at IS NOT NULL"
    )["n"]
    opted_in = query_one(
        "SELECT COUNT(*) n FROM customers WHERE marketing_opt_in = 1"
    )["n"]
    with_orders = query_one(
        "SELECT COUNT(DISTINCT customer_id) n FROM orders WHERE customer_id IS NOT NULL"
    )["n"]
    return {
        "total": total,
        "verified": verified,
        "marketingOptIn": opted_in,
        "withOrders": with_orders,
    }
