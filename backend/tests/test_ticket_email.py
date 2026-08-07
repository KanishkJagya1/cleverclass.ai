"""Opening a ticket emails the team and acknowledges the customer.

    python -m tests.test_ticket_email
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_tkmail_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)
# The mailer only queues when SMTP is configured; without this every send is a
# no-op and the test would pass while proving nothing.
os.environ["SMTP_HOST"] = "smtp.example.com"
os.environ["SMTP_FROM"] = "CleverClass <noreply@example.com>"

from app.db.conn import query  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import mailer, support  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def outbox(kind: str | None = None) -> list[dict]:
    sql = "SELECT * FROM email_outbox"
    params: list = []
    if kind:
        sql += " WHERE kind = ?"
        params.append(kind)
    return [dict(r) for r in query(sql + " ORDER BY created_at", params)]


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    check("SMTP counts as configured for this run", mailer.configured() is True,
          "without it every send is a silent no-op")

    print("\n=== opening a technical ticket ===")
    ticket = support.create(
        email="parent@example.com",
        subject="PDF download fails",
        body="I click download on the Class 10 Science sample and nothing happens.",
        name="Asha",
        phone="9876543210",
        category="technical",
    )
    reference = ticket["reference"]
    check("a ticket was created", bool(reference), str(ticket)[:120])
    check("the category stuck", ticket["category"] == "technical", str(ticket["category"]))

    print("\n=== the team is emailed ===")
    staff = outbox("ticket_staff")
    check("exactly one staff email is queued", len(staff) == 1, str(len(staff)))
    mail = staff[0]
    check("it goes to the support inbox",
          mail["to_email"] == mailer.support_inbox(), mail["to_email"])
    check("the subject carries the reference",
          reference in mail["subject"], mail["subject"])
    check("and the category, so it can be filtered",
          "technical" in mail["subject"].lower(), mail["subject"])
    check("the customer's own words are included in full",
          "nothing happens" in mail["body_text"],
          "a summary means staff must open the panel to triage")
    check("their contact details are there",
          "parent@example.com" in mail["body_text"]
          and "9876543210" in mail["body_text"],
          mail["body_text"][:200])
    check("with a link straight to the panel",
          f"/admin/support/{reference}" in mail["body_text"], mail["body_text"][:200])

    print("\n=== the customer is acknowledged ===")
    ack = outbox("ticket_ack")
    check("exactly one acknowledgement", len(ack) == 1, str(len(ack)))
    check("it goes to the customer, NOT the team",
          ack[0]["to_email"] == "parent@example.com", ack[0]["to_email"])
    check("it carries the reference they will need",
          reference in ack[0]["subject"] and reference in ack[0]["body_text"],
          ack[0]["subject"])
    check("and a link to track it",
          f"/support/{reference}" in ack[0]["body_text"],
          "without a way back in, people just submit again")

    print("\n=== queued, not sent inline ===")
    check("both are queued in the outbox, not sent inline",
          all(m["status"] == "queued" for m in staff + ack),
          "SMTP inside a request is how a form takes eight seconds; "
          f"got {[m['status'] for m in staff + ack]}")

    print("\n=== a ticket with no email still works ===")
    before = len(outbox("ticket_ack"))
    support.create(
        email="", subject="Anonymous problem", body="Something is broken here.",
        name="Nobody", category="technical",
    )
    check("no acknowledgement is sent to nobody",
          len(outbox("ticket_ack")) == before,
          "queuing a mail to an empty address is a bounce, not a courtesy")

    print("\n=== email failure never loses the ticket ===")
    broken = mailer.send_ticket_opened_staff
    try:
        def explode(*_a, **_k):
            raise RuntimeError("SMTP exploded")

        mailer.send_ticket_opened_staff = explode  # type: ignore[assignment]
        t = support.create(
            email="x@example.com", subject="Still saved",
            body="The mail server is down but this must persist.",
            category="technical",
        )
        check("the ticket is created anyway", bool(t.get("reference")), str(t)[:120])
        check("and it is really in the database",
              support.get(t["reference"]) is not None,
              "losing a customer's message to a mail outage is unacceptable")
    finally:
        mailer.send_ticket_opened_staff = broken  # type: ignore[assignment]

    print("\n=== WITHOUT SMTP, the mail is still RECORDED, not dropped ===")
    # This is production's actual state. An early return on `configured()`
    # would mean a support request emails nobody and leaves no trace that it
    # should have — silent, and only discovered by an angry customer.
    import app.config as config_mod  # noqa: PLC0415

    real_host = config_mod.settings.smtp_host
    try:
        config_mod.settings.smtp_host = None
        check("SMTP now reads as unconfigured", mailer.configured() is False)

        before = len(outbox("ticket_staff"))
        t = support.create(
            email="offline@example.com", subject="Sent while SMTP is down",
            body="This must still leave a record in the outbox.",
            category="technical",
        )
        after = outbox("ticket_staff")
        check("a staff email is STILL queued", len(after) == before + 1,
              f"{before} -> {len(after)}")
        recorded = [m for m in after if m["related_id"] == t["reference"]]
        check("marked skipped rather than silently dropped",
              recorded and recorded[0]["status"] == "skipped",
              str(recorded[0]["status"]) if recorded else "no row at all")
        check("and the whole message is recoverable from the outbox",
              recorded and "must still leave a record" in recorded[0]["body_text"],
              "otherwise the customer's words are gone")
    finally:
        config_mod.settings.smtp_host = real_host

    print("\n=== an unknown category does not become a lost ticket ===")
    t = support.create(
        email="y@example.com", subject="Odd category",
        body="Testing what happens with a made-up category.",
        category="not-a-real-category",
    )
    check("it falls back to general rather than failing",
          t["category"] == "general", str(t["category"]))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Ticket email holds: team notified, customer acknowledged, ticket never lost.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
