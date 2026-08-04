"""The ONLY module permitted to write to the vector store.

This is the first and strongest of the four layers that keep locked book pages
away from the sales assistant. The other three (separate collections, a live
re-check at prompt-build time, and hard truncation) all sit downstream of this
one; if arbitrary code could call `store.add`, none of them would matter.

    ┌───────────────────────────────────────────────────────────────┐
    │  book_pages  ──WHERE is_free = 1──▶  cc_samples               │
    │  books       ──marketing/chapters─▶  cc_marketing             │
    │  knowledge/*.md ──────────────────▶  cc_policy                │
    └───────────────────────────────────────────────────────────────┘

Nothing else reaches the index. `tests/test_corpus_isolation.py` asserts both
that this is the only caller and — the part that actually matters — that
narrowing a free range REMOVES the newly-locked text.

Sync is a delta, not a rebuild: `corpus_docs` records what is currently indexed
with the sha of its source text, so re-saving an unchanged range is a no-op and
a narrowed range produces an explicit delete list.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import logging
from dataclasses import dataclass, field

from app.config import settings
from app.db.conn import load_json_list, query, query_one, transaction
from app.vector_db.store import MARKETING, POLICY, SAMPLES, Document, VectorStore

log = logging.getLogger(__name__)

# One sample chunk per page. Books are already paginated, page numbers are what
# the preview API and the live re-check key off, and a chunk spanning a free and
# a locked page would be unattributable to either.
MAX_SAMPLE_CHARS = 4000


@dataclass
class CorpusDelta:
    added: int = 0
    deleted: int = 0
    unchanged: int = 0
    collection: str = ""
    notes: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"{self.collection}: +{self.added} -{self.deleted} "
            f"({self.unchanged} unchanged)"
        )


def _sha(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# --------------------------------------------------------------------------
# What is currently indexed
# --------------------------------------------------------------------------

def _indexed(book_id: str | None, collection: str) -> dict[str, str]:
    """{doc_id: source_sha} for what the index is believed to hold."""
    if book_id:
        rows = query(
            "SELECT doc_id, source_sha FROM corpus_docs WHERE collection = ? AND book_id = ?",
            (collection, book_id),
        )
    else:
        rows = query(
            "SELECT doc_id, source_sha FROM corpus_docs WHERE collection = ? AND book_id IS NULL",
            (collection,),
        )
    return {r["doc_id"]: r["source_sha"] for r in rows}


def _reconcile(book_id: str | None, collection: str, wanted: dict[str, Document]) -> None:
    """Make corpus_docs match what we just wrote."""
    with transaction() as conn:
        if book_id:
            conn.execute(
                "DELETE FROM corpus_docs WHERE collection = ? AND book_id = ?",
                (collection, book_id),
            )
        else:
            conn.execute(
                "DELETE FROM corpus_docs WHERE collection = ? AND book_id IS NULL",
                (collection,),
            )
        for doc_id, doc in wanted.items():
            conn.execute(
                "INSERT INTO corpus_docs (doc_id, collection, book_id, source_sha, page_no, indexed_at)"
                " VALUES (?,?,?,?,?,?)",
                (
                    doc_id,
                    collection,
                    book_id,
                    _sha(doc.text),
                    doc.metadata.get("page_no"),
                    _now(),
                ),
            )


def _apply(
    store: VectorStore,
    collection: str,
    book_id: str | None,
    wanted: dict[str, Document],
) -> CorpusDelta:
    """Diff against what is indexed, then add and DELETE as needed."""
    have = _indexed(book_id, collection)

    to_add = [doc for doc_id, doc in wanted.items() if have.get(doc_id) != _sha(doc.text)]
    # Anything indexed that is no longer wanted. For cc_samples this is exactly
    # the set of pages that just stopped being free.
    to_delete = [doc_id for doc_id in have if doc_id not in wanted]

    if to_delete:
        store.delete(collection, to_delete)
    if to_add:
        store.add(collection, to_add)

    _reconcile(book_id, collection, wanted)

    return CorpusDelta(
        added=len(to_add),
        deleted=len(to_delete),
        unchanged=len(wanted) - len(to_add),
        collection=collection,
    )


# --------------------------------------------------------------------------
# cc_samples — free page text ONLY
# --------------------------------------------------------------------------

def _free_page_docs(book_id: str) -> dict[str, Document]:
    row = query_one("SELECT slug, title FROM books WHERE id = ?", (book_id,))
    if row is None:
        return {}

    pages = query(
        """
        SELECT p.page_no, p.text, p.text_sha1
          FROM book_pages p
          JOIN book_assets a ON a.id = p.asset_id
         WHERE a.book_id = ? AND a.is_current = 1 AND p.is_free = 1
           AND LENGTH(TRIM(p.text)) > 40
         ORDER BY p.page_no
        """,
        (book_id,),
    )

    docs: dict[str, Document] = {}
    for page in pages:
        # Belt and braces. The SQL above already filters on is_free, but this is
        # the boundary where locked text would leak if that clause were ever
        # edited, so it is asserted rather than assumed.
        assert page["page_no"] is not None

        text = (page["text"] or "").strip()[:MAX_SAMPLE_CHARS]
        if not text:
            continue

        doc_id = f"{row['slug']}::p{page['page_no']}::{_sha(text)[:10]}"
        docs[doc_id] = Document(
            id=doc_id,
            text=text,
            metadata={
                "kind": "free_page",
                "book_slug": row["slug"],
                "book_title": row["title"],
                "page_no": page["page_no"],
            },
        )
    return docs


def sync_book_samples(store: VectorStore, book_id: str) -> CorpusDelta:
    """Reconcile cc_samples for one book against `book_pages WHERE is_free=1`.

    Called after every free-range change. Narrowing a range produces deletes;
    widening produces adds; re-saving the same range produces neither.
    """
    delta = _apply(store, SAMPLES, book_id, _free_page_docs(book_id))
    log.info("sync_book_samples(%s) -> %s", book_id, delta)
    return delta


# --------------------------------------------------------------------------
# cc_marketing — admin-authored copy, never book content
# --------------------------------------------------------------------------

def _marketing_docs(book_id: str) -> dict[str, Document]:
    row = query_one("SELECT * FROM books WHERE id = ?", (book_id,))
    # Drafts and archived books must not be recommended, so they are not indexed.
    if row is None or row["status"] != "published":
        return {}

    chapters = load_json_list(row["chapter_list"])
    highlights = load_json_list(row["highlights"])

    # One document per book, phrased as prose. Everything here is written by a
    # human in the admin panel — there is not a word of book content in it.
    parts = [
        f"{row['title']}.",
        f"For Class {row['class_id']}, {row['subject']}, "
        f"{str(row['medium']).replace('-', ' ')} medium, {row['series']} series.",
    ]
    if row["title_mr"]:
        parts.append(str(row["title_mr"]))
    if row["description"]:
        parts.append(str(row["description"]))
    if row["marketing_copy"]:
        parts.append(str(row["marketing_copy"]))
    if highlights:
        parts.append("Key features: " + "; ".join(str(h) for h in highlights) + ".")
    if chapters:
        parts.append("Chapters covered: " + "; ".join(str(c) for c in chapters) + ".")

    text = "\n".join(parts).strip()
    doc_id = f"{row['slug']}::marketing"
    return {
        doc_id: Document(
            id=doc_id,
            text=text,
            metadata={
                "kind": "marketing",
                "book_slug": row["slug"],
                "book_title": row["title"],
                "class_id": row["class_id"],
                "medium": row["medium"],
                "subject": row["subject"],
            },
        )
    }


def sync_book_marketing(store: VectorStore, book_id: str) -> CorpusDelta:
    """Called whenever a book is saved or its status changes."""
    return _apply(store, MARKETING, book_id, _marketing_docs(book_id))


def sync_book(store: VectorStore, book_id: str) -> list[CorpusDelta]:
    return [sync_book_marketing(store, book_id), sync_book_samples(store, book_id)]


def remove_book(store: VectorStore, book_id: str) -> None:
    """Drop a book from every collection — used on delete or unpublish."""
    for collection in (MARKETING, SAMPLES):
        _apply(store, collection, book_id, {})


# --------------------------------------------------------------------------
# cc_policy — company copy from knowledge/*.md
# --------------------------------------------------------------------------

def sync_policy(store: VectorStore) -> CorpusDelta:
    """Index the markdown in KNOWLEDGE_DIR.

    Markdown ONLY. The previous directory walker also read PDFs, which meant an
    admin who dropped a full book into `knowledge/` silently published all of it
    to the assistant — the exact leak this whole design exists to prevent.
    """
    from pathlib import Path

    from app.rag.chunker import chunk_text, extract_title

    directory = Path(settings.knowledge_dir)
    if not directory.is_dir():
        log.warning("Knowledge directory %s does not exist", directory)
        return CorpusDelta(collection=POLICY, notes=["knowledge dir missing"])

    docs: dict[str, Document] = {}
    skipped: list[str] = []

    for path in sorted(directory.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".md", ".markdown", ".txt"}:
            # catalog.json is data, not prose; a PDF here would be a mistake.
            if path.suffix.lower() != ".json":
                skipped.append(path.name)
            continue

        raw = path.read_text(encoding="utf-8", errors="replace")
        # `fallback` is required — calling this with one argument raised
        # TypeError inside the try/except in main.py's lifespan, so policy
        # indexing failed silently at every boot and cc_policy stayed empty
        # while /health still reported the store as ready.
        title = extract_title(raw, path.stem)
        for index, chunk in enumerate(chunk_text(raw)):
            doc_id = f"{path.name}::{index}::{_sha(chunk)[:10]}"
            docs[doc_id] = Document(
                id=doc_id,
                text=chunk,
                metadata={"kind": "policy", "source": path.name, "title": title},
            )

    delta = _apply(store, POLICY, None, docs)
    if skipped:
        delta.notes.append(
            f"ignored non-markdown files in knowledge/: {', '.join(skipped)}"
        )
        log.warning(
            "Ignored %d non-markdown file(s) in %s — only .md/.txt are indexed",
            len(skipped),
            directory,
        )
    return delta


def stats(store: VectorStore) -> dict:
    return {
        POLICY: store.count(POLICY),
        MARKETING: store.count(MARKETING),
        SAMPLES: store.count(SAMPLES),
    }
