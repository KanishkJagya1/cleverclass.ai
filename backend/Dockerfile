# syntax=docker/dockerfile:1
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # Keep the sentence-transformers model inside the image layer rather than
    # downloading ~90 MB on every cold start.
    HF_HOME=/app/.cache/huggingface

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first: this layer is cached unless requirements.txt changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Warm the embedding model at build time so the first request isn't slow.
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')" || \
    echo "Model pre-warm skipped"

# Build the vector index at image build time. Cold starts then skip ingestion.
RUN python -c "import asyncio; \
    from app.embeddings.provider import build_embedding_provider; \
    from app.vector_db.store import build_vector_store; \
    from app.rag.ingest import ingest_directory; \
    ingest_directory(build_vector_store(build_embedding_provider()))" || \
    echo "Pre-ingest skipped"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

# One worker: each worker loads its own copy of the embedding model, so
# scaling means more containers, not more workers in one container.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
