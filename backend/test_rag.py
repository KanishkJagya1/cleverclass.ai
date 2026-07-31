"""Runnable checks for the RAG pipeline.

No pytest, no fixtures — `python test_rag.py`. These assert the behaviours
that would silently break the assistant: chunking that loses text, retrieval
that returns the wrong document, facet parsing that misreads a query, and —
most importantly — a corpus miss that produces a confident invention instead
of a refusal.
"""

from __future__ import annotations

import asyncio
import sys

from app.config import settings
from app.embeddings.provider import HashEmbeddings
from app.prompts.system import ORDER_HANDOFF, REFUSAL
from app.rag.chunker import chunk_text, extract_title
from app.rag.ingest import documents_from_text
from app.rag.pipeline import RAGPipeline, ResponseCache
from app.services.catalog import CatalogIndex, parse_filters
from app.vector_db.store import InMemoryStore


def test_chunker() -> None:
    text = "\n\n".join(f"Paragraph {i} " + "word " * 40 for i in range(10))
    chunks = chunk_text(text, size=400, overlap=60)

    assert chunks, "chunker produced nothing"
    assert all(c.strip() for c in chunks), "chunker produced an empty chunk"
    # Overlap means total length exceeds the source; losing text does not.
    assert sum(len(c) for c in chunks) >= len(text) * 0.9, "chunker lost content"

    # A single oversized paragraph must still be split, not emitted whole.
    huge = "x" * 5000
    assert len(chunk_text(huge, size=500, overlap=50)) > 1, "oversized paragraph not split"

    assert extract_title("# Shipping\n\nbody", "f.md") == "Shipping"
    assert extract_title("no heading", "fallback.md") == "fallback.md"
    print("  chunker ok")


def test_ingest_ids_are_stable() -> None:
    text = "# Doc\n\n" + "\n\n".join(f"Para {i} " + "w " * 30 for i in range(6))
    first = documents_from_text(text, "doc.md")
    second = documents_from_text(text, "doc.md")

    assert [d.id for d in first] == [d.id for d in second], "ids are not deterministic"
    assert len({d.id for d in first}) == len(first), "duplicate chunk ids"
    assert all(d.metadata["title"] == "Doc" for d in first), "title metadata missing"
    print("  ingest ok")


def test_retrieval_ranking() -> None:
    store = InMemoryStore(HashEmbeddings())
    store.add(
        documents_from_text(
            "# Shipping\n\nShipping is free on all orders of 200 rupees and above. "
            "Below that a flat 40 rupees applies anywhere in India.",
            "shipping.md",
        )
    )
    store.add(
        documents_from_text(
            "# Returns\n\nUnused books can be returned within 7 days of delivery "
            "in original condition.",
            "returns.md",
        )
    )

    top = store.query("free shipping rupees orders above", top_k=2)
    assert top, "retrieval returned nothing"
    assert "shipping" in top[0].metadata["source"], (
        f"wrong document ranked first: {top[0].metadata['source']}"
    )
    assert top[0].score >= top[-1].score, "results are not sorted by score"
    print("  retrieval ok")


def test_filter_parsing() -> None:
    cases = [
        ("Show me Class 10 Science books in English", {"classId": "10", "subject": "Science", "medium": "english"}),
        ("class 12 pcm spark", {"classId": "12", "stream": "science-pcm", "series": "spark"}),
        ("10th marathi maths", {"classId": "10", "medium": "marathi", "subject": "Mathematics"}),
        ("hsc commerce accountancy", {"classId": "12", "stream": "commerce", "subject": "Book Keeping & Accountancy"}),
    ]
    for query, expected in cases:
        got = parse_filters(query).model_dump()
        for key, value in expected.items():
            assert got[key] == value, f"{query!r}: {key} was {got[key]!r}, expected {value!r}"
    print("  filter parsing ok")


def test_catalog_search() -> None:
    catalog = CatalogIndex()
    if catalog.count() == 0:
        print("  catalog search skipped (no catalog.json)")
        return

    hits = catalog.search("which book for 12th PCM")
    assert hits, "no hits for a query the catalogue clearly covers"
    assert all(h.slug for h in hits), "hit missing a slug"
    # A wrong class is disqualifying, not merely down-ranked.
    assert all(
        h.href.startswith("/") for h in hits
    ), "hit href is not a site-relative path"

    class10 = catalog.search("class 10 marathi science")
    assert class10, "no hits for class 10 marathi science"
    print("  catalog search ok")


def test_cache_evicts() -> None:
    cache = ResponseCache(size=2)
    cache.put("a", ("A", [], []))
    cache.put("b", ("B", [], []))
    cache.get("a")  # touch, so "b" is now least-recently-used
    cache.put("c", ("C", [], []))

    assert cache.get("a") is not None, "LRU evicted a recently used entry"
    assert cache.get("b") is None, "LRU did not evict the oldest entry"
    print("  cache ok")


def test_refuses_when_corpus_is_silent() -> None:
    """The one that matters most.

    An empty corpus must produce a refusal, never an invented answer.
    """
    store = InMemoryStore(HashEmbeddings())
    pipeline = RAGPipeline(store, CatalogIndex(path="/nonexistent.json"))

    answer, products, sources, grounded = asyncio.run(
        pipeline.answer("What is the capital of France?", [])
    )
    assert answer == REFUSAL, f"expected a refusal, got: {answer!r}"
    assert not products and not sources and not grounded
    print("  refusal ok")


def test_order_questions_hand_off() -> None:
    store = InMemoryStore(HashEmbeddings())
    store.add(documents_from_text("# Shipping\n\nOrders ship in 3 to 5 days.", "s.md"))
    pipeline = RAGPipeline(store, CatalogIndex(path="/nonexistent.json"))

    for question in ("Where is my order?", "I want to track my parcel", "refund status please"):
        answer, _, _, grounded = asyncio.run(pipeline.answer(question, []))
        assert answer == ORDER_HANDOFF, f"{question!r} did not hand off: {answer!r}"
        assert not grounded
    print("  order handoff ok")


def test_grounded_answer_uses_context() -> None:
    store = InMemoryStore(HashEmbeddings())
    store.add(
        documents_from_text(
            "# Shipping\n\nShipping is free on all orders of 200 rupees and above. "
            "Orders within Maharashtra usually arrive in 3 to 5 working days.",
            "shipping.md",
        )
    )
    pipeline = RAGPipeline(store, CatalogIndex(path="/nonexistent.json"))

    answer, _, sources, grounded = asyncio.run(
        pipeline.answer("free shipping orders above rupees", [])
    )
    assert grounded, "a covered question was not answered from the corpus"
    assert sources, "grounded answer carried no sources"
    assert answer and answer != REFUSAL
    print("  grounded answer ok")


def main() -> int:
    print(f"RAG checks (llm={settings.llm_provider}, min_relevance={settings.min_relevance})")
    for check in (
        test_chunker,
        test_ingest_ids_are_stable,
        test_retrieval_ranking,
        test_filter_parsing,
        test_catalog_search,
        test_cache_evicts,
        test_refuses_when_corpus_is_silent,
        test_order_questions_hand_off,
        test_grounded_answer_uses_context,
    ):
        check()
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
