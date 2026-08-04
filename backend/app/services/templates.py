"""Email templates a non-coder can edit safely.

⚠ THE SECURITY DECISION THAT SHAPES THIS WHOLE MODULE

Placeholders are **substituted, never evaluated**. `{{customer_name}}` is
replaced by `str.replace` against an explicit allow-list of keys. This must
never become Jinja, `str.format`, f-strings or `eval`:

  * Jinja from a web form is server-side template injection. `{{
    ''.__class__.__mro__[1].__subclasses__() }}` walks to arbitrary code, and
    the person typing it is precisely the person we invited to edit templates.
  * `str.format` is nearly as bad: `{a.__class__.__init__.__globals__}` reads
    application config, including the SMTP password and the Razorpay secret.

Substitution cannot do any of that. The cost is that templates have no loops or
conditionals — which is the correct trade for a form a shop owner uses.

TWO MORE RULES

  * **Every template has a built-in default.** A shop that breaks its own
    password-reset template must not stop being able to reset passwords, so an
    inactive or missing row falls back to code.
  * **An unknown placeholder blocks the send.** Rendering `{{custmer_name}}` as
    an empty gap means a live customer gets "Hi ," — the typo has to surface in
    the preview, not the inbox.
"""

from __future__ import annotations

import datetime as dt
import html
import logging
import re
import secrets

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")

# Tags a shop owner might reasonably use, and nothing that executes. Note the
# absence of `script`, `iframe`, `object`, `embed`, `form`, `style` and `link`.
_ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "blockquote", "a", "span", "div", "hr",
    "table", "tr", "td", "th", "tbody", "thead",
}
_ALLOWED_ATTRS = {"href", "title", "align", "colspan", "rowspan"}

# The templates the product sends, each with the variables it may use. The
# allow-list is PER TEMPLATE on purpose: an order email offers order variables,
# and a password-reset email must not be able to reference them at all.
CATALOGUE: dict[str, dict] = {
    "verify_email": {
        "name": "Confirm your email",
        "description": "Sent when someone signs up, and on resend.",
        "variables": ["customer_name", "verify_link", "company_name", "company_phone"],
        "subject": "Confirm your email — {{company_name}}",
        "body": (
            "<p>Hi {{customer_name}},</p>"
            "<p>Confirm your email address to finish setting up your account.</p>"
            "<p><a href=\"{{verify_link}}\">Confirm email</a></p>"
            "<p>The link is valid for 48 hours.</p>"
        ),
    },
    "reset_password": {
        "name": "Reset your password",
        "description": "Sent when a password reset is requested.",
        "variables": ["customer_name", "reset_link", "company_name", "company_phone"],
        "subject": "Reset your password — {{company_name}}",
        "body": (
            "<p>Hi {{customer_name}},</p>"
            "<p>Use the link below to choose a new password. It is valid for 60 "
            "minutes and can be used once.</p>"
            "<p><a href=\"{{reset_link}}\">Choose a new password</a></p>"
            "<p>If you did not ask for this, nothing has changed.</p>"
        ),
    },
    "order_received": {
        "name": "Order request received",
        "description": "Sent as soon as an order is placed.",
        "variables": ["customer_name", "order_number", "order_total", "order_items",
                      "track_link", "company_name", "company_phone"],
        "subject": "Order {{order_number}} received — {{company_name}}",
        "body": (
            "<p>Hi {{customer_name}},</p>"
            "<p>We have your order request <strong>{{order_number}}</strong>.</p>"
            "<p>{{order_items}}</p>"
            "<p>Total: ₹{{order_total}}</p>"
            "<p>We will call you to confirm before dispatch.</p>"
            "<p><a href=\"{{track_link}}\">Track this order</a></p>"
        ),
    },
    "order_shipped": {
        "name": "Order shipped",
        "description": "Sent when a shipment is dispatched.",
        "variables": ["customer_name", "order_number", "carrier", "awb",
                      "tracking_link", "company_name", "company_phone"],
        "subject": "Order {{order_number}} is on its way",
        "body": (
            "<p>Hi {{customer_name}},</p>"
            "<p>Your order has been dispatched with {{carrier}}.</p>"
            "<p>Tracking number: <strong>{{awb}}</strong></p>"
            "<p><a href=\"{{tracking_link}}\">Track your parcel</a></p>"
        ),
    },
    "order_delivered": {
        "name": "Order delivered",
        "description": "Sent when a shipment is marked delivered.",
        "variables": ["customer_name", "order_number", "company_name", "company_phone"],
        "subject": "Order {{order_number}} delivered",
        "body": (
            "<p>Hi {{customer_name}},</p>"
            "<p>Your order {{order_number}} has been delivered. We hope the books "
            "are useful.</p>"
        ),
    },
    "payment_approved": {
        "name": "Payment approved",
        "description": "Sent when a payment is verified.",
        "variables": ["customer_name", "order_number", "order_total",
                      "company_name", "company_phone"],
        "subject": "Payment received for {{order_number}}",
        "body": (
            "<p>Hi {{customer_name}},</p>"
            "<p>We have received ₹{{order_total}} for order {{order_number}}. "
            "It is now confirmed.</p>"
        ),
    },
    "payment_rejected": {
        "name": "Payment needs attention",
        "description": "Sent when a payment is rejected or a correction is needed.",
        "variables": ["customer_name", "order_number", "reason",
                      "company_name", "company_phone"],
        "subject": "We could not verify your payment for {{order_number}}",
        "body": (
            "<p>Hi {{customer_name}},</p>"
            "<p>We could not verify the payment for {{order_number}}.</p>"
            "<p>{{reason}}</p>"
            "<p>Call us on {{company_phone}} and we will sort it out.</p>"
        ),
    },
    "ticket_reply": {
        "name": "Support reply",
        "description": "Sent when staff reply to a support ticket.",
        "variables": ["customer_name", "ticket_reference", "reply_body",
                      "ticket_link", "company_name", "company_phone"],
        "subject": "Re: your request {{ticket_reference}}",
        "body": (
            "<p>Hi {{customer_name}},</p>"
            "<p>{{reply_body}}</p>"
            "<p><a href=\"{{ticket_link}}\">View the full conversation</a></p>"
        ),
    },
}


