"""Bulk catalogue import from CSV.

Three rules, each learned from how bulk imports usually go wrong.

  1. **Dry-run is not optional, it is the default.** `apply=False` validates
     every row and writes nothing. Someone pasting 300 rows out of Excel has no
     idea what the file actually contains until something tells them.
  2. **All-or-nothing per batch.** One malformed price must not leave 180 books
     updated and 120 not, because the operator cannot tell which is which
     afterwards and there is no undo.
  3. **Errors name the row and the column.** "Row 47, price: 'two hundred' is
     not a number" is fixable in ten seconds; "import failed" is a support call.

Upserts on `slug`, matching `scripts/import_seed.py`. A row for an unknown slug
creates a book; a known slug updates ONLY the columns present in the file, so a
price-only spreadsheet cannot silently blank every description.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import logging

from app.db.conn import query_one, transaction

log = logging.getLogger(__name__)

# column -> (type, required-on-create)
COLUMNS: dict[str, tuple[str, bool]] = {
    "slug": ("slug", True),
    "title": ("text", True),
    "title_mr": ("text", False),
    "series": ("text", True),
    "board": ("text", False),
    "class_id": ("text", True),
    "medium": ("text", True),
    "subject": ("text", True),
    "stream": ("text", False),
    "price": ("int", True),
    "mrp": ("int", False),
    "pages": ("int", False),
    "isbn": ("text", False),
    "edition": ("text", False),
    "description": ("text", False),
    "status": ("status", False),
    "in_stock": ("bool", False),
    "stock_qty": ("int", False),
    "low_stock_threshold": ("int", False),
    "hsn_code": ("text", False),
    "gst_rate": ("int", False),
}

REQUIRED_ON_CREATE = [c for c, (_, req) in COLUMNS.items() if req]
_VALID_STATUS = {"draft", "published", "archived"}


class BulkError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def template() -> str:
    """A CSV with the headers and one worked example row.

    Downloadable, because the alternative is the operator guessing column names
    and discovering the real ones through failed imports.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(list(COLUMNS))
    writer.writerow([
        "kohinoor-10-science-marathi", "Kohinoor Class 10 Science",
        "कोहिनूर इयत्ता १० वी विज्ञान", "kohinoor", "state", "10", "marathi",
        "Science", "", "250", "300", "260", "", "2026 Edition",
        "Chapter-wise solved exercises.", "published", "1", "", "5", "4901", "0",
    ])
    # BOM so Excel opens the Devanagari example correctly rather than as
    # mojibake — the same reason the order export carries one.
    return "﻿" + buffer.getvalue()


def _coerce(column: str, raw: str, row_no: int) -> object:
    kind = COLUMNS[column][0]
    value = (raw or "").strip()

    if kind == "int":
        if value == "":
            return None
        try:
            number = int(float(value))
        except ValueError:
            raise BulkError(f"Row {row_no}, {column}: {value!r} is not a number")
        if number < 0:
            raise BulkError(f"Row {row_no}, {column}: cannot be negative")
        return number

    if kind == "bool":
        if value == "":
            return None
        if value.lower() in ("1", "true", "yes", "y"):
            return 1
        if value.lower() in ("0", "false", "no", "n"):
            return 0
        raise BulkError(f"Row {row_no}, {column}: {value!r} is not yes/no")

    if kind == "status":
        if value == "":
            return None
        if value.lower() not in _VALID_STATUS:
            raise BulkError(
                f"Row {row_no}, status: {value!r} must be one of "
                f"{', '.join(sorted(_VALID_STATUS))}"
            )
        return value.lower()

    if kind == "slug":
        if not value:
            raise BulkError(f"Row {row_no}: slug is required")
        if not all(c.isalnum() or c == "-" for c in value) or value != value.lower():
            raise BulkError(
                f"Row {row_no}, slug: {value!r} must be lower-case letters, "
                "numbers and hyphens — it becomes the page URL"
            )
        return value

    return value or None


