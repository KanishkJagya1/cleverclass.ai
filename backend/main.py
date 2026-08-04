"""CleverClass.AI — AI Learning Assistant backend.

Responsibilities: chatbot, RAG, embeddings, vector search. No ecommerce.

Run:  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.admin_routes import router as admin_router
from app.api.auth_routes import router as auth_router
from app.api.catalog_routes import router as catalog_router
from app.api.lead_routes import router as lead_router
from app.api.order_routes import router as order_router
from app.api.preview_routes import router as preview_router
from app.api.support_routes import router as support_router

from app.api.routes import router
from app.config import settings
from app.db.conn import healthcheck as db_healthcheck
from app.db.migrate import migrate
from app.errors import install as install_error_handlers
from app.middleware import RequestContextMiddleware, SecurityHeadersMiddleware

from app.embeddings.provider import build_embedding_provider
from app.rag import corpus
from app.rag.sales import SalesPipeline
from app.services import storage
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

    # Schema first: the catalogue routes query tables that must exist, and a
    # missing migration should fail loudly at boot rather than as a 500 on the
    # first request.
    migrate()
    db = db_healthcheck()
    if not db.get("ok"):
        log.error("Database unavailable: %s", db.get("error"))
    else:
        log.info("Database ready: %d books, schema v%d", db["books"], db["migration"])

    embeddings = build_embedding_provider()
    store = build_vector_store(embeddings)

    # Policy copy is cheap and content-addressed, so re-syncing on every boot
    # costs nothing and guarantees the index matches the files on disk.
    try:
        log.info("Policy corpus: %s", corpus.sync_policy(store))
    except Exception:  # noqa: BLE001 — a corpus problem must not stop the API
        log.exception("Policy corpus sync failed")

    log.info("Corpus: %s", corpus.stats(store))

    # Abandoned upload staging files, swept once at boot. A .part left by a
    # connection that died would otherwise sit there until the disk filled.
    try:
        storage.sweep_tmp()
    except Exception:  # noqa: BLE001
        log.warning("Could not sweep the upload staging directory")

    catalog = CatalogIndex()

    app.state.embeddings = embeddings
    app.state.store = store
    app.state.catalog = catalog
    # The sales assistant. Its rules are enforced in code, not only in the
    # prompt — see app/rag/sales.py and tests/test_sales_guard.py.
    app.state.pipeline = SalesPipeline(store, catalog)

    # Background jobs last, once everything they touch is ready. This is what
    # actually drains the email outbox, purges dead sessions and reconciles
    # stock — all of which existed as functions that nothing ever called.
    try:
        from app.services.jobs import register_default_jobs, scheduler

        register_default_jobs()
        scheduler.start()
    except Exception:  # noqa: BLE001 — the API must serve even if jobs will not
        log.exception("Could not start the job scheduler")

    yield

    try:
        from app.services.jobs import scheduler

        scheduler.stop()
    except Exception:  # noqa: BLE001
        pass
    log.info("Shutting down")


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "RAG-backed learning assistant and semantic catalogue search for "
        "CleverClass.AI. Answers strictly from the company's own knowledge base."
    ),
    lifespan=lifespan,
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url=None,
)

install_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    # PUT is here for /auth/profile. Its absence never broke anything only
    # because the browser does not call this service cross-origin — the Next
    # proxy does it server-side, where CORS does not apply.
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)
# SSE is excluded by minimum_size in practice; this compresses the JSON
# endpoints, where catalogue search responses are the largest payloads.
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(SecurityHeadersMiddleware)
# Added LAST so it is the OUTERMOST middleware: Starlette runs them in reverse
# registration order, and the request id must be set before anything inner —
# including the error handlers and every service log line — tries to read it.
app.add_middleware(RequestContextMiddleware)

app.include_router(router)
app.include_router(catalog_router)
app.include_router(lead_router)
app.include_router(admin_router)
app.include_router(preview_router)
app.include_router(order_router)
app.include_router(auth_router)
app.include_router(support_router)

@app.get("/")
async def root() -> dict:
    return {
        "service": settings.app_name,
        "version": "1.0.0",
        "endpoints": ["/health", "/chat", "/chat/sync", "/search", "/catalog", "/preview", "/orders"],
    }
