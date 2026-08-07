"""Search suggestions and query logging.

Three kinds of suggestion, in the order a shopper actually thinks:

  1. **Facets** — "Class 10 Science" is a destination, not a product. Offering
     it first means one tap instead of scrolling a grid.
  2. **Titles** — prefix and substring matches on real books.
  3. **Popular** — what other people searched, when the box is still empty.

SYNONYMS ARE APPLIED BEFORE MATCHING. This catalogue's customers type "maths",
"10th", "SSC" and "अंक गणित" for things the database calls "Mathematics" and
"10". Without the mapping the search box looks broken to the people it was built
for, and `parse_filters` already carries the same knowledge for the assistant.

ZERO-RESULT QUERIES ARE THE POINT OF THE LOG. Popular searches are mildly
interesting; a list of searches that returned nothing is a list of sales the
shop is losing, and it is the clearest signal about what to stock next.
"""

from __future__ import annotations

import datetime as dt
import logging
import re

from app.db.conn import query, transaction

log = logging.getLogger(__name__)

# What shoppers type -> what the catalogue calls it. Kept next to the search
# rather than in `parse_filters` because the shapes differ: this one expands a
# partial word mid-typing, that one classifies a whole sentence.
SYNONYMS: dict[str, str] = {
    "maths": "mathematics", "math": "mathematics", "ganit": "mathematics",
    "गणित": "mathematics",
    "sci": "science", "vigyan": "science", "विज्ञान": "science",
    "ssc": "10", "hsc": "12", "fyjc": "11", "syjc": "12",
    "10th": "10", "12th": "12", "9th": "9", "11th": "11", "8th": "8",
    "eng": "english", "इंग्रजी": "english",
    "mar": "marathi", "मराठी": "marathi",
    "hin": "hindi", "हिंदी": "hindi",
    "sst": "social science", "socialscience": "social science",
    "bk": "book keeping & accountancy", "accounts": "book keeping & accountancy",
    "phy": "physics", "chem": "chemistry", "bio": "biology",
    "geo": "geography", "hist": "history", "pol": "political science",
}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def expand(term: str) -> str:
    """Rewrite known shorthand, word by word.

    Word-level rather than whole-string: "10th maths marathi" has to become
    "10 mathematics marathi", and a whole-string lookup would miss all three.
    """
    words = re.split(r"\s+", (term or "").strip().lower())
    return " ".join(SYNONYMS.get(w, w) for w in words if w)


def suggest(term: str, limit: int = 8) -> dict:
    """Suggestions for a partially-typed query."""
    raw = (term or "").strip()
    if len(raw) < 2:
        # Below two characters every book matches, which is noise rather than
        # help. Show what other people looked for instead.
        return {"query": raw, "facets": [], "books": [], "popular": popular(6)}

    expanded = expand(raw)
    like = f"%{expanded}%"
    prefix = f"{expanded}%"

    # --- facets: destinations, offered first -------------------------------
    facets = []
    for row in query(
        "SELECT DISTINCT class_id, subject FROM books"
        " WHERE status = 'published' AND deleted_at IS NULL"
        "   AND (LOWER(subject) LIKE ? OR class_id = ?)"
        " ORDER BY CAST(class_id AS INTEGER), subject LIMIT 5",
        (like, expanded.split()[0] if expanded else ""),
    ):
        facets.append({
            "label": f"Class {row['class_id']} {row['subject']}",
            "href": f"/shop?class={row['class_id']}&subject={row['subject']}",
            "kind": "facet",
        })

    # --- titles: prefix matches rank above substring -----------------------
    books = [
        {
            "slug": r["slug"], "title": r["title"], "classId": r["class_id"],
            "medium": r["medium"], "subject": r["subject"], "price": r["price"],
            "href": f"/shop/{r['slug']}", "kind": "book",
        }
        for r in query(
            "SELECT slug, title, class_id, medium, subject, price FROM books"
            " WHERE status = 'published' AND deleted_at IS NULL"
            "   AND (LOWER(title) LIKE ? OR LOWER(series) LIKE ?"
            "        OR LOWER(subject) LIKE ?)"
            # A title that STARTS with what was typed is what the shopper
            # meant; a substring match is a fallback.
            " ORDER BY CASE WHEN LOWER(title) LIKE ? THEN 0 ELSE 1 END,"
            "          best_seller_rank IS NULL, best_seller_rank, title"
            " LIMIT ?",
            (like, like, like, prefix, int(limit)),
        )
    ]

    return {"query": raw, "expanded": expanded if expanded != raw.lower() else None,
            "facets": facets, "books": books, "popular": []}


def record(term: str, results: int, *, source: str = "search",
           customer_id: str | None = None) -> None:
    """Log a query. Never raises — a logging failure must not break search."""
    cleaned = (term or "").strip().lower()
    if len(cleaned) < 2:
        return
    try:
        with transaction() as conn:
            conn.execute(
                "INSERT INTO search_log (q, results, source, customer_id, created_at)"
                " VALUES (?,?,?,?,?)",
                (cleaned[:200], int(results), source, customer_id, _now()),
            )
    except Exception:  # noqa: BLE001
        log.exception("Could not record search %r", cleaned[:40])


def popular(limit: int = 10, days: int = 30) -> list[dict]:
    """Most-searched terms that actually returned something."""
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()
    return [
        {"query": r["q"], "count": r["n"]}
        for r in query(
            "SELECT q, COUNT(*) n FROM search_log"
            " WHERE created_at >= ? AND results > 0 AND source = 'search'"
            " GROUP BY q ORDER BY n DESC, q LIMIT ?",
            (since, int(limit)),
        )
    ]


def zero_results(limit: int = 25, days: int = 30) -> list[dict]:
    """Searches that found nothing — demand the catalogue is not meeting.

    The most actionable report in the admin panel: every row is somebody who
    wanted to buy something and left.
    """
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()
    return [
        {"query": r["q"], "count": r["n"], "lastSeen": r["last_seen"]}
        for r in query(
            "SELECT q, COUNT(*) n, MAX(created_at) last_seen FROM search_log"
            " WHERE created_at >= ? AND results = 0 AND source = 'search'"
            " GROUP BY q ORDER BY n DESC, last_seen DESC LIMIT ?",
            (since, int(limit)),
        )
    ]


def stats(days: int = 30) -> dict:
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()
    rows = query(
        "SELECT COUNT(*) n, SUM(CASE WHEN results = 0 THEN 1 ELSE 0 END) zero"
        "  FROM search_log WHERE created_at >= ? AND source = 'search'",
        (since,),
    )
    total = rows[0]["n"] or 0
    zero = rows[0]["zero"] or 0
    return {
        "searches": total,
        "zeroResults": zero,
        # The number to watch. A rising rate means the catalogue is drifting
        # away from what people are asking for.
        "zeroRate": round(zero / total * 100, 1) if total else 0.0,
    }
