"""Outbound email.

DESIGN RULE: the database row comes first, the send attempt second.

Every message is written to `email_outbox` before anything touches SMTP, and
the send only flips a status on that row. This buys three things that matter
more than elegance here:

  * With no SMTP configured the product still works end to end. Mail lands in
    the outbox as `skipped` with the link recorded, so sign-up and password
    reset are testable and recoverable on day one — the owner can read the link
    out of the admin panel and send it by hand.
  * "Did the reset email actually go out?" is answerable. A support question
    that would otherwise be pure guesswork becomes one SELECT.
  * An SMTP outage degrades to a queue instead of losing registrations. The
    rows stay `queued` and can be retried.

Stdlib `smtplib` on purpose: no paid API, no SDK, no extra dependency.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets
import smtplib
import ssl
from email.message import EmailMessage

from app.config import settings
from app.db.conn import query, transaction

log = logging.getLogger(__name__)


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from)


def queue(
    *,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    kind: str = "verify",
    related_id: str | None = None,
) -> str:
    message_id = f"eml_{secrets.token_hex(8)}"
    with transaction() as conn:
        conn.execute(
            "INSERT INTO email_outbox"
            " (id, to_email, subject, body_text, body_html, kind, status,"
            "  related_id, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (
                message_id,
                to_email,
                subject,
                body_text,
                body_html,
                kind,
                "queued" if configured() else "skipped",
                related_id,
                _now(),
            ),
        )
    if not configured():
        # Loud on purpose. A silently-unsent verification email is the kind of
        # thing that is discovered by a customer, not by us.
        log.warning(
            "SMTP is not configured — email %s (%s) to %s was queued as SKIPPED. "
            "The link is in email_outbox.body_text.",
            message_id,
            kind,
            to_email,
        )
    return message_id


def send_one(message_id: str) -> bool:
    rows = query("SELECT * FROM email_outbox WHERE id = ?", (message_id,))
    if not rows:
        return False
    row = dict(rows[0])
    if row["status"] == "sent" or not configured():
        return False

    message = EmailMessage()
    message["Subject"] = row["subject"]
    message["From"] = settings.smtp_from
    message["To"] = row["to_email"]
    message.set_content(row["body_text"])
    if row["body_html"]:
        message.add_alternative(row["body_html"], subtype="html")

    try:
        if settings.smtp_use_ssl:
            server = smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port, timeout=20,
                context=ssl.create_default_context(),
            )
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
        with server:
            if settings.smtp_use_tls and not settings.smtp_use_ssl:
                server.starttls(context=ssl.create_default_context())
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password or "")
            server.send_message(message)
    except Exception as exc:  # noqa: BLE001 — every failure mode is a failed send
        log.exception("Email %s to %s failed", message_id, row["to_email"])
        with transaction() as conn:
            conn.execute(
                "UPDATE email_outbox SET status = 'failed', error = ?,"
                " attempts = attempts + 1 WHERE id = ?",
                (str(exc)[:400], message_id),
            )
        return False

    with transaction() as conn:
        conn.execute(
            "UPDATE email_outbox SET status = 'sent', sent_at = ?,"
            " attempts = attempts + 1, error = NULL WHERE id = ?",
            (_now(), message_id),
        )
    return True


def send_queued(limit: int = 50) -> dict:
    """Drain the queue. Safe to call repeatedly; used at boot and by a cron."""
    if not configured():
        return {"sent": 0, "failed": 0, "skipped": True}
    rows = query(
        "SELECT id FROM email_outbox WHERE status IN ('queued','failed')"
        " AND attempts < 5 ORDER BY created_at LIMIT ?",
        (int(limit),),
    )
    sent = failed = 0
    for row in rows:
        if send_one(row["id"]):
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed, "skipped": False}


# ------------------------------------------------------------- templates --
#
# Plain text is the source of truth and is always populated. HTML is a
# progressive enhancement — a mail client that refuses it still shows a
# working link, which is the only part that actually matters.

def _shell(title: str, body: str, cta_label: str, cta_url: str) -> str:
    return f"""\
