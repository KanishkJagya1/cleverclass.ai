"""Admin API: authentication and book management.

Security model — three independent layers, because none of them is sufficient
alone:

  1. Network.  nginx serves this on the admin port behind HTTP Basic auth. That
     answers "should you be at this URL at all".
  2. Session.  An HttpOnly cookie identifies WHO is acting, which is what makes
     the audit trail meaningful. Basic auth alone gives one shared identity.
  3. CSRF.     A double-submit token on every write. The session cookie is
     SameSite=Lax, which stops cross-site POSTs in current browsers, but Lax is
     a mitigation and not a guarantee — a top-level GET-initiated form post is
     still a documented gap.

⚠ Over plain HTTP the cookie and the password cross the network in cleartext.
That is a deliberate, accepted trade for this deployment. `COOKIE_SECURE=true`
is the single switch to flip once TLS is in front.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from typing import Any

from fastapi import (
    APIRouter,
    Body,
    Cookie,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

from app.config import settings
from app.db.conn import query, query_one, transaction
from app.db.repo import admin as admin_repo
from app.db.repo import books as books_repo
from app.db.repo import leads as leads_repo
from app.db.repo import orders as orders_repo

from app.db.repo import pages as pages_repo
from app.rag import corpus
from app.services import pdf, pdf_worker, revalidate, storage
from app.services import ranges as ranges_service
from app.services.ratelimit import SlidingWindowLimiter, client_ip
from app.services import permissions
from app.services import inventory
from app.services import order_flow
from app.services import payments
from app.services import reviews as reviews_service
from app.services import coupons as coupons_service
from app.services import exports
from app.services import shipping
from app.services import support
from app.services import templates as templates_service
from app.services import customer_admin
from app.services import notifications
from app.services import analytics

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin-api", tags=["admin"])

SESSION_COOKIE = "cc_admin"

# 10 attempts per 15 minutes per IP. Slow enough to make online guessing
# useless, generous enough that a real person who forgets their password twice
# is not locked out of their own shop.
_login_limiter = SlidingWindowLimiter([(settings.login_per_15min, 900)])


# --------------------------------------------------------------------------
# Dependencies
# --------------------------------------------------------------------------

def current_admin(
    request: Request,
    cc_admin: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict:
    session = admin_repo.resolve_session(cc_admin)
    if session is None:
        raise HTTPException(401, "Not signed in")
    request.state.admin = session
    return session


def require_csrf(
    request: Request,
    admin: dict = Depends(current_admin),
) -> dict:
    """Double-submit check on every state-changing request.

    The token is issued with the session and echoed by the client in
    X-CSRF-Token. An attacker on another origin can cause the cookie to be sent
    but cannot read it to set the header.
    """
    from app.services.security import constant_time_equals

    sent = request.headers.get("x-csrf-token")
    if not constant_time_equals(sent, admin["csrf_token"]):
        raise HTTPException(403, "Missing or invalid CSRF token")
    return admin


def require_read(permission: str):
    """Authorisation for a read route.

    Three separate questions, three dependencies: `current_admin` asks WHO,
    `require_csrf` asks DID THEY MEAN TO, and the permission asks MAY THEY.
    Merging them would force a read route to pay for a CSRF check it does not
    need, or a write route to skip the permission check it does.
    """

    def dependency(admin: dict = Depends(current_admin)) -> dict:
        permissions.check(admin, permission)
        return admin

    return dependency


def require_write(permission: str):
    """Authorisation for a state-changing route: CSRF *and* permission.

    Depends on `require_csrf`, which depends on `current_admin`, so the session
    is still resolved exactly once per request.
    """

    def dependency(admin: dict = Depends(require_csrf)) -> dict:
        permissions.check(admin, permission)
        return admin

    return dependency


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------

class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class MeOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    csrfToken: str


class BookIn(BaseModel):
    """Admin-editable book fields. Deliberately not the full read model —
    rating, reviewCount and bestSellerRank are derived, not authored."""

    slug: str = Field(min_length=1, max_length=200, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str = Field(min_length=1, max_length=300)
    titleMr: str | None = Field(default=None, max_length=300)
    series: str
    board: str = "state"
    classId: str
    medium: str
    subject: str = Field(min_length=1, max_length=100)
    stream: str | None = None

    price: int = Field(ge=0, le=100000)
    mrp: int | None = Field(default=None, ge=0, le=100000)

    pages: int = Field(default=0, ge=0, le=5000)
    isbn: str | None = Field(default=None, max_length=40)
    edition: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=8000)
    highlights: list[str] = Field(default_factory=list, max_length=20)

    marketingCopy: str = Field(default="", max_length=4000)
    # What the sales bot uses to answer "does this cover trigonometry?" WITHOUT
    # reading a single page of the book.
    chapterList: list[str] = Field(default_factory=list, max_length=200)

    inStock: bool = True
    stockQty: int | None = Field(default=None, ge=0, le=1000000)
    status: str = Field(default="draft", pattern="^(draft|published|archived)$")
    publishedAt: str = Field(default="", max_length=40)


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------

@router.post("/auth/login", response_model=MeOut)
def login(request: Request, response: Response, body: LoginIn) -> dict:
    ip = client_ip(request)
    allowed, retry = _login_limiter.check(ip)
    if not allowed:
        raise HTTPException(429, "Too many attempts. Try again shortly.",
                            headers={"Retry-After": str(retry)})

    user = admin_repo.get_user_by_email(str(body.email))
    from app.services.security import verify_password

    # Always run a verification, even when the user does not exist, so response
    # time does not reveal which emails are registered.
    stored = user["password_hash"] if user else (
        "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A" * 43 + "="
    )
    ok = verify_password(body.password, stored)

    if not user or not ok or not user["is_active"]:
        admin_repo.audit(user_id=user["id"] if user else None, action="auth.login.failed",
                         detail={"email": str(body.email)}, ip=ip)
        raise HTTPException(401, "Incorrect email or password")

    token, csrf = admin_repo.create_session(
        user["id"], ip, request.headers.get("user-agent")
    )
    _login_limiter.reset(ip)

    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.admin_session_hours * 3600,
        httponly=True,
        # Lax, not Strict: Strict would drop the cookie when an admin follows a
        # link into the panel from anywhere else, which reads as a random logout.
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    admin_repo.audit(user_id=user["id"], action="auth.login", ip=ip)
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "csrfToken": csrf,
    }


@router.post("/auth/logout")
def logout(
    request: Request,
    response: Response,
    cc_admin: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict:
    session = admin_repo.resolve_session(cc_admin)
    admin_repo.revoke_session(cc_admin)
    response.delete_cookie(SESSION_COOKIE, path="/")
    if session:
        admin_repo.audit(user_id=session["id"], action="auth.logout", ip=client_ip(request))
    return {"ok": True}


@router.get("/auth/me", response_model=MeOut)
def me(admin: dict = Depends(current_admin)) -> dict:
    return {
        "id": admin["id"],
        "email": admin["email"],
        "name": admin["name"],
        "role": admin["role"],
        "csrfToken": admin["csrf_token"],
    }


# --------------------------------------------------------------------------
# Books
# --------------------------------------------------------------------------

@router.get("/books")
def admin_list_books(
    admin: dict = Depends(require_read(permissions.BOOKS_READ)),
    q: str | None = Query(default=None, max_length=200),
    status: str | None = Query(default=None, pattern="^(draft|published|archived)$"),
    classId: str | None = None,
    page: int = Query(default=1, ge=1),
    perPage: int = Query(default=50, ge=1, le=200),
) -> dict:
    """Unlike the public list, this one shows drafts and archived books, and
    reports PDF/free-page state so the table can say what still needs doing."""
    clauses: list[str] = ["1=1"]
    params: list[Any] = []
    if status:
        clauses.append("b.status = ?")
        params.append(status)
    if classId:
        clauses.append("b.class_id = ?")
        params.append(classId)
    if q:
        like = f"%{q.lower()}%"
        clauses.append("(LOWER(b.title) LIKE ? OR LOWER(b.slug) LIKE ? OR LOWER(b.subject) LIKE ?)")
        params.extend([like, like, like])

    where = " AND ".join(clauses)
    total = query_one(f"SELECT COUNT(*) AS n FROM books b WHERE {where}", params)["n"]

    rows = query(
        f"""
        SELECT b.id, b.slug, b.title, b.class_id, b.medium, b.subject, b.series,
               b.price, b.mrp, b.in_stock, b.stock_qty, b.status, b.updated_at,
               (SELECT src FROM book_images i WHERE i.book_id = b.id
                 ORDER BY i.position LIMIT 1) AS cover,
               (SELECT a.process_state FROM book_assets a
                 WHERE a.book_id = b.id AND a.is_current = 1) AS pdf_state,
               (SELECT a.page_count FROM book_assets a
                 WHERE a.book_id = b.id AND a.is_current = 1) AS page_count,
               (SELECT COUNT(*) FROM book_pages p
                 JOIN book_assets a2 ON a2.id = p.asset_id
                WHERE a2.book_id = b.id AND a2.is_current = 1 AND p.is_free = 1) AS free_pages
        FROM books b WHERE {where}
        ORDER BY b.updated_at DESC LIMIT ? OFFSET ?
        """,
        [*params, perPage, (page - 1) * perPage],
    )

    return {
        "items": [
            {
                "id": r["id"],
                "slug": r["slug"],
                "title": r["title"],
                "classId": r["class_id"],
                "medium": r["medium"],
                "subject": r["subject"],
                "series": r["series"],
                "price": r["price"],
                "mrp": r["mrp"],
                "inStock": bool(r["in_stock"]),
                "stockQty": r["stock_qty"],
                "status": r["status"],
                "updatedAt": r["updated_at"],
                "cover": r["cover"],
                "pdfState": r["pdf_state"],
                "pageCount": r["page_count"] or 0,
                "freePages": r["free_pages"] or 0,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "perPage": perPage,
        "totalPages": max(1, -(-total // perPage)),
    }


@router.get("/books/{slug}")
def admin_get_book(slug: str, admin: dict = Depends(require_read(permissions.BOOKS_READ))) -> dict:
    row = query_one("SELECT * FROM books WHERE slug = ?", (slug,))
    if row is None:
        raise HTTPException(404, "Book not found")

    from app.db.conn import load_json_list

    asset = query_one(
        "SELECT * FROM book_assets WHERE book_id = ? AND is_current = 1", (row["id"],)
    )
    ranges = query(
        "SELECT start_page, end_page FROM free_page_ranges WHERE book_id = ? ORDER BY start_page",
        (row["id"],),
    )

    return {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "titleMr": row["title_mr"],
        "series": row["series"],
        "board": row["board"],
        "classId": row["class_id"],
        "medium": row["medium"],
        "subject": row["subject"],
        "stream": row["stream"],
        "price": row["price"],
        "mrp": row["mrp"],
        "pages": row["pages"],
        "isbn": row["isbn"],
        "edition": row["edition"],
        "description": row["description"],
        "highlights": load_json_list(row["highlights"]),
        "marketingCopy": row["marketing_copy"],
        "chapterList": load_json_list(row["chapter_list"]),
        "inStock": bool(row["in_stock"]),
        "stockQty": row["stock_qty"],
        "status": row["status"],
        "publishedAt": row["published_at"],
        "updatedAt": row["updated_at"],
        "asset": (
            {
                "id": asset["id"],
                "originalName": asset["original_name"],
                "pageCount": asset["page_count"],
                "processState": asset["process_state"],
                "processError": asset["process_error"],
                "pagesDone": asset["pages_done"],
            }
            if asset
            else None
        ),
        "freeRanges": [{"start": r["start_page"], "end": r["end_page"]} for r in ranges],
    }


@router.post("/books", status_code=201)
def admin_create_book(
    request: Request,
    body: BookIn,
    admin: dict = Depends(require_write(permissions.BOOKS_WRITE)),
) -> dict:
    if query_one("SELECT id FROM books WHERE slug = ?", (body.slug,)):
        raise HTTPException(409, f"A book with slug '{body.slug}' already exists")

    with transaction() as conn:
        book_id = books_repo.upsert_book(conn, body.model_dump())

    admin_repo.audit(
        user_id=admin["id"], action="book.create", entity="book", entity_id=body.slug,
        detail={"title": body.title, "price": body.price}, ip=client_ip(request),
    )
    revalidate.book_changed(body.slug)
    return {"id": book_id, "slug": body.slug}


@router.put("/books/{slug}")
def admin_update_book(
    slug: str,
    request: Request,
    body: BookIn,
    admin: dict = Depends(require_write(permissions.BOOKS_WRITE)),
) -> dict:
    existing = query_one("SELECT id, price, status FROM books WHERE slug = ?", (slug,))
    if existing is None:
        raise HTTPException(404, "Book not found")
    if body.slug != slug and query_one("SELECT id FROM books WHERE slug = ?", (body.slug,)):
        raise HTTPException(409, f"A book with slug '{body.slug}' already exists")

    payload = body.model_dump()
    payload["id"] = existing["id"]

    with transaction() as conn:
        # Keep the original slug in the WHERE by writing through the id.
        conn.execute("UPDATE books SET slug = ? WHERE id = ?", (body.slug, existing["id"]))
        books_repo.upsert_book(conn, payload)

    admin_repo.audit(
        user_id=admin["id"], action="book.update", entity="book", entity_id=body.slug,
        detail={
            "priceFrom": existing["price"], "priceTo": body.price,
            "statusFrom": existing["status"], "statusTo": body.status,
        },
        ip=client_ip(request),
    )
    # Both slugs: an edit that renames the slug must clear the old URL too.
    revalidate.book_changed(body.slug, slug)
    return {"ok": True, "slug": body.slug}


@router.post("/books/{slug}/status")
def admin_set_status(
    slug: str,
    request: Request,
    status: str = Body(embed=True, pattern="^(draft|published|archived)$"),
    admin: dict = Depends(require_write(permissions.BOOKS_WRITE)),
) -> dict:
    if not books_repo.set_status(slug, status):
        raise HTTPException(404, "Book not found")
    admin_repo.audit(
        user_id=admin["id"], action="book.status", entity="book", entity_id=slug,
        detail={"status": status}, ip=client_ip(request),
    )
    revalidate.book_changed(slug)
    return {"ok": True, "slug": slug, "status": status}


# --------------------------------------------------------------------------
# PDF upload and free-page ranges
# --------------------------------------------------------------------------

@router.post("/books/{slug}/pdf", status_code=202)
async def admin_upload_pdf(
    slug: str,
    request: Request,
    file: UploadFile = File(...),
    admin: dict = Depends(require_write(permissions.BOOKS_WRITE)),
) -> dict:
    """Accept a book PDF. Returns 202 — processing happens in the background.

    The body is streamed to disk in 1 MB chunks with a running byte count. The
    old `/upload` route did `await file.read()` and only THEN checked the size,
    so a 2 GB upload was 2 GB resident on a memory-capped container before being
    rejected. Never buffer a whole upload to check whether it is too big.
    """
    book = query_one("SELECT id, slug FROM books WHERE slug = ?", (slug,))
    if book is None:
        raise HTTPException(404, "Book not found")

    limit = settings.max_pdf_mb * 1024 * 1024
    staging = storage.tmp_dir() / f"{uuid.uuid4().hex}.part"
    digest = hashlib.sha256()
    total = 0
    first = b""

    try:
        with staging.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > limit:
                    raise HTTPException(413, f"That PDF is larger than {settings.max_pdf_mb} MB.")
                if not first:
                    first = chunk[:8]
                digest.update(chunk)
                out.write(chunk)

        if total == 0:
            raise HTTPException(400, "The uploaded file was empty.")
        # Magic bytes, not the filename or the client's Content-Type — both of
        # those are supplied by whoever is uploading.
        if not first.startswith(pdf.PDF_MAGIC):
            raise HTTPException(400, "That file is not a PDF.")

        sha = digest.hexdigest()
        destination = storage.pdf_path(book["id"], sha)
        # os.replace is atomic within a filesystem, so a reader can never see a
        # half-written PDF at the destination path.
        staging.replace(destination)
        storage.harden(destination)

        try:
            info = pdf.inspect(destination)
        except pdf.PdfError as exc:
            destination.unlink(missing_ok=True)
            raise HTTPException(400, str(exc)) from exc

        asset_id = pages_repo.create_asset(
            book_id=book["id"],
            sha256=sha,
            original_name=file.filename or "book.pdf",
            byte_size=total,
            storage_path=storage.relative(destination),
            uploaded_by=admin["id"],
        )
        pages_repo.set_asset_state(asset_id, "pending", page_count=info.page_count)

        # A new PDF invalidates the previous one's ranges and rendered pages:
        # page 12 of the new file is not page 12 of the old one.
        with transaction() as conn:
            conn.execute("DELETE FROM free_page_ranges WHERE book_id = ?", (book["id"],))

        pdf_worker.enqueue(asset_id)

        admin_repo.audit(
            user_id=admin["id"], action="book.pdf.upload", entity="book", entity_id=slug,
            detail={"pages": info.page_count, "bytes": total, "name": file.filename},
            ip=client_ip(request),
        )

        return {
            "assetId": asset_id,
            "pageCount": info.page_count,
            "bytes": total,
            "state": "pending",
            "outline": info.outline,
        }
    finally:
        staging.unlink(missing_ok=True)


@router.get("/books/{slug}/pdf-status")
def admin_pdf_status(slug: str, admin: dict = Depends(require_read(permissions.BOOKS_READ))) -> dict:
    """Polled by the upload UI while extraction runs."""
    book = query_one("SELECT id FROM books WHERE slug = ?", (slug,))
    if book is None:
        raise HTTPException(404, "Book not found")

    asset = pages_repo.current_asset(book["id"])
    if asset is None:
        return {"state": "none"}

    return {
        "assetId": asset["id"],
        "state": asset["process_state"],
        "pageCount": asset["page_count"],
        "pagesDone": asset["pages_done"],
        "error": asset["process_error"],
        "originalName": asset["original_name"],
        "outline": json.loads(asset["outline"] or "[]"),
    }


class FreeRangesIn(BaseModel):
    spec: str = Field(default="", max_length=2000)
    # Set only after the admin confirms an unusually large give-away.
    force: bool = False


@router.put("/books/{slug}/free-ranges")
def admin_set_free_ranges(
    slug: str,
    request: Request,
    body: FreeRangesIn,
    admin: dict = Depends(require_write(permissions.BOOKS_WRITE)),
) -> dict:
    """Set which pages are free.

    This is the pivot of the whole feature. In one call it:
      1. rewrites free_page_ranges and book_pages.is_free in one transaction
      2. re-syncs cc_samples — ADDING newly-free page text and, critically,
         DELETING text for pages that just stopped being free
      3. sweeps rendered images for pages that are no longer free
      4. tells the storefront to drop its cache
    """
    book = query_one("SELECT id, slug FROM books WHERE slug = ?", (slug,))
    if book is None:
        raise HTTPException(404, "Book not found")

    try:
        result = pages_repo.set_free_ranges(
            book["id"], body.spec, changed_by=admin["id"], force=body.force
        )
    except ranges_service.RangeSpecError as exc:
        # 422 rather than 400: this is a well-formed request whose content the
        # admin needs to correct, and the UI shows the message verbatim.
        raise HTTPException(422, str(exc)) from exc

    store = getattr(request.app.state, "store", None)
    delta = None
    if store is not None:
        delta = corpus.sync_book_samples(store, book["id"])

    asset = pages_repo.current_asset(book["id"])
    if asset:
        # Any rendered image for a now-locked page is a hole straight through
        # the range check, so it goes.
        for rel in pages_repo.stale_renders(asset["id"]):
            try:
                storage.absolute(rel).unlink(missing_ok=True)
            except (OSError, ValueError):
                pass
        pages_repo.clear_renders(asset["id"])

    admin_repo.audit(
        user_id=admin["id"], action="book.free_ranges.update", entity="book", entity_id=slug,
        detail={
            "spec": result["spec"],
            "freePages": result["freePages"],
            "indexed": delta.added if delta else None,
            "removed": delta.deleted if delta else None,
        },
        ip=client_ip(request),
    )
    revalidate.book_changed(slug)

    return {
        **result,
        "corpus": (
            {"added": delta.added, "removed": delta.deleted, "unchanged": delta.unchanged}
            if delta
            else None
        ),
    }


@router.get("/books/{slug}/free-ranges")
def admin_get_free_ranges(slug: str, admin: dict = Depends(require_read(permissions.BOOKS_READ))) -> dict:
    book = query_one("SELECT id FROM books WHERE slug = ?", (slug,))
    if book is None:
        raise HTTPException(404, "Book not found")

    asset = pages_repo.current_asset(book["id"])
    page_count = int(asset["page_count"] or 0) if asset else 0
    parsed = pages_repo.get_ranges(book["id"])

    return {
        "spec": ranges_service.format_spec(parsed),
        "ranges": [{"start": s, "end": e} for s, e in parsed],
        "gaps": [{"start": s, "end": e} for s, e in ranges_service.gaps(parsed, page_count)],
        "freePages": ranges_service.total_pages(parsed),
        "pageCount": page_count,
        "fraction": round(ranges_service.fraction(parsed, page_count), 4),
        "description": ranges_service.describe(parsed, page_count),
        "maxFraction": settings.max_free_fraction,
        "outline": json.loads(asset["outline"] or "[]") if asset else [],
        "state": asset["process_state"] if asset else "none",
    }


# --------------------------------------------------------------------------
# Orders, leads and the audit trail (read-only for now)
# --------------------------------------------------------------------------

@router.get("/orders")
def admin_orders(
    admin: dict = Depends(require_read(permissions.ORDERS_READ)),
    status: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    sql = "SELECT * FROM orders"
    params: list[Any] = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    out = []
    for row in query(sql, params):
        items = query(
            "SELECT slug, title, qty, unit_price, line_total FROM order_items WHERE order_id = ?",
            (row["id"],),
        )
        out.append(
            {
                **{k: row[k] for k in row.keys()},
                "items": [dict(i) for i in items],
            }
        )
    return out


@router.get("/leads")
def admin_leads(
    admin: dict = Depends(require_read(permissions.LEADS_READ)),
    kind: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    return leads_repo.recent(kind, limit)


@router.get("/audit")
def admin_audit_log(
    admin: dict = Depends(require_read(permissions.AUDIT_READ)),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    return admin_repo.recent_audit(limit)


@router.get("/stats")
def admin_stats(admin: dict = Depends(current_admin)) -> dict:
    """The dashboard's numbers, in one query round trip."""

    def count(sql: str, params: tuple = ()) -> int:
        row = query_one(sql, params)
        return int(row["n"]) if row else 0

    return {
        "books": {
            "total": count("SELECT COUNT(*) AS n FROM books"),
            "published": count("SELECT COUNT(*) AS n FROM books WHERE status='published'"),
            "draft": count("SELECT COUNT(*) AS n FROM books WHERE status='draft'"),
            "outOfStock": count("SELECT COUNT(*) AS n FROM books WHERE in_stock=0"),
            "withPdf": count(
                "SELECT COUNT(DISTINCT book_id) AS n FROM book_assets WHERE is_current=1"
            ),
            "withFreePages": count(
                "SELECT COUNT(DISTINCT book_id) AS n FROM free_page_ranges"
            ),
        },
        "combos": count("SELECT COUNT(*) AS n FROM combos"),
        "keyNotes": count("SELECT COUNT(*) AS n FROM key_notes"),
        "orders": {
            "total": count("SELECT COUNT(*) AS n FROM orders"),
            "requested": count("SELECT COUNT(*) AS n FROM orders WHERE status='requested'"),
        },
        "leads": {
            "contact": count("SELECT COUNT(*) AS n FROM leads WHERE kind='contact' AND handled=0"),
            "newsletter": count("SELECT COUNT(*) AS n FROM leads WHERE kind='newsletter'"),
        },
    }


