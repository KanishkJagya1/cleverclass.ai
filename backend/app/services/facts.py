"""Authoritative numbers for the assistant.

Every price, MRP, saving, stock level, page count and shipping figure the bot is
allowed to state comes from here — read from the database and injected verbatim
above the prompt. The model is told it may state numbers ONLY if they appear in
this block, and a post-generation guard checks that it obeyed.

The reason is narrow and specific: an LLM quoting a wrong price is not an
embarrassment, it is an order taken at a price nobody agreed to. Arithmetic
(combo savings, discounts, totals) is done in SQL for the same reason — models
get sums wrong exactly when the sum is the thing that matters.
"""

from __future__ import annotations

import re

from app.config import settings
from app.db.conn import query, query_one


def _money(value: int | None) -> str:
    return f"₹{value}" if value is not None else "—"


# Topic word -> the `books.subject` value it belongs to.
#
# Without this the bot answered "मला त्रिकोणमिती समजावून सांग" (explain
# trigonometry) by recommending a Class 10 **Science** guide. Nothing was
# broken: no subject was extracted, so every book scored equally and the
# ORDER BY fell through to `price ASC` — the cheapest title won. Recommending
# the wrong subject is the same commercial mistake as recommending the wrong
# class, and it is the one this business already pays support costs for.
#
# Matched on word boundaries against the lower-cased question. Devanagari is
# listed alongside English because a Marathi-medium parent asks in Marathi and
# the chapter lists in the catalogue are all in English, so `book_for_topic`
# cannot match them.
_TOPIC_SUBJECTS: dict[str, tuple[str, ...]] = {
    "Mathematics": (
        "trigonometry", "algebra", "geometry", "arithmetic", "quadratic",
        "polynomial", "theorem", "pythagoras", "mensuration", "statistics",
        "probability", "calculus", "matrices", "determinant", "logarithm",
        "त्रिकोणमिती", "बीजगणित", "भूमिती", "गणित", "प्रमेय", "समीकरण",
    ),
    "Science": (
        "photosynthesis", "gravitation", "periodic table", "cell division",
        "heredity", "ecosystem", "refraction", "magnetism", "metallurgy",
        "carbon compound", "space mission", "विज्ञान", "प्रकाशसंश्लेषण",
        "गुरुत्वाकर्षण", "पेशी",
    ),
    "Physics": ("kinematics", "thermodynamics", "optics", "electrostatic", "पदार्थविज्ञान"),
    "Chemistry": ("mole concept", "chemical bond", "electrochemistry", "रसायनशास्त्र"),
    # Deliberately NOT "photosynthesis" — that sits in Science for classes 5-10
    # (32 titles) and only becomes Biology at 11-12 (5 titles), so Science is
    # the right default and these are the terms that are unambiguously Biology.
    "Biology": ("genetics", "biotechnology", "जीवशास्त्र"),
    "History": ("mughal", "maratha", "freedom struggle", "shivaji", "इतिहास", "शिवाजी"),
    "Geography": ("monsoon", "latitude", "longitude", "plate tectonic", "भूगोल"),
    "Political Science": ("constitution", "parliament", "federalism", "नागरिकशास्त्र", "राज्यशास्त्र"),
    "Economics": ("demand curve", "inflation", "gdp", "अर्थशास्त्र"),
    "Book Keeping & Accountancy": ("journal entry", "ledger", "balance sheet", "trial balance"),
    "English": ("grammar", "comprehension", "इंग्रजी"),
    "Marathi": ("व्याकरण", "मराठी"),
    "Hindi": ("हिंदी",),
    "Sanskrit": ("संस्कृत",),
}

# Longest phrases first, so "periodic table" wins over a bare word that also
# appears inside it.
_TOPIC_INDEX: list[tuple[str, str]] = sorted(
    ((word, subject) for subject, words in _TOPIC_SUBJECTS.items() for word in words),
    key=lambda pair: len(pair[0]),
    reverse=True,
)


def subject_for_topic(text: str) -> str | None:
    """Infer the subject a question is about, or None if it is not obvious.

    Deliberately conservative — returning the wrong subject is worse than
    returning none, because a known subject is disqualifying in `recommend`.
    """
    if not text:
        return None
    haystack = text.lower()
    for word, subject in _TOPIC_INDEX:
        if word in haystack:
            return subject
    return None


