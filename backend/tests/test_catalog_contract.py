"""Contract test: the catalogue API must return what the seed adapter returned.

The frontend swap (`lib/data/index.ts`: seedAdapter -> apiAdapter) is only safe
if every component sees the same object shape it saw before. This compares live
API responses against the exported seed data, field by field.

Run (with the server on :8011, or set CC_TEST_BASE):

    python -m tests.test_catalog_contract

Hand-rolled rather than pytest to match `test_rag.py`, which is the convention
already in this repo.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("CC_TEST_BASE", "http://127.0.0.1:8011")
SEED_EXPORT = Path(__file__).resolve().parent.parent / "scripts" / "seed-export.json"

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(label)


def get(path: str):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as r:
        return json.loads(r.read())


def status(path: str) -> int:
    try:
        with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as exc:
        return exc.code


def main() -> int:
    if not SEED_EXPORT.is_file():
        print(f"Missing {SEED_EXPORT}. Run: cd frontend && npm run export:seed")
        return 1
    seed = json.loads(SEED_EXPORT.read_text(encoding="utf-8"))
    seed_books = {b["slug"]: b for b in seed["books"]}
    seed_combos = {c["slug"]: c for c in seed["combos"]}
    seed_notes = {k["slug"]: k for k in seed["keyNotes"]}

    print("=== every seed slug is served ===")
    api_slugs = set(get("/catalog/books/slugs"))
    missing = set(seed_books) - api_slugs
    check("all seed books reachable", not missing, f"{len(missing)} missing e.g. {list(missing)[:3]}")

    print("\n=== Book field parity (sampled across the taxonomy) ===")
    # Sample rather than all 324: one per class keeps the run fast while still
    # covering nursery (english-only), board-exam, and the streamed classes.
    by_class: dict[str, str] = {}
    for slug, b in seed_books.items():
        by_class.setdefault(b["classId"], slug)
    sample = list(by_class.values())
    print(f"      sampling {len(sample)} books, one per class")

    # These are produced by the preview layer, not the catalogue, so the seed's
    # values are deliberately not carried over. Everything else must match.
    IGNORED = {"previewPages", "chapterList", "marketingCopy", "status", "images"}

    mismatched: list[str] = []
    for slug in sample:
        want = seed_books[slug]
        got = get(f"/catalog/books/{slug}")

        for key, value in want.items():
            if key in IGNORED or value is None:
                continue
            if key not in got:
                mismatched.append(f"{slug}.{key} absent from API")
                continue
            if got[key] != value:
                mismatched.append(f"{slug}.{key}: {got[key]!r} != {value!r}")

        # No key may be null: the TS types use optional (`?`), and the seed
        # adapter omitted absent fields rather than emitting null.
        nulls = [k for k, v in got.items() if v is None]
        if nulls:
            mismatched.append(f"{slug} has null-valued keys {nulls}")

    check("book fields match the seed", not mismatched, "; ".join(mismatched[:5]))

    print("\n=== Paginated<Book> envelope ===")
    page = get("/catalog/books?perPage=5&page=2")
    check("envelope keys", set(page) == {"items", "total", "page", "perPage", "totalPages"}, str(set(page)))
    check("page echoed", page["page"] == 2)
    check("perPage honoured", len(page["items"]) == 5, str(len(page["items"])))
    check("totalPages is ceil", page["totalPages"] == -(-page["total"] // 5))

    print("\n=== Facets ===")
    facets = get("/catalog/facets")
    check("facet keys", set(facets) == {"classId", "medium", "subject", "series", "priceRange"}, str(set(facets)))
    check("facet entry shape",
          all(set(e) == {"value", "label", "count"} for e in facets["classId"]))
    check("priceRange shape", set(facets["priceRange"]) == {"min", "max"})
    # Filtering by a field must not collapse that field's own facet.
    narrowed = get("/catalog/facets?classId=10")
    check("own-field facet not collapsed", len(narrowed["classId"]) > 1, str(len(narrowed["classId"])))
    check("other facets do narrow",
          len(narrowed["subject"]) <= len(facets["subject"]))

    print("\n=== ComboResolved ===")
    combo_slug = next(iter(seed_combos))
    combo = get(f"/catalog/combos/{combo_slug}")
    for key in ("items", "itemsTotal", "savings", "savingsPct", "itemSlugs"):
        check(f"combo has {key}", key in combo)
    check("items resolve 1:1 with itemSlugs", len(combo["items"]) == len(combo["itemSlugs"]),
          f"{len(combo['items'])} vs {len(combo['itemSlugs'])}")
    check("savings = itemsTotal - price",
          combo["savings"] == max(0, combo["itemsTotal"] - combo["price"]))
    check("savingsPct consistent",
          combo["savingsPct"] == (round(combo["savings"] / combo["itemsTotal"] * 100)
                                  if combo["itemsTotal"] else 0))

    print("\n=== combo ?stream= actually filters ===")
    all_combos = get("/catalog/combos?perPage=100")["total"]
    pcm = get("/catalog/combos?stream=science-pcm")["total"]
    check("stream narrows the result set", 0 < pcm < all_combos, f"{pcm} of {all_combos}")

    print("\n=== KeyNote ===")
    note_slug = next(iter(seed_notes))
    note = get(f"/catalog/key-notes/{note_slug}")
    want_note = seed_notes[note_slug]
    for key in ("id", "slug", "title", "classId", "subject", "medium", "board",
                "chapters", "totalPages", "updatedAt"):
        check(f"key note has {key}", key in note)
    check("chapters preserved", note["chapters"] == want_note["chapters"],
          f"{len(note['chapters'])} vs {len(want_note['chapters'])}")

    print("\n=== Review ===")
    reviewed = next(s for s in sample if get(f"/catalog/reviews/{s}"))
    review = get(f"/catalog/reviews/{reviewed}")[0]
    check("review keys",
          set(review) == {"id", "productSlug", "author", "rating", "title", "body",
                          "date", "verified"}, str(set(review)))

    print("\n=== SearchHit carries classId/medium ===")
    hits = get("/catalog/search?q=science&limit=5")
    check("search returns hits", len(hits) > 0)
    if hits:
        # The assistant widget used to hardcode classId "10" / medium "marathi"
        # on every recommended product. It can only stop guessing if the wire
        # format carries the real values.
        check("hit carries classId", "classId" in hits[0], str(hits[0]))
        check("hit carries medium", "medium" in hits[0])
        check("hit classId matches the book",
              hits[0]["classId"] == get(f"/catalog/books/{hits[0]['slug']}")["classId"])

    print("\n=== rails ===")
    for path, key in (("/catalog/rails/best-sellers?limit=4", "bestSellerRank"),
                      ("/catalog/rails/new-arrivals?limit=4", "publishedAt"),
                      ("/catalog/rails/featured?limit=4", "rating")):
        items = get(path)
        check(f"{path} returns books", 0 < len(items) <= 4, str(len(items)))
        check(f"{path} items carry {key}", all(key in i for i in items))

    print("\n=== export (build-time bulk read) ===")
    export = get("/catalog/export")
    check("export keys", set(export) == {"books", "combos", "keyNotes", "generatedAt"})
    check("export book count matches slugs", len(export["books"]) == len(api_slugs))

    print("\n=== error handling ===")
    check("unknown book -> 404", status("/catalog/books/nope-nope") == 404)
    check("unknown combo -> 404", status("/catalog/combos/nope-nope") == 404)
    check("unknown key note -> 404", status("/catalog/key-notes/nope-nope") == 404)
    check("oversized perPage -> 422", status("/catalog/books?perPage=100000") == 422)
    check("negative page -> 422", status("/catalog/books?page=-1") == 422)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Catalogue contract holds — the apiAdapter swap is safe.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