# --------------------------------------------------------------------------
# Staff accounts  (super_admin only — this is the privilege boundary)
# --------------------------------------------------------------------------

class StaffIn(BaseModel):
    email: EmailStr
    name: str = Field(default="", max_length=120)
    password: str = Field(min_length=10, max_length=200)
    role: str = Field(default="editor")


class StaffRoleIn(BaseModel):
    role: str


@router.get("/staff")
def admin_list_staff(
    admin: dict = Depends(require_read(permissions.ADMINS_MANAGE)),
) -> dict:
    return {
        "roles": [
            {"id": r, "permissions": sorted(permissions.permissions_for(r))}
            for r in permissions.ROLES
        ],
        "staff": [
            {
                "id": u["id"],
                "email": u["email"],
                "name": u["name"],
                "role": u["role"],
                "isActive": bool(u["is_active"]),
                "lastLoginAt": u["last_login_at"],
                "createdAt": u["created_at"],
            }
            for u in admin_repo.list_users()
        ],
    }


@router.post("/staff", status_code=201)
def admin_create_staff(
    body: StaffIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.ADMINS_MANAGE)),
) -> dict:
    if body.role not in permissions.ROLES:
        raise HTTPException(422, f"Unknown role. Valid roles: {', '.join(permissions.ROLES)}")
    if admin_repo.get_user_by_email(str(body.email)):
        raise HTTPException(409, "An account with that email already exists")

    user_id = admin_repo.create_user(
        str(body.email), body.password, body.name, role=body.role
    )
    admin_repo.audit(
        user_id=admin["id"],
        action="staff.create",
        entity="staff",
        entity_id=user_id,
        detail={"email": str(body.email), "role": body.role},
        ip=client_ip(request),
    )
    return {"ok": True, "id": user_id}


