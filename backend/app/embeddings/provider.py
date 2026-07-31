"""Embedding providers behind one interface.

Local sentence-transformers is the default: no per-query cost, no network
dependency at request time, and 384 dimensions is more than enough for a
corpus of a few hundred chunks.

A hash-based fallback exists so the service still starts — and the test suite
still runs — on a machine with no model downloaded and no API key. It is not
semantically useful; it just keeps the pipeline exercisable.
"""

from __future__ import annotations

import hashlib
import logging
import math
from typing import Protocol

from app.config import settings

log = logging.getLogger(__name__)


class EmbeddingProvider(Protocol):
    dimension: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...

    def embed_one(self, text: str) -> list[float]: ...


def _normalise(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    return [v / norm for v in vec] if norm else vec


class SentenceTransformerEmbeddings:
    """Local model. Loaded once at startup, not per request."""

    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer  # heavy import

        self._model = SentenceTransformer(model_name)
        self.dimension = int(self._model.get_sentence_embedding_dimension())

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [
            list(map(float, v))
            for v in self._model.encode(texts, normalize_embeddings=True)
        ]

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]


class OpenAIEmbeddings:
    def __init__(self, api_key: str, model: str) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key)
        self._model = model
        self.dimension = 1536

    def embed(self, texts: list[str]) -> list[list[float]]:
        resp = self._client.embeddings.create(model=self._model, input=texts)
        return [_normalise(list(d.embedding)) for d in resp.data]

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]


class HashEmbeddings:
    """Deterministic bag-of-words hashing. Keeps the stack runnable offline.

    ponytail: crude on purpose. Exact-token overlap only, no semantics. Fine
    for smoke tests; swap to a real provider before anyone relies on answers.
    """

    dimension = 256

    def embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self.dimension
        for token in text.lower().split():
            digest = hashlib.md5(token.encode("utf-8")).digest()
            vec[digest[0] % self.dimension] += 1.0
        return _normalise(vec)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_one(t) for t in texts]


def build_embedding_provider() -> EmbeddingProvider:
    if settings.embedding_provider == "openai" and settings.openai_api_key:
        log.info("Embeddings: OpenAI %s", settings.openai_embedding_model)
        return OpenAIEmbeddings(settings.openai_api_key, settings.openai_embedding_model)

    try:
        log.info("Embeddings: sentence-transformers %s", settings.embedding_model)
        return SentenceTransformerEmbeddings(settings.embedding_model)
    except Exception as exc:  # noqa: BLE001 - degradation is deliberate
        log.warning(
            "sentence-transformers unavailable (%s). Falling back to hash "
            "embeddings — answers will be poor until a real model is installed.",
            exc,
        )
        return HashEmbeddings()
