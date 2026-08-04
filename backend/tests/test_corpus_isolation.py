"""The test the entire "sells but never teaches" guarantee rests on.

Four things are asserted here, in order of how badly they would hurt:

  1. NARROWING A FREE RANGE REMOVES THE TEXT.
     Widen a range to 1-20, index it, narrow it to 1-5, and page 12's text must
     no longer be retrievable. If `VectorStore.delete` were missing or the sync
     were add-only, locked content would stay queryable forever and the whole
     feature would be a lie. This is the one that matters most.

  2. Locked pages never enter the corpus in the first place.
  3. `cc_samples` is physically separate — a query against the marketing or
     policy collection cannot return page text.
  4. `app/rag/corpus.py` is the ONLY module that calls `store.add`.

Run:  python -m tests.test_corpus_isolation
"""

from __future__ import annotations

import pathlib
import re
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import books as books_repo  # noqa: E402
from app.db.repo import pages as pages_repo  # noqa: E402
from app.embeddings.provider import build_embedding_provider  # noqa: E402
from app.rag import corpus  # noqa: E402
from app.services import ranges as ranges_service  # noqa: E402
from app.vector_db.store import MARKETING, POLICY, SAMPLES, InMemoryStore  # noqa: E402

failures: list[str] = []
SLUG = "__corpus_isolation_fixture__"


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f" — {detail}" if not ok and detail else ""))
    if not ok:
        failures.append(label)


# Distinctive text per page so a retrieval hit is unambiguous about its origin.
def page_text(n: int) -> str:
    return (
        f"Chapter content for page {n}. "
        f"The unique marker for this page is zephyrine{n}quokka. "
        f"It discusses topic number {n} in considerable and specific detail, "
        f"with worked examples and exercises that appear nowhere else."
    )


def build_fixture(total_pages: int = 30) -> tuple[str, str]:
    """A book with `total_pages` pages of extracted text, no free range yet."""
    with transaction() as conn:
        conn.execute("DELETE FROM books WHERE slug = ?", (SLUG,))
        book_id = books_repo.upsert_book(
            conn,
            {
                "slug": SLUG,
                "title": "Corpus Isolation Fixture",
                "series": "kohinoor",
                "classId": "10",
                "medium": "english",
                "subject": "Science",
                "price": 100,
                "status": "published",
                "marketingCopy": "A fixture book used only by the isolation test.",
                "chapterList": ["Fixture chapter one", "Fixture chapter two"],
            },
        )

    asset_id = pages_repo.create_asset(
        book_id=book_id,
        sha256="0" * 64,
        original_name="fixture.pdf",
        byte_size=1,
        storage_path="pdf/fixture/fixture.pdf",
        uploaded_by=None,
    )
    pages_repo.upsert_pages(asset_id, [(n, page_text(n)) for n in range(1, total_pages + 1)])
    pages_repo.set_asset_state(asset_id, "ready", page_count=total_pages, pages_done=total_pages)
    return book_id, asset_id


def cleanup(book_id: str) -> None:
    with transaction() as conn:
        conn.execute("DELETE FROM corpus_docs WHERE book_id = ?", (book_id,))
        conn.execute("DELETE FROM books WHERE id = ?", (book_id,))


def finds(store, collection: str, marker: str) -> bool:
    """Is any chunk containing `marker` retrievable from `collection`?

    Checks the returned text rather than the score: hash-embedding fallbacks
    make scores meaningless, but if the text comes back at all, it is in the
    index and reachable.
    """
    for match in store.query(collection, marker, 20):
        if marker in match.text:
            return True
    return False


