"""Vector store behind a Protocol so Chroma is an implementation detail.

Swapping to FAISS, pgvector or Pinecone means writing one class that satisfies
`VectorStore`. Nothing in the RAG pipeline knows which one it is talking to.

COLLECTIONS
-----------
Everything is addressed by collection name, and the sales bot depends on that
separation being physical rather than a metadata filter:

    cc_policy      company, shipping and returns copy
    cc_marketing   admin-authored sales copy and chapter lists
    cc_samples     text from FREE book pages only

A metadata filter is a decision made at query time, and a query-time decision
is one a future bug can forget. A separate collection is a different object that
the wrong code path cannot reach even by accident.

DELETE IS LOAD-BEARING
----------------------
`delete()` is not a convenience. When an admin narrows a book's free range from
1-20 to 1-5, pages 6-20 must leave the index. Without it that text stays
queryable forever and the "the bot can only see free pages" guarantee is false
the first time anyone edits a range. This is the single highest-risk correctness
requirement in the feature, and `tests/test_corpus_isolation.py` exists to prove
it holds.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Protocol

from app.config import settings
from app.embeddings.provider import EmbeddingProvider

log = logging.getLogger(__name__)

# The only collection names in use. Anything else is a typo.
POLICY = "cc_policy"
MARKETING = "cc_marketing"
SAMPLES = "cc_samples"
ALL_COLLECTIONS = (POLICY, MARKETING, SAMPLES)


@dataclass
class Document:
    id: str
    text: str
    metadata: dict = field(default_factory=dict)


@dataclass
class Match:
    id: str
    text: str
    metadata: dict
    score: float  # cosine similarity, 1.0 = identical
    collection: str = ""


class VectorStore(Protocol):
    def add(self, collection: str, docs: list[Document]) -> None: ...
    def delete(self, collection: str, ids: list[str]) -> None: ...
    def query(self, collection: str, text: str, top_k: int) -> list[Match]: ...
    def ids(self, collection: str) -> set[str]: ...
    def count(self, collection: str | None = None) -> int: ...
    def reset(self, collection: str | None = None) -> None: ...


class InMemoryStore:
    """Brute-force cosine search, one bucket per collection.

    O(n) per query. At a few thousand chunks that is well under a millisecond;
    move to Chroma/FAISS if the corpus grows past ~50k chunks.
    """

    def __init__(self, embeddings: EmbeddingProvider) -> None:
        self._embeddings = embeddings
        self._docs: dict[str, dict[str, Document]] = {c: {} for c in ALL_COLLECTIONS}
        self._vectors: dict[str, dict[str, list[float]]] = {c: {} for c in ALL_COLLECTIONS}

    def _bucket(self, collection: str) -> str:
        if collection not in self._docs:
            self._docs[collection] = {}
            self._vectors[collection] = {}
        return collection

    def add(self, collection: str, docs: list[Document]) -> None:
        if not docs:
            return
        c = self._bucket(collection)
        vectors = self._embeddings.embed([d.text for d in docs])
        for doc, vector in zip(docs, vectors):
            self._docs[c][doc.id] = doc
            self._vectors[c][doc.id] = vector

    def delete(self, collection: str, ids: list[str]) -> None:
        if not ids:
            return
        c = self._bucket(collection)
        for doc_id in ids:
            self._docs[c].pop(doc_id, None)
            self._vectors[c].pop(doc_id, None)

    def query(self, collection: str, text: str, top_k: int) -> list[Match]:
        c = self._bucket(collection)
        if not self._docs[c]:
            return []
        q = self._embeddings.embed_one(text)
        scored = [
            (sum(a * b for a, b in zip(q, self._vectors[c][doc_id])), doc)
            for doc_id, doc in self._docs[c].items()
        ]
        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            Match(id=d.id, text=d.text, metadata=d.metadata, score=float(s), collection=c)
            for s, d in scored[:top_k]
        ]

    def ids(self, collection: str) -> set[str]:
        return set(self._docs.get(collection, {}))

    def count(self, collection: str | None = None) -> int:
        if collection is None:
            return sum(len(b) for b in self._docs.values())
        return len(self._docs.get(collection, {}))

    def reset(self, collection: str | None = None) -> None:
        targets = [collection] if collection else list(self._docs)
        for c in targets:
            self._docs[c] = {}
            self._vectors[c] = {}


class ChromaStore:
    """Persistent store. Survives restarts, so ingestion runs once."""

    def __init__(self, embeddings: EmbeddingProvider) -> None:
        import chromadb

        self._embeddings = embeddings
        self._client = chromadb.PersistentClient(path=settings.chroma_path)
        self._collections: dict[str, object] = {}

    def _get(self, collection: str):
        if collection not in self._collections:
            self._collections[collection] = self._client.get_or_create_collection(
                name=collection,
                # Cosine, not the L2 default — our embeddings are normalised, and
                # L2 on normalised vectors is monotonic with cosine but not
                # directly comparable to min_relevance.
                metadata={"hnsw:space": "cosine"},
            )
        return self._collections[collection]

    def add(self, collection: str, docs: list[Document]) -> None:
        if not docs:
            return
        self._get(collection).upsert(
            ids=[d.id for d in docs],
            documents=[d.text for d in docs],
            embeddings=self._embeddings.embed([d.text for d in docs]),
            metadatas=[d.metadata or {"source": "unknown"} for d in docs],
        )

    def delete(self, collection: str, ids: list[str]) -> None:
        if not ids:
            return
        self._get(collection).delete(ids=ids)

    def query(self, collection: str, text: str, top_k: int) -> list[Match]:
        available = self.count(collection)
        if available == 0:
            return []
        res = self._get(collection).query(
            query_embeddings=[self._embeddings.embed_one(text)],
            n_results=min(top_k, available),
            include=["documents", "metadatas", "distances"],
        )
        ids = res.get("ids", [[]])[0]
        documents = res.get("documents", [[]])[0]
        metadatas = res.get("metadatas", [[]])[0]
        distances = res.get("distances", [[]])[0]

        return [
            Match(
                id=i,
                text=doc,
                metadata=meta or {},
                # Chroma returns cosine *distance*; similarity is 1 - distance.
                score=float(1.0 - dist),
                collection=collection,
            )
            for i, doc, meta, dist in zip(ids, documents, metadatas, distances)
        ]

    def ids(self, collection: str) -> set[str]:
        got = self._get(collection).get(include=[])
        return set(got.get("ids", []))

    def count(self, collection: str | None = None) -> int:
        if collection is None:
            return sum(int(self._get(c).count()) for c in ALL_COLLECTIONS)
        return int(self._get(collection).count())

    def reset(self, collection: str | None = None) -> None:
        targets = [collection] if collection else list(ALL_COLLECTIONS)
        for c in targets:
            try:
                self._client.delete_collection(c)
            except Exception:  # noqa: BLE001 — deleting a missing collection is fine
                pass
            self._collections.pop(c, None)


def build_vector_store(embeddings: EmbeddingProvider) -> VectorStore:
    if settings.vector_store == "memory":
        return InMemoryStore(embeddings)
    try:
        return ChromaStore(embeddings)
    except Exception as exc:  # noqa: BLE001
        log.warning("Chroma unavailable (%s). Using in-memory store.", exc)
        return InMemoryStore(embeddings)