class TemplateError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def keys() -> list[str]:
    return list(CATALOGUE)


def variables_for(key: str) -> list[str]:
    return list(CATALOGUE.get(key, {}).get("variables", []))


def sanitise(html_body: str) -> str:
    """Strip anything that can execute.

    Deliberately an ALLOW-list. A blocklist of `<script>` misses `<img
    onerror=>`, `<a href="javascript:">`, `<svg onload=>` and whatever the next
    one is. This body is also rendered in the admin preview pane, so a stored
    payload would fire against the person reviewing it.
    """
    text = html_body or ""

    # Whole elements whose content is also dangerous, not just their tags.
    text = re.sub(r"(?is)<(script|style|iframe|object|embed|form)\b.*?</\1\s*>", "", text)
    text = re.sub(r"(?is)<(script|style|iframe|object|embed|form)\b[^>]*>", "", text)
    # Event handlers and javascript: URLs.
    text = re.sub(r"(?is)\son\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", text)
    text = re.sub(r"(?is)(href|src)\s*=\s*([\"']?)\s*javascript:[^\"'>\s]*", r"\1=\2#", text)

    def _keep(match: re.Match) -> str:
        raw = match.group(0)
        closing = raw.startswith("</")
        name = (match.group(1) or "").lower()
        if name not in _ALLOWED_TAGS:
            return ""
        if closing:
            return f"</{name}>"
        attrs = []
        for attr, value in re.findall(
            r"([a-zA-Z-]+)\s*=\s*\"([^\"]*)\"", match.group(0)
        ):
            if attr.lower() in _ALLOWED_ATTRS:
                attrs.append(f'{attr.lower()}="{html.escape(value, quote=True)}"')
        return f"<{name}{(' ' + ' '.join(attrs)) if attrs else ''}>"

    return re.sub(r"</?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>", _keep, text)


def placeholders_in(text: str) -> set[str]:
    return set(_PLACEHOLDER.findall(text or ""))


def validate(key: str, subject: str, body: str) -> list[str]:
    """Returns the unknown placeholders. Empty means the template is sendable."""
    allowed = set(variables_for(key))
    used = placeholders_in(subject) | placeholders_in(body)
    return sorted(used - allowed)


def render(key: str, values: dict) -> tuple[str, str]:
    """(subject, html_body), rendered by SUBSTITUTION only.

    Raises if a placeholder has no value: an unresolved `{{name}}` reaching a
    customer's inbox as a literal, or silently as an empty gap, is worse than
    failing here where the outbox records it.
    """
    template = get(key)
    if template is None:
        raise TemplateError(f"Unknown template {key!r}")

    allowed = set(variables_for(key))
    subject, body = template["subject"], template["body"]

    used = placeholders_in(subject) | placeholders_in(body)
    unknown = used - allowed
    if unknown:
        raise TemplateError(
            f"Template {key!r} uses unknown variables: {', '.join(sorted(unknown))}"
        )
    missing = used - set(values)
    if missing:
        raise TemplateError(
            f"Template {key!r} is missing values for: {', '.join(sorted(missing))}"
        )

    for name in used:
        # Values are escaped: a customer's own name is untrusted input, and a
        # buyer called `<script>` must not become script in someone's inbox.
        replacement = html.escape(str(values.get(name, "")), quote=False)
        token = "{{" + name + "}}"
        subject = subject.replace(token, replacement)
        body = body.replace(token, replacement)
        # Tolerate whitespace inside the braces, which people type by habit.
        spaced = "{{ " + name + " }}"
        subject = subject.replace(spaced, replacement)
        body = body.replace(spaced, replacement)

    return subject, body


