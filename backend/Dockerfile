# syntax=docker/dockerfile:1
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # Model cache lives on a MOUNTED volume, not in the image. Baking ~90 MB
    # into a layer means re-downloading it on every dependency change, and this
    # box shares a disk with another stack.
    HF_HOME=/cache/hf \
    SENTENCE_TRANSFORMERS_HOME=/cache/hf

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first: this layer is cached unless requirements.txt changes, and
# it is the expensive one (torch).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The build-time vector index is GONE on purpose.
#
# It called `ingest_directory()`, which no longer exists — it was a second
# writer to the store and it read PDFs, which is the exact leak the free-page
# feature exists to prevent (see app/rag/ingest.py). Beyond that, a corpus baked
# at build time is stale the moment a book is added in the admin panel, and the
# runtime volume shadows it anyway. The corpus now syncs on boot from the
# database, through the single permitted writer.

RUN mkdir -p /db /media /chroma /cache

EXPOSE 8000

# start-period is generous: the first boot loads the embedding model and syncs
# the policy corpus before it can answer /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

# One worker: each worker loads its own copy of the embedding model (~400 MB),
# and the PDF worker assumes a single writer to SQLite. Scale with containers,
# not with workers in one container.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
