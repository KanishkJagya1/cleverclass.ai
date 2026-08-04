"""Pure-function checks for the retrieval and catalogue helpers.

Collected normally rather than run as a subprocess: nothing here touches the
database, the vector store or any module-level singleton, so it is safe in a
shared process.

Salvaged from the repo-root `test_rag.py`, which pytest surfaced as broken —
it had been calling the pre-collection `store.add(docs)` signature ever since
`VectorStore` became collection-addressed, and nothing collected it, so nobody
noticed. Its tests of `RAGPipeline`/`ResponseCache` went with that dead module;
these three cover code that is still live.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.rag.chunker import chunk_text, extract_title  # noqa: E402
from app.services.catalog import CatalogIndex, parse_filters  # noqa: E402


def test_chunker_splits_without_losing_text() -> None:
    text = "\n\n".join(f"Paragraph {i} " + "word " * 40 for i in range(10))
    chunks = chunk_text(text, size=400, overlap=60)

    assert chunks, "chunker produced nothing"
    assert all(c.strip() for c in chunks), "chunker produced an empty chunk"
    # Overlap means the total exceeds the source; losing text does not.
    assert sum(len(c) for c in chunks) >= len(text) * 0.9, "chunker lost content"

    # A single oversized paragraph must still be split, not emitted whole.
    assert len(chunk_text("x" * 5000, size=500, overlap=50)) > 1


def test_extract_title_falls_back_to_filename() -> None:
    assert extract_title("# Shipping\n\nbody", "f.md") == "Shipping"
    assert extract_title("no heading", "fallback.md") == "fallback.md"


def test_filter_parsing() -> None:
    """Guards the query understanding the whole recommender depends on."""
    cases = [
        (
            "Show me Class 10 Science books in English",
            {"classId": "10", "subject": "Science", "medium": "english"},
        ),
        ("class 12 pcm spark", {"classId": "12", "stream": "science-pcm", "series": "spark"}),
        ("10th marathi maths", {"classId": "10", "medium": "marathi", "subject": "Mathematics"}),
        (
            "hsc commerce accountancy",
            {"classId": "12", "stream": "commerce", "subject": "Book Keeping & Accountancy"},
        ),
    ]
    for query, expected in cases:
        got = parse_filters(query).model_dump()
        for key, value in expected.items():
            assert got[key] == value, f"{query!r}: {key} was {got[key]!r}, expected {value!r}"


def test_bare_number_is_read_as_a_class() -> None:
    """Regression: "kohinoor 10 science marathi" answered with Class 9, 8 and 5.

    No `class` keyword meant no class was extracted, every book scored equally,
    and `ORDER BY … price ASC` handed back whichever title was cheapest. Wrong
    class is the most expensive recommendation mistake this catalogue can make.
    """
    assert parse_filters("kohinoor 10 science marathi").classId == "10"
    assert parse_filters("vidyamitra 9 maths").classId == "9"


def test_bare_number_does_not_swallow_quantities_or_ids() -> None:
    """The other half of that fix: only 5-12, and only as a standalone token."""
    for query in (
        "I want 2 copies",
        "under 200 rupees",
        "where is CC-ABCD1234",
        "my pincode is 440016",
        "call me on 9876500000",
    ):
        assert parse_filters(query).classId is None, query


def test_catalog_search_returns_site_relative_hrefs() -> None:
    catalog = CatalogIndex()
    if catalog.count() == 0:
        return  # no catalog.json in this environment; nothing to assert

    hits = catalog.search("which book for 12th PCM")
    assert hits, "no hits for a query the catalogue clearly covers"
    assert all(h.slug for h in hits), "hit missing a slug"
    assert all(h.href.startswith("/") for h in hits), "href is not site-relative"
    assert catalog.search("class 10 marathi science"), "no hits for class 10 marathi science"
