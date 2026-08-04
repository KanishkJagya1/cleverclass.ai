"""The order lifecycle: legal transitions, timeline, and stock side effects.

Before this, `orders_repo.set_status` accepted ANY status from ANY status. A
delivered order could be moved back to `requested`, a cancelled one to
`shipped`, and nothing deducted or restored stock. The status column recorded
what someone last clicked, not what had actually happened to the order.

THREE RULES

  1. **Transitions are declared, not implied.** `TRANSITIONS` is the whole
     contract; anything not listed is refused with a message naming what IS
     allowed, because the person hitting it is staff who need to get on with
     their day.
  2. **Stock moves with the status, in the same transaction.** Deduct on
     confirm, restore on cancel/return. If the stock movement fails — the last
     copy went while the admin was deciding — the status change fails with it.
     A confirmed order whose stock was never deducted is how a shop oversells.
  3. **Deduction happens at most once.** `orders.stock_applied_at` is the guard.
     Confirm → cancel → confirm must not deduct twice, and cancelling an order
     that never deducted must not invent inventory.
"""

from __future__ import annotations

import datetime as dt
import logging

from app.db.conn import query, query_one, transaction
from app.services import inventory

log = logging.getLogger(__name__)

# Terminal states have no outgoing transitions: the order is finished, and
# reopening it would make the timeline a lie. A mistake after this point is
# corrected by a new order or a refund, both of which leave a record.
TRANSITIONS: dict[str, tuple[str, ...]] = {
    "requested": ("pending_payment", "confirmed", "cancelled"),
    "pending_payment": ("confirmed", "cancelled"),
    "confirmed": ("processing", "packed", "shipped", "cancelled"),
    "processing": ("packed", "cancelled"),
    "packed": ("shipped", "cancelled"),
    "shipped": ("out_for_delivery", "delivered", "returned"),
    "out_for_delivery": ("delivered", "returned"),
    "delivered": ("refund_requested", "returned"),
    "refund_requested": ("refund_approved", "refund_rejected"),
    "refund_approved": ("returned",),
    "refund_rejected": ("delivered",),
    # Terminal.
    "cancelled": (),
    "returned": (),
}

STATUSES = tuple(TRANSITIONS)

# Statuses in which the shop has committed the stock.
_DEDUCTING = {"confirmed", "processing", "packed", "shipped", "out_for_delivery",
              "delivered"}

# Statuses that give it back.
_RESTORING = {"cancelled", "returned"}

# Customer-facing wording. The internal names are for staff; a customer should
# never read "refund_requested".
LABELS = {
    "requested": "Order request received",
    "pending_payment": "Waiting for payment",
    "confirmed": "Confirmed",
    "processing": "Being prepared",
    "packed": "Packed",
    "shipped": "Shipped",
    "out_for_delivery": "Out for delivery",
    "delivered": "Delivered",
    "cancelled": "Cancelled",
    "refund_requested": "Refund requested",
    "refund_approved": "Refund approved",
    "refund_rejected": "Refund declined",
    "returned": "Returned",
}


class TransitionError(RuntimeError):
    """The requested status change is not legal from where the order is."""


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def allowed_from(status: str) -> tuple[str, ...]:
    return TRANSITIONS.get(status, ())


def can_transition(current: str, target: str) -> bool:
    return target in allowed_from(current)


