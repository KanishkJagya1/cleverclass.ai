"""Kohinoor Tez — AI Learning Assistant backend.

Responsibilities: chatbot, RAG, embeddings, vector search. No ecommerce.

Run:  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.routes import router
from app.config import settings
from app.embeddings.provider import build_embedding_provider
from app.rag.ingest import ingest_directory
from app.rag.pipeline import RAGPipeline
from app.services.catalog import CatalogIndex
from app.vector_db.store import build_vector_store

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
log = logging.getLogger("kohinoor")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the model and index once at startup.

    Doing this per request would add seconds of model-loading latency to every
    message; doing it at import time breaks `--reload` and test collection.
    """
    log.info("Starting %s (%s)", settings.app_name, settings.environment)

    embeddings = build_embedding_provider()
    store = build_vector_store(embeddings)

    if store.count() == 0:
        files, chunks = ingest_directory(store)
        log.info("Cold start ingestion: %d files, %d chunks", files, chunks)
    else:
        log.info("Vector store already populated: %d chunks", store.count())

    catalog = CatalogIndex()

    app.state.embeddings = embeddings
    app.state.store = store
    app.state.catalog = catalog
    app.state.pipeline = RAGPipeline(store, catalog)

    yield

    log.info("Shutting down")


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "RAG-backed learning assistant and semantic catalogue search for "
        "Kohinoor Tez. Answers strictly from the company's own knowledge base."
    ),
    lifespan=lifespan,
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key"],
)
# SSE is excluded by minimum_size in practice; this compresses the JSON
# endpoints, where catalogue search responses are the largest payloads.
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(router)


@app.get("/")
async def root() -> dict:
    return {
        "service": settings.app_name,
        "version": "1.0.0",
        "endpoints": ["/chat", "/chat/sync", "/search", "/upload", "/reindex", "/health"],
    }
