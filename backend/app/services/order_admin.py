"""Order tooling for the admin panel: internal notes and bulk transitions.

The rule that shapes this whole module: **a bulk action is a loop over
individual decisions, never a single blanket UPDATE.** Moving forty orders to
"shipped" must apply the same state machine, stock effects and audit trail as
moving one, and must report per-order what happened. An operator who selects
forty and is told "done" when six silently failed has a worse problem than one
who is told plainly that six failed and why.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid

from app.db.conn import query, query_one, transaction
from app.services import inventory, order_flow

log = logging.getLogger(__name__)

MAX_BULK = 100


class OrderAdminError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# --------------------------------------------------------------------------
# Internal notes
# --------------------------------------------------------------------------

def add_note(
    order_number: str,
    body: str,
    *,
    author_id: str | None,
    author_name: str = "",
    pinned: bool = False,
) -> dict:
    text = (body or "").strip()
    if not text:
        raise OrderAdminError("A note cannot be empty")
    if len(text) > 4000:
        raise OrderAdminError("That note is too long (4000 characters max)")

    order = query_one("SELECT id FROM orders WHERE order_number = ?", (order_number,))
    if order is None:
        raise OrderAdminError("No such order")

    note = {
        "id": str(uuid.uuid4()),
        "order_id": order["id"],
        "author_id": author_id,
        "author_name": author_name or "Staff",
        "body": text,
        "pinned": 1 if pinned else 0,
        "created_at": _now(),
    }
    with transaction() as conn:
        conn.execute(
            "INSERT INTO order_notes (id, order_id, author_id, author_name, body,"
            " pinned, created_at) VALUES (?,?,?,?,?,?,?)",
            tuple(note.values()),
        )
    return _public(note)


def notes(order_number: str) -> list[dict]:
    order = query_one("SELECT id FROM orders WHERE order_number = ?", (order_number,))
    if order is None:
        return []
    return [
        _public(dict(r))
        for r in query(
            "SELECT * FROM order_notes WHERE order_id = ?"
            " ORDER BY pinned DESC, created_at DESC",
            (order["id"],),
        )
    ]


def set_pinned(note_id: str, pinned: bool) -> bool:
    with transaction() as conn:
        return conn.execute(
            "UPDATE order_notes SET pinned = ? WHERE id = ?",
            (1 if pinned else 0, note_id),
        ).rowcount > 0


def delete_note(note_id: str) -> bool:
    with transaction() as conn:
        return conn.execute(
            "DELETE FROM order_notes WHERE id = ?", (note_id,)
        ).rowcount > 0


def _public(row: dict) -> dict:
    return {
        "id": row["id"],
        "author": row["author_name"],
        "authorId": row["author_id"],
        "body": row["body"],
        "pinned": bool(row["pinned"]),
        "createdAt": row["created_at"],
    }


# --------------------------------------------------------------------------
# Bulk status changes
# --------------------------------------------------------------------------

def bulk_transition(
    order_numbers: list[str],
    target: str,
    *,
    note: str = "",
    actor: str | None = None,
) -> dict:
    """Move many orders, one real transition at a time.

    Every order goes through `order_flow.transition`, so an illegal move is
    refused per order rather than for the batch — selecting thirty orders of
    which two are already cancelled should move twenty-eight, not fail
    entirely, and should say exactly which two did not move.
    """
    numbers = [n.strip() for n in order_numbers if n and n.strip()]
    if not numbers:
        raise OrderAdminError("No orders selected")
    if len(numbers) > MAX_BULK:
        raise OrderAdminError(
            f"That is {len(numbers)} orders. Do at most {MAX_BULK} at a time."
        )
    if target not in order_flow.TRANSITIONS:
        raise OrderAdminError(f"Unknown status {target!r}")

    # De-duplicated, preserving order: a double-submitted selection must not
    # apply the same transition twice.
    seen: set[str] = set()
    ordered = [n for n in numbers if not (n in seen or seen.add(n))]

    moved: list[str] = []
    failed: list[dict] = []
    for number in ordered:
        try:
            order_flow.transition(number, target, note=note, actor=actor)
            moved.append(number)
        except (order_flow.TransitionError, inventory.StockError) as exc:
            # Named individually — "6 failed" without saying which is not
            # something an operator can act on.
            failed.append({"orderNumber": number, "reason": str(exc)})
        except Exception as exc:  # noqa: BLE001
            log.exception("Bulk transition failed for %s", number)
            failed.append({"orderNumber": number, "reason": f"Unexpected: {exc}"})

    return {
        "target": target,
        "requested": len(ordered),
        "moved": moved,
        "movedCount": len(moved),
        "failed": failed,
        "failedCount": len(failed),
    }
