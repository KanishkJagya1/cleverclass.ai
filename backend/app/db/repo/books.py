"""Book reads and writes.

Rows come out of here already shaped like the TypeScript `Book` interface in
`frontend/types/catalog.ts` — camelCase keys, JSON arrays parsed, images nested.
That contract is enforced by `tests/test_catalog_contract.py`; if you rename a
key here, that test fails, which is the point.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from app.db.conn import dump_json_list, load_json_list, query, query_one, transaction

# Sort keys the frontend can send (`SortKey` in types/catalog.ts) mapped to SQL.
# Whitelisted rather than interpolated — this string is concatenated into the
# query, so anything not in this dict must never reach it.
SORT_SQL: dict[str, str] = {
    "relevance": "b.best_seller_rank IS NULL, b.best_seller_rank ASC, b.rating DESC",
    "popularity": "b.review_count DESC, b.rating DESC",
    "rating": "b.rating DESC, b.review_count DESC",
    "newest": "b.published_at DESC",
    "price-asc": "b.price ASC",
    "price-desc": "b.price DESC",
}
DEFAULT_SORT = "relevance"


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _as_list(value: Any) -> list[str]:
    """CatalogQuery fields accept a scalar or an array; normalise to a list."""
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(v) for v in value if v not in (None, "")]
    return [str(value)] if value != "" else []


# --------------------------------------------------------------------------
# Row -> API shape
# --------------------------------------------------------------------------

def book_from_row(row: Any, images: list[dict] | None = None) -> dict:
    out: dict[str, Any] = {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "series": row["series"],
        "board": row["board"],
        "classId": row["class_id"],
        "medium": row["medium"],
        "subject": row["subject"],
        "price": row["price"],
        "ebookPrice": row["ebook_price"],
        "ebookAvailable": bool(row["ebook_available"]),
        "physicalAvailable": bool(row["physical_available"]),
        "images": images or [],
        # Populated by the preview layer, not stored here — a book has free
        # pages only once a PDF is uploaded and ranges are set.
        "previewPages": [],
        "pages": row["pages"],
        "edition": row["edition"],
        "description": row["description"],
        "highlights": load_json_list(row["highlights"]),
        "rating": row["rating"],
        "reviewCount": row["review_count"],
        "inStock": bool(row["in_stock"]),
        "publishedAt": row["published_at"],
    }
    # Optional fields are omitted rather than sent as null: the TS types mark
    # them `?`, and `exactOptionalPropertyTypes`-style consumers treat an
    # explicit null differently from an absent key.
    if row["title_mr"]:
        out["titleMr"] = row["title_mr"]
    if row["stream"]:
        out["stream"] = row["stream"]
    if row["mrp"] is not None:
        out["mrp"] = row["mrp"]
    if row["isbn"]:
        out["isbn"] = row["isbn"]
    if row["best_seller_rank"] is not None:
        out["bestSellerRank"] = row["best_seller_rank"]
    variants = load_json_list(row["variants"])
    if variants:
        out["variants"] = variants
    related = load_json_list(row["related"])
    if related:
        out["related"] = related
    return out


def image_from_row(row: Any) -> dict:
    out = {
        "src": row["src"],
        "alt": row["alt"],
        "kind": row["kind"],
        "width": row["width"],
        "height": row["height"],
    }
    if row["blur_data_url"]:
        out["blurDataURL"] = row["blur_data_url"]
    return out


def _images_for(book_ids: list[str]) -> dict[str, list[dict]]:
    """One query for N books. Fetching per book is the N+1 that makes a 24-tile
    shop grid do 25 round trips."""
    if not book_ids:
        return {}
    marks = ",".join("?" * len(book_ids))
    rows = query(
        f"SELECT * FROM book_images WHERE book_id IN ({marks}) ORDER BY book_id, position",
        book_ids,
    )
    out: dict[str, list[dict]] = {}
    for row in rows:
        out.setdefault(row["book_id"], []).append(image_from_row(row))
    return out


def _free_page_counts(book_ids: list[str]) -> dict[str, tuple[int, int]]:
    """{book_id: (free_pages, total_pages)} for books that have a sample.

    One query for N books. The product page needs this to say "Read 8 pages
    free" instead of guessing, and to hide the CTA entirely when a book has no
    sample yet — which is most of the catalogue until the PDFs are uploaded.
    """
    if not book_ids:
        return {}
    marks = ",".join("?" * len(book_ids))
    rows = query(
        f"""
        SELECT a.book_id,
               a.page_count,
               (SELECT COUNT(*) FROM book_pages p
                 WHERE p.asset_id = a.id AND p.is_free = 1) AS free_pages
          FROM book_assets a
         WHERE a.book_id IN ({marks}) AND a.is_current = 1 AND a.process_state = 'ready'
        """,
        book_ids,
    )
    return {
        r["book_id"]: (int(r["free_pages"] or 0), int(r["page_count"] or 0))
        for r in rows
        if (r["free_pages"] or 0) > 0
    }


def hydrate(rows: list[Any]) -> list[dict]:
    ids = [r["id"] for r in rows]
    images = _images_for(ids)
    samples = _free_page_counts(ids)
    out = []
    for r in rows:
        book = book_from_row(r, images.get(r["id"], []))
        sample = samples.get(r["id"])
        if sample:
            book["freePageCount"], book["totalPages"] = sample
        out.append(book)
    return out


# --------------------------------------------------------------------------
# Filtering
# --------------------------------------------------------------------------

def _where(q: dict, alias: str = "b") -> tuple[str, list]:
    """Build the shared WHERE clause for list, facet and count queries.

    Returned as (sql, params) so the three callers cannot drift apart — a facet
    count computed against different filters than the result list is the classic
    faceted-search bug.
    """
    # A deleted book is gone from every browse, facet and count in one place.
    # Filtering here rather than at 58 call sites means a new query cannot
    # forget it — and the three callers of this clause stay in step.
    clauses = [f"{alias}.status = 'published'", f"{alias}.deleted_at IS NULL"]
    params: list[Any] = []

    if q.get("board"):
        clauses.append(f"{alias}.board = ?")
        params.append(q["board"])

    for field, column in (
        ("classId", "class_id"),
        ("medium", "medium"),
        ("subject", "subject"),
        ("series", "series"),
    ):
        values = _as_list(q.get(field))
        if values:
            marks = ",".join("?" * len(values))
            clauses.append(f"{alias}.{column} IN ({marks})")
            params.extend(values)

    if q.get("stream"):
        clauses.append(f"{alias}.stream = ?")
        params.append(q["stream"])
    if q.get("minPrice") is not None:
        clauses.append(f"{alias}.price >= ?")
        params.append(int(q["minPrice"]))
    if q.get("maxPrice") is not None:
        clauses.append(f"{alias}.price <= ?")
        params.append(int(q["maxPrice"]))
    if q.get("inStockOnly"):
        clauses.append(f"{alias}.in_stock = 1")

    term = (q.get("q") or "").strip()
    if term:
        # LIKE rather than FTS here: this path filters an already-narrowed
        # facet set, and mixing MATCH with the facet WHERE forces a full FTS
        # scan. Ranked search is a separate endpoint (search_books).
        like = f"%{term.lower()}%"
        clauses.append(
            f"(LOWER({alias}.title) LIKE ? OR LOWER({alias}.subject) LIKE ?"
            f" OR LOWER({alias}.series) LIKE ? OR {alias}.title_mr LIKE ?)"
        )
        params.extend([like, like, like, f"%{term}%"])

    return " AND ".join(clauses), params


def list_books(q: dict | None = None) -> dict:
    """Paginated book list. Mirrors `Paginated<Book>`."""
    q = q or {}
    where, params = _where(q)

    page = max(1, int(q.get("page") or 1))
    per_page = min(200, max(1, int(q.get("perPage") or 24)))
    offset = (page - 1) * per_page

    total = query_one(f"SELECT COUNT(*) AS n FROM books b WHERE {where}", params)["n"]
    order = SORT_SQL.get(str(q.get("sort") or DEFAULT_SORT), SORT_SQL[DEFAULT_SORT])

    rows = query(
        f"SELECT b.* FROM books b WHERE {where} ORDER BY {order}, b.slug ASC LIMIT ? OFFSET ?",
        [*params, per_page, offset],
    )
    return {
        "items": hydrate(rows),
        "total": total,
        "page": page,
        "perPage": per_page,
        "totalPages": max(1, -(-total // per_page)),  # ceil
    }


def get_book(slug: str) -> dict | None:
    """Published books only.

    This used to accept anything except 'archived', which meant a draft — a
    half-finished record with a placeholder price — was readable on the public
    API and rendered on the storefront. Unpublishing has to actually unpublish.
    Admin reads go through admin_routes, which sees every status.
    """
    row = query_one("SELECT * FROM books WHERE slug = ? AND status = 'published' AND deleted_at IS NULL", (slug,))
    if row is None:
        return None
    return hydrate([row])[0]


def get_books_by_slugs(slugs: list[str]) -> list[dict]:
    if not slugs:
        return []
    marks = ",".join("?" * len(slugs))
    rows = query(
        f"SELECT * FROM books WHERE slug IN ({marks}) AND status = 'published' AND deleted_at IS NULL", slugs
    )
    hydrated = hydrate(rows)
    # Preserve the caller's order — combo contents and "related" lists are
    # curated sequences, and SQL IN gives no ordering guarantee.
    by_slug = {b["slug"]: b for b in hydrated}
    return [by_slug[s] for s in slugs if s in by_slug]


def all_slugs(limit: int | None = None) -> list[str]:
    sql = (
        "SELECT slug FROM books WHERE status = 'published' AND deleted_at IS NULL"
        " ORDER BY best_seller_rank IS NULL, best_seller_rank ASC, slug ASC"
    )
    params: list[Any] = []
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    return [r["slug"] for r in query(sql, params)]


def facets(q: dict | None = None) -> dict:
    """Facet counts computed against the same WHERE clause as the result list,
    minus the facet's own field — so ticking "Class 10" doesn't collapse the
    class facet to a single option."""
    q = dict(q or {})
    out: dict[str, Any] = {}

    for field, column in (
        ("classId", "class_id"),
        ("medium", "medium"),
        ("subject", "subject"),
        ("series", "series"),
    ):
        scoped = {k: v for k, v in q.items() if k != field}
        where, params = _where(scoped)
        rows = query(
            f"SELECT b.{column} AS value, COUNT(*) AS n FROM books b"
            f" WHERE {where} AND b.{column} IS NOT NULL AND b.{column} != ''"
            f" GROUP BY b.{column} ORDER BY n DESC, value ASC",
            params,
        )
        out[field] = [
            {"value": r["value"], "label": r["value"], "count": r["n"]} for r in rows
        ]

    where, params = _where(q)
    row = query_one(
        f"SELECT MIN(b.price) AS lo, MAX(b.price) AS hi FROM books b WHERE {where}", params
    )
    out["priceRange"] = {"min": row["lo"] or 0, "max": row["hi"] or 0}
    return out


def search_books(term: str, limit: int = 8) -> list[dict]:
    """Ranked lexical search via FTS5 bm25, with a LIKE fallback.

    FTS5 syntax errors on user input are common (a bare `"` or `*` is enough),
    so the MATCH is wrapped and falls back rather than 500-ing a search box.
    """
    term = (term or "").strip()
    if len(term) < 2:
        return []

    limit = min(50, max(1, limit))
    # Quote each token so punctuation can't be read as FTS operators, and
    # prefix-match the last one so search-as-you-type works.
    tokens = [t for t in "".join(c if c.isalnum() else " " for c in term).split() if t]
    if not tokens:
        return []
    fts_query = " ".join(f'"{t}"' for t in tokens[:-1] + [f"{tokens[-1]}*"])

    try:
        rows = query(
            "SELECT b.*, bm25(books_fts) AS rank FROM books_fts"
            " JOIN books b ON b.rowid = books_fts.rowid"
            " WHERE books_fts MATCH ? AND b.status = 'published' AND deleted_at IS NULL"
            " ORDER BY rank LIMIT ?",
            (fts_query, limit),
        )
    except Exception:  # noqa: BLE001 — malformed FTS expression
        like = f"%{term.lower()}%"
        rows = query(
            "SELECT b.* FROM books b WHERE b.status = 'published' AND deleted_at IS NULL"
            " AND (LOWER(b.title) LIKE ? OR LOWER(b.subject) LIKE ?)"
            " ORDER BY b.best_seller_rank IS NULL, b.best_seller_rank LIMIT ?",
            (like, like, limit),
        )
    return hydrate(rows)


# --------------------------------------------------------------------------
# Curated rails
# --------------------------------------------------------------------------

def best_sellers(limit: int = 8, class_id: str | None = None) -> list[dict]:
    sql = (
        "SELECT * FROM books WHERE status = 'published' AND deleted_at IS NULL AND best_seller_rank IS NOT NULL"
    )
    params: list[Any] = []
    if class_id:
        sql += " AND class_id = ?"
        params.append(class_id)
    sql += " ORDER BY best_seller_rank ASC LIMIT ?"
    params.append(int(limit))
    return hydrate(query(sql, params))


def new_arrivals(limit: int = 8) -> list[dict]:
    return hydrate(
        query(
            "SELECT * FROM books WHERE status = 'published' AND deleted_at IS NULL"
            " ORDER BY published_at DESC, slug ASC LIMIT ?",
            (int(limit),),
        )
    )


def featured(limit: int = 8) -> list[dict]:
    return hydrate(
        query(
            "SELECT * FROM books WHERE status = 'published' AND deleted_at IS NULL AND in_stock = 1"
            " ORDER BY rating DESC, review_count DESC LIMIT ?",
            (int(limit),),
        )
    )


def related(slug: str, limit: int = 4) -> list[dict]:
    book = query_one(
        "SELECT * FROM books WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if book is None:
        return []

    curated = load_json_list(book["related"])
    out = get_books_by_slugs(curated)[:limit]
    if len(out) >= limit:
        return out

    seen = {slug, *(b["slug"] for b in out)}
    marks = ",".join("?" * len(seen))
    rows = query(
        f"SELECT * FROM books WHERE status = 'published' AND deleted_at IS NULL AND class_id = ? AND medium = ?"
        f" AND slug NOT IN ({marks}) ORDER BY rating DESC LIMIT ?",
        [book["class_id"], book["medium"], *seen, limit - len(out)],
    )
    return out + hydrate(rows)


def frequently_bought_together(slug: str, limit: int = 3) -> list[dict]:
    """Same class and medium, different subject — the combination that actually
    gets bought together, and the one that clears the free-shipping threshold."""
    book = query_one(
        "SELECT * FROM books WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if book is None:
        return []
    rows = query(
        "SELECT * FROM books WHERE status = 'published' AND deleted_at IS NULL AND in_stock = 1"
        " AND class_id = ? AND medium = ? AND subject != ? AND slug != ?"
        " ORDER BY best_seller_rank IS NULL, best_seller_rank ASC, rating DESC LIMIT ?",
        (book["class_id"], book["medium"], book["subject"], slug, int(limit)),
    )
    return hydrate(rows)


# --------------------------------------------------------------------------
# Writes
# --------------------------------------------------------------------------

BOOK_COLUMNS = (
    "slug", "title", "title_mr", "series", "board", "class_id", "medium", "subject",
    "stream", "price", "mrp", "pages", "isbn", "edition", "description", "highlights",
    "marketing_copy", "chapter_list", "rating", "review_count", "in_stock", "stock_qty",
    "best_seller_rank", "status", "published_at", "variants", "related",
)


def upsert_book(conn, book: dict) -> str:
    """Insert or update by slug. Caller supplies the connection so a bulk import
    runs inside one transaction rather than 325 of them."""
    now = _now()
    book_id = book.get("id") or book["slug"]
    values = {
        "slug": book["slug"],
        "title": book["title"],
        "title_mr": book.get("titleMr"),
        "series": book["series"],
        "board": book.get("board", "state"),
        "class_id": book["classId"],
        "medium": book["medium"],
        "subject": book["subject"],
        "stream": book.get("stream"),
        "price": int(book["price"]),
        "mrp": int(book["mrp"]) if book.get("mrp") is not None else None,
        "ebook_price": (
            int(book["ebookPrice"]) if book.get("ebookPrice") is not None else None
        ),
        "ebook_available": 1 if book.get("ebookAvailable") else 0,
        # Defaults to available so a payload from an older client — or any
        # caller that has not learned about these fields — keeps the book on
        # sale in print rather than silently delisting it.
        "physical_available": 0 if book.get("physicalAvailable") is False else 1,
        "pages": int(book.get("pages") or 0),
        "isbn": book.get("isbn"),
        "edition": book.get("edition", ""),
        "description": book.get("description", ""),
        "highlights": dump_json_list(book.get("highlights")),
        "marketing_copy": book.get("marketingCopy", ""),
        "chapter_list": dump_json_list(book.get("chapterList")),
        "rating": float(book.get("rating") or 0),
        "review_count": int(book.get("reviewCount") or 0),
        "in_stock": 1 if book.get("inStock", True) else 0,
        "stock_qty": book.get("stockQty"),
        "best_seller_rank": book.get("bestSellerRank"),
        "status": book.get("status", "draft"),
        "published_at": book.get("publishedAt", ""),
        "variants": dump_json_list(book.get("variants")),
        "related": dump_json_list(book.get("related")),
    }

    columns = ", ".join(("id", *BOOK_COLUMNS, "created_at", "updated_at"))
    marks = ", ".join("?" * (len(BOOK_COLUMNS) + 3))
    # created_at is deliberately excluded from the UPDATE — re-importing must
    # not rewrite when a book first appeared.
    updates = ", ".join(f"{c} = excluded.{c}" for c in BOOK_COLUMNS)
    conn.execute(
        f"INSERT INTO books ({columns}) VALUES ({marks})"
        f" ON CONFLICT(slug) DO UPDATE SET {updates}, updated_at = excluded.updated_at",
        [book_id, *(values[c] for c in BOOK_COLUMNS), now, now],
    )

    row = conn.execute("SELECT id FROM books WHERE slug = ?", (book["slug"],)).fetchone()
    resolved_id = row[0]

    images = book.get("images") or []
    if images:
        conn.execute("DELETE FROM book_images WHERE book_id = ?", (resolved_id,))
        for position, img in enumerate(images):
            conn.execute(
                "INSERT INTO book_images"
                " (book_id, kind, src, alt, width, height, blur_data_url, position)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (
                    resolved_id,
                    img.get("kind", "front"),
                    img["src"],
                    img.get("alt", ""),
                    int(img.get("width") or 600),
                    int(img.get("height") or 800),
                    img.get("blurDataURL"),
                    position,
                ),
            )
    return resolved_id


def set_status(slug: str, status: str) -> bool:
    if status not in ("draft", "published", "archived"):
        raise ValueError(f"invalid status: {status}")
    with transaction() as conn:
        cur = conn.execute(
            "UPDATE books SET status = ?, updated_at = ? WHERE slug = ?",
            (status, _now(), slug),
        )
        return cur.rowcount > 0


# --------------------------------------------------------------------------
# Soft delete
# --------------------------------------------------------------------------

def soft_delete(slug: str, *, actor_id: str | None) -> dict:
    """Mark a book deleted. Never removes the row.

    Orders, invoices and the stock ledger all reference `books.id`. An invoice
    that cannot name what was sold is a problem for an auditor, not just a
    broken page — so the row stays and the catalogue stops showing it.

    Status is moved to 'archived' alongside the flag. Belt and braces: any
    query that gates on `status = 'published'` and has not yet learned about
    `deleted_at` still does the right thing.
    """
    now = _now()
    book = query_one(
        "SELECT id, slug, title, status, deleted_at FROM books WHERE slug = ?",
        (slug,),
    )
    if book is None:
        raise LookupError("No such book")
    if book["deleted_at"] is not None:
        # Idempotent rather than an error: a double-click must not 500.
        return {"slug": slug, "alreadyDeleted": True}

    with transaction() as conn:
        conn.execute(
            "UPDATE books SET deleted_at = ?, deleted_by = ?, status = 'archived',"
            " updated_at = ? WHERE slug = ?",
            (now, actor_id, now, slug),
        )
    return {
        "slug": slug,
        "title": book["title"],
        # Returned so the UI can say what it will restore TO, rather than
        # silently republishing a book on restore.
        "previousStatus": book["status"],
        "deletedAt": now,
        "alreadyDeleted": False,
    }


def restore(slug: str, *, status: str = "draft") -> dict:
    """Bring a deleted book back, as a draft by default.

    Deliberately NOT restored to 'published'. A book was deleted for a reason;
    putting it straight back in the shop without anyone looking at it is how a
    wrong price goes live twice.
    """
    if status not in ("draft", "archived"):
        raise ValueError("A restored book may only come back as draft or archived")

    book = query_one("SELECT id, deleted_at FROM books WHERE slug = ?", (slug,))
    if book is None:
        raise LookupError("No such book")
    if book["deleted_at"] is None:
        return {"slug": slug, "alreadyLive": True}

    now = _now()
    with transaction() as conn:
        conn.execute(
            "UPDATE books SET deleted_at = NULL, deleted_by = NULL, status = ?,"
            " updated_at = ? WHERE slug = ?",
            (status, now, slug),
        )
    return {"slug": slug, "status": status, "alreadyLive": False}


def deleted(limit: int = 50, offset: int = 0) -> dict:
    """The bin, newest first, with a total so the UI can paginate it."""
    total = query_one(
        "SELECT COUNT(*) AS n FROM books WHERE deleted_at IS NOT NULL"
    )["n"]
    rows = query(
        "SELECT b.slug, b.title, b.class_id, b.medium, b.subject, b.price,"
        " b.deleted_at, b.deleted_by, u.email AS deleted_by_email"
        " FROM books b LEFT JOIN admin_users u ON u.id = b.deleted_by"
        " WHERE b.deleted_at IS NOT NULL"
        " ORDER BY b.deleted_at DESC LIMIT ? OFFSET ?",
        (int(limit), int(offset)),
    )
    return {
        "items": [
            {
                "slug": r["slug"], "title": r["title"], "classId": r["class_id"],
                "medium": r["medium"], "subject": r["subject"], "price": r["price"],
                "deletedAt": r["deleted_at"],
                # Who did it, by email — "deleted_by: 7f3a-..." answers nothing.
                "deletedBy": r["deleted_by_email"] or r["deleted_by"],
            }
            for r in rows
        ],
        "total": total,
    }
