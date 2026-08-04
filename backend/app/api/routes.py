"""Public API routes: /health, /chat, /chat/sync, /search."""

from __future__ import annotations

import json
import logging
import secrets
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.config import settings
from app.db.conn import healthcheck as db_healthcheck
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    ComponentHealth,
    HealthResponse,
    SearchResponse,
)
from app.services.catalog import parse_filters

log = logging.getLogger(__name__)
router = APIRouter()

VERSION = "1.0.0"


def _frame(payload: dict) -> bytes:
    """One SSE frame. The blank line terminator is the protocol, not styling."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """No-op unless API_KEY is configured — local development stays frictionless."""
    if not settings.api_key:
        return
    # compare_digest, not `!=`: a plain comparison short-circuits on the first
    # differing byte and leaks the prefix through timing. Cheap to fix, and
    # there is no argument for leaving it.
    if not x_api_key or not secrets.compare_digest(x_api_key, settings.api_key):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    """Report what is ACTUALLY running, not what was configured.

    The embedding provider and vector store both degrade silently: an import
    failure swaps a real model for md5 hash vectors, or Chroma for a dict. Both
    destroy retrieval quality. Reporting `settings.*` here meant those failures
    were invisible — the service looked healthy while answering from noise.
    """
    state = request.app.state
    store = state.store
    embeddings = getattr(state, "embeddings", None)

    try:
        documents = store.count()
    except Exception as exc:  # noqa: BLE001 — health must never raise
        documents = 0
        log.warning("Vector store count failed: %s", exc)

    # The class name is the ground truth; the settings value is only an intent.
    actual_store = type(store).__name__
    actual_embeddings = type(embeddings).__name__ if embeddings else "unknown"
    actual_llm = type(getattr(state, "llm", None)).__name__ if hasattr(state, "llm") else settings.llm_provider

    degraded: list[str] = []
    if "Hash" in actual_embeddings:
        degraded.append("embeddings: fell back to hash vectors — retrieval is unusable")
    if settings.vector_store == "chroma" and "Chroma" not in actual_store:
        degraded.append("store: fell back to in-memory — nothing persists across restarts")
    if settings.llm_provider != "echo" and "Echo" in actual_llm:
        degraded.append(f"llm: {settings.llm_provider} unavailable, using extractive fallback")

    db = db_healthcheck()
    if not db.get("ok"):
        degraded.append(f"database: {db.get('error')}")
    if documents == 0:
        degraded.append("corpus: empty")

    # Payments and email are the two subsystems that look fine in code review
    # and are broken to a customer when unconfigured — one takes no money, the
    # other sends no mail, and neither raises anything. Reported as ACTUAL
    # state, the same rule already applied to the LLM and the vector store.
    from app.services import mailer
    from app.services import payments as payments_service
    from app.services import razorpay as razorpay_service

    try:
        active_payment_provider = payments_service.provider().name
    except Exception as exc:  # noqa: BLE001 — a misconfiguration must surface here
        active_payment_provider = "misconfigured"
        degraded.append(f"payments: {exc}")

    if active_payment_provider == "manual" and not settings.payment_upi_id:
        degraded.append(
            "payments: manual mode with no PAYMENT_UPI_ID — customers have "
            "nowhere to send money"
        )
    if razorpay_service.configured() and not settings.razorpay_webhook_secret:
        degraded.append(
            "payments: Razorpay has no webhook secret — a customer who closes "
            "the tab after paying stays unpaid"
        )
    if not mailer.configured():
        degraded.append(
            "email: SMTP unset — verification and order mail is queued, not sent"
        )

    return HealthResponse(
        status="degraded" if degraded else "ok",
        version=VERSION,
        llm=ComponentHealth(configured=settings.llm_provider, actual=actual_llm),
        embeddings=ComponentHealth(
            configured=settings.embedding_provider,
            actual=actual_embeddings,
            detail=settings.embedding_model,
        ),
        store=ComponentHealth(configured=settings.vector_store, actual=actual_store),
        documents=documents,
        database=db,
        degraded=degraded,
    )


@router.post("/chat", dependencies=[Depends(require_api_key)])
async def chat(request: Request, body: ChatRequest) -> StreamingResponse:
    """Server-sent events. Frames match what the frontend's parser expects:

        data: {"type":"token","value":"…"}
        data: {"type":"products","value":[…]}
        data: {"type":"done"}
    """
    pipeline = request.app.state.pipeline
    history = [(t.role, t.content) for t in body.history]

    async def events() -> AsyncIterator[bytes]:
        try:
            async for kind, value in pipeline.stream(body.message, history):
                if kind == "done":
                    payload = {"type": "done"}
                else:
                    payload = {"type": kind, "value": value}
                yield _frame(payload)
        except Exception:  # noqa: BLE001
            # The stream has already started, so an HTTP status is no longer
            # available — the failure has to travel as a frame.
            log.exception("Chat stream failed")
            yield _frame(
                {
                    "type": "token",
                    "value": (
                        "Something went wrong on our side. Please call "
                        f"{settings.company_phone} and we'll help directly."
                    ),
                }
            )
            yield _frame({"type": "done"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            # Nginx buffers SSE by default, which turns streaming into a
            # single delayed blob. This disables it.
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat/sync", response_model=ChatResponse, dependencies=[Depends(require_api_key)])
async def chat_sync(request: Request, body: ChatRequest) -> ChatResponse:
    """Non-streaming variant — used by tests, cron jobs and debugging."""
    pipeline = request.app.state.pipeline
    history = [(t.role, t.content) for t in body.history]
    result = await pipeline.answer(body.message, history)
    return ChatResponse(
        answer=result["answer"],
        products=result.get("products", []),
        sources=[],
        grounded=bool(result.get("grounded")),
    )


@router.get("/search", response_model=SearchResponse)
async def search(
    request: Request,
    q: str = Query(min_length=1, max_length=200),
    # Was an unbounded int: `?limit=100000` built 100k Pydantic models on a
    # 2 vCPU box. This endpoint stays public — it returns catalogue data the
    # storefront shows anyway — but it does not stay uncapped.
    limit: int = Query(default=8, ge=1, le=50),
) -> SearchResponse:
    """Semantic product search (D8).

    Returns structured filters as well as hits, so the frontend palette can
    apply real catalogue facets rather than rendering a sentence.
    """
    if len(q.strip()) < 2:
        return SearchResponse()

    catalog = request.app.state.catalog
    filters = parse_filters(q)
    hits = catalog.search(q, limit=limit)

    parts = [
        f"Class {filters.classId}" if filters.classId else "",
        filters.medium.replace("-", " ") if filters.medium else "",
        filters.subject or "",
        filters.series.title() if filters.series else "",
    ]
    interpreted = " · ".join(p for p in parts if p)

    return SearchResponse(hits=hits, filters=filters, interpreted=interpreted)


"""
REMOVED: POST /upload and POST /reindex.

Both wrote directly to the vector store, which made them a SECOND writer
alongside `app/rag/corpus.py` — and a second writer is a hole straight through
the "the assistant can only ever see free pages" guarantee. `/upload` in
particular accepted a PDF and indexed every page of it, so dropping a full book
there published the whole thing to the bot.

Their replacements are admin-authenticated and go through the one permitted
writer:

    POST /admin-api/books/{slug}/pdf          upload a book PDF
    PUT  /admin-api/books/{slug}/free-ranges  choose which pages are free
    POST /admin-api/corpus/resync             rebuild the policy corpus
"""
