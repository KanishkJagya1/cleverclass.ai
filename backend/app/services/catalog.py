"""Catalogue index for product recommendations and semantic search (D8).

Kept separate from the document corpus: prose answers come from the knowledge
base, product cards come from structured catalogue rows. Mixing them means a
paragraph about shipping can be "retrieved" as a book.

The catalogue is loaded from `knowledge/catalog.json`, which the frontend can
regenerate from whatever adapter is live (seed today, a database later).
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from app.config import settings
from app.schemas.chat import ProductHit, SearchFilters

log = logging.getLogger(__name__)

# Natural-language → facet vocabulary. Deliberately a lookup table rather than
# an LLM call: "class 10 marathi science" must resolve in single-digit
# milliseconds inside the ⌘K palette, and an LLM round-trip cannot do that.
CLASS_WORDS = {
    "nursery": "nursery", "kg": "nursery", "pre-primary": "nursery",
    "5th": "5", "fifth": "5", "6th": "6", "sixth": "6",
    "7th": "7", "seventh": "7", "8th": "8", "eighth": "8",
    "9th": "9", "ninth": "9", "10th": "10", "tenth": "10", "ssc": "10",
    "11th": "11", "eleventh": "11", "fyjc": "11",
    "12th": "12", "twelfth": "12", "hsc": "12",
    "board": "board-exam",
}

MEDIUM_WORDS = {
    "marathi": "marathi", "मराठी": "marathi",
    "semi": "semi-english", "semi-english": "semi-english", "semi english": "semi-english",
    "english": "english",
}

STREAM_WORDS = {
    "pcm": "science-pcm", "pcb": "science-pcb", "pcbm": "science-pcbm",
    "commerce": "commerce", "arts": "arts",
}

SUBJECT_WORDS = [
    "mathematics", "maths", "math", "science", "physics", "chemistry", "biology",
    "english", "marathi", "hindi", "sanskrit", "history", "geography",
    "political science", "economics", "social science", "book keeping",
    "accountancy",
]

SUBJECT_CANONICAL = {
    "maths": "Mathematics", "math": "Mathematics", "mathematics": "Mathematics",
    "accountancy": "Book Keeping & Accountancy",
    "book keeping": "Book Keeping & Accountancy",
    "political science": "Political Science",
    "social science": "Social Science",
}

SERIES_WORDS = ["kohinoor", "spark", "vidyamitra", "winwings", "ekatmik"]


def parse_filters(query: str) -> SearchFilters:
    """Extract catalogue facets from a natural-language query."""
    q = query.lower()
    filters = SearchFilters()

    # "class 10" / "std 10" / "10th"
    if m := re.search(r"\b(?:class|std|standard|इयत्ता)\s*(\d{1,2})\b", q):
        filters.classId = m.group(1)
    else:
        for word, value in CLASS_WORDS.items():
            if re.search(rf"\b{re.escape(word)}\b", q):
                filters.classId = value
                break

    # Language names are ambiguous: "marathi" is a medium AND a subject.
    # Whichever reading wins here must not win twice, so the matched medium
    # word is removed before subject detection — otherwise "10th marathi
    # maths" resolves its subject to Marathi and never reaches "maths".
    subject_text = q
    for word, value in MEDIUM_WORDS.items():
        if word in q:
            filters.medium = value
            subject_text = subject_text.replace(word, " ", 1)
            break

    for word, value in STREAM_WORDS.items():
        if re.search(rf"\b{word}\b", q):
            filters.stream = value
            break

    for word in sorted(SUBJECT_WORDS, key=len, reverse=True):
        if re.search(rf"\b{re.escape(word)}\b", subject_text):
            filters.subject = SUBJECT_CANONICAL.get(word, word.title())
            break

    for word in SERIES_WORDS:
        if word in q:
            filters.series = word
            break

    return filters


class CatalogIndex:
    def __init__(self, path: str | None = None) -> None:
        self._items: list[dict] = []
        self.load(path)

    def load(self, path: str | None = None) -> int:
        target = Path(path or Path(settings.knowledge_dir) / "catalog.json")
        if not target.exists():
            log.warning("Catalogue file %s not found — product cards disabled.", target)
            self._items = []
            return 0

        try:
            self._items = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            log.error("catalog.json is not valid JSON: %s", exc)
            self._items = []

        log.info("Catalogue loaded: %d items", len(self._items))
        return len(self._items)

    def count(self) -> int:
        return len(self._items)

    def search(self, query: str, limit: int = 8) -> list[ProductHit]:
        if not self._items:
            return []

        filters = parse_filters(query)
        tokens = {t for t in re.findall(r"\w+", query.lower()) if len(t) > 2}

        scored: list[tuple[float, dict]] = []
        for item in self._items:
            score = 0.0

            # Facet matches are worth far more than incidental word overlap:
            # "class 10" appearing in the title is weak evidence, but the
            # class field actually being 10 is decisive.
            if filters.classId and item.get("classId") == filters.classId:
                score += 4
            elif filters.classId:
                continue  # wrong class is disqualifying, not merely unlikely

            if filters.medium and item.get("medium") == filters.medium:
                score += 3
            if filters.subject and item.get("subject") == filters.subject:
                score += 3
            if filters.series and item.get("series") == filters.series:
                score += 2
            if filters.stream and item.get("stream") == filters.stream:
                score += 2

            haystack = " ".join(
                str(item.get(k, ""))
                for k in ("title", "titleMr", "subject", "series", "format")
            ).lower()
            score += sum(1 for t in tokens if t in haystack) * 0.5

            # A combo answers "which set should I buy" better than any single
            # book, and it is also the higher-value recommendation.
            if item.get("format") == "combo" and re.search(
                r"\b(set|combo|pack|all|complete|everything)\b", query.lower()
            ):
                score += 2.5

            if score > 0:
                scored.append((score, item))

        scored.sort(key=lambda x: (-x[0], x[1].get("price", 0)))

        return [
            ProductHit(
                slug=item["slug"],
                title=item["title"],
                titleMr=item.get("titleMr"),
                subtitle=item.get("subtitle", ""),
                format=item.get("format", "book"),
                href=item.get(
                    "href",
                    f"/{'combo-packs' if item.get('format') == 'combo' else 'shop'}/{item['slug']}",
                ),
                image=item.get("image"),
                price=item.get("price"),
                score=round(score, 2),
            )
            for score, item in scored[:limit]
        ]