@router.post("/staff/{user_id}/role")
def admin_set_staff_role(
    user_id: str,
    body: StaffRoleIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.ADMINS_MANAGE)),
) -> dict:
    if body.role not in permissions.ROLES:
        raise HTTPException(422, f"Unknown role. Valid roles: {', '.join(permissions.ROLES)}")

    target = query_one("SELECT * FROM admin_users WHERE id = ?", (user_id,))
    if target is None:
        raise HTTPException(404, "No such staff account")

    # Nobody demotes themselves out of admin management. Without this a
    # super_admin can remove their own last privilege and lock the deployment
    # out of its own user management — recoverable only by hand-editing SQL on
    # the server.
    if user_id == admin["id"] and body.role != "super_admin":
        raise HTTPException(
            400,
            "You cannot change your own role. Ask another super admin to do it.",
        )

    # And the last super_admin cannot be demoted by anyone, for the same reason.
    if target["role"] == "super_admin" and body.role != "super_admin":
        remaining = query_one(
            "SELECT COUNT(*) AS n FROM admin_users"
            " WHERE role = 'super_admin' AND is_active = 1 AND id != ?",
            (user_id,),
        )["n"]
        if remaining == 0:
            raise HTTPException(
                400, "This is the last super admin. Promote someone else first."
            )

    with transaction() as conn:
        conn.execute("UPDATE admin_users SET role = ? WHERE id = ?", (body.role, user_id))
    admin_repo.audit(
        user_id=admin["id"],
        action="staff.role.update",
        entity="staff",
        entity_id=user_id,
        detail={"from": target["role"], "to": body.role},
        ip=client_ip(request),
    )
    return {"ok": True}