def parse(csv_text: str) -> tuple[list[dict], list[str]]:
    """Validate the whole file. Returns (rows, errors) and writes nothing."""
    text = csv_text.lstrip("﻿")
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        return [], ["The file is empty or has no header row."]

    headers = [h.strip().lower() for h in reader.fieldnames]
    unknown = [h for h in headers if h and h not in COLUMNS]
    errors: list[str] = []
    if unknown:
        # Named rather than ignored: a typo'd header means a column the
        # operator believes they set is silently doing nothing.
        errors.append(
            f"Unknown column(s): {', '.join(unknown)}. "
            f"Valid: {', '.join(COLUMNS)}"
        )
    if "slug" not in headers:
        errors.append("A `slug` column is required — it identifies the book.")
    if errors:
        return [], errors

    rows: list[dict] = []
    seen: set[str] = set()
    # Row 1 is the header, so data starts at 2 — matching what the operator
    # sees in Excel's row numbers.
    for row_no, raw_row in enumerate(reader, start=2):
        parsed: dict = {}
        try:
            for header in headers:
                if not header:
                    continue
                parsed[header] = _coerce(header, raw_row.get(header) or "", row_no)
        except BulkError as exc:
            errors.append(str(exc))
            continue

        slug = parsed.get("slug")
        if not slug:
            continue
        if slug in seen:
            errors.append(f"Row {row_no}: slug {slug!r} appears more than once")
            continue
        seen.add(str(slug))

        existing = query_one("SELECT id FROM books WHERE slug = ?", (slug,))
        parsed["_exists"] = existing is not None
        parsed["_row"] = row_no

        if existing is None:
            missing = [
                c for c in REQUIRED_ON_CREATE
                if parsed.get(c) in (None, "")
            ]
            if missing:
                errors.append(
                    f"Row {row_no}: new book {slug!r} is missing "
                    f"{', '.join(missing)}"
                )
                continue
        rows.append(parsed)

    if len(rows) > 2000:
        errors.append("A single import is limited to 2000 rows. Split the file.")
    return rows, errors


def apply(csv_text: str, *, actor_id: str | None = None, dry_run: bool = True) -> dict:
    """Validate and, unless dry_run, write.

    A batch with ANY error writes nothing at all. Partially applying an import
    leaves the operator with no way to tell which rows landed.
    """
    rows, errors = parse(csv_text)

    created = [r["slug"] for r in rows if not r["_exists"]]
    updated = [r["slug"] for r in rows if r["_exists"]]

    result = {
        "dryRun": dry_run,
        "rows": len(rows),
        "created": len(created),
        "updated": len(updated),
        "errors": errors,
        "sampleCreated": created[:10],
        "sampleUpdated": updated[:10],
        "applied": False,
    }
    if errors or dry_run:
        return result

    now = _now()
    with transaction() as conn:
        for row in rows:
            slug = row["slug"]
            # Only the columns PRESENT in the file are touched. A spreadsheet
            # with just slug+price must not blank every description.
            fields = {
                k: v for k, v in row.items()
                if k in COLUMNS and k != "slug" and v is not None
            }
            if row["_exists"]:
                if not fields:
                    continue
                assignments = ", ".join(f"{k} = ?" for k in fields)
                conn.execute(
                    f"UPDATE books SET {assignments}, updated_at = ? WHERE slug = ?",
                    (*fields.values(), now, slug),
                )
            else:
                fields.setdefault("board", "state")
                fields.setdefault("status", "draft")
                columns = ["id", "slug", *fields, "created_at", "updated_at"]
                marks = ",".join("?" * len(columns))
                conn.execute(
                    f"INSERT INTO books ({','.join(columns)}) VALUES ({marks})",
                    (slug, slug, *fields.values(), now, now),
                )

    result["applied"] = True
    log.info(
        "Bulk import by %s: %d created, %d updated",
        actor_id, len(created), len(updated),
    )
    return result
