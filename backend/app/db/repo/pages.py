"""PDF assets, per-page text and free-page ranges.

`is_free` on `book_pages` is denormalised from `free_page_ranges` inside a
single transaction. Two representations of one fact is normally a smell; here it
is deliberate, because the hot paths need different shapes:

  * "is page 42 free?"      — one indexed range lookup, on every preview request
  * "which pages are free?" — a set scan, when rebuilding the sample corpus

Keeping them in step is the job of `set_free_ranges`, which is the only writer.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import uuid

from app.db.conn import query, query_one, scalar, transaction
from app.services import ranges as ranges_service


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# --------------------------------------------------------------------------
# Assets
# --------------------------------------------------------------------------

def create_asset(
    *,
    book_id: str,
    sha256: str,
    original_name: str,
    byte_size: int,
    storage_path: str,
    uploaded_by: str | None,
) -> str:
    asset_id = f"ast_{uuid.uuid4().hex[:12]}"
    with transaction() as conn:
        # Only one current asset per book. A replacement PDF supersedes the old
        # one rather than competing with it.
        conn.execute(
            "UPDATE book_assets SET is_current = 0 WHERE book_id = ?", (book_id,)
        )
        conn.execute(
            "INSERT INTO book_assets (id, book_id, sha256, original_name, byte_size,"
            " storage_path, is_current, process_state, uploaded_by, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,1,'pending',?,?,?)",
            (
                asset_id, book_id, sha256, original_name[:200], byte_size,
                storage_path, uploaded_by, _now(), _now(),
            ),
        )
    return asset_id


def current_asset(book_id: str) -> dict | None:
    row = query_one(
        "SELECT * FROM book_assets WHERE book_id = ? AND is_current = 1", (book_id,)
    )
    return dict(row) if row else None


def get_asset(asset_id: str) -> dict | None:
    row = query_one("SELECT * FROM book_assets WHERE id = ?", (asset_id,))
    return dict(row) if row else None


def set_asset_state(
    asset_id: str,
    state: str,
    *,
    error: str | None = None,
    page_count: int | None = None,
    pages_done: int | None = None,
    outline: str | None = None,
) -> None:
    sets = ["process_state = ?", "updated_at = ?"]
    params: list = [state, _now()]
    if error is not None:
        sets.append("process_error = ?")
        params.append(error[:1000])
    if page_count is not None:
        sets.append("page_count = ?")
        params.append(page_count)
    if pages_done is not None:
        sets.append("pages_done = ?")
        params.append(pages_done)
    if outline is not None:
        sets.append("outline = ?")
        params.append(outline)
    params.append(asset_id)

    with transaction() as conn:
        conn.execute(f"UPDATE book_assets SET {', '.join(sets)} WHERE id = ?", params)


# --------------------------------------------------------------------------
# Page text
# --------------------------------------------------------------------------

def upsert_pages(asset_id: str, pages: list[tuple[int, str]]) -> None:
    """Write a batch of extracted pages.

    Called every 25 pages rather than once at the end: a single write
    transaction held open across a 400-page extraction would block every other
    writer on a single-writer database, and a crash would lose the lot.
    """
    if not pages:
        return
    with transaction() as conn:
        for page_no, text in pages:
            clean = (text or "").strip()
            conn.execute(
                "INSERT INTO book_pages (asset_id, page_no, text, char_count, text_sha1, is_free)"
                " VALUES (?,?,?,?,?,0)"
                " ON CONFLICT(asset_id, page_no) DO UPDATE SET"
                "  text = excluded.text, char_count = excluded.char_count,"
                "  text_sha1 = excluded.text_sha1",
                (
                    asset_id,
                    page_no,
                    clean,
                    len(clean),
                    hashlib.sha1(clean.encode("utf-8")).hexdigest()[:16],
                ),
            )


def page_char_counts(asset_id: str, limit: int = 20) -> list[int]:
    rows = query(
        "SELECT char_count FROM book_pages WHERE asset_id = ? ORDER BY page_no LIMIT ?",
        (asset_id, limit),
    )
    return [int(r["char_count"]) for r in rows]


def free_page_text(book_id: str) -> list[dict]:
    rows = query(
        """
        SELECT p.page_no, p.text FROM book_pages p
          JOIN book_assets a ON a.id = p.asset_id
         WHERE a.book_id = ? AND a.is_current = 1 AND p.is_free = 1
         ORDER BY p.page_no
        """,
        (book_id,),
    )
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------
# Free ranges
# --------------------------------------------------------------------------

def get_ranges(book_id: str) -> list[tuple[int, int]]:
    rows = query(
        "SELECT start_page, end_page FROM free_page_ranges WHERE book_id = ? ORDER BY start_page",
        (book_id,),
    )
    return [(int(r["start_page"]), int(r["end_page"])) for r in rows]


def is_free(book_id: str, page_no: int) -> bool:
    """The hot path, hit on every preview page request.

    One indexed range lookup rather than expanding the set. This is also the
    check that re-verifies a retrieved sample chunk against the LIVE database
    at prompt-build time, closing the window between an admin narrowing a range
    and the corpus re-index landing.
    """
    return (
        scalar(
            "SELECT 1 FROM free_page_ranges WHERE book_id = ?"
            " AND ? BETWEEN start_page AND end_page LIMIT 1",
            (book_id, int(page_no)),
            default=0,
        )
        == 1
    )


def set_free_ranges(
    book_id: str,
    spec: str,
    *,
    changed_by: str | None,
    force: bool = False,
) -> dict:
    """Replace a book's free ranges. The single writer for `is_free`.

    Returns a summary for the admin UI. Raises RangeSpecError for anything the
    admin needs to fix, including the give-away guardrail.
    """
    asset = current_asset(book_id)
    if asset is None:
        raise ranges_service.RangeSpecError("Upload a PDF before choosing free pages.")
    if asset["process_state"] != "ready":
        raise ranges_service.RangeSpecError(
            "The PDF is still being processed — wait for it to finish."
        )

    page_count = int(asset["page_count"] or 0)
    parsed = ranges_service.parse_spec(spec, page_count)

    # Giving away most of a book is a real commercial risk and almost always a
    # typo ("1-200" instead of "1-20"). Refuse once, then take the admin at
    # their word if they confirm.
    from app.config import settings

    share = ranges_service.fraction(parsed, page_count)
    if not force and share > settings.max_free_fraction:
        raise ranges_service.RangeSpecError(
            f"That would give away {round(share * 100)}% of the book "
            f"({ranges_service.total_pages(parsed)} of {page_count} pages). "
            f"Confirm if you meant it."
        )

    old_spec = ranges_service.format_spec(get_ranges(book_id))
    new_spec = ranges_service.format_spec(parsed)
    pages = ranges_service.expand(parsed)

    with transaction() as conn:
        conn.execute("DELETE FROM free_page_ranges WHERE book_id = ?", (book_id,))
        for start, end in parsed:
            conn.execute(
                "INSERT INTO free_page_ranges (book_id, start_page, end_page) VALUES (?,?,?)",
                (book_id, start, end),
            )

        # Reset then set, so pages dropped from the spec are actually cleared.
        conn.execute(
            "UPDATE book_pages SET is_free = 0 WHERE asset_id = ?", (asset["id"],)
        )
        if pages:
            marks = ",".join("?" * len(pages))
            conn.execute(
                f"UPDATE book_pages SET is_free = 1 WHERE asset_id = ? AND page_no IN ({marks})",
                [asset["id"], *sorted(pages)],
            )

        conn.execute(
            "INSERT INTO free_range_history (book_id, old_spec, new_spec, changed_by, changed_at)"
            " VALUES (?,?,?,?,?)",
            (book_id, old_spec, new_spec, changed_by, _now()),
        )

    return {
        "spec": new_spec,
        "ranges": [{"start": s, "end": e} for s, e in parsed],
        "freePages": ranges_service.total_pages(parsed),
        "pageCount": page_count,
        "fraction": round(share, 4),
        "gaps": [
            {"start": s, "end": e} for s, e in ranges_service.gaps(parsed, page_count)
        ],
        "description": ranges_service.describe(parsed, page_count),
    }


def stale_renders(asset_id: str) -> list[str]:
    """Rendered images for pages that are no longer free.

    Serving them would be a hole straight through the range check, so they are
    swept whenever a range narrows.
    """
    rows = query(
        "SELECT render_path FROM book_pages"
        " WHERE asset_id = ? AND is_free = 0 AND render_path IS NOT NULL",
        (asset_id,),
    )
    return [r["render_path"] for r in rows if r["render_path"]]


def clear_renders(asset_id: str, page_numbers: list[int] | None = None) -> None:
    with transaction() as conn:
        if page_numbers:
            marks = ",".join("?" * len(page_numbers))
            conn.execute(
                f"UPDATE book_pages SET render_path = NULL, rendered_at = NULL"
                f" WHERE asset_id = ? AND page_no IN ({marks})",
                [asset_id, *page_numbers],
            )
        else:
            conn.execute(
                "UPDATE book_pages SET render_path = NULL, rendered_at = NULL"
                " WHERE asset_id = ? AND is_free = 0",
                (asset_id,),
            )


def record_render(asset_id: str, page_no: int, path: str) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE book_pages SET render_path = ?, rendered_at = ?"
            " WHERE asset_id = ? AND page_no = ?",
            (path, _now(), asset_id, page_no),
        )