<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;
 font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
 <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;
   padding:32px;border:1px solid #e2e8f0">
  <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;
    text-transform:uppercase;color:#6366f1;font-weight:600">CleverClass.AI</p>
  <h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">{title}</h1>
  <div style="font-size:15px;line-height:1.6;color:#334155">{body}</div>
  <p style="margin:28px 0 0">
   <a href="{cta_url}" style="display:inline-block;background:#4f46e5;color:#fff;
     text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600"
     >{cta_label}</a>
  </p>
  <p style="margin:24px 0 0;font-size:13px;color:#64748b">
   If the button does not work, paste this into your browser:<br>
   <span style="word-break:break-all">{cta_url}</span></p>
  <p style="margin:24px 0 0;font-size:13px;color:#94a3b8">
   {settings.company_name} · {settings.company_phone}</p>
 </div></body></html>"""


def send_verification(customer: dict, link: str) -> str:
    name = customer.get("name") or "there"
    return queue(
        to_email=customer["email"],
        subject="Confirm your email — CleverClass.AI",
        body_text=(
            f"Hi {name},\n\nConfirm your email address to finish setting up your "
            f"CleverClass.AI account:\n\n{link}\n\n"
            "The link is valid for 48 hours. If you did not create an account, "
            "you can ignore this message.\n"
        ),
        body_html=_shell(
            "Confirm your email",
            f"<p>Hi {name}, confirm your email address to finish setting up your "
            "account. The link is valid for 48 hours.</p>",
            "Confirm email",
            link,
        ),
        kind="verify",
        related_id=customer["id"],
    )


def send_password_reset(customer: dict, link: str) -> str:
    name = customer.get("name") or "there"
    return queue(
        to_email=customer["email"],
        subject="Reset your password — CleverClass.AI",
        body_text=(
            f"Hi {name},\n\nReset your CleverClass.AI password here:\n\n{link}\n\n"
            "The link is valid for 60 minutes and can be used once. If you did "
            "not ask for this, nothing has changed and you can ignore it.\n"
        ),
        body_html=_shell(
            "Reset your password",
            f"<p>Hi {name}, use the button below to choose a new password. The "
            "link is valid for 60 minutes and can be used once.</p><p>If you did "
            "not ask for this, nothing has changed.</p>",
            "Choose a new password",
            link,
        ),
        kind="reset",
        related_id=customer["id"],
    )


def send_order_confirmation(order: dict, link: str) -> str | None:
    if not order.get("email"):
        return None
    titles = "\n".join(
        f"  - {i['title']} x{i['qty']}  Rs.{i['price']}" for i in order.get("items", [])
    )
    # "Order request received", never "Order placed". Nothing has been paid and
    # nothing is committed until someone calls to confirm — saying otherwise is
    # how a shop loses an order and finds out from an angry phone call.
    return queue(
        to_email=order["email"],
        subject=f"Order request {order['orderNumber']} received — CleverClass.AI",
        body_text=(
            f"Hi {order.get('customerName') or 'there'},\n\n"
            f"We have your order request {order['orderNumber']}.\n\n"
            f"{titles}\n\n"
            f"  Subtotal Rs.{order.get('subtotal')}\n"
            f"  Shipping Rs.{order.get('shipping')}\n"
            f"  Total    Rs.{order.get('total')}\n\n"
            "We will call you to confirm the books and the total before "
            f"dispatch.\n\nTrack it here:\n{link}\n"
        ),
        body_html=_shell(
            f"Order request {order['orderNumber']} received",
            "<p>We have your order request. We will call you to confirm the "
            "books and the total before dispatch.</p>"
            f"<p><strong>Total Rs.{order.get('total')}</strong></p>",
            "Track this order",
            link,
        ),
        kind="order",
        related_id=order.get("id"),
    )