@router.post("/staff/{user_id}/active")
def admin_set_staff_active(
    user_id: str,
    request: Request,
    active: bool = Body(embed=True),
    admin: dict = Depends(require_write(permissions.ADMINS_MANAGE)),
) -> dict:
    target = query_one("SELECT * FROM admin_users WHERE id = ?", (user_id,))
    if target is None:
        raise HTTPException(404, "No such staff account")
    if user_id == admin["id"] and not active:
        raise HTTPException(400, "You cannot disable your own account.")

    if not active and target["role"] == "super_admin":
        remaining = query_one(
            "SELECT COUNT(*) AS n FROM admin_users"
            " WHERE role = 'super_admin' AND is_active = 1 AND id != ?",
            (user_id,),
        )["n"]
        if remaining == 0:
            raise HTTPException(400, "This is the last active super admin.")

    with transaction() as conn:
        conn.execute(
            "UPDATE admin_users SET is_active = ? WHERE id = ?",
            (1 if active else 0, user_id),
        )
        # Disabling must end their access NOW, not whenever the cookie expires.
        if not active:
            conn.execute("DELETE FROM admin_sessions WHERE user_id = ?", (user_id,))
    admin_repo.audit(
        user_id=admin["id"],
        action="staff.active.update",
        entity="staff",
        entity_id=user_id,
        detail={"active": active},
        ip=client_ip(request),
    )
    return {"ok": True}


