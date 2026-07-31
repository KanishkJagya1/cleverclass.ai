"""Vector store behind a Protocol so Chroma is an implementation detail.

Swapping to FAISS, pgvector or Pinecone means writing one class that satisfies
`VectorStore`. Nothing in the RAG pipeline knows which one it is talking to.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Protocol

from app.config import settings
from app.embeddings.provider import EmbeddingProvider

log = logging.getLogger(__name__)


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


class VectorStore(Protocol):
    def add(self, docs: list[Document]) -> None: ...
    def query(self, text: str, top_k: int) -> list[Match]: ...
    def count(self) -> int: ...
    def reset(self) -> None: ...


class InMemoryStore:
    """Brute-force cosine search.

    ponytail: O(n) per query. At a few thousand chunks that is well under a
    millisecond; move to Chroma/FAISS if the corpus grows past ~50k chunks.
    """

    def __init__(self, embeddings: EmbeddingProvider) -> None:
        self._embeddings = embeddings
        self._docs: list[Document] = []
        self._vectors: list[list[float]] = []

    def add(self, docs: list[Document]) -> None:
        if not docs:
            return
        vectors = self._embeddings.embed([d.text for d in docs])
        self._docs.extend(docs)
        self._vectors.extend(vectors)

    def query(self, text: str, top_k: int) -> list[Match]:
        if not self._docs:
            return []
        q = self._embeddings.embed_one(text)
        scored = [
            (sum(a * b for a, b in zip(q, v)), doc)
            for v, doc in zip(self._vectors, self._docs)
        ]
        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            Match(id=d.id, text=d.text, metadata=d.metadata, score=float(s))
            for s, d in scored[:top_k]
        ]

    def count(self) -> int:
        return len(self._docs)

    def reset(self) -> None:
        self._docs.clear()
        self._vectors.clear()


class ChromaStore:
    """Persistent store. Survives restarts, so ingestion runs once."""

    def __init__(self, embeddings: EmbeddingProvider) -> None:
        import chromadb

        self._embeddings = embeddings
        self._client = chromadb.PersistentClient(path=settings.chroma_path)
        self._collection = self._client.get_or_create_collection(
            name=settings.collection_name,
            # Cosine, not the L2 default — our embeddings are normalised, and
            # L2 on normalised vectors produces a distance that is monotonic
            # with cosine but not directly comparable to min_relevance.
            metadata={"hnsw:space": "cosine"},
        )

    def add(self, docs: list[Document]) -> None:
        if not docs:
            return
        self._collection.upsert(
            ids=[d.id for d in docs],
            documents=[d.text for d in docs],
            embeddings=self._embeddings.embed([d.text for d in docs]),
            metadatas=[d.metadata or {"source": "unknown"} for d in docs],
        )

    def query(self, text: str, top_k: int) -> list[Match]:
        if self.count() == 0:
            return []
        res = self._collection.query(
            query_embeddings=[self._embeddings.embed_one(text)],
            n_results=min(top_k, self.count()),
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
            )
            for i, doc, meta, dist in zip(ids, documents, metadatas, distances)
        ]

    def count(self) -> int:
        return int(self._collection.count())

    def reset(self) -> None:
        self._client.delete_collection(settings.collection_name)
        self._collection = self._client.get_or_create_collection(
            name=settings.collection_name, metadata={"hnsw:space": "cosine"}
        )


def build_vector_store(embeddings: EmbeddingProvider) -> VectorStore:
    if settings.vector_store == "memory":
        return InMemoryStore(embeddings)
    try:
        return ChromaStore(embeddings)
    except Exception as exc:  # noqa: BLE001
        log.warning("Chroma unavailable (%s). Using in-memory store.", exc)
        return InMemoryStore(embeddings)
