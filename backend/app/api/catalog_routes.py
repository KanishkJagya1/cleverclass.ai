"""Catalogue read API.

Backs all 18 methods of the frontend's `CatalogAdapter`
(`frontend/lib/data/adapter.ts`). Read-only and unauthenticated by design: this
serves exactly the data the storefront renders publicly anyway. What it is not
is uncapped — every list endpoint bounds `limit`/`perPage`, because an
unbounded page size on a 2 vCPU box is the actual risk here, not disclosure.

Route order matters: static paths (`/books/slugs`) are declared before
parameterised ones (`/books/{slug}`), or FastAPI captures "slugs" as a slug.
"""

from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from app.db.repo import books as books_repo
from app.db.repo import catalog as catalog_repo
from app.schemas.catalog import (
    BookOut,
    CatalogExportOut,
    ComboOut,
    ComboResolvedOut,
    FacetsOut,
    KeyNoteOut,
    PaginatedOut,
    ReviewOut,
    SearchHitOut,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/catalog", tags=["catalog"])

# Cheap defence against a caller asking for the whole catalogue in one page.
# 200 is set from real demand, not picked round: /combo-packs renders every
# combo grouped by class and asks for 200, and /series/[series] asks for 48. A
# cap the application's own pages violate is a badly-chosen cap.
MAX_PER_PAGE = 200
MAX_LIMIT = 50


def _query_params(
    board: str | None = None,
    classId: list[str] | None = Query(default=None),
    medium: list[str] | None = Query(default=None),
    subject: list[str] | None = Query(default=None),
    series: list[str] | None = Query(default=None),
    stream: str | None = None,
    minPrice: int | None = Query(default=None, ge=0),
    maxPrice: int | None = Query(default=None, ge=0),
    inStockOnly: bool = False,
    q: str | None = Query(default=None, max_length=200),
    sort: str | None = None,
    page: int = Query(default=1, ge=1),
    perPage: int = Query(default=24, ge=1, le=MAX_PER_PAGE),
) -> dict:
    """Mirrors `CatalogQuery`. Repeated params (`?classId=9&classId=10`) arrive
    as lists, which is how the storefront's multi-select facets serialise."""
    return {
        "board": board,
        "classId": classId,
        "medium": medium,
        "subject": subject,
        "series": series,
        "stream": stream,
        "minPrice": minPrice,
        "maxPrice": maxPrice,
        "inStockOnly": inStockOnly,
        "q": q,
        "sort": sort,
        "page": page,
        "perPage": perPage,
    }


# --------------------------------------------------------------------------
# Books
# --------------------------------------------------------------------------

@router.get("/books/slugs", response_model=list[str])
def book_slugs(limit: int | None = Query(default=None, ge=1, le=5000)) -> list[str]:
    return books_repo.all_slugs(limit)


@router.get(
    "/books/by-slugs",
    response_model=list[BookOut],
    response_model_exclude_none=True,
)
def books_by_slugs(
    slugs: str = Query(max_length=4000, description="Comma-separated slugs"),
) -> list[dict]:
    """Resolve many slugs in one request.

    The wishlist holds an arbitrary list of slugs client-side; without this it
    would either make one request per item or — as it did — resolve them against
    the bundled seed module and show books that are not in the catalogue.

    Order follows the caller's list, and unknown slugs are dropped rather than
    returning nulls the client has to filter.
    """
    wanted = [s.strip() for s in slugs.split(",") if s.strip()][:100]
    if not wanted:
        return []
    return books_repo.get_books_by_slugs(wanted)


@router.get(
    "/books",
    response_model=PaginatedOut[BookOut],
    response_model_exclude_none=True,
)
def list_books(params: dict = Depends(_query_params)) -> dict:
    return books_repo.list_books(params)


@router.get(
    "/books/{slug}/related",
    response_model=list[BookOut],
    response_model_exclude_none=True,
)
def related_books(
    slug: str = Path(min_length=1, max_length=200),
    limit: int = Query(default=4, ge=1, le=MAX_LIMIT),
) -> list[dict]:
    return books_repo.related(slug, limit)


@router.get(
    "/books/{slug}/frequently-bought-together",
    response_model=list[BookOut],
    response_model_exclude_none=True,
)
def fbt(
    slug: str = Path(min_length=1, max_length=200),
    limit: int = Query(default=3, ge=1, le=MAX_LIMIT),
) -> list[dict]:
    return books_repo.frequently_bought_together(slug, limit)


@router.get(
    "/books/{slug}",
    response_model=BookOut,
    response_model_exclude_none=True,
)
def get_book(slug: str = Path(min_length=1, max_length=200)) -> dict:
    book = books_repo.get_book(slug)
    if book is None:
        raise HTTPException(404, "Book not found")
    return book


# --------------------------------------------------------------------------
# Combos
# --------------------------------------------------------------------------

@router.get("/combos/slugs", response_model=list[str])
def combo_slugs(limit: int | None = Query(default=None, ge=1, le=5000)) -> list[str]:
    return catalog_repo.all_combo_slugs(limit)


@router.get(
    "/combos",
    response_model=PaginatedOut[ComboOut],
    response_model_exclude_none=True,
)
def list_combos(params: dict = Depends(_query_params)) -> dict:
    # `stream` is honoured here. The old combo page declared the param and then
    # filtered on class only, so five landing cards and four mega-menu links
    # pointed at a filter that silently did nothing.
    return catalog_repo.list_combos(params)


@router.get(
    "/combos/{slug}",
    response_model=ComboResolvedOut,
    response_model_exclude_none=True,
)
def get_combo(slug: str = Path(min_length=1, max_length=200)) -> dict:
    combo = catalog_repo.get_combo(slug)
    if combo is None:
        raise HTTPException(404, "Combo not found")
    return combo


# --------------------------------------------------------------------------
# Key notes
# --------------------------------------------------------------------------

@router.get("/key-notes/slugs", response_model=list[str])
def key_note_slugs(limit: int | None = Query(default=None, ge=1, le=5000)) -> list[str]:
    return catalog_repo.all_key_note_slugs(limit)


@router.get(
    "/key-notes",
    response_model=list[KeyNoteOut],
    response_model_exclude_none=True,
)
def list_key_notes(params: dict = Depends(_query_params)) -> list[dict]:
    return catalog_repo.list_key_notes(params)


@router.get(
    "/key-notes/{slug}",
    response_model=KeyNoteOut,
    response_model_exclude_none=True,
)
def get_key_note(slug: str = Path(min_length=1, max_length=200)) -> dict:
    note = catalog_repo.get_key_note(slug)
    if note is None:
        raise HTTPException(404, "Key note not found")
    return note


# --------------------------------------------------------------------------
# Reviews, rails, export
# --------------------------------------------------------------------------

@router.get("/facets", response_model=FacetsOut)
def facets(params: dict = Depends(_query_params)) -> dict:
    """Facet counts for the current filter set.

    Each facet is counted with its own field removed from the filters, so
    ticking "Class 10" does not collapse the class facet to a single option —
    the user must still be able to see and reach Class 9.
    """
    return books_repo.facets(params)


@router.get("/search", response_model=list[SearchHitOut], response_model_exclude_none=True)
def search(
    q: str = Query(min_length=2, max_length=200),
    limit: int = Query(default=8, ge=1, le=MAX_LIMIT),
) -> list[dict]:
    """Ranked lexical search (FTS5 bm25).

    Semantic search lives in the RAG pipeline; this is the fast path the
    command palette hits first.
    """
    from app.services import suggest as suggest_service

    # Synonyms first: this catalogue's customers type "maths", "10th" and "SSC"
    # for things the database calls "Mathematics" and "10". Without the rewrite
    # the search box looks broken to exactly the people it was built for.
    expanded = suggest_service.expand(q)

    hits: list[dict] = []
    for book in books_repo.search_books(expanded, limit):
        cover = next((i["src"] for i in book["images"] if i["kind"] == "front"), None)
        hits.append(
            {
                "slug": book["slug"],
                "title": book["title"],
                "titleMr": book.get("titleMr"),
                "subtitle": f"{book['subject']} · Class {book['classId']} · "
                f"{book['medium'].replace('-', ' ').title()}",
                "format": "book",
                "href": f"/shop/{book['slug']}",
                "image": cover,
                "price": book["price"],
                "mrp": book.get("mrp"),
                # Carried so the assistant's product cards can add the RIGHT
                # variant to the cart instead of guessing class 10 / marathi.
                "classId": book["classId"],
                "medium": book["medium"],
            }
        )
    # Logged after the fact, with the ORIGINAL query rather than the expanded
    # one — the zero-result report is only useful if it shows what the customer
    # actually typed.
    suggest_service.record(q, len(hits), source="search")
    return hits


@router.get("/reviews/{slug}", response_model=list[ReviewOut])
def get_reviews(
    slug: str = Path(min_length=1, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    return catalog_repo.get_reviews(slug, limit)


@router.get(
    "/rails/best-sellers",
    response_model=list[BookOut],
    response_model_exclude_none=True,
)
def best_sellers(
    limit: int = Query(default=8, ge=1, le=MAX_LIMIT),
    classId: str | None = None,
) -> list[dict]:
    return books_repo.best_sellers(limit, classId)


@router.get(
    "/rails/new-arrivals",
    response_model=list[BookOut],
    response_model_exclude_none=True,
)
def new_arrivals(limit: int = Query(default=8, ge=1, le=MAX_LIMIT)) -> list[dict]:
    return books_repo.new_arrivals(limit)


@router.get(
    "/rails/featured",
    response_model=list[BookOut],
    response_model_exclude_none=True,
)
def featured(limit: int = Query(default=8, ge=1, le=MAX_LIMIT)) -> list[dict]:
    return books_repo.featured(limit)


@router.get("/export", response_model=CatalogExportOut)
def export_slugs() -> dict:
    """Every published slug in one response.

    `sitemap.ts` and `generateStaticParams` would otherwise make hundreds of
    individual requests during `next build`.
    """
    return {
        "books": books_repo.all_slugs(),
        "combos": catalog_repo.all_combo_slugs(),
        "keyNotes": catalog_repo.all_key_note_slugs(),
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


@router.get("/suggest")
def suggest(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=8, ge=1, le=20),
) -> dict:
    """Autocomplete for the search box.

    Separate from /search on purpose. This fires on keystrokes, so it is logged
    under `source='suggest'` and kept out of the "popular searches" report —
    otherwise the most popular query in the shop would be the letter "s".
    """
    from app.services import suggest as suggest_service

    result = suggest_service.suggest(q, limit)
    suggest_service.record(q, len(result["books"]), source="suggest")
    return result


@router.get("/masters")
def catalog_masters() -> dict:
    """The five lists, active entries only — what the storefront filters need.

    Public and unauthenticated: these are the same values already visible in
    every facet and URL, so there is nothing here a visitor cannot already see.
    Inactive entries are excluded, which is the whole point of the flag.
    """
    from app.services import masters

    return masters.grouped(active_only=True)