# --------------------------------------------------------------------------
# Stock
# --------------------------------------------------------------------------

class StockAdjustIn(BaseModel):
    delta: int = Field(description="Signed. Negative removes stock.")
    reason: str
    note: str = Field(default="", max_length=300)
    reference: str | None = Field(default=None, max_length=60)


class StockTrackIn(BaseModel):
    opening: int = Field(ge=0, le=1000000)
    note: str = Field(default="", max_length=300)


@router.get("/books/{slug}/stock")
def admin_stock(
    slug: str,
    admin: dict = Depends(require_read(permissions.BOOKS_READ)),
) -> dict:
    book = query_one("SELECT id, stock_qty, low_stock_threshold FROM books WHERE slug = ?", (slug,))
    if book is None:
        raise HTTPException(404, "No such book")
    return {
        "tracked": book["stock_qty"] is not None,
        "quantity": book["stock_qty"],
        "lowStockThreshold": book["low_stock_threshold"],
        "movements": [
            {
                "id": m["id"], "delta": m["delta"], "balance": m["balance"],
                "reason": m["reason"], "reference": m["reference"],
                "note": m["note"], "createdAt": m["created_at"],
            }
            for m in inventory.history(book["id"])
        ],
    }


@router.post("/books/{slug}/stock/track")
def admin_start_tracking(
    slug: str,
    body: StockTrackIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.BOOKS_WRITE)),
) -> dict:
    book = query_one("SELECT id FROM books WHERE slug = ?", (slug,))
    if book is None:
        raise HTTPException(404, "No such book")
    try:
        qty = inventory.start_tracking(
            book["id"], body.opening, actor_id=admin["id"], note=body.note
        )
    except inventory.StockError as exc:
        raise HTTPException(400, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="stock.track", entity="book", entity_id=slug,
        detail={"opening": body.opening}, ip=client_ip(request),
    )
    return {"ok": True, "quantity": qty}


@router.post("/books/{slug}/stock")
def admin_adjust_stock(
    slug: str,
    body: StockAdjustIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.BOOKS_WRITE)),
) -> dict:
    book = query_one("SELECT id FROM books WHERE slug = ?", (slug,))
    if book is None:
        raise HTTPException(404, "No such book")
    try:
        qty = inventory.adjust(
            book["id"], body.delta, body.reason,
            reference=body.reference, note=body.note, actor_id=admin["id"],
        )
    except inventory.StockError as exc:
        raise HTTPException(400, str(exc)) from exc

    if qty is None:
        raise HTTPException(
            400, "This book is not tracked. Start tracking it before adjusting stock."
        )

    admin_repo.audit(
        user_id=admin["id"], action="stock.adjust", entity="book", entity_id=slug,
        detail={"delta": body.delta, "reason": body.reason, "balance": qty},
        ip=client_ip(request),
    )
    return {"ok": True, "quantity": qty}


@router.get("/stock/low")
def admin_low_stock(
    admin: dict = Depends(require_read(permissions.BOOKS_READ)),
) -> dict:
    return {
        "books": [
            {
                "slug": b["slug"], "title": b["title"],
                "quantity": b["stock_qty"], "threshold": b["low_stock_threshold"],
            }
            for b in inventory.low_stock()
        ]
    }


# --------------------------------------------------------------------------
# Order lifecycle
# --------------------------------------------------------------------------

class OrderStatusIn(BaseModel):
    status: str
    note: str = Field(default="", max_length=500)


@router.get("/orders/{order_number}")
def admin_order_detail(
    order_number: str,
    admin: dict = Depends(require_read(permissions.ORDERS_READ)),
) -> dict:
    order = orders_repo.lookup(order_number)
    if order is None:
        raise HTTPException(404, "No such order")
    full = query_one("SELECT * FROM orders WHERE order_number = ?", (order_number,))
    return {
        "order": {
            **order,
            "statusLabel": order_flow.LABELS.get(full["status"], full["status"]),
            # Drives the admin UI: only offer moves the machine will accept,
            # rather than showing every status and failing on click.
            "allowedNext": [
                {"status": s, "label": order_flow.LABELS.get(s, s)}
                for s in order_flow.allowed_from(full["status"])
            ],
            "stockApplied": full["stock_applied_at"] is not None,
        },
        "timeline": order_flow.timeline(order_number),
    }


@router.post("/orders/{order_number}/status")
def admin_set_order_status(
    order_number: str,
    body: OrderStatusIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.ORDERS_WRITE)),
) -> dict:
    try:
        order = order_flow.transition(
            order_number, body.status, note=body.note, actor=admin["id"]
        )
    except order_flow.TransitionError as exc:
        # 409, not 400: the request is well-formed, it conflicts with the
        # order's current state. The admin UI shows this verbatim.
        raise HTTPException(409, str(exc)) from exc
    except inventory.StockError as exc:
        raise HTTPException(409, f"Stock: {exc}") from exc

    admin_repo.audit(
        user_id=admin["id"], action="order.status", entity="order",
        entity_id=order_number,
        detail={"to": body.status, "note": body.note}, ip=client_ip(request),
    )
    return {
        "ok": True,
        "status": order.get("status"),
        "statusLabel": order.get("statusLabel"),
        "allowedNext": order.get("allowedNext", []),
    }


# --------------------------------------------------------------------------
# Payment verification queue
# --------------------------------------------------------------------------

class PaymentReviewIn(BaseModel):
    decision: str = Field(pattern="^(approved|rejected|correction_requested)$")
    note: str = Field(default="", max_length=500)
    # Approving usually means the order should move on; the admin decides,
    # because a paid order for an out-of-stock title must not auto-confirm.
    advanceOrder: bool = True


@router.get("/payments/queue")
def admin_payment_queue(
    admin: dict = Depends(require_read(permissions.ORDERS_READ)),
) -> dict:
    return {
        "payments": [
            {
                "orderNumber": p["order_number"],
                "customerName": p["customer_name"],
                "amount": p["amount"],
                "orderTotal": p["order_total"],
                # Surfaced explicitly: a mismatch between what they say they
                # paid and what the order costs is the single most useful
                # signal on this screen.
                "matchesTotal": p["amount"] == p["order_total"],
                "method": p["method"],
                "reference": p["provider_ref"],
                "hasProof": bool(p["proof_path"]),
                "customerNote": p["customer_note"],
                "submittedAt": p["updated_at"],
            }
            for p in payments.queue()
        ]
    }


