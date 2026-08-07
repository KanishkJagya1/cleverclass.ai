"""Saved delivery addresses.

One customer, many addresses — home, school, hostel. Before this a customer had
exactly one, so anyone ordering to a second place retyped it every time.

TWO INVARIANTS

  * **Exactly one default**, enforced by a partial unique index rather than by
    remembering to clear the old one. Two defaults is a silent bug whose symptom
    is a parcel going to the wrong address.
  * **Deleting is soft.** A past order points at the address it shipped to; a
    hard delete would break that link, and "where did we actually send it" is a
    question support has to be able to answer months later.

`customers.address_*` is kept in step with the default so every existing reader
— checkout prefill, the profile screen, the order form — keeps working.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import secrets

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

MAX_PER_CUSTOMER = 10


class AddressError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _public(row: dict) -> dict:
    return {
        "id": row["id"],
        "label": row["label"],
        "name": row["name"],
        "phone": row["phone"],
        "line1": row["line1"],
        "line2": row["line2"],
        "city": row["city"],
        "state": row["state"],
        "pincode": row["pincode"],
        "landmark": row["landmark"],
        "isDefault": bool(row["is_default"]),
    }


def _validate(line1: str, city: str, pincode: str) -> None:
    if not line1.strip():
        raise AddressError("Street address is required")
    if not city.strip():
        raise AddressError("City is required")
    if not re.fullmatch(r"\d{6}", (pincode or "").strip()):
        raise AddressError("Pincode must be 6 digits")


def list_for(customer_id: str) -> list[dict]:
    return [
        _public(dict(r))
        for r in query(
            "SELECT * FROM addresses WHERE customer_id = ? AND deleted_at IS NULL"
            " ORDER BY is_default DESC, created_at",
            (customer_id,),
        )
    ]


def get(customer_id: str, address_id: str) -> dict | None:
    """Scoped to the customer on purpose.

    Every caller passes the session's customer id, so an address id belonging to
    somebody else simply does not resolve — the ownership check cannot be
    forgotten at a call site because it is not a separate step.
    """
    row = query_one(
        "SELECT * FROM addresses WHERE id = ? AND customer_id = ?"
        " AND deleted_at IS NULL",
        (address_id, customer_id),
    )
    return _public(dict(row)) if row else None


def default_for(customer_id: str) -> dict | None:
    row = query_one(
        "SELECT * FROM addresses WHERE customer_id = ? AND is_default = 1"
        " AND deleted_at IS NULL",
        (customer_id,),
    )
    return _public(dict(row)) if row else None


def _sync_customer_mirror(conn, customer_id: str) -> None:
    """Copy the default onto `customers`, which older code still reads."""
    row = conn.execute(
        "SELECT * FROM addresses WHERE customer_id = ? AND is_default = 1"
        " AND deleted_at IS NULL",
        (customer_id,),
    ).fetchone()
    if row is None:
        return
    conn.execute(
        "UPDATE customers SET address_line1 = ?, address_line2 = ?, city = ?,"
        " state = ?, pincode = ?, updated_at = ? WHERE id = ?",
        (row["line1"], row["line2"], row["city"], row["state"], row["pincode"],
         _now(), customer_id),
    )


def create(customer_id: str, **fields) -> dict:
    line1 = str(fields.get("line1", "")).strip()
    city = str(fields.get("city", "")).strip()
    pincode = str(fields.get("pincode", "")).strip()
    _validate(line1, city, pincode)

    existing = list_for(customer_id)
    if len(existing) >= MAX_PER_CUSTOMER:
        raise AddressError(
            f"You can save up to {MAX_PER_CUSTOMER} addresses. Remove one first."
        )

    # The first address a customer saves is their default, whatever they asked
    # for — an account with addresses but no default has nothing to prefill.
    make_default = bool(fields.get("isDefault")) or not existing

    address_id = f"adr_{secrets.token_hex(8)}"
    with transaction() as conn:
        if make_default:
            conn.execute(
                "UPDATE addresses SET is_default = 0, updated_at = ?"
                " WHERE customer_id = ? AND is_default = 1",
                (_now(), customer_id),
            )
        conn.execute(
            "INSERT INTO addresses (id, customer_id, label, name, phone, line1,"
            " line2, city, state, pincode, landmark, is_default, created_at,"
            " updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (address_id, customer_id,
             str(fields.get("label") or "Home")[:40],
             str(fields.get("name") or "")[:120],
             str(fields.get("phone") or "")[:20],
             line1[:300], str(fields.get("line2") or "")[:300],
             city[:100], str(fields.get("state") or "")[:100], pincode,
             str(fields.get("landmark") or "")[:200],
             1 if make_default else 0, _now(), _now()),
        )
        if make_default:
            _sync_customer_mirror(conn, customer_id)
    return get(customer_id, address_id) or {}


def update(customer_id: str, address_id: str, **fields) -> dict:
    current = get(customer_id, address_id)
    if current is None:
        raise AddressError("No such address")

    merged = {**current, **{k: v for k, v in fields.items() if v is not None}}
    _validate(str(merged["line1"]), str(merged["city"]), str(merged["pincode"]))

    with transaction() as conn:
        conn.execute(
            "UPDATE addresses SET label = ?, name = ?, phone = ?, line1 = ?,"
            " line2 = ?, city = ?, state = ?, pincode = ?, landmark = ?,"
            " updated_at = ? WHERE id = ? AND customer_id = ?",
            (str(merged["label"])[:40], str(merged["name"])[:120],
             str(merged["phone"])[:20], str(merged["line1"])[:300],
             str(merged["line2"])[:300], str(merged["city"])[:100],
             str(merged["state"])[:100], str(merged["pincode"]),
             str(merged.get("landmark") or "")[:200], _now(),
             address_id, customer_id),
        )
        if current["isDefault"]:
            _sync_customer_mirror(conn, customer_id)
    return get(customer_id, address_id) or {}


def set_default(customer_id: str, address_id: str) -> dict:
    if get(customer_id, address_id) is None:
        raise AddressError("No such address")
    with transaction() as conn:
        # Cleared first: the partial unique index would otherwise reject the
        # second default, which is the index doing its job.
        conn.execute(
            "UPDATE addresses SET is_default = 0, updated_at = ?"
            " WHERE customer_id = ? AND is_default = 1",
            (_now(), customer_id),
        )
        conn.execute(
            "UPDATE addresses SET is_default = 1, updated_at = ? WHERE id = ?",
            (_now(), address_id),
        )
        _sync_customer_mirror(conn, customer_id)
    return get(customer_id, address_id) or {}


def remove(customer_id: str, address_id: str) -> dict:
    address = get(customer_id, address_id)
    if address is None:
        raise AddressError("No such address")

    with transaction() as conn:
        conn.execute(
            "UPDATE addresses SET deleted_at = ?, is_default = 0, updated_at = ?"
            " WHERE id = ? AND customer_id = ?",
            (_now(), _now(), address_id, customer_id),
        )
        if address["isDefault"]:
            # Promote the oldest survivor. Leaving a customer with addresses but
            # no default means checkout stops prefilling for no visible reason.
            nxt = conn.execute(
                "SELECT id FROM addresses WHERE customer_id = ? AND deleted_at IS NULL"
                " ORDER BY created_at LIMIT 1",
                (customer_id,),
            ).fetchone()
            if nxt:
                conn.execute(
                    "UPDATE addresses SET is_default = 1, updated_at = ? WHERE id = ?",
                    (_now(), nxt["id"]),
                )
                _sync_customer_mirror(conn, customer_id)
    return {"ok": True, "remaining": list_for(customer_id)}