def main() -> int:
    migrate()
    store = InMemoryStore(build_embedding_provider())
    book_id, asset_id = build_fixture()

    try:
        # ------------------------------------------------------------------
        print("=== 1. only free pages are indexed ===")
        pages_repo.set_free_ranges(book_id, "1-5", changed_by=None, force=True)
        corpus.sync_book_samples(store, book_id)

        check("a free page IS retrievable", finds(store, SAMPLES, "zephyrine3quokka"))
        check("a locked page is NOT retrievable", not finds(store, SAMPLES, "zephyrine12quokka"))
        check(
            "corpus holds exactly the free pages",
            store.count(SAMPLES) == 5,
            f"expected 5, got {store.count(SAMPLES)}",
        )

        # ------------------------------------------------------------------
        print("\n=== 2. widening a range adds the new pages ===")
        pages_repo.set_free_ranges(book_id, "1-20", changed_by=None, force=True)
        delta = corpus.sync_book_samples(store, book_id)

        check("page 12 becomes retrievable after widening", finds(store, SAMPLES, "zephyrine12quokka"))
        check("15 pages added, none removed", delta.added == 15 and delta.deleted == 0, str(delta))
        check("corpus now holds 20 pages", store.count(SAMPLES) == 20, str(store.count(SAMPLES)))

        # ------------------------------------------------------------------
        print("\n=== 3. NARROWING a range REMOVES the text (the critical one) ===")
        pages_repo.set_free_ranges(book_id, "1-5", changed_by=None, force=True)
        delta = corpus.sync_book_samples(store, book_id)

        check(
            "page 12 is gone from the corpus after narrowing",
            not finds(store, SAMPLES, "zephyrine12quokka"),
            "LOCKED CONTENT IS STILL QUERYABLE — the sales guarantee is broken",
        )
        check("15 pages deleted", delta.deleted == 15, str(delta))
        check("corpus back to 5 pages", store.count(SAMPLES) == 5, str(store.count(SAMPLES)))
        check("page 3 still retrievable", finds(store, SAMPLES, "zephyrine3quokka"))

        # ------------------------------------------------------------------
        print("\n=== 4. re-saving an unchanged range is a no-op ===")
        delta = corpus.sync_book_samples(store, book_id)
        check(
            "nothing added or deleted",
            delta.added == 0 and delta.deleted == 0 and delta.unchanged == 5,
            str(delta),
        )

        # ------------------------------------------------------------------
        print("\n=== 5. clearing the spec empties the samples ===")
        pages_repo.set_free_ranges(book_id, "", changed_by=None, force=True)
        corpus.sync_book_samples(store, book_id)
        check("no free pages left", store.count(SAMPLES) == 0, str(store.count(SAMPLES)))
        check("page 3 no longer retrievable", not finds(store, SAMPLES, "zephyrine3quokka"))

        # ------------------------------------------------------------------
        print("\n=== 6. collections are physically separate ===")
        pages_repo.set_free_ranges(book_id, "1-5", changed_by=None, force=True)
        corpus.sync_book_samples(store, book_id)
        corpus.sync_book_marketing(store, book_id)

        check(
            "page text is NOT in cc_marketing",
            not finds(store, MARKETING, "zephyrine3quokka"),
            "book content leaked into the marketing collection",
        )
        check("page text is NOT in cc_policy", not finds(store, POLICY, "zephyrine3quokka"))
        check(
            "marketing copy IS in cc_marketing",
            any("fixture book" in m.text.lower() for m in store.query(MARKETING, "fixture", 10)),
        )

        # ------------------------------------------------------------------
        print("\n=== 7. removing a book clears every collection ===")
        corpus.remove_book(store, book_id)
        check("samples cleared", store.count(SAMPLES) == 0)
        check("marketing cleared", store.count(MARKETING) == 0)

        # ------------------------------------------------------------------
        print("\n=== 8. corpus.py is the only writer to the vector store ===")
        offenders: list[str] = []
        root = pathlib.Path(__file__).resolve().parent.parent / "app"
        # Matches `store.add(`, `self.store.add(`, `_store.add(` etc.
        pattern = re.compile(r"\b(?:\w+\.)?store\.(?:add|delete)\s*\(", re.I)
        for path in root.rglob("*.py"):
            if path.name == "corpus.py" or path.parts[-2:] == ("vector_db", "store.py"):
                continue
            if path.match("vector_db/store.py"):
                continue
            for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if line.strip().startswith("#"):
                    continue
                if pattern.search(line):
                    offenders.append(f"{path.relative_to(root)}:{lineno}: {line.strip()[:70]}")
        check(
            "no module other than corpus.py writes to the store",
            not offenders,
            "; ".join(offenders[:4]),
        )

        # ------------------------------------------------------------------
        print("\n=== 9. range parsing normalises the way the reader expects ===")
        cases = [
            ("1-12, 45, 60-64", 100, [(1, 12), (45, 45), (60, 64)]),
            ("5-8, 1-3", 100, [(1, 3), (5, 8)]),          # sorted
            ("1-5, 6-9", 100, [(1, 9)]),                   # ADJACENT ranges merge
            ("1-5, 3-8", 100, [(1, 8)]),                   # overlapping merge
            ("1 – 4", 100, [(1, 4)]),                      # en dash
            ("1-9999", 30, [(1, 30)]),                     # clamped, not rejected
            ("", 100, []),
        ]
        for spec, count, expected in cases:
            got = ranges_service.parse_spec(spec, count)
            check(f'parse "{spec}" -> {expected}', got == expected, str(got))

        for bad in ["0-5", "abc", "12-3", "500-600"]:
            try:
                ranges_service.parse_spec(bad, 100)
                check(f'"{bad}" is rejected', False, "it was accepted")
            except ranges_service.RangeSpecError:
                check(f'"{bad}" is rejected', True)

        gaps = ranges_service.gaps([(1, 8), (24, 27)], 40)
        check("gaps between free ranges", gaps == [(9, 23), (28, 40)], str(gaps))

        # ------------------------------------------------------------------
        # sync_policy() had a wrong-arity call to extract_title(). main.py wraps
        # it in `except Exception`, so the policy corpus stayed empty at every
        # boot and nothing surfaced it — /health still reported a ready store.
        # Nothing here called sync_policy, which is why the tests were green.
        print("\n=== 10. policy sync actually runs (not just doesn't crash) ===")
        with tempfile.TemporaryDirectory() as tmp:
            knowledge = pathlib.Path(tmp)

            # Reconcile against an EMPTY directory first.
            #
            # `_apply` diffs against the `corpus_docs` table, which lives in the
            # database and survives between runs, while the store here is
            # in-memory and does not. Without this the second run of the suite
            # sees every doc as already indexed, reports `added == 0`, and fails
            # a test that passed the first time.
            original_dir = settings.knowledge_dir
            settings.knowledge_dir = str(knowledge)
            try:
                corpus.sync_policy(store)
            finally:
                settings.knowledge_dir = original_dir

            (knowledge / "shipping.md").write_text(
                "# Shipping and returns\n\nOrders ship in 2 working days. "
                "Returns accepted within 7 days if unused, marker quibbleflax.\n",
                encoding="utf-8",
            )
            (knowledge / "catalog.json").write_text("{}", encoding="utf-8")
            (knowledge / "leaked-book.pdf").write_bytes(b"%PDF-1.4 not prose")

            original_dir = settings.knowledge_dir
            settings.knowledge_dir = str(knowledge)
            try:
                delta = corpus.sync_policy(store)
            finally:
                settings.knowledge_dir = original_dir

            check("policy sync indexed something", delta.added > 0, f"added={delta.added}")
            check("policy text is retrievable", finds(store, POLICY, "quibbleflax"))
            check(
                "the PDF was refused, not indexed",
                not finds(store, POLICY, "not prose"),
                "a PDF dropped into knowledge/ was published to the assistant",
            )
            check(
                "policy copy did NOT land in cc_samples",
                not finds(store, SAMPLES, "quibbleflax"),
            )

    finally:
        cleanup(book_id)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Corpus isolation holds: locked pages cannot reach the assistant.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