@router.post("/payments/{order_number}/review")
def admin_review_payment(
    order_number: str,
    body: PaymentReviewIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.PAYMENTS_VERIFY)),
) -> dict:
    try:
        payment = payments.review(
            order_number, body.decision, reviewer_id=admin["id"], note=body.note
        )
    except payments.PaymentError as exc:
        raise HTTPException(409, str(exc)) from exc

    advanced = None
    if body.decision == "approved" and body.advanceOrder:
        # Explicit, and through the state machine — so stock is deducted and the
        # timeline records it. Failing here leaves the payment approved and the
        # order unmoved, which is recoverable; the reverse is not.
        try:
            order = order_flow.transition(
                order_number, "confirmed",
                note=f"payment approved ({payment.get('provider_ref') or 'manual'})",
                actor=admin["id"],
            )
            advanced = order.get("status")
        except (order_flow.TransitionError, inventory.StockError) as exc:
            advanced = f"not advanced: {exc}"

    admin_repo.audit(
        user_id=admin["id"], action="payment.review", entity="order",
        entity_id=order_number,
        detail={"decision": body.decision, "advanced": advanced},
        ip=client_ip(request),
    )
    return {"ok": True, "status": payment["status"], "orderStatus": advanced}


# --------------------------------------------------------------------------
# Review moderation
# --------------------------------------------------------------------------

class ReviewModerateIn(BaseModel):
    decision: str = Field(pattern="^(published|rejected)$")
    reply: str = Field(default="", max_length=2000)


@router.get("/reviews/pending")
def admin_pending_reviews(
    admin: dict = Depends(require_read(permissions.BOOKS_READ)),
) -> dict:
    return {
        "reviews": [
            {
                "id": r["id"], "productSlug": r["product_slug"],
                "author": r["author"], "rating": r["rating"],
                "title": r["title"], "body": r["body"],
                "verified": bool(r["verified"]), "source": r["source"],
                "createdAt": r["created_at"],
            }
            for r in reviews_service.pending()
        ],
        # Surfaced so the provenance of the catalogue's ratings is visible in
        # the panel rather than buried in the database.
        "provenance": reviews_service.stats(),
    }


@router.post("/reviews/{review_id}/moderate")
def admin_moderate_review(
    review_id: str,
    body: ReviewModerateIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.BOOKS_WRITE)),
) -> dict:
    try:
        review = reviews_service.moderate(
            review_id, body.decision, actor_id=admin["id"], reply=body.reply
        )
    except reviews_service.ReviewError as exc:
        raise HTTPException(404, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="review.moderate", entity="review",
        entity_id=review_id, detail={"decision": body.decision},
        ip=client_ip(request),
    )
    return {"ok": True, "status": review["status"]}


# --------------------------------------------------------------------------
# Coupons
# --------------------------------------------------------------------------

class CouponIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    description: str = Field(default="", max_length=200)
    kind: str = Field(default="percent", pattern="^(percent|flat|free_shipping|bxgy)$")
    value: int = Field(default=0, ge=0, le=100000)
    buyQty: int = Field(default=0, ge=0, le=100)
    getQty: int = Field(default=0, ge=0, le=100)
    minCart: int = Field(default=0, ge=0, le=1000000)
    maxDiscount: int | None = Field(default=None, ge=0, le=1000000)
    startsAt: str | None = None
    endsAt: str | None = None
    usageLimit: int | None = Field(default=None, ge=1)
    perUserLimit: int = Field(default=1, ge=0, le=100)
    productSlugs: list[str] = Field(default_factory=list, max_length=200)
    classIds: list[str] = Field(default_factory=list, max_length=20)
    series: list[str] = Field(default_factory=list, max_length=20)
    firstOrderOnly: bool = False
    autoApply: bool = False


@router.get("/coupons")
def admin_list_coupons(
    admin: dict = Depends(require_read(permissions.BOOKS_READ)),
) -> dict:
    return {"coupons": coupons_service.report()}


@router.post("/coupons", status_code=201)
def admin_create_coupon(
    body: CouponIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.SETTINGS_WRITE)),
) -> dict:
    try:
        coupon = coupons_service.create(**body.model_dump(), createdBy=admin["id"])
    except coupons_service.CouponError as exc:
        raise HTTPException(422, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="coupon.create", entity="coupon",
        entity_id=coupon["code"], detail={"kind": body.kind, "value": body.value},
        ip=client_ip(request),
    )
    return {"ok": True, "code": coupon["code"]}


@router.post("/coupons/{code}/active")
def admin_set_coupon_active(
    code: str,
    request: Request,
    active: bool = Body(embed=True),
    admin: dict = Depends(require_write(permissions.SETTINGS_WRITE)),
) -> dict:
    if coupons_service.get(code) is None:
        raise HTTPException(404, "No such coupon")
    coupons_service.set_active(code, active)
    admin_repo.audit(
        user_id=admin["id"], action="coupon.active", entity="coupon",
        entity_id=code, detail={"active": active}, ip=client_ip(request),
    )
    return {"ok": True}


# --------------------------------------------------------------------------
# Order export
# --------------------------------------------------------------------------

@router.get("/orders/export/summary")
def admin_export_summary(
    admin: dict = Depends(require_read(permissions.ORDERS_EXPORT)),
    dateFrom: str | None = None,
    dateTo: str | None = None,
    status: str | None = None,
    paymentStatus: str | None = None,
    coupon: str | None = None,
) -> dict:
    """How many rows the current filters would export.

    Shown before the download so nobody discovers the size by waiting for it.
    """
    return exports.summary(
        date_from=dateFrom, date_to=dateTo, status=status,
        payment_status=paymentStatus, coupon=coupon,
    )


@router.get("/orders/export")
def admin_export_orders(
    request: Request,
    admin: dict = Depends(require_read(permissions.ORDERS_EXPORT)),
    shape: str = Query(default="order", pattern="^(order|line)$"),
    fmt: str = Query(default="csv", pattern="^(csv|json)$"),
    dateFrom: str | None = None,
    dateTo: str | None = None,
    status: str | None = None,
    paymentStatus: str | None = None,
    coupon: str | None = None,
) -> StreamingResponse:
    filters = {
        "date_from": dateFrom, "date_to": dateTo, "status": status,
        "payment_status": paymentStatus, "coupon": coupon,
    }
    stats = exports.summary(**filters)

    # Audited BEFORE streaming. If the download is interrupted the export still
    # happened as far as disclosure goes — the rows were read and sent — and an
    # audit trail that only records completed downloads understates what left.
    admin_repo.audit(
        user_id=admin["id"], action="orders.export", entity="orders",
        detail={"shape": shape, "format": fmt, "filters": filters, **stats},
        ip=client_ip(request),
    )
    log.info(
        "Order export by %s: %s rows, %s to %s",
        admin["email"], stats["orders"], stats["from"], stats["to"],
    )

    stamp = stats["from"][:10]
    filename = f"orders-{shape}-{stamp}.{fmt}"
    stream = (
        exports.to_csv(shape, **filters) if fmt == "csv"
        else exports.to_json(shape, **filters)
    )
    return StreamingResponse(
        stream,
        media_type="text/csv; charset=utf-8" if fmt == "csv" else "application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # This file is every customer's address. It must not sit in a proxy.
            "Cache-Control": "private, no-store",
        },
    )


# --------------------------------------------------------------------------
# Shipping
# --------------------------------------------------------------------------

class ShipmentIn(BaseModel):
    carrierCode: str = Field(min_length=2, max_length=40)
    awb: str = Field(min_length=3, max_length=60)
    charge: int = Field(default=0, ge=0, le=100000)
    weightGrams: int | None = Field(default=None, ge=0, le=100000)
    expectedAt: str | None = None
    notes: str = Field(default="", max_length=500)


