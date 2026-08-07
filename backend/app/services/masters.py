"""Master data — the five lists the catalogue is built from.

`masters.code` IS the value stored on `books` (see migration 020), so there is
no foreign key protecting these rows. That makes one rule load-bearing:

    **A master in use cannot be deleted.**

Deleting 'kohinoor' while 52 books say `series = 'kohinoor'` would not fail at
the database level — it would silently orphan them: they would vanish from
faceted browse, still exist, and nobody would know why. So delete counts the
referencing books first and refuses, offering deactivation instead.

Renaming a `code` has the same hazard, so it is refused outright once a master
is in use. The `label` is free to change at any time — that is the field meant
for presentation, and the whole reason code and label are separate.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import uuid

from app.db.conn import query, query_one, transaction

log = logging.getLogger(__name__)

KINDS = ("class", "series", "board", "subject", "stream")

# Which `books` column stores each kind's code — used to count usage before a
# destructive change. Whitelisted rather than derived: these names are
# interpolated into SQL, so they must never come from user input.
COLUMN: dict[str, str] = {
    "class": "class_id",
    "series": "series",
    "board": "board",
    "subject": "subject",
    "stream": "stream",
}

# Streams exist only for 11-12. Kept here so both the API and the admin form
# agree without either owning the rule.
STREAM_CLASSES = ("11", "12")


class MasterError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _clean_code(kind: str, raw: str) -> str:
    code = (raw or "").strip()
    if not code:
        raise MasterError("A code is required")
    if kind == "subject":
        # Subjects are displayed verbatim on the storefront, so their case is
        # meaningful — "Book Keeping & Accountancy", not "book-keeping".
        return code
    # Normalise rather than refuse. An admin typing "Kohinoor Books" means the
    # same thing as "kohinoor-books", and rejecting it teaches them to guess at
    # a format instead of naming their series. Only genuinely unusable
    # characters are an error.
    code = re.sub(r"\s+", "-", code.lower())
    code = re.sub(r"-{2,}", "-", code).strip("-")
    if not code:
        raise MasterError("A code is required")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", code):
        raise MasterError(
            f"{raw!r} can only contain letters, numbers, spaces and hyphens — "
            "it is stored on every book and used in URLs"
        )
    return code


def usage(kind: str, code: str) -> int:
    """How many books reference this master."""
    if kind not in COLUMN:
        raise MasterError(f"Unknown kind {kind!r}")
    column = COLUMN[kind]
    row = query_one(
        f"SELECT COUNT(*) AS n FROM books WHERE {column} = ? AND deleted_at IS NULL",
        (code,),
    )
    return row["n"] if row else 0


def _public(row: dict, *, with_usage: bool = False) -> dict:
    out = {
        "id": row["id"],
        "kind": row["kind"],
        "code": row["code"],
        "label": row["label"],
        "labelMr": row["label_mr"],
        "appliesTo": [c for c in (row["applies_to"] or "").split(",") if c],
        "sortOrder": row["sort_order"],
        "isActive": bool(row["is_active"]),
    }
    if with_usage:
        out["usageCount"] = usage(row["kind"], row["code"])
    return out


def listing(kind: str | None = None, *, active_only: bool = False,
            with_usage: bool = False) -> list[dict]:
    clauses, params = ["1=1"], []
    if kind:
        if kind not in KINDS:
            raise MasterError(f"Unknown kind {kind!r}")
        clauses.append("kind = ?")
        params.append(kind)
    if active_only:
        clauses.append("is_active = 1")
    rows = query(
        f"SELECT * FROM masters WHERE {' AND '.join(clauses)}"
        " ORDER BY kind, sort_order, label",
        params,
    )
    return [_public(dict(r), with_usage=with_usage) for r in rows]


def grouped(*, active_only: bool = True) -> dict[str, list[dict]]:
    """All five lists in one call — what a form needs to render its pickers."""
    out: dict[str, list[dict]] = {k: [] for k in KINDS}
    for item in listing(active_only=active_only):
        out[item["kind"]].append(item)
    return out


def create(
    kind: str,
    *,
    code: str,
    label: str,
    label_mr: str = "",
    applies_to: list[str] | None = None,
    sort_order: int = 0,
    is_active: bool = True,
) -> dict:
    if kind not in KINDS:
        raise MasterError(f"Unknown kind {kind!r}")
    code = _clean_code(kind, code)
    label = (label or "").strip()
    if not label:
        raise MasterError("A label is required")

    if query_one("SELECT id FROM masters WHERE kind = ? AND code = ?", (kind, code)):
        raise MasterError(f"A {kind} with the code {code!r} already exists")

    applies = _clean_applies_to(kind, applies_to)
    now = _now()
    master_id = f"mst_{uuid.uuid4().hex[:12]}"
    with transaction() as conn:
        conn.execute(
            "INSERT INTO masters (id, kind, code, label, label_mr, applies_to,"
            " sort_order, is_active, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (master_id, kind, code, label, (label_mr or "").strip(), applies,
             int(sort_order), 1 if is_active else 0, now, now),
        )
    log.info("Master created: %s/%s", kind, code)
    return get(master_id)


def _clean_applies_to(kind: str, applies_to: list[str] | None) -> str:
    if kind != "stream":
        # Only streams are class-scoped. Silently dropping the field elsewhere
        # rather than erroring keeps the one admin form simple.
        return ""
    values = [str(c).strip() for c in (applies_to or []) if str(c).strip()]
    if not values:
        # The spec says streams are for 11-12; that is the default rather than
        # a hard rule, so a future junior-college stream is a data change.
        values = list(STREAM_CLASSES)
    return ",".join(values)


def get(master_id: str) -> dict:
    row = query_one("SELECT * FROM masters WHERE id = ?", (master_id,))
    if row is None:
        raise MasterError("No such master")
    return _public(dict(row), with_usage=True)


def update(master_id: str, **fields) -> dict:
    row = query_one("SELECT * FROM masters WHERE id = ?", (master_id,))
    if row is None:
        raise MasterError("No such master")

    kind = row["kind"]
    updates: dict = {}

    if "code" in fields and fields["code"] is not None:
        new_code = _clean_code(kind, fields["code"])
        if new_code != row["code"]:
            in_use = usage(kind, row["code"])
            if in_use:
                # The books store the code, so renaming it here would strand
                # them. The label is the field to change for presentation.
                raise MasterError(
                    f"{row['code']!r} is used by {in_use} book"
                    f"{'' if in_use == 1 else 's'} — its code cannot change. "
                    "Edit the label instead, or create a new one."
                )
            if query_one(
                "SELECT id FROM masters WHERE kind = ? AND code = ? AND id != ?",
                (kind, new_code, master_id),
            ):
                raise MasterError(f"A {kind} with the code {new_code!r} already exists")
            updates["code"] = new_code

    if fields.get("label") is not None:
        label = str(fields["label"]).strip()
        if not label:
            raise MasterError("A label is required")
        updates["label"] = label
    if fields.get("label_mr") is not None:
        updates["label_mr"] = str(fields["label_mr"]).strip()
    if fields.get("applies_to") is not None:
        updates["applies_to"] = _clean_applies_to(kind, fields["applies_to"])
    if fields.get("sort_order") is not None:
        updates["sort_order"] = int(fields["sort_order"])
    if fields.get("is_active") is not None:
        updates["is_active"] = 1 if fields["is_active"] else 0

    if not updates:
        return _public(dict(row), with_usage=True)

    assignments = ", ".join(f"{k} = ?" for k in updates)
    with transaction() as conn:
        conn.execute(
            f"UPDATE masters SET {assignments}, updated_at = ? WHERE id = ?",
            (*updates.values(), _now(), master_id),
        )
    return get(master_id)


def delete(master_id: str) -> dict:
    """Refuses while books still reference the code.

    The database cannot enforce this — `books.series` is text, not a foreign
    key — so this function is the only thing standing between a careless click
    and 52 books quietly disappearing from browse.
    """
    row = query_one("SELECT * FROM masters WHERE id = ?", (master_id,))
    if row is None:
        raise MasterError("No such master")

    in_use = usage(row["kind"], row["code"])
    if in_use:
        raise MasterError(
            f"{row['label']} is used by {in_use} book"
            f"{'' if in_use == 1 else 's'}. Deactivate it instead — that hides "
            "it from the pickers without changing those books."
        )

    with transaction() as conn:
        conn.execute("DELETE FROM masters WHERE id = ?", (master_id,))
    log.info("Master deleted: %s/%s", row["kind"], row["code"])
    return {"id": master_id, "kind": row["kind"], "code": row["code"]}


def seed_from_books() -> dict:
    """Populate the masters from values already present on books.

    Run once at migration time. Without it the admin opens an empty screen
    while 324 books quietly use codes nothing knows about, and every picker is
    blank — a "dynamic" system that lost all the existing data.
    """
    created: dict[str, int] = {}
    for kind, column in COLUMN.items():
        rows = query(
            f"SELECT DISTINCT {column} AS code FROM books"
            f" WHERE {column} IS NOT NULL AND {column} != ''"
            f" ORDER BY {column}"
        )
        n = 0
        for i, row in enumerate(rows):
            code = row["code"]
            if query_one(
                "SELECT id FROM masters WHERE kind = ? AND code = ?", (kind, code)
            ):
                continue
            try:
                create(
                    kind, code=code, label=_default_label(kind, code),
                    sort_order=_default_order(kind, code, i),
                )
                n += 1
            except MasterError:
                log.warning("Could not seed master %s/%s", kind, code)
        created[kind] = n
    return created


def _default_label(kind: str, code: str) -> str:
    if kind == "class":
        if code.isdigit():
            return f"Class {code}"
        return code.replace("-", " ").title()
    if kind == "subject":
        return code
    return code.replace("-", " ").title()


def _default_order(kind: str, code: str, fallback: int) -> int:
    # Classes sort numerically, so "Class 5" precedes "Class 10" rather than
    # the string order that puts 10 before 5.
    if kind == "class" and code.isdigit():
        return int(code)
    if kind == "class":
        return 0 if code == "nursery" else 99
    return fallback
