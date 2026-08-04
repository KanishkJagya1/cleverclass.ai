"""Rebuild the vector corpus for every published book.

Why this exists: `corpus.sync_book()` normally runs as a side effect of an admin
save, and `sync_policy()` runs at boot. Nothing syncs the *marketing* collection
for books that arrived any other way — and the seed import is exactly that path.
After a fresh import the catalogue is complete in SQL while `cc_marketing` is
empty, so coverage and comparison questions fall back to SQL facts only.

This is the missing bulk entrypoint. It is safe to re-run: doc ids are
content-addressed and `_reconcile` diffs against `corpus_docs`, so a second run
over unchanged books writes nothing.

    python -m scripts.reindex_corpus              # published books, both collections
    python -m scripts.reindex_corpus --policy     # policy files as well
    python -m scripts.reindex_corpus --dry-run
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.db.conn import query  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.rag import corpus  # noqa: E402
from app.embeddings.provider import build_embedding_provider  # noqa: E402
from app.vector_db.store import build_vector_store  # noqa: E402

log = logging.getLogger("reindex")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--policy", action="store_true", help="also re-sync knowledge/ policy copy")
    ap.add_argument("--dry-run", action="store_true", help="list what would be indexed, write nothing")
    args = ap.parse_args()

    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    print(f"database: {settings.db_path}")
    print(f"chroma:   {settings.chroma_path}")

    migrate()

    books = query("SELECT id, slug FROM books WHERE status = 'published' ORDER BY slug")
    print(f"\npublished books: {len(books)}")

    if args.dry_run:
        print("Dry run — nothing was written.")
        return 0

    embeddings = build_embedding_provider()
    store = build_vector_store(embeddings)

    if args.policy:
        print(f"policy: {corpus.sync_policy(store)}")

    added = deleted = failed = 0
    for i, row in enumerate(books, 1):
        try:
            for delta in corpus.sync_book(store, row["id"]):
                added += delta.added
                deleted += delta.deleted
        except Exception:  # noqa: BLE001 — one bad book must not abort the run
            failed += 1
            log.exception("failed: %s", row["slug"])
        if i % 25 == 0 or i == len(books):
            print(f"  {i}/{len(books)}  +{added} -{deleted}" + (f"  ({failed} failed)" if failed else ""))

    print(f"\n{corpus.stats(store)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