class ShipmentStatusIn(BaseModel):
    status: str
    lastUpdate: str = Field(default="", max_length=500)


@router.get("/shipping/carriers")
def admin_carriers(
    admin: dict = Depends(require_read(permissions.ORDERS_READ)),
) -> dict:
    return {
        "carriers": [
            {"code": c["code"], "name": c["name"], "hasTracking": bool(c["tracking_url"])}
            for c in shipping.carriers()
        ],
        "statuses": [
            {"id": s, "label": shipping.LABELS[s]} for s in shipping.STATUSES
        ],
    }


@router.post("/orders/{order_number}/shipment", status_code=201)
def admin_create_shipment(
    order_number: str,
    body: ShipmentIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.ORDERS_WRITE)),
) -> dict:
    try:
        shipment = shipping.create(
            order_number, carrier_code=body.carrierCode, awb=body.awb,
            charge=body.charge, weight_grams=body.weightGrams,
            expected_at=body.expectedAt, notes=body.notes, actor_id=admin["id"],
        )
    except shipping.ShippingError as exc:
        raise HTTPException(409, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="shipment.create", entity="order",
        entity_id=order_number,
        detail={"carrier": body.carrierCode, "awb": body.awb},
        ip=client_ip(request),
    )
    return {"ok": True, "shipment": shipping.public_view(shipment)}


@router.post("/orders/{order_number}/shipment/status")
def admin_update_shipment(
    order_number: str,
    body: ShipmentStatusIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.ORDERS_WRITE)),
) -> dict:
    try:
        shipment = shipping.update_status(
            order_number, body.status, last_update=body.lastUpdate,
            actor_id=admin["id"],
        )
    except shipping.ShippingError as exc:
        raise HTTPException(409, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="shipment.status", entity="order",
        entity_id=order_number, detail={"status": body.status},
        ip=client_ip(request),
    )
    return {"ok": True, "shipment": shipping.public_view(shipment)}


# --------------------------------------------------------------------------
# Support queue
# --------------------------------------------------------------------------

class TicketReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
    isInternal: bool = False


class TicketUpdateIn(BaseModel):
    status: str | None = None
    priority: str | None = None
    assigneeId: str | None = None


@router.get("/support/queue")
def admin_ticket_queue(
    admin: dict = Depends(require_read(permissions.LEADS_READ)),
    status: str | None = None,
) -> dict:
    return {
        "tickets": [
            {
                "reference": t["reference"], "subject": t["subject"],
                "category": t["category"], "status": t["status"],
                "statusLabel": t["statusLabel"], "priority": t["priority"],
                "email": t["email"], "name": t["name"],
                "assigneeId": t["assignee_id"],
                "messageCount": t["messageCount"],
                "createdAt": t["created_at"], "updatedAt": t["updated_at"],
                # The SLA number that matters: nobody has replied yet.
                "awaitingFirstReply": t["first_response_at"] is None,
            }
            for t in support.queue(status=status)
        ],
        "stats": support.stats(),
    }


@router.get("/support/{reference}")
def admin_ticket_detail(
    reference: str,
    admin: dict = Depends(require_read(permissions.LEADS_READ)),
) -> dict:
    ticket = support.get(reference)
    if ticket is None:
        raise HTTPException(404, "No such ticket")
    return {
        "ticket": dict(ticket),
        # Staff see internal notes; this is the only caller that asks for them.
        "messages": support.thread(reference, include_internal=True),
    }


@router.post("/support/{reference}/reply")
def admin_reply_ticket(
    reference: str,
    body: TicketReplyIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.LEADS_READ)),
) -> dict:
    try:
        support.reply(
            reference, body.body, author_kind="staff", author_id=admin["id"],
            author_name=admin["name"] or "Support", is_internal=body.isInternal,
        )
    except support.TicketError as exc:
        raise HTTPException(409, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="ticket.reply", entity="ticket",
        entity_id=reference, detail={"internal": body.isInternal},
        ip=client_ip(request),
    )
    return {"ok": True, "messages": support.thread(reference, include_internal=True)}


@router.post("/support/{reference}/update")
def admin_update_ticket(
    reference: str,
    body: TicketUpdateIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.LEADS_READ)),
) -> dict:
    try:
        if body.status:
            support.set_status(reference, body.status, actor_id=admin["id"],
                               actor_name=admin["name"] or "Support")
        if body.priority:
            support.set_priority(reference, body.priority)
        if body.assigneeId is not None:
            support.assign(reference, body.assigneeId or None)
    except support.TicketError as exc:
        raise HTTPException(409, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="ticket.update", entity="ticket",
        entity_id=reference, detail=body.model_dump(exclude_none=True),
        ip=client_ip(request),
    )
    return {"ok": True, "ticket": support.get(reference)}


# --------------------------------------------------------------------------
# Email templates
# --------------------------------------------------------------------------

class TemplateIn(BaseModel):
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=50000)


@router.get("/templates")
def admin_templates(
    admin: dict = Depends(require_read(permissions.SETTINGS_WRITE)),
) -> dict:
    return {"templates": templates_service.catalogue()}


@router.get("/templates/{key}")
def admin_template_detail(
    key: str,
    admin: dict = Depends(require_read(permissions.SETTINGS_WRITE)),
) -> dict:
    template = templates_service.get(key)
    if template is None:
        raise HTTPException(404, "No such template")
    return {
        "template": template,
        # The editor renders these as clickable chips, so the shop owner never
        # types a variable name by hand and never sees raw HTML by default.
        "variables": templates_service.variables_for(key),
        "history": templates_service.history(key),
    }


@router.post("/templates/{key}/preview")
def admin_template_preview(
    key: str,
    body: TemplateIn,
    admin: dict = Depends(require_read(permissions.SETTINGS_WRITE)),
) -> dict:
    """Render with sample data WITHOUT saving.

    Unknown variables are returned rather than raised, so the editor can point
    at the typo instead of showing a failure.
    """
    unknown = templates_service.validate(key, body.subject, body.body)
    if unknown:
        return {
            "ok": False,
            "unknown": unknown,
            "available": templates_service.variables_for(key),
        }

    values = templates_service.sample_values(key)
    subject = body.subject
    rendered = templates_service.sanitise(body.body)
    for name, value in values.items():
        for token in ("{{" + name + "}}", "{{ " + name + " }}"):
            subject = subject.replace(token, str(value))
            rendered = rendered.replace(token, str(value))
    return {"ok": True, "subject": subject, "body": rendered}


@router.put("/templates/{key}")
def admin_save_template(
    key: str,
    body: TemplateIn,
    request: Request,
    admin: dict = Depends(require_write(permissions.SETTINGS_WRITE)),
) -> dict:
    try:
        template = templates_service.save(
            key, body.subject, body.body, actor_id=admin["id"]
        )
    except templates_service.TemplateError as exc:
        raise HTTPException(422, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="template.save", entity="template",
        entity_id=key, ip=client_ip(request),
    )
    return {"ok": True, "template": template}


@router.post("/templates/{key}/reset")
def admin_reset_template(
    key: str,
    request: Request,
    admin: dict = Depends(require_write(permissions.SETTINGS_WRITE)),
) -> dict:
    try:
        template = templates_service.reset_to_default(key)
    except templates_service.TemplateError as exc:
        raise HTTPException(404, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="template.reset", entity="template",
        entity_id=key, ip=client_ip(request),
    )
    return {"ok": True, "template": template}