def facts_block(slugs: list[str]) -> str:
    """Verbatim, machine-generated facts for the books in play."""
    lines = [
        "FACTS (authoritative — you may state these numbers and no others):",
    ]

    unique = [s for s in dict.fromkeys(slugs) if s][:6]
    if unique:
        marks = ",".join("?" * len(unique))
        rows = query(
            f"""
            SELECT b.slug, b.title, b.price, b.mrp, b.in_stock, b.stock_qty,
                   b.class_id, b.medium, b.subject, b.edition, b.pages,
                   (SELECT COUNT(*) FROM book_pages p
                      JOIN book_assets a ON a.id = p.asset_id
                     WHERE a.book_id = b.id AND a.is_current = 1 AND p.is_free = 1
                   ) AS free_pages
              FROM books b
             WHERE b.slug IN ({marks}) AND b.status = 'published' AND deleted_at IS NULL
            """,
            unique,
        )
        for r in rows:
            saving = ""
            if r["mrp"] and r["mrp"] > r["price"]:
                diff = r["mrp"] - r["price"]
                pct = round(diff / r["mrp"] * 100)
                saving = f" | you save {_money(diff)} ({pct}%)"

            stock = "in stock" if r["in_stock"] else "OUT OF STOCK — do not recommend"
            if r["in_stock"] and r["stock_qty"] is not None:
                stock += f" ({r['stock_qty']} available)"

            lines.append(
                f"- {r['title']} [{r['slug']}]\n"
                f"  price {_money(r['price'])} | MRP {_money(r['mrp'])}{saving} | {stock}\n"
                f"  Class {r['class_id']} · {str(r['medium']).replace('-', ' ')} · "
                f"{r['subject']} · {r['edition'] or 'current edition'} · {r['pages']} pages"
                + (
                    f" | free sample: {r['free_pages']} pages"
                    if r["free_pages"]
                    else " | no free sample yet"
                )
            )

    lines.append(
        f"- Shipping: free above {_money(settings.free_shipping_threshold)}, "
        f"otherwise flat {_money(settings.shipping_flat_rate)}."
    )
    lines.append("- Returns: 7 days, unused books in original condition.")
    lines.append(f"- Phone {settings.company_phone} | {settings.company_email}")
    return "\n".join(lines)


# Any ₹ amount, or "Rs. 250", or a bare "250 rupees".
_MONEY = re.compile(r"₹\s*([\d,]+)|(?:\brs\.?\s*([\d,]+))|(\b[\d,]+)\s*rupees?\b", re.IGNORECASE)


def numbers_in(text: str) -> set[str]:
    found: set[str] = set()
    for match in _MONEY.finditer(text or ""):
        for group in match.groups():
            if group:
                found.add(group.replace(",", ""))
    return found


def price_hallucination(answer: str, facts: str) -> str | None:
    """Return the first money figure the model invented, or None.

    Cheap, and it catches the single most expensive failure mode this bot has.
    Deliberately one-directional: a figure in FACTS that the model omits is
    fine; a figure in the answer that is not in FACTS is not.
    """
    allowed = numbers_in(facts)
    for value in numbers_in(answer):
        if value not in allowed:
            return value
    return None


