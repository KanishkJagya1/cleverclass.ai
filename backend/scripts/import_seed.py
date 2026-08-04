"""Import the exported seed catalogue into SQLite.

    cd frontend && npm run export:seed
    cd backend  && python -m scripts.import_seed --dry-run
                   python -m scripts.import_seed

Idempotent: everything upserts on slug, so re-running after a re-export updates
in place rather than duplicating. Safe to run against a live database.

One deliberate behaviour: covers are rewritten to point only at files that
actually exist in `frontend/public/covers`. The seed generates front/back/inside
paths for every book, but only ~118 front covers were ever downloaded — so
importing all three kinds verbatim would carry ~800 guaranteed-404 image URLs
into the database. Books left with no image render the generated placeholder.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Allow `python -m scripts.import_seed` and `python scripts/import_seed.py`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.conn import db_path, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import books as books_repo  # noqa: E402
from app.db.repo import catalog as catalog_repo  # noqa: E402

log = logging.getLogger("import_seed")

HERE = Path(__file__).resolve().parent
DEFAULT_EXPORT = HERE / "seed-export.json"
COVERS_DIR = HERE.parent.parent / "frontend" / "public" / "covers"


def existing_covers() -> set[str]:
    if not COVERS_DIR.is_dir():
        log.warning("No covers directory at %s — every book gets a placeholder", COVERS_DIR)
        return set()
    return {p.name for p in COVERS_DIR.iterdir() if p.is_file()}


def filter_images(images: list[dict], available: set[str]) -> list[dict]:
    """Drop image entries whose file is not on disk."""
    if not available:
        return []
    kept = []
    for img in images or []:
        name = Path(str(img.get("src", ""))).name
        if name in available:
            kept.append(img)
    return kept


def load_export(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(
            f"No seed export at {path}\n"
            f"Run:  cd frontend && npm run export:seed"
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in ("books", "combos", "keyNotes", "reviews"):
        if not isinstance(data.get(key), list):
            raise SystemExit(f"Malformed export: '{key}' is missing or not a list")
    return data


def run(export_path: Path, dry_run: bool, publish: bool) -> dict:
    data = load_export(export_path)
    available = existing_covers()

    books = data["books"]
    combos = data["combos"]
    key_notes = data["keyNotes"]
    reviews = data["reviews"]

    # Reviews reference books by slug; drop orphans rather than carrying rows
    # that no product page will ever read.
    book_slugs = {b["slug"] for b in books}
    orphan_reviews = [r for r in reviews if r["productSlug"] not in book_slugs]
    reviews = [r for r in reviews if r["productSlug"] in book_slugs]

    # Combos referencing a missing book would render a set whose contents do not
    # add up to the advertised savings.
    dropped_items = 0
    for combo in combos:
        original = combo.get("itemSlugs") or []
        combo["itemSlugs"] = [s for s in original if s in book_slugs]
        dropped_items += len(original) - len(combo["itemSlugs"])

    with_cover = 0
    for book in books:
        book["images"] = filter_images(book.get("images"), available)
        if book["images"]:
            with_cover += 1
        if publish:
            book["status"] = "published"

    stats = {
        "books": len(books),
        "booksWithCover": with_cover,
        "booksWithoutCover": len(books) - with_cover,
        "combos": len(combos),
        "combosWithStream": sum(1 for c in combos if c.get("stream")),
        "keyNotes": len(key_notes),
        "reviews": len(reviews),
        "orphanReviewsDropped": len(orphan_reviews),
        "comboItemsDropped": dropped_items,
    }

    if dry_run:
        return stats

    # One transaction for the whole import: a half-imported catalogue with
    # combos pointing at books that were not written is worse than no import.
    with transaction() as conn:
        for book in books:
            books_repo.upsert_book(conn, book)
        for combo in combos:
            catalog_repo.upsert_combo(conn, combo)
        for note in key_notes:
            catalog_repo.upsert_key_note(conn, note)
        for review in reviews:
            catalog_repo.upsert_review(conn, review)

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the seed catalogue into SQLite")
    parser.add_argument("--export", type=Path, default=DEFAULT_EXPORT)
    parser.add_argument("--dry-run", action="store_true", help="report, write nothing")
    parser.add_argument(
        "--draft",
        action="store_true",
        help="import as unpublished drafts instead of published",
    )
    args = parser.parse_args()

    logging.basicConfig(level="INFO", format="%(levelname)-8s %(message)s")

    print(f"database: {db_path()}")
    if not args.dry_run:
        migrate()

    stats = run(args.export, args.dry_run, publish=not args.draft)

    label = "would import" if args.dry_run else "imported"
    print(f"\n{label}:")
    print(f"  books      {stats['books']:>5}   "
          f"({stats['booksWithCover']} with a real cover, "
          f"{stats['booksWithoutCover']} using the generated placeholder)")
    print(f"  combos     {stats['combos']:>5}   "
          f"({stats['combosWithStream']} carry a stream, so ?stream= now filters)")
    print(f"  key notes  {stats['keyNotes']:>5}")
    print(f"  reviews    {stats['reviews']:>5}")

    if stats["orphanReviewsDropped"]:
        print(f"\n  dropped {stats['orphanReviewsDropped']} reviews for unknown books")
    if stats["comboItemsDropped"]:
        print(f"  dropped {stats['comboItemsDropped']} combo items for unknown books")

    if args.dry_run:
        print("\nDry run — nothing was written. Re-run without --dry-run to apply.")


if __name__ == "__main__":
    main()