@router.post("/templates/{key}/test-send")
def admin_test_send(
    key: str,
    request: Request,
    admin: dict = Depends(require_write(permissions.SETTINGS_WRITE)),
) -> dict:
    """Send this template to the signed-in admin, with sample data.

    Deliberately only to the admin's own address — a test-send that accepts an
    arbitrary recipient is an open relay wearing a admin panel.
    """
    from app.services import mailer

    try:
        subject, body = templates_service.render(key, templates_service.sample_values(key))
    except templates_service.TemplateError as exc:
        raise HTTPException(422, str(exc)) from exc

    message_id = mailer.queue(
        to_email=admin["email"], subject=f"[TEST] {subject}",
        body_text="This is a test send. Open in an HTML client to see the layout.",
        body_html=body, kind="verify", related_id=admin["id"],
    )
    return {
        "ok": True,
        "queued": message_id,
        "delivered": mailer.configured(),
        "message": (
            f"Sent to {admin['email']}."
            if mailer.configured()
            else "SMTP is not configured, so this was queued but not sent."
        ),
    }


# --------------------------------------------------------------------------
# Customers
# --------------------------------------------------------------------------

@router.get("/customers")
def admin_customers(
    admin: dict = Depends(require_read(permissions.CUSTOMERS_READ)),
    q: str = "",
    status: str | None = None,
    marketingOnly: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    result = customer_admin.search(
        q, status=status, marketing_only=marketingOnly, limit=limit, offset=offset
    )
    return {**result, "stats": customer_admin.stats()}


@router.get("/customers/{customer_id}")
def admin_customer_detail(
    customer_id: str,
    admin: dict = Depends(require_read(permissions.CUSTOMERS_READ)),
) -> dict:
    data = customer_admin.detail(customer_id)
    if data is None:
        raise HTTPException(404, "No such customer")
    return data


@router.post("/customers/{customer_id}/status")
def admin_customer_status(
    customer_id: str,
    request: Request,
    status: str = Body(embed=True),
    admin: dict = Depends(require_write(permissions.CUSTOMERS_WRITE)),
) -> dict:
    try:
        data = customer_admin.set_status(customer_id, status, actor_id=admin["id"])
    except customer_admin.CustomerAdminError as exc:
        raise HTTPException(400, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="customer.status", entity="customer",
        entity_id=customer_id, detail={"status": status}, ip=client_ip(request),
    )
    return {"ok": True, **data}


@router.post("/customers/{customer_id}/marketing")
def admin_customer_marketing(
    customer_id: str,
    request: Request,
    optedIn: bool = Body(embed=True),
    admin: dict = Depends(require_write(permissions.CUSTOMERS_WRITE)),
) -> dict:
    data = customer_admin.set_marketing(customer_id, optedIn, actor_id=admin["id"])
    # Consent is a legal record. An admin flipping it ON is precisely what a
    # regulator asks for evidence of, so the audit row is not optional.
    admin_repo.audit(
        user_id=admin["id"], action="customer.marketing", entity="customer",
        entity_id=customer_id, detail={"optedIn": optedIn}, ip=client_ip(request),
    )
    return {"ok": True, **data}


@router.get("/customers/{customer_id}/export")
def admin_customer_export(
    customer_id: str,
    request: Request,
    admin: dict = Depends(require_read(permissions.CUSTOMERS_READ)),
) -> dict:
    """Everything held about one person — a data-subject access request."""
    try:
        data = customer_admin.export_one(customer_id)
    except customer_admin.CustomerAdminError as exc:
        raise HTTPException(404, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="customer.export", entity="customer",
        entity_id=customer_id, ip=client_ip(request),
    )
    return data


@router.post("/customers/{customer_id}/anonymise")
def admin_customer_anonymise(
    customer_id: str,
    request: Request,
    confirm: str = Body(embed=True),
    admin: dict = Depends(require_write(permissions.CUSTOMERS_WRITE)),
) -> dict:
    """Erase the person, keep the accounting. NOT reversible."""
    if confirm != "ANONYMISE":
        # A typed confirmation, because this cannot be undone and a misclick in
        # a customer list would otherwise destroy someone's account.
        raise HTTPException(
            400, 'Type ANONYMISE to confirm. This cannot be undone.'
        )
    try:
        result = customer_admin.anonymise(customer_id, actor_id=admin["id"])
    except customer_admin.CustomerAdminError as exc:
        raise HTTPException(400, str(exc)) from exc

    admin_repo.audit(
        user_id=admin["id"], action="customer.anonymise", entity="customer",
        entity_id=customer_id, ip=client_ip(request),
    )
    return result


# --------------------------------------------------------------------------
# Notifications (staff bell)
# --------------------------------------------------------------------------

@router.get("/notifications")
def admin_notifications(
    admin: dict = Depends(current_admin), unreadOnly: bool = False
) -> dict:
    """Deliberately gated on the session only, not a permission.

    Every role needs to see the bell; what each can DO about an item is
    enforced by the route the link goes to.
    """
    return notifications.for_admin(admin["id"], unread_only=unreadOnly)


@router.post("/notifications/{notification_id}/read")
def admin_read_notification(
    notification_id: str, admin: dict = Depends(require_csrf)
) -> dict:
    return {"ok": notifications.mark_read(notification_id)}


@router.post("/notifications/read-all")
def admin_read_all(admin: dict = Depends(require_csrf)) -> dict:
    return {"ok": True, "marked": notifications.mark_all_read(audience="admin")}


# --------------------------------------------------------------------------
# Dashboard analytics
# --------------------------------------------------------------------------

@router.get("/analytics")
def admin_analytics(
    admin: dict = Depends(require_read(permissions.ORDERS_READ)),
    days: int = Query(default=30, ge=1, le=365),
) -> dict:
    return analytics.dashboard(days)


@router.get("/analytics/revenue")
def admin_revenue(
    admin: dict = Depends(require_read(permissions.ORDERS_READ)),
    days: int = Query(default=30, ge=1, le=365),
) -> dict:
    return {"series": analytics.revenue_series(days), "summary": analytics.summary(days)}


# --------------------------------------------------------------------------
# Background jobs
# --------------------------------------------------------------------------

@router.get("/jobs")
def admin_jobs(
    admin: dict = Depends(require_read(permissions.AUDIT_READ)),
) -> dict:
    """What the scheduler has been doing.

    A scheduler you cannot observe is one you cannot trust — this is how
    "why has no email gone out" gets an answer rather than a guess.
    """
    from app.services.jobs import scheduler

    return {"jobs": scheduler.status()}


@router.post("/jobs/{name}/run")
def admin_run_job(
    name: str,
    request: Request,
    admin: dict = Depends(require_write(permissions.SETTINGS_WRITE)),
) -> dict:
    from app.services.jobs import scheduler

    result = scheduler.run_now(name)
    if result is None:
        raise HTTPException(404, "No such job")

    admin_repo.audit(
        user_id=admin["id"], action="job.run", entity="job", entity_id=name,
        detail={"result": result.get("lastResult")}, ip=client_ip(request),
    )
    return {"ok": True, "job": result}
