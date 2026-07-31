"""RAG pipeline: retrieve → ground → generate.

Refusal is a first-class outcome. If retrieval comes back below the relevance
floor, we never reach the LLM — no context, no temptation to improvise.
"""

from __future__ import annotations

import logging
import re
from collections import OrderedDict
from typing import AsyncIterator

from app.config import settings
from app.prompts.system import ORDER_HANDOFF, REFUSAL, SYSTEM_PROMPT, build_prompt
from app.schemas.chat import ProductHit, Source
from app.services.catalog import CatalogIndex
from app.vector_db.store import VectorStore

log = logging.getLogger(__name__)

# Questions about a specific customer order can never be answered from a
# static corpus, so they short-circuit to a human before retrieval runs.
ORDER_PATTERNS = re.compile(
    r"\b(my order|where is my|track(ing)? (my )?(order|parcel)|refund status|"
    r"cancel my order|change my address|delivery status|order number)\b",
    re.IGNORECASE,
)


class ResponseCache:
    """Small LRU over (question, top-doc-id).

    Keyed on the retrieved document as well as the question so a re-ingested
    corpus does not keep serving the previous answer.
    """

    def __init__(self, size: int) -> None:
        self._size = size
        self._store: OrderedDict[str, tuple[str, list[ProductHit], list[Source]]] = (
            OrderedDict()
        )

    def get(self, key: str):
        if key not in self._store:
            return None
        self._store.move_to_end(key)
        return self._store[key]

    def put(self, key: str, value: tuple[str, list[ProductHit], list[Source]]) -> None:
        self._store[key] = value
        self._store.move_to_end(key)
        while len(self._store) > self._size:
            self._store.popitem(last=False)

    def clear(self) -> None:
        self._store.clear()


class RAGPipeline:
    def __init__(self, store: VectorStore, catalog: CatalogIndex) -> None:
        self.store = store
        self.catalog = catalog
        self.cache = ResponseCache(settings.cache_size)
        self._llm = None  # built lazily; most health checks never need it

    # -- retrieval ---------------------------------------------------------
    def retrieve(self, question: str) -> list:
        matches = self.store.query(question, settings.top_k)
        return [m for m in matches if m.score >= settings.min_relevance]

    @staticmethod
    def build_context(matches: list) -> str:
        return "\n\n---\n\n".join(
            f"[{m.metadata.get('title', m.id)}]\n{m.text}" for m in matches
        )

    # -- generation --------------------------------------------------------
    def _get_llm(self):
        if self._llm is None:
            from app.services.llm import build_llm

            self._llm = build_llm()
        return self._llm

    async def answer(
        self, question: str, history: list[tuple[str, str]]
    ) -> tuple[str, list[ProductHit], list[Source], bool]:
        if ORDER_PATTERNS.search(question):
            return ORDER_HANDOFF, [], [], False

        matches = self.retrieve(question)
        products = self.catalog.search(question, limit=3)

        if not matches:
            # No grounding. If the catalogue matched, the products alone are
            # still a useful answer — otherwise refuse outright.
            if products:
                return (
                    "I couldn't find that in our written information, but these "
                    "titles look closest to what you asked about.",
                    products,
                    [],
                    False,
                )
            return REFUSAL, [], [], False

        cache_key = f"{question.strip().lower()}::{matches[0].id}"
        if cached := self.cache.get(cache_key):
            answer, cached_products, sources = cached
            return answer, cached_products, sources, True

        prompt = build_prompt(question, self.build_context(matches), history)
        answer = await self._get_llm().complete(SYSTEM_PROMPT, prompt)

        sources = [
            Source(id=m.id, title=str(m.metadata.get("title", m.id)), score=round(m.score, 3))
            for m in matches
        ]
        self.cache.put(cache_key, (answer, products, sources))
        return answer, products, sources, True

    async def stream(
        self, question: str, history: list[tuple[str, str]]
    ) -> AsyncIterator[tuple[str, object]]:
        """Yields ("token", str) / ("products", list) / ("done", None)."""
        if ORDER_PATTERNS.search(question):
            yield "token", ORDER_HANDOFF
            yield "done", None
            return

        matches = self.retrieve(question)
        products = self.catalog.search(question, limit=3)

        if not matches:
            text = (
                "I couldn't find that in our written information, but these "
                "titles look closest to what you asked about."
                if products
                else REFUSAL
            )
            yield "token", text
            if products:
                yield "products", products
            yield "done", None
            return

        prompt = build_prompt(question, self.build_context(matches), history)

        async for token in self._get_llm().stream(SYSTEM_PROMPT, prompt):
            yield "token", token

        # Products come after the prose so the cards land under a complete
        # answer rather than appearing mid-sentence.
        if products:
            yield "products", products
        yield "done", None
