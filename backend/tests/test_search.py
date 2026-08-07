"""Search suggestions and query logging.

    python -m tests.test_search
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_search_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import suggest  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def seed() -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    books = [
        ("s-10-sci-en", "Kohinoor Class 10 Science", "kohinoor", "10", "english",
         "Science", 250, "published"),
        ("s-10-math-en", "Kohinoor Class 10 Mathematics", "kohinoor", "10", "english",
         "Mathematics", 260, "published"),
        ("s-9-math-mr", "Kohinoor Class 9 Mathematics", "kohinoor", "9", "marathi",
         "Mathematics", 240, "published"),
        # Draft: must never surface in a shopper-facing suggestion.
        ("s-11-phy-draft", "Kohinoor Class 11 Physics", "kohinoor", "11", "english",
         "Physics", 300, "draft"),
    ]
    with transaction() as conn:
        for slug, title, series, cls, medium, subject, price, status in books:
            conn.execute(
                "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
                " subject, price, status, created_at, updated_at)"
                " VALUES (?,?,?,?,'state',?,?,?,?,?,?,?)",
                (slug, slug, title, series, cls, medium, subject, price, status,
                 now, now),
            )


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    seed()

    print("=== synonyms are applied BEFORE matching ===")
    cases = [
        ("maths", "mathematics"), ("math", "mathematics"), ("ganit", "mathematics"),
        ("गणित", "mathematics"), ("ssc", "10"), ("10th", "10"), ("hsc", "12"),
        ("sci", "science"), ("विज्ञान", "science"), ("accounts",
                                                     "book keeping & accountancy"),
    ]
    for typed, expected in cases:
        check(f"{typed!r} expands to {expected!r}",
              suggest.expand(typed) == expected, suggest.expand(typed))

    check("expansion is word-by-word, not whole-string",
          suggest.expand("10th maths marathi") == "10 mathematics marathi",
          suggest.expand("10th maths marathi"))
    check("an unknown word is left alone",
          suggest.expand("kohinoor") == "kohinoor")

    print("\n=== suggestions ===")
    result = suggest.suggest("maths")
    titles = [b["title"] for b in result["books"]]
    check("a shorthand query finds the real books", len(titles) == 2, str(titles))
    check("the expansion is reported back to the UI",
          result["expanded"] == "mathematics", str(result.get("expanded")))
    check("facets are offered as destinations", len(result["facets"]) > 0)
    check("a facet links into the shop with filters applied",
          all("/shop?class=" in f["href"] for f in result["facets"]),
          str(result["facets"][:2]))

    print("\n=== a draft book is never suggested ===")
    result = suggest.suggest("physics")
    check("drafts stay out of the shopper's view",
          result["books"] == [],
          "an unpublished book appearing in search is a leak")

    print("\n=== a one-character query shows popular, not everything ===")
    result = suggest.suggest("m")
    check("no book flood below two characters", result["books"] == [])
    check("popular is offered instead", "popular" in result)

    print("\n=== prefix matches rank above substring ===")
    result = suggest.suggest("kohinoor class 9")
    check("the most specific match comes first",
          result["books"] and result["books"][0]["slug"] == "s-9-math-mr",
          str([b["slug"] for b in result["books"]]))

    print("\n=== query logging ===")
    for _ in range(3):
        suggest.record("maths", 2)
    suggest.record("trigonometry workbook", 0)
    suggest.record("trigonometry workbook", 0)
    suggest.record("physics olympiad", 0)
    # Suggestion traffic must not pollute the popular list, or the top query in
    # the shop becomes the letter "m".
    suggest.record("ma", 5, source="suggest")

    top = suggest.popular(10)
    check("the most-searched term ranks first",
          top and top[0]["query"] == "maths" and top[0]["count"] == 3, str(top))
    check("keystroke traffic is excluded from popular",
          all(t["query"] != "ma" for t in top), str(top))

    zero = suggest.zero_results(10)
    zero_queries = [z["query"] for z in zero]
    check("zero-result searches are reported",
          "trigonometry workbook" in zero_queries, str(zero_queries))
    check("they rank by how many people asked",
          zero[0]["query"] == "trigonometry workbook" and zero[0]["count"] == 2,
          str(zero))
    check("a query that DID return results is not listed as zero",
          "maths" not in zero_queries,
          "mixing these up sends the shop chasing demand it already meets")

    stats = suggest.stats()
    check("stats count real searches only",
          stats["searches"] == 6, str(stats))
    check("the zero rate is computed", stats["zeroResults"] == 3, str(stats))
    check("the rate is a percentage", stats["zeroRate"] == 50.0, str(stats))

    print("\n=== logging never breaks search ===")
    check("a one-character query is not logged",
          suggest.record("a", 0) is None)
    os.environ["DB_PATH"] = "/nonexistent/dir/broken.db"
    try:
        suggest.record("something", 0)
        check("a logging failure is swallowed", True)
    except Exception as exc:  # noqa: BLE001
        check("a logging failure is swallowed", False, repr(exc))
    finally:
        os.environ["DB_PATH"] = str(_TMP)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Search holds: synonyms expand, drafts stay hidden, zero-results surface.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
