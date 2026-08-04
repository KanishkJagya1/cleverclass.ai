"""Support tickets: threading, internal notes, SLA clocks.

    python -m tests.test_support
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_sup_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.migrate import migrate  # noqa: E402
from app.db.repo import customers as customers_repo  # noqa: E402
from app.services import support  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== a guest can open a ticket ===")
    ticket = support.create(
        email="Guest@Example.COM", name="Guest", subject="Where is my parcel?",
        body="Ordered last week, nothing yet.", category="delivery",
    )
    ref = ticket["reference"]
    check("a ticket is created", bool(ref))
    check("the reference is unguessable", ref.startswith("TK-") and len(ref) == 11, ref)
    check("no O/0/I/1/L in the reference",
          not set("O0I1L") & set(ref[3:]), ref,
          )
    check("email is normalised", ticket["email"] == "guest@example.com", ticket["email"])
    check("it starts open", ticket["status"] == "open")
    check("the first message is in the thread", len(support.thread(ref)) == 1)

    print("\n=== a bad order number does not reject the ticket ===")
    t2 = support.create(
        email="a@b.com", subject="Question", body="About order",
        order_number="CC-NOTREAL",
    )
    check("the ticket is still accepted", bool(t2["reference"]),
          "refusing support over a mistyped order number is how someone gives up")
    check("and simply carries no order link", t2["order_id"] is None)

    print("\n=== internal notes never reach the customer ===")
    support.reply(ref, "Checking with the courier.", author_kind="staff",
                  author_name="Asha", is_internal=True)
    customer_view = support.thread(ref)
    staff_view = support.thread(ref, include_internal=True)
    check("the customer does not see the internal note", len(customer_view) == 1,
          str([m["body"] for m in customer_view]))
    check("staff do", len(staff_view) == 2)
    check("and it is flagged as internal",
          any(m["isInternal"] for m in staff_view))
    check("the safe view is the DEFAULT",
          all(not m["isInternal"] for m in support.thread(ref)),
          "the reverse default leaks the first time someone forgets the flag")

    try:
        support.reply(ref, "sneaky", author_kind="customer", is_internal=True)
        check("a customer cannot write an internal note", False, "it was allowed")
    except support.TicketError:
        check("a customer cannot write an internal note", True)

    print("\n=== SLA clocks ===")
    check("no first response yet", support.get(ref)["first_response_at"] is None,
          "an internal note is not a reply to the customer")
    support.reply(ref, "It is out for delivery today.", author_kind="staff",
                  author_name="Asha")
    ticket = support.get(ref)
    check("a public staff reply starts the first-response clock",
          ticket["first_response_at"] is not None)
    check("and moves the ticket to waiting-for-customer",
          ticket["status"] == "pending_customer", ticket["status"])

    first_at = ticket["first_response_at"]
    support.reply(ref, "Also checking the address.", author_kind="staff", author_name="Asha")
    check("a second reply does not move the first-response time",
          support.get(ref)["first_response_at"] == first_at,
          "it is a measure of the first reply, not the latest")

    print("\n=== a customer reply reopens ===")
    support.set_status(ref, "resolved", actor_name="Asha")
    check("resolved is stamped", support.get(ref)["resolved_at"] is not None)
    support.reply(ref, "Still not here.", author_kind="customer", author_name="Guest")
    check("the customer writing back reopens it",
          support.get(ref)["status"] == "open",
          "'resolved' is our opinion; the customer replying is evidence against it")

    print("\n=== status changes appear in the thread ===")
    support.set_status(ref, "resolved", actor_name="Asha")
    bodies = [m["body"] for m in support.thread(ref)]
    check("the customer sees the status change in sequence",
          any("resolved" in b.lower() for b in bodies), str(bodies[-2:]))

    print("\n=== closed is closed ===")
    support.set_status(ref, "closed", actor_name="Asha")
    try:
        support.reply(ref, "one more thing", author_kind="customer")
        check("a customer cannot reply to a closed ticket", False, "it was allowed")
    except support.TicketError as exc:
        check("a customer cannot reply to a closed ticket", True)
        check("and is told to open a new one", "new one" in str(exc), str(exc))

    print("\n=== the queue prioritises ===")
    urgent = support.create(email="u@x.com", subject="Payment taken twice",
                            body="Charged twice", category="payment")
    support.set_priority(urgent["reference"], "urgent")
    first_in_queue = support.queue()[0]
    check("urgent sorts to the top", first_in_queue["reference"] == urgent["reference"],
          first_in_queue["reference"])
    check("the queue carries a message count", first_in_queue["messageCount"] >= 1)

    print("\n=== a customer sees their own tickets, guest ones included ===")
    customer = customers_repo.create(email="guest@example.com",
                                     password="guestpassword1", name="Guest")
    mine = support.for_customer(customer["id"], email="guest@example.com")
    check("a ticket opened as a guest appears after registering",
          any(t["reference"] == ref for t in mine), str([t["reference"] for t in mine]))
    check("someone else's ticket does not",
          all(t["reference"] != urgent["reference"] for t in mine))

    print("\n=== what the customer payload exposes ===")
    view = support.public_view(support.get(ref))
    check("no assignee id", "assignee_id" not in view, str(view))
    check("no internal ids", "id" not in view and "customer_id" not in view, str(view))
    check("status has a readable label", view["statusLabel"] == "Closed", str(view))

    print("\n=== bad input ===")
    for kwargs, label in [
        ({"email": "x@y.com", "subject": "", "body": "b"}, "an empty subject"),
        ({"email": "x@y.com", "subject": "s", "body": "  "}, "an empty body"),
    ]:
        try:
            support.create(**kwargs)
            check(f"{label} is refused", False, "accepted")
        except support.TicketError:
            check(f"{label} is refused", True)
    check("an unknown category falls back to general",
          support.create(email="x@y.com", subject="s", body="b",
                         category="teleport")["category"] == "general")

    print("\n=== stats ===")
    stats = support.stats()
    check("stats report by status", bool(stats["byStatus"]), str(stats))
    check("and count tickets awaiting a first reply",
          stats["awaitingFirstReply"] >= 1, str(stats))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Support holds: threaded, internal notes stay internal, SLA measured.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
