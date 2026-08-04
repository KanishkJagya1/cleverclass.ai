"""Free-sample preview API.

The whole feature reduces to one rule, enforced here and nowhere else:

    A page is served if and only if it is inside a free range, checked against
    the database on every single request.

The client is never trusted. Not the page number, not the dpi, not a signed
token, not a referer. Every path is built from validated integers, so directory
traversal is impossible by construction rather than by sanitising.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from fastapi.responses import FileResponse

from app.config import settings
from app.db.conn import query_one
from app.db.repo import pages as pages_repo
from app.services import pdf, ranges as ranges_service, storage
from app.services.ratelimit import SlidingWindowLimiter, client_ip

log = logging.getLogger(__name__)
router = APIRouter(prefix="/preview", tags=["preview"])

# Rendering is the expensive operation here; the manifest is cheap.
_limiter = SlidingWindowLimiter([(settings.preview_rpm, 60), (settings.preview_rpm * 20, 3600)])

# One render per (asset, page, dpi), even under ten simultaneous readers.
# Without this, a burst on an uncached page starts ten identical renders and
# every one of them pays the full cost.
_render_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


def _book_and_asset(slug: str) -> tuple[dict, dict]:
    book = query_one(
        "SELECT id, slug, title, pages FROM books WHERE slug = ? AND status = 'published'",
        (slug,),
    )
    if book is None:
        raise HTTPException(404, "Not found")

    asset = pages_repo.current_asset(book["id"])
    if asset is None or asset["process_state"] != "ready":
        raise HTTPException(404, "No preview available for this book")

    return dict(book), asset


def _spec_hash(book_id: str, asset_sha: str) -> str:
    """Changes whenever the free ranges change.

    Used as a cache-buster in the manifest's page URLs. Page images are served
    `immutable` because the bytes genuinely never change — but when an admin
    LOCKS a previously free page, caches would happily keep serving it for a
    day. A new hash means a new URL, so the old bytes become unreachable the
    moment the manifest refreshes.
    """
    spec = ranges_service.format_spec(pages_repo.get_ranges(book_id))
    return hashlib.sha1(f"{asset_sha}:{spec}".encode()).hexdigest()[:10]


@router.get("/{slug}/manifest")
def manifest(request: Request, slug: str = Path(min_length=1, max_length=200)) -> dict:
    """Everything the reader needs to render, in one request.

    Includes the LOCKED gaps as well as the free pages. The reader draws those
    as "pages 9–23 are in the full book" rather than skipping silently — seeing
    the gap is the strongest reason a sample gives anyone to buy.
    """
    allowed, retry = _limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests", headers={"Retry-After": str(retry)})

    book, asset = _book_and_asset(slug)
    parsed = pages_repo.get_ranges(book["id"])
    if not parsed:
        raise HTTPException(404, "No free pages have been set for this book")

    page_count = int(asset["page_count"] or 0)
    version = _spec_hash(book["id"], asset["sha256"])

    pages = []
    for start, end in parsed:
        for n in range(start, end + 1):
            pages.append(
                {
                    "n": n,
                    "url": f"/preview/{slug}/page/{n}.webp?v={version}",
                    "thumb": f"/preview/{slug}/page/{n}.webp?dpi=72&v={version}",
                }
            )

    response_body = {
        "slug": slug,
        "title": book["title"],
        "totalPages": page_count,
        "freeRanges": [{"start": s, "end": e} for s, e in parsed],
        "gaps": [
            {"start": s, "end": e} for s, e in ranges_service.gaps(parsed, page_count)
        ],
        "freePageCount": ranges_service.total_pages(parsed),
        "pages": pages,
        "version": version,
    }
    return response_body


@router.get("/{slug}/page/{page_no}.webp")
async def page_image(
    request: Request,
    slug: str = Path(min_length=1, max_length=200),
    # Bounded by the router, so no unvalidated integer ever reaches a file path.
    page_no: int = Path(ge=1, le=5000),
    # An ENUM, not a free integer: `?dpi=4000` would be a one-request memory
    # exhaustion on a 2 vCPU box.
    dpi: int = Query(default=144, description="72 for thumbnails, 144 for reading"),
    v: str | None = Query(default=None, max_length=32),
) -> Response:
    allowed, retry = _limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(429, "Too many requests", headers={"Retry-After": str(retry)})

    if dpi not in (72, 144):
        raise HTTPException(422, "dpi must be 72 or 144")

    book, asset = _book_and_asset(slug)

    # ── THE CHECK ─────────────────────────────────────────────────────────
    # One indexed range lookup against the LIVE database. Not a cached list,
    # not a signed token, not something the manifest said earlier — the state
    # right now. An admin who locks a page has locked it for the next request.
    if not pages_repo.is_free(book["id"], page_no):
        raise HTTPException(403, "That page is not part of the free sample")
    # ──────────────────────────────────────────────────────────────────────

    target = storage.preview_path(asset["id"], page_no, dpi)

    if not target.is_file():
        lock = _render_locks[f"{asset['id']}:{page_no}:{dpi}"]
        async with lock:
            # Re-check inside the lock: another request may have rendered it
            # while this one waited.
            if not target.is_file():
                source = storage.absolute(asset["storage_path"])
                if not source.is_file():
                    log.error("Asset file missing for %s page %d", slug, page_no)
                    raise HTTPException(404, "Preview unavailable")

                mark = f"{settings.company_name} · Free sample · cleverclass.ai"
                try:
                    # Rendering blocks; keep it off the event loop or one slow
                    # page stalls every other request on the worker.
                    data = await asyncio.to_thread(
                        pdf.render_page, source, page_no, dpi, mark
                    )
                except pdf.PdfError as exc:
                    raise HTTPException(404, str(exc)) from exc

                tmp = target.with_suffix(".tmp")
                tmp.write_bytes(data)
                tmp.replace(target)  # atomic: no reader sees a partial image
                if dpi == settings.preview_dpi:
                    pages_repo.record_render(asset["id"], page_no, storage.relative(target))

    return FileResponse(
        target,
        media_type="image/webp",
        headers={
            # Safe to cache hard BECAUSE the URL carries the spec hash: locking
            # a page changes the hash, which changes the URL.
            "Cache-Control": "public, max-age=86400, immutable",
            "X-Robots-Tag": "noindex, nofollow, noimageindex",
            "Content-Disposition": "inline",
        },
    )