def get(key: str) -> dict | None:
    """The saved template, or the built-in default.

    Falling back is what stops a broken edit from disabling password resets.
    """
    row = query_one(
        "SELECT * FROM email_templates WHERE key = ? AND is_active = 1", (key,)
    )
    if row:
        return {
            "key": key,
            "subject": row["subject"],
            "body": row["body_html"],
            "source": "custom",
            "updatedAt": row["updated_at"],
        }
    default = CATALOGUE.get(key)
    if default is None:
        return None
    return {
        "key": key,
        "subject": default["subject"],
        "body": default["body"],
        "source": "default",
        "updatedAt": None,
    }


def save(key: str, subject: str, body: str, *, actor_id: str | None = None) -> dict:
    if key not in CATALOGUE:
        raise TemplateError(f"Unknown template {key!r}")
    if not subject.strip():
        raise TemplateError("A subject is required")

    unknown = validate(key, subject, body)
    if unknown:
        raise TemplateError(
            "These variables are not available in this template: "
            + ", ".join("{{" + u + "}}" for u in unknown)
            + ". Available: " + ", ".join("{{" + v + "}}" for v in variables_for(key))
        )

    clean = sanitise(body)
    with transaction() as conn:
        # Version history: the previous body is kept so a bad edit is one click
        # back rather than a retype.
        previous = conn.execute(
            "SELECT subject, body_html FROM email_templates WHERE key = ?", (key,)
        ).fetchone()
        if previous:
            conn.execute(
                "INSERT INTO email_template_versions (id, key, subject, body_html,"
                " saved_at, saved_by) VALUES (?,?,?,?,?,?)",
                (f"tv_{secrets.token_hex(6)}", key, previous["subject"],
                 previous["body_html"], _now(), actor_id),
            )
            conn.execute(
                "UPDATE email_templates SET subject = ?, body_html = ?,"
                " updated_at = ?, updated_by = ?, is_active = 1 WHERE key = ?",
                (subject[:300], clean, _now(), actor_id, key),
            )
        else:
            conn.execute(
                "INSERT INTO email_templates (key, subject, body_html, is_active,"
                " created_at, updated_at, updated_by) VALUES (?,?,?,1,?,?,?)",
                (key, subject[:300], clean, _now(), _now(), actor_id),
            )
    log.info("Email template %s saved by %s", key, actor_id)
    return get(key) or {}


def reset_to_default(key: str) -> dict:
    if key not in CATALOGUE:
        raise TemplateError(f"Unknown template {key!r}")
    with transaction() as conn:
        conn.execute("UPDATE email_templates SET is_active = 0 WHERE key = ?", (key,))
    return get(key) or {}


def history(key: str, limit: int = 10) -> list[dict]:
    return [
        {"id": r["id"], "subject": r["subject"], "savedAt": r["saved_at"]}
        for r in query(
            "SELECT * FROM email_template_versions WHERE key = ?"
            " ORDER BY saved_at DESC LIMIT ?",
            (key, int(limit)),
        )
    ]


def sample_values(key: str) -> dict:
    """Believable values for the preview, so a shop owner sees a real email."""
    samples = {
        "customer_name": "Ravi Kumar",
        "company_name": "CleverClass.AI",
        "company_phone": "+91 71042 99010",
        "verify_link": "https://example.com/verify-email?token=sample",
        "reset_link": "https://example.com/reset-password?token=sample",
        "order_number": "CC-ABCD2345",
        "order_total": "540",
        "order_items": "Kohinoor Class 10 Science x1; Vidyamitra Class 10 Maths x1",
        "track_link": "https://example.com/order/CC-ABCD2345",
        "carrier": "Delhivery",
        "awb": "1234567890",
        "tracking_link": "https://www.delhivery.com/track/package/1234567890",
        "reason": "The screenshot showed a different amount.",
        "ticket_reference": "TK-ABCD2345",
        "reply_body": "We have checked with the courier and it is out for delivery.",
        "ticket_link": "https://example.com/support/TK-ABCD2345",
    }
    return {name: samples.get(name, name) for name in variables_for(key)}


def catalogue() -> list[dict]:
    """Everything the admin template screen needs to render itself."""
    out = []
    for key, default in CATALOGUE.items():
        current = get(key) or {}
        out.append({
            "key": key,
            "name": default["name"],
            "description": default["description"],
            "variables": default["variables"],
            "subject": current.get("subject"),
            "source": current.get("source"),
            "updatedAt": current.get("updatedAt"),
        })
    return out
