"""Manual payment verification.

    python -m tests.test_payments
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_pay_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import orders as orders_repo  # noqa: E402
from app.services import order_flow, payments  # noqa: E402

failures: list[str] = []

CUSTOMER = {
    "name": "Payer", "phone": "9876500000", "email": "payer@example.com",
    "address1": "1 Road", "city": "Nagpur", "pincode": "440016",
}


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def make_order(slug: str = "pay-book", price: int = 250) -> str:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    if not query_one("SELECT id FROM books WHERE slug = ?", (slug,)):
        with transaction() as conn:
            conn.execute(
                "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
                " subject, price, status, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (slug, slug, "Payable", "kohinoor", "state", "10", "english",
                 "Science", price, "published", now, now),
            )
    return orders_repo.create_order(
        items=[{"slug": slug, "qty": 1}], customer=CUSTOMER
    )["orderNumber"]


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== the amount comes from the server, never the client ===")
    num = make_order()
    payment = payments.start(num)
    order_total = query_one("SELECT total FROM orders WHERE order_number=?", (num,))["total"]
    check("payment amount equals the server-computed order total",
          payment["amount"] == order_total, f"{payment['amount']} vs {order_total}")
    check("it starts awaiting", payment["status"] == "awaiting")
    check("starting twice does not duplicate", payments.start(num)["id"] == payment["id"])

    print("\n=== the customer submits proof ===")
    try:
        payments.submit_proof(num)
        check("submitting nothing is refused", False, "empty submission accepted")
    except payments.PaymentError:
        check("submitting nothing is refused", True)

    payments.submit_proof(num, method="upi", reference="UTR123456789", note="paid via GPay")
    payment = payments.get_for_order(num)
    check("status becomes submitted", payment["status"] == "submitted")
    check("the reference is stored", payment["provider_ref"] == "UTR123456789")

    try:
        payments.submit_proof(num, reference="UTR999")
        check("cannot resubmit while under review", False, "resubmission allowed")
    except payments.PaymentError:
        check("cannot resubmit while under review", True)

    print("\n=== it appears in the admin queue ===")
    queue = payments.queue()
    check("the payment is queued for review", any(p["order_number"] == num for p in queue), str(len(queue)))

    print("\n=== rejection requires a reason ===")
    try:
        payments.review(num, "rejected", reviewer_id="admin1", note="")
        check("a rejection without a reason is refused", False, "it was allowed")
    except payments.PaymentError:
        check("a rejection without a reason is refused", True)

    payments.review(num, "correction_requested", reviewer_id="admin1",
                    note="The screenshot shows a different amount.")
    payment = payments.get_for_order(num)
    check("correction requested", payment["status"] == "correction_requested")
    check("the customer is told why",
          payments.public_view(payment)["message"].startswith("The screenshot"))
    check("the order is still unpaid",
          query_one("SELECT payment_status FROM orders WHERE order_number=?", (num,))["payment_status"] == "unpaid")

    print("\n=== the customer corrects and it is approved ===")
    payments.submit_proof(num, reference="UTR987654321")
    payments.review(num, "approved", reviewer_id="admin1", note="matches the bank statement")
    payment = payments.get_for_order(num)
    check("approved", payment["status"] == "approved")
    check("the order is marked paid",
          query_one("SELECT payment_status FROM orders WHERE order_number=?", (num,))["payment_status"] == "paid")
    check("the reference is copied onto the order",
          query_one("SELECT payment_ref FROM orders WHERE order_number=?", (num,))["payment_ref"] == "UTR987654321")
    check("who reviewed it is recorded", payment["reviewed_by"] == "admin1")

    try:
        payments.review(num, "approved", reviewer_id="admin2", note="again")
        check("cannot approve twice", False, "double approval allowed")
    except payments.PaymentError:
        check("cannot approve twice", True)

    print("\n=== approving does NOT move the order by itself ===")
    # The order lifecycle has exactly one path: order_flow.transition. A payment
    # service that also advanced orders would be a second, divergent lifecycle
    # that skips stock deduction.
    check("the order status is untouched by payment approval",
          query_one("SELECT status FROM orders WHERE order_number=?", (num,))["status"] == "requested",
          "payments moved the order behind the state machine's back")
    order_flow.transition(num, "confirmed", actor="admin1")
    check("the caller advances it explicitly",
          query_one("SELECT status FROM orders WHERE order_number=?", (num,))["status"] == "confirmed")

    print("\n=== what the customer may see ===")
    view = payments.public_view(payments.get_for_order(num))
    check("no filesystem path is exposed", "proof_path" not in view and "proofPath" not in view, str(view))
    check("no staff id is exposed", "reviewed_by" not in view and "reviewedBy" not in view, str(view))
    check("an approved payment shows no internal note", view["message"] == "", str(view))

    print("\n=== the provider seam ===")
    check("the active provider is manual", payments.provider().name == "manual")
    check("it satisfies the interface",
          all(hasattr(payments.provider(), m) for m in ("create_intent", "capture", "refund")))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Manual payments hold: server-priced, human-verified, gateway-ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
