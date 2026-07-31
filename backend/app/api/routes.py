"""API routes: /chat, /search, /upload, /health."""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.config import settings
from app.rag.ingest import documents_from_text, ingest_directory
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    HealthResponse,
    IngestResponse,
    SearchResponse,
)
from app.services.catalog import parse_filters

log = logging.getLogger(__name__)
router = APIRouter()

VERSION = "1.0.0"


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """No-op unless API_KEY is configured — local development stays frictionless."""
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    store = request.app.state.store
    try:
        documents = store.count()
        status = "ok" if documents > 0 else "degraded"
    except Exception:  # noqa: BLE001
        documents, status = 0, "degraded"

    return HealthResponse(
        status=status,
        version=VERSION,
        llm_provider=settings.llm_provider,
        embedding_provider=settings.embedding_provider,
        vector_store=settings.vector_store,
        documents=documents,
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
                if kind == "products":
                    payload = {
                        "type": "products",
                        "value": [p.model_dump() for p in value],  # type: ignore[union-attr]
                    }
                elif kind == "token":
                    payload = {"type": "token", "value": value}
                else:
                    payload = {"type": "done"}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()
        except Exception as exc:  # noqa: BLE001
            # The stream has already started, so an HTTP error code is no
            # longer available — the failure has to travel as a frame.
            log.exception("Chat stream failed")
            fallback = {
                "type": "token",
                "value": (
                    "Something went wrong on our side. Please call "
                    f"{settings.company_phone} and we'll help directly."
                ),
            }
            yield f"data: {json.dumps(fallback)}\n\n".encode()
            yield b'data: {"type":"done"}\n\n'
            del exc

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
    """Non-streaming variant — useful for tests, cron jobs and debugging."""
    pipeline = request.app.state.pipeline
    history = [(t.role, t.content) for t in body.history]
    answer, products, sources, grounded = await pipeline.answer(body.message, history)
    return ChatResponse(answer=answer, products=products, sources=sources, grounded=grounded)


@router.get("/search", response_model=SearchResponse)
async def search(request: Request, q: str, limit: int = 8) -> SearchResponse:
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


@router.post("/upload", response_model=IngestResponse, dependencies=[Depends(require_api_key)])
async def upload(request: Request, file: UploadFile = File(...)) -> IngestResponse:
    """Add a document to the knowledge base at runtime."""
    allowed = {".md", ".markdown", ".txt", ".pdf"}
    suffix = "." + (file.filename or "").rsplit(".", maxsplit=1)[-1].lower()
    if suffix not in allowed:
        raise HTTPException(400, f"Unsupported file type. Allowed: {sorted(allowed)}")

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large (10 MB limit)")

    if suffix == ".pdf":
        from io import BytesIO

        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise HTTPException(500, "PDF support requires pypdf") from exc

        reader = PdfReader(BytesIO(raw))
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    else:
        text = raw.decode("utf-8", errors="replace")

    if not text.strip():
        raise HTTPException(400, "No extractable text in that file")

    docs = documents_from_text(text, file.filename or "upload")
    request.app.state.store.add(docs)
    # Any cached answer may now be stale against the new corpus.
    request.app.state.pipeline.cache.clear()

    return IngestResponse(ingested=1, chunks=len(docs), collection=settings.collection_name)


@router.post("/reindex", response_model=IngestResponse, dependencies=[Depends(require_api_key)])
async def reindex(request: Request) -> IngestResponse:
    """Re-read the knowledge directory. Chunk ids are content-addressed, so
    unchanged chunks upsert in place rather than duplicating."""
    store = request.app.state.store
    files, chunks = ingest_directory(store)
    request.app.state.catalog.load()
    request.app.state.pipeline.cache.clear()
    return IngestResponse(ingested=files, chunks=chunks, collection=settings.collection_name)