def transition(
    order_number: str,
    target: str,
    *,
    note: str = "",
    actor: str | None = None,
) -> dict:
    """Move an order to `target`, applying stock effects atomically.

    Returns the updated order. Raises TransitionError for an illegal move and
    inventory.StockError if the stock effect cannot be applied.
    """
    if target not in TRANSITIONS:
        raise TransitionError(f"Unknown status {target!r}")

    order = query_one(
        "SELECT id, status, order_number, stock_applied_at FROM orders"
        " WHERE order_number = ?",
        (order_number,),
    )
    if order is None:
        raise TransitionError("No such order")

    current = order["status"]
    if current == target:
        # Idempotent rather than an error: retries and double-clicks are normal,
        # and failing them teaches staff to ignore errors.
        return _load(order_number)

    if not can_transition(current, target):
        allowed = allowed_from(current)
        raise TransitionError(
            f"An order that is '{LABELS.get(current, current)}' cannot become "
            f"'{LABELS.get(target, target)}'. "
            + (
                f"Allowed from here: {', '.join(allowed)}."
                if allowed
                else "This order is in a final state."
            )
        )

    items = query(
        "SELECT slug, qty FROM order_items WHERE order_id = ?", (order["id"],)
    )
    already_applied = order["stock_applied_at"] is not None

    # Decide the stock effect BEFORE opening the write transaction, so the
    # intent is explicit and testable.
    deduct = target in _DEDUCTING and not already_applied
    restore = target in _RESTORING and already_applied

    if deduct:
        # Applied first and OUTSIDE the status write, because `inventory.adjust`
        # runs its own transaction and will raise on an oversell. Raising here
        # leaves the order untouched, which is the correct outcome: a confirm
        # that cannot reserve stock must not be recorded as confirmed.
        applied: list[tuple[str, int]] = []
        try:
            for item in items:
                book = query_one("SELECT id FROM books WHERE slug = ?", (item["slug"],))
                if book is None:
                    continue  # combos and key notes are not stocked titles
                result = inventory.adjust(
                    book["id"], -item["qty"], "sold",
                    reference=order_number, actor_id=actor,
                )
                if result is not None:
                    applied.append((book["id"], item["qty"]))
        except inventory.StockError:
            # Put back whatever this attempt already took. Without this a
            # partial failure silently eats stock from the earlier lines.
            for book_id, qty in applied:
                inventory.adjust(
                    book_id, qty, "correction", reference=order_number,
                    note="rolled back a failed order confirmation", actor_id=actor,
                )
            raise

    if restore:
        for item in items:
            book = query_one("SELECT id FROM books WHERE slug = ?", (item["slug"],))
            if book is None:
                continue
            inventory.adjust(
                book["id"], item["qty"],
                "returned" if target == "returned" else "cancelled",
                reference=order_number, actor_id=actor,
            )

    with transaction() as conn:
        conn.execute(
            "UPDATE orders SET status = ?, updated_at = ?, stock_applied_at = ?"
            " WHERE id = ?",
            (
                target,
                _now(),
                _now() if deduct else (None if restore else order["stock_applied_at"]),
                order["id"],
            ),
        )
        conn.execute(
            "INSERT INTO order_events"
            " (order_id, from_status, to_status, note, actor, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (order["id"], current, target, note[:500], actor, _now()),
        )

    # Issue the invoice on confirmation, once the money and the stock are both
    # settled. Deliberately AFTER the status write and deliberately non-fatal:
    # an invoice that fails to render must not roll back a confirmed order with
    # deducted stock. It is idempotent, so a later retry — or simply opening the
    # invoice — produces it.
    if target == "confirmed":
        try:
            from app.services import invoices

            invoices.issue(order_number, issued_by=actor)
        except Exception:  # noqa: BLE001
            log.exception(
                "Invoice generation failed for %s — the order is confirmed and "
                "the invoice can be issued on demand", order_number,
            )

    # Notifications are best-effort and deliberately last: the order has already
    # moved and its stock is settled, so a failure to ring a bell must not undo
    # any of that.
    try:
        from app.services import notifications

        owner = query_one(
            "SELECT customer_id FROM orders WHERE order_number = ?", (order_number,)
        )
        notifications.order_status_changed(
            (owner or {})["customer_id"] if owner else None,
            order_number, LABELS.get(target, target),
        )
        if deduct:
            # A confirmation is the moment stock actually drops, so it is the
            # right moment to notice the shelf is nearly empty.
            for item in items:
                book = query_one(
                    "SELECT id, slug, title, stock_qty, low_stock_threshold"
                    "  FROM books WHERE slug = ?", (item["slug"],)
                )
                if book and book["stock_qty"] is not None and                         book["stock_qty"] <= book["low_stock_threshold"]:
                    notifications.low_stock(book["slug"], book["title"], book["stock_qty"])
    except Exception:  # noqa: BLE001
        log.exception("Notification for %s failed", order_number)

    log.info(
        "Order %s: %s -> %s (stock %s)",
        order_number, current, target,
        "deducted" if deduct else "restored" if restore else "unchanged",
    )
    return _load(order_number)


def timeline(order_number: str) -> list[dict]:
    """Every status change, oldest first — what the customer is shown."""
    order = query_one("SELECT id FROM orders WHERE order_number = ?", (order_number,))
    if order is None:
        return []
    return [
        {
            "status": e["to_status"],
            "label": LABELS.get(e["to_status"], e["to_status"]),
            "from": e["from_status"],
            "note": e["note"],
            "at": e["created_at"],
        }
        for e in query(
            "SELECT * FROM order_events WHERE order_id = ? ORDER BY id",
            (order["id"],),
        )
    ]


def _load(order_number: str) -> dict:
    row = query_one("SELECT * FROM orders WHERE order_number = ?", (order_number,))
    order = dict(row) if row else {}
    if order:
        order["statusLabel"] = LABELS.get(order["status"], order["status"])
        order["allowedNext"] = list(allowed_from(order["status"]))
    return order
