"""Combos, key notes and reviews.

Books get their own module because they carry the PDF/preview machinery; these
three are plain catalogue reads and belong together.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from app.db.conn import dump_json_list, load_json_list, query, query_one
from app.db.repo import books as books_repo


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# --------------------------------------------------------------------------
# Combos
# --------------------------------------------------------------------------

def _combo_from_row(row: Any, images: list[dict], item_slugs: list[str]) -> dict:
    out: dict[str, Any] = {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "board": row["board"],
        "classId": row["class_id"],
        "medium": row["medium"],
        "price": row["price"],
        "itemSlugs": item_slugs,
        "images": images,
        "highlights": load_json_list(row["highlights"]),
        "description": row["description"],
        "rating": row["rating"],
        "reviewCount": row["review_count"],
        "inStock": bool(row["in_stock"]),
        "publishedAt": row["published_at"],
    }
    if row["title_mr"]:
        out["titleMr"] = row["title_mr"]
    if row["stream"]:
        out["stream"] = row["stream"]
    if row["mrp"] is not None:
        out["mrp"] = row["mrp"]
    return out


def _combo_bundles(combo_ids: list[str]) -> tuple[dict[str, list[dict]], dict[str, list[str]]]:
    """Images and item slugs for N combos in two queries, not 2N."""
    if not combo_ids:
        return {}, {}
    marks = ",".join("?" * len(combo_ids))

    images: dict[str, list[dict]] = {}
    for row in query(
        f"SELECT * FROM combo_images WHERE combo_id IN ({marks}) ORDER BY combo_id, position",
        combo_ids,
    ):
        images.setdefault(row["combo_id"], []).append(
            {
                "src": row["src"],
                "alt": row["alt"],
                "kind": row["kind"],
                "width": row["width"],
                "height": row["height"],
            }
        )

    items: dict[str, list[str]] = {}
    for row in query(
        f"SELECT combo_id, book_slug FROM combo_items WHERE combo_id IN ({marks})"
        f" ORDER BY combo_id, position",
        combo_ids,
    ):
        items.setdefault(row["combo_id"], []).append(row["book_slug"])

    return images, items


def _hydrate_combos(rows: list[Any]) -> list[dict]:
    ids = [r["id"] for r in rows]
    images, items = _combo_bundles(ids)
    return [
        _combo_from_row(r, images.get(r["id"], []), items.get(r["id"], [])) for r in rows
    ]


def list_combos(q: dict | None = None) -> dict:
    q = q or {}
    clauses = ["status = 'published'"]
    params: list[Any] = []

    for field, column in (("classId", "class_id"), ("medium", "medium")):
        values = books_repo._as_list(q.get(field))
        if values:
            marks = ",".join("?" * len(values))
            clauses.append(f"{column} IN ({marks})")
            params.extend(values)

    # The stream filter the storefront advertises on five cards and four
    # mega-menu links, and which the old page silently ignored.
    if q.get("stream"):
        clauses.append("stream = ?")
        params.append(q["stream"])
    if q.get("inStockOnly"):
        clauses.append("in_stock = 1")

    where = " AND ".join(clauses)
    page = max(1, int(q.get("page") or 1))
    per_page = min(200, max(1, int(q.get("perPage") or 24)))

    total = query_one(f"SELECT COUNT(*) AS n FROM combos WHERE {where}", params)["n"]
    rows = query(
        f"SELECT * FROM combos WHERE {where} ORDER BY class_id ASC, medium ASC LIMIT ? OFFSET ?",
        [*params, per_page, (page - 1) * per_page],
    )
    return {
        "items": _hydrate_combos(rows),
        "total": total,
        "page": page,
        "perPage": per_page,
        "totalPages": max(1, -(-total // per_page)),
    }


def get_combo(slug: str) -> dict | None:
    """Returns `ComboResolved` — books resolved and savings arithmetic done.

    The arithmetic is deliberately server-side. It is also the number the sales
    bot is allowed to quote, and an LLM computing a discount is exactly the
    failure that costs money.
    """
    # Published only — see the note on books_repo.get_book. A draft combo would
    # otherwise be publicly readable with a price nobody signed off.
    row = query_one("SELECT * FROM combos WHERE slug = ? AND status = 'published'", (slug,))
    if row is None:
        return None

    combo = _hydrate_combos([row])[0]
    items = books_repo.get_books_by_slugs(combo["itemSlugs"])
    items_total = sum(b["price"] for b in items)
    savings = max(0, items_total - combo["price"])

    combo["items"] = items
    combo["itemsTotal"] = items_total
    combo["savings"] = savings
    combo["savingsPct"] = round(savings / items_total * 100) if items_total else 0
    return combo


def all_combo_slugs(limit: int | None = None) -> list[str]:
    sql = "SELECT slug FROM combos WHERE status = 'published' ORDER BY slug ASC"
    params: list[Any] = []
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    return [r["slug"] for r in query(sql, params)]


def upsert_combo(conn, combo: dict) -> str:
    now = _now()
    combo_id = combo.get("id") or combo["slug"]
    conn.execute(
        "INSERT INTO combos (id, slug, title, title_mr, board, class_id, medium, stream,"
        " price, mrp, description, highlights, rating, review_count, in_stock, status,"
        " published_at, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(slug) DO UPDATE SET"
        "  title=excluded.title, title_mr=excluded.title_mr, board=excluded.board,"
        "  class_id=excluded.class_id, medium=excluded.medium, stream=excluded.stream,"
        "  price=excluded.price, mrp=excluded.mrp, description=excluded.description,"
        "  highlights=excluded.highlights, rating=excluded.rating,"
        "  review_count=excluded.review_count, in_stock=excluded.in_stock,"
        "  status=excluded.status, published_at=excluded.published_at,"
        "  updated_at=excluded.updated_at",
        (
            combo_id, combo["slug"], combo["title"], combo.get("titleMr"),
            combo.get("board", "state"), combo["classId"], combo["medium"],
            combo.get("stream"), int(combo["price"]),
            int(combo["mrp"]) if combo.get("mrp") is not None else None,
            combo.get("description", ""), dump_json_list(combo.get("highlights")),
            float(combo.get("rating") or 0), int(combo.get("reviewCount") or 0),
            1 if combo.get("inStock", True) else 0, combo.get("status", "draft"),
            combo.get("publishedAt", ""), now, now,
        ),
    )
    resolved = conn.execute("SELECT id FROM combos WHERE slug = ?", (combo["slug"],)).fetchone()[0]

    conn.execute("DELETE FROM combo_items WHERE combo_id = ?", (resolved,))
    for position, book_slug in enumerate(combo.get("itemSlugs") or []):
        conn.execute(
            "INSERT INTO combo_items (combo_id, book_slug, position) VALUES (?,?,?)",
            (resolved, book_slug, position),
        )

    images = combo.get("images") or []
    if images:
        conn.execute("DELETE FROM combo_images WHERE combo_id = ?", (resolved,))
        for position, img in enumerate(images):
            conn.execute(
                "INSERT INTO combo_images (combo_id, kind, src, alt, width, height, position)"
                " VALUES (?,?,?,?,?,?,?)",
                (
                    resolved, img.get("kind", "front"), img["src"], img.get("alt", ""),
                    int(img.get("width") or 600), int(img.get("height") or 800), position,
                ),
            )
    return resolved


# --------------------------------------------------------------------------
# Key notes
# --------------------------------------------------------------------------

def _key_note_from_row(row: Any) -> dict:
    out: dict[str, Any] = {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "classId": row["class_id"],
        "subject": row["subject"],
        "medium": row["medium"],
        "board": row["board"],
        "chapters": load_json_list(row["chapters"]),
        # Same as books: preview pages come from the PDF/free-range layer, not
        # from a stored array of image paths that may not exist on disk.
        "previewPages": [],
        "totalPages": row["total_pages"],
        "updatedAt": row["updated_at"],
    }
    if row["title_mr"]:
        out["titleMr"] = row["title_mr"]
    if row["related_book_slug"]:
        out["relatedBookSlug"] = row["related_book_slug"]
    return out


def list_key_notes(q: dict | None = None) -> list[dict]:
    q = q or {}
    clauses = ["status = 'published'"]
    params: list[Any] = []
    for field, column in (("classId", "class_id"), ("subject", "subject"), ("medium", "medium")):
        values = books_repo._as_list(q.get(field))
        if values:
            marks = ",".join("?" * len(values))
            clauses.append(f"{column} IN ({marks})")
            params.extend(values)

    rows = query(
        f"SELECT * FROM key_notes WHERE {' AND '.join(clauses)}"
        f" ORDER BY class_id ASC, subject ASC, medium ASC",
        params,
    )
    return [_key_note_from_row(r) for r in rows]


def get_key_note(slug: str) -> dict | None:
    row = query_one("SELECT * FROM key_notes WHERE slug = ? AND status = 'published'", (slug,))
    return _key_note_from_row(row) if row else None


def all_key_note_slugs(limit: int | None = None) -> list[str]:
    sql = "SELECT slug FROM key_notes WHERE status = 'published' ORDER BY slug ASC"
    params: list[Any] = []
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    return [r["slug"] for r in query(sql, params)]


def upsert_key_note(conn, note: dict) -> str:
    note_id = note.get("id") or f"kn-{note['slug']}"
    conn.execute(
        "INSERT INTO key_notes (id, slug, title, title_mr, class_id, subject, medium,"
        " board, chapters, total_pages, related_book_slug, status, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(slug) DO UPDATE SET"
        "  title=excluded.title, title_mr=excluded.title_mr, class_id=excluded.class_id,"
        "  subject=excluded.subject, medium=excluded.medium, board=excluded.board,"
        "  chapters=excluded.chapters, total_pages=excluded.total_pages,"
        "  related_book_slug=excluded.related_book_slug, status=excluded.status,"
        "  updated_at=excluded.updated_at",
        (
            note_id, note["slug"], note["title"], note.get("titleMr"), note["classId"],
            note["subject"], note["medium"], note.get("board", "state"),
            dump_json_list(note.get("chapters")), int(note.get("totalPages") or 0),
            note.get("relatedBookSlug"), note.get("status", "draft"),
            note.get("updatedAt") or _now(),
        ),
    )
    return note_id


# --------------------------------------------------------------------------
# Reviews
# --------------------------------------------------------------------------

def get_reviews(product_slug: str, limit: int = 50) -> list[dict]:
    rows = query(
        "SELECT * FROM reviews WHERE product_slug = ? AND status = 'published'"
        " ORDER BY date DESC LIMIT ?",
        (product_slug, int(limit)),
    )
    return [
        {
            "id": r["id"],
            "productSlug": r["product_slug"],
            "author": r["author"],
            "rating": r["rating"],
            "title": r["title"],
            "body": r["body"],
            "date": r["date"],
            "verified": bool(r["verified"]),
        }
        for r in rows
    ]


def upsert_review(conn, review: dict) -> None:
    conn.execute(
        "INSERT INTO reviews (id, product_slug, author, rating, title, body, date, verified, status)"
        " VALUES (?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(id) DO UPDATE SET"
        "  author=excluded.author, rating=excluded.rating, title=excluded.title,"
        "  body=excluded.body, date=excluded.date, verified=excluded.verified",
        (
            review["id"], review["productSlug"], review["author"], int(review["rating"]),
            review.get("title", ""), review.get("body", ""), review["date"],
            1 if review.get("verified") else 0, review.get("status", "published"),
        ),
    )