def recommend(
    *,
    class_id: str | None = None,
    medium: str | None = None,
    subject: str | None = None,
    series: str | None = None,
    stream: str | None = None,
    term: str | None = None,
    limit: int = 4,
) -> list[dict]:
    """Weighted product search, in SQL.

    Kept as an explicit scorer rather than an embedding similarity because of
    one rule that embeddings cannot express: **a wrong class is disqualifying.**
    An embedding model will happily return a Class 9 guide for a Class 10 query,
    because the text is 95% identical — and a parent who buys the wrong class's
    book is a refund, a bad review, and exactly the support cost this business
    already has too much of.
    """
    clauses = ["b.status = 'published' AND deleted_at IS NULL"]
    params: list = []

    if class_id:
        clauses.append("b.class_id = ?")
        params.append(class_id)

    # A known subject is disqualifying too, not merely a +3 nudge.
    #
    # As a score it did nothing useful: when no subject was extracted every book
    # scored the same and `ORDER BY … price ASC` picked the cheapest title in the
    # catalogue, which is how a trigonometry question came back with a Science
    # guide. And when a subject WAS known, +3 was still beatable by an unrelated
    # best-seller. `_retry_without_subject` below keeps this from ever returning
    # an empty list.
    if subject:
        clauses.append("b.subject = ?")
        params.append(subject)

    score_parts = [
        "(CASE WHEN ? IS NOT NULL AND b.medium  = ? THEN 3 ELSE 0 END)",
        "(CASE WHEN ? IS NOT NULL AND b.subject = ? THEN 3 ELSE 0 END)",
        "(CASE WHEN ? IS NOT NULL AND b.series  = ? THEN 2 ELSE 0 END)",
        "(CASE WHEN ? IS NOT NULL AND b.stream  = ? THEN 2 ELSE 0 END)",
        # Never lead with something we cannot ship.
        "(CASE WHEN b.in_stock = 1 THEN 0.5 ELSE -5 END)",
        "(CASE WHEN b.best_seller_rank IS NOT NULL THEN 1 ELSE 0 END)",
    ]
    score_params = [medium, medium, subject, subject, series, series, stream, stream]

    if term:
        like = f"%{term.lower()}%"
        score_parts.append("(CASE WHEN LOWER(b.title) LIKE ? THEN 2 ELSE 0 END)")
        score_params.append(like)

    sql = f"""
        SELECT b.slug, b.title, b.title_mr, b.price, b.mrp, b.class_id, b.medium,
               b.subject, b.in_stock,
               (SELECT src FROM book_images i WHERE i.book_id = b.id
                 ORDER BY i.position LIMIT 1) AS cover,
               (SELECT COUNT(*) FROM book_pages p
                  JOIN book_assets a ON a.id = p.asset_id
                 WHERE a.book_id = b.id AND a.is_current = 1 AND p.is_free = 1
               ) AS free_pages,
               ({" + ".join(score_parts)}) AS score
          FROM books b
         WHERE {" AND ".join(clauses)}
         ORDER BY score DESC, b.best_seller_rank IS NULL, b.price ASC
         LIMIT ?
    """
    rows = query(sql, [*score_params, *params, int(limit)])

    # Never answer "we have nothing" because a filter was too tight. If the
    # subject narrowed it to zero — a subject we do not publish for that class,
    # or an inference that was simply wrong — fall back to the same query
    # without it, where subject is still worth +3.
    if not rows and subject:
        return recommend(
            class_id=class_id,
            medium=medium,
            subject=None,
            series=series,
            stream=stream,
            term=term,
            limit=limit,
        )

    return [
        {
            "slug": r["slug"],
            "title": r["title"],
            "titleMr": r["title_mr"],
            "subtitle": f"{r['subject']} · Class {r['class_id']} · "
            f"{str(r['medium']).replace('-', ' ').title()}",
            "format": "book",
            "href": f"/shop/{r['slug']}",
            "image": r["cover"],
            "price": r["price"],
            "mrp": r["mrp"],
            # Carried so the widget adds the RIGHT variant to the cart instead
            # of guessing class 10 / marathi as it used to.
            "classId": r["class_id"],
            "medium": r["medium"],
            "freePageCount": r["free_pages"] or None,
            "previewHref": f"/shop/{r['slug']}/preview" if r["free_pages"] else None,
        }
        for r in rows
        if r["score"] > -1
    ]


def book_for_topic(topic: str, class_id: str | None = None) -> dict | None:
    """The single best book to point a teaching question at.

    Matches against the admin-authored chapter list, the subject and the title —
    never book content — so the pivot is grounded in what a human said the book
    covers rather than in anything scraped out of the PDF.
    """
    like = f"%{(topic or '').strip().lower()}%"
    if len(like) <= 4:  # "%%" plus a stray character matches everything
        return None

    clauses = ["b.status = 'published' AND deleted_at IS NULL", "b.in_stock = 1"]
    params: list = []
    if class_id:
        clauses.append("b.class_id = ?")
        params.append(class_id)

    row = query_one(
        f"""
        SELECT b.slug, b.title, b.title_mr, b.price, b.mrp, b.class_id, b.medium,
               b.subject,
               (SELECT src FROM book_images i WHERE i.book_id = b.id
                 ORDER BY i.position LIMIT 1) AS cover,
               (SELECT COUNT(*) FROM book_pages p
                  JOIN book_assets a ON a.id = p.asset_id
                 WHERE a.book_id = b.id AND a.is_current = 1 AND p.is_free = 1
               ) AS free_pages
          FROM books b
         WHERE {" AND ".join(clauses)}
           AND (LOWER(b.chapter_list) LIKE ?
                OR LOWER(b.subject) LIKE ?
                OR LOWER(b.title) LIKE ?)
         ORDER BY b.best_seller_rank IS NULL, b.best_seller_rank, b.price ASC
         LIMIT 1
        """,
        [*params, like, like, like],
    )
    if row is None:
        return None

    return {
        "slug": row["slug"],
        "title": row["title"],
        "titleMr": row["title_mr"],
        "subtitle": f"{row['subject']} · Class {row['class_id']} · "
        f"{str(row['medium']).replace('-', ' ').title()}",
        "format": "book",
        "href": f"/shop/{row['slug']}",
        "image": row["cover"],
        "price": row["price"],
        "mrp": row["mrp"],
        "classId": row["class_id"],
        "medium": row["medium"],
        "freePageCount": row["free_pages"] or None,
        "previewHref": f"/shop/{row['slug']}/preview" if row["free_pages"] else None,
    }
