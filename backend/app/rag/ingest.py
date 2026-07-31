"""Document ingestion.

Reads markdown/text from the knowledge directory and PDFs when pypdf is
available, chunks them, and writes them into the vector store.

Chunk ids are content-addressed (path + index + content hash), so re-running
ingestion updates changed chunks in place instead of duplicating the corpus.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from app.config import settings
from app.rag.chunker import chunk_text, extract_title
from app.vector_db.store import Document, VectorStore

log = logging.getLogger(__name__)

TEXT_SUFFIXES = {".md", ".markdown", ".txt"}
PDF_SUFFIXES = {".pdf"}


def _read_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        log.warning("pypdf not installed — skipping %s", path.name)
        return ""

    try:
        reader = PdfReader(str(path))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not read %s: %s", path.name, exc)
        return ""


def _read(path: Path) -> str:
    if path.suffix.lower() in TEXT_SUFFIXES:
        return path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() in PDF_SUFFIXES:
        return _read_pdf(path)
    return ""


def documents_from_text(text: str, source: str) -> list[Document]:
    title = extract_title(text, source)
    docs: list[Document] = []
    for index, chunk in enumerate(chunk_text(text)):
        digest = hashlib.sha1(chunk.encode("utf-8")).hexdigest()[:10]
        docs.append(
            Document(
                id=f"{source}::{index}::{digest}",
                text=chunk,
                metadata={"source": source, "title": title, "chunk": index},
            )
        )
    return docs


def ingest_directory(store: VectorStore, directory: str | None = None) -> tuple[int, int]:
    """Returns (files ingested, chunks written)."""
    root = Path(directory or settings.knowledge_dir)
    if not root.exists():
        log.warning("Knowledge directory %s does not exist", root)
        return 0, 0

    files = 0
    all_docs: list[Document] = []

    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES | PDF_SUFFIXES:
            continue

        text = _read(path)
        if not text.strip():
            continue

        docs = documents_from_text(text, path.relative_to(root).as_posix())
        all_docs.extend(docs)
        files += 1

    # One batched write: embedding in bulk is dramatically faster than
    # embedding chunk by chunk, for both local and hosted providers.
    store.add(all_docs)
    log.info("Ingested %d files → %d chunks", files, len(all_docs))
    return files, len(all_docs)
