"""Bulk CSV import.

    python -m tests.test_bulk
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_bulk_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import bulk  # noqa: E402

failures: list[str] = []

HEAD = "slug,title,series,class_id,medium,subject,price"


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== dry run is the default and writes nothing ===")
    csv_text = f"{HEAD}\nbulk-a,Book A,kohinoor,10,english,Science,200\n"
    result = bulk.apply(csv_text)
    check("reports what it would do", result["created"] == 1, str(result))
    check("but did not apply", result["applied"] is False)
    check("and nothing was written",
          query_one("SELECT id FROM books WHERE slug='bulk-a'") is None,
          "a dry run that writes is not a dry run")

    print("\n=== applying works ===")
    result = bulk.apply(csv_text, dry_run=False, actor_id="admin1")
    check("applied", result["applied"] is True)
    row = query_one("SELECT title, price, status FROM books WHERE slug='bulk-a'")
    check("the book exists", row is not None)
    check("values landed", row["title"] == "Book A" and row["price"] == 200, str(dict(row)))
    check("new books default to draft, not published",
          row["status"] == "draft",
          "a bulk import must not publish 300 unreviewed books to the shop")

    print("\n=== update touches ONLY the columns present ===")
    bulk.apply("slug,price\nbulk-a,275\n", dry_run=False)
    row = query_one("SELECT title, price FROM books WHERE slug='bulk-a'")
    check("the price changed", row["price"] == 275, str(dict(row)))
    check("the title was NOT blanked", row["title"] == "Book A",
          "a price-only spreadsheet must not wipe every description")

    print("\n=== a bad row blocks the WHOLE batch ===")
    bad = (
        f"{HEAD}\n"
        "bulk-b,Book B,kohinoor,10,english,Science,300\n"
        "bulk-c,Book C,kohinoor,10,english,Science,not-a-number\n"
    )
    result = bulk.apply(bad, dry_run=False)
    check("errors reported", len(result["errors"]) == 1, str(result["errors"]))
    check("the error names row AND column",
          "Row 3" in result["errors"][0] and "price" in result["errors"][0],
          result["errors"][0])
    check("nothing was applied", result["applied"] is False)
    check("not even the GOOD row",
          query_one("SELECT id FROM books WHERE slug='bulk-b'") is None,
          "a partial import leaves the operator unable to tell what landed")

    print("\n=== validation ===")
    cases = [
        (f"{HEAD}\nBulk-D,Book D,kohinoor,10,english,Science,100\n",
         "slug", "an upper-case slug is refused"),
        (f"{HEAD}\nbulk e,Book E,kohinoor,10,english,Science,100\n",
         "slug", "a slug with a space is refused"),
        (f"{HEAD}\nbulk-f,Book F,kohinoor,10,english,Science,-5\n",
         "negative", "a negative price is refused"),
        ("slug,title,price\nbulk-g,Book G,100\n",
         "missing", "a new book missing required columns is refused"),
        ("title,price\nBook H,100\n",
         "slug", "a file with no slug column is refused"),
        (f"{HEAD},nonsense\nbulk-i,Book I,kohinoor,10,english,Science,100,x\n",
         "Unknown column", "an unknown column is named, not ignored"),
        (f"{HEAD}\nbulk-j,Book J,kohinoor,10,english,Science,100\n"
         "bulk-j,Book J again,kohinoor,10,english,Science,200\n",
         "more than once", "a duplicate slug in one file is refused"),
    ]
    for text, needle, label in cases:
        result = bulk.apply(text, dry_run=False)
        found = any(needle.lower() in e.lower() for e in result["errors"])
        check(label, found and not result["applied"], str(result["errors"])[:140])

    print("\n=== status must be one of the real ones ===")
    result = bulk.apply(
        f"{HEAD},status\nbulk-k,Book K,kohinoor,10,english,Science,100,live\n",
        dry_run=False,
    )
    check("an invented status is refused",
          any("status" in e for e in result["errors"]), str(result["errors"]))

    print("\n=== booleans accept what people actually type ===")
    bulk.apply(f"{HEAD},in_stock\nbulk-l,Book L,kohinoor,10,english,Science,100,yes\n",
               dry_run=False)
    check("yes becomes 1",
          query_one("SELECT in_stock FROM books WHERE slug='bulk-l'")["in_stock"] == 1)
    result = bulk.apply("slug,in_stock\nbulk-l,maybe\n", dry_run=False)
    check("an ambiguous boolean is refused",
          any("yes/no" in e for e in result["errors"]), str(result["errors"]))

    print("\n=== the template is usable as-is ===")
    template = bulk.template()
    check("it carries a BOM for Excel", template.startswith("﻿"))
    check("headers match the accepted columns",
          all(c in template for c in ("slug", "title", "price", "class_id")))
    # The example row must actually import, or the template teaches a broken shape.
    body = template.lstrip("﻿").split("\n")
    sample = "\n".join([body[0], body[1]])
    result = bulk.apply(sample, dry_run=True)
    check("the example row validates cleanly", result["errors"] == [], str(result["errors"]))

    print("\n=== a BOM'd file from Excel parses ===")
    result = bulk.apply("﻿" + f"{HEAD}\nbulk-m,Book M,kohinoor,10,english,Science,100\n",
                        dry_run=True)
    check("the BOM does not break the header", result["errors"] == [], str(result["errors"]))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Bulk import holds: dry-run first, all-or-nothing, errors point at the row.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
