"""Soft delete: a deleted book disappears from the shop but never from history.

    python -m tests.test_soft_delete
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_softdel_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import books as books_repo  # noqa: E402
from app.services import suggest  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def seed() -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with transaction() as conn:
        for slug, title, subject in [
            ("del-a", "Kohinoor Class 10 Science", "Science"),
            ("del-b", "Kohinoor Class 10 Mathematics", "Mathematics"),
        ]:
            conn.execute(
                "INSERT INTO books (id, slug, title, series, board, class_id, medium,"
                " subject, price, status, created_at, updated_at)"
                " VALUES (?,?,?,'kohinoor','state','10','english',?,250,'published',?,?)",
                (slug, slug, title, subject, now, now),
            )
        # An order referencing the book we are about to delete — the whole
        # reason this is a soft delete.
        conn.execute(
            "INSERT INTO orders (id, order_number, status, customer_name, phone,"
            " total, subtotal, created_at, updated_at)"
            " VALUES ('o1','CC-D1','confirmed','Buyer','9000000000',250,250,?,?)",
            (now, now),
        )
        conn.execute(
            "INSERT INTO order_items (order_id, slug, title, qty, unit_price,"
            " line_total) VALUES ('o1','del-a','Kohinoor Class 10 Science',1,250,250)"
        )


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    seed()

    print("=== before deletion the book is visible ===")
    check("the shop lists it",
          any(b["slug"] == "del-a" for b in books_repo.list_books()["items"]))
    check("search suggests it",
          any(b["slug"] == "del-a" for b in suggest.suggest("science")["books"]))

    print("\n=== deleting ===")
    result = books_repo.soft_delete("del-a", actor_id="admin1")
    check("it reports what it deleted", result["slug"] == "del-a", str(result))
    check("and what it was before, so restore can say",
          result["previousStatus"] == "published", str(result))

    print("\n=== the row is STILL THERE ===")
    row = query_one("SELECT * FROM books WHERE slug = 'del-a'")
    check("the book row survives", row is not None,
          "a hard delete would orphan the invoice line")
    check("it is marked deleted", row["deleted_at"] is not None)
    check("with who did it", row["deleted_by"] == "admin1")
    check("and archived as belt-and-braces",
          row["status"] == "archived",
          "any query still gating only on status must also do the right thing")

    print("\n=== the order line still resolves ===")
    line = query_one(
        "SELECT oi.title, b.id FROM order_items oi"
        " LEFT JOIN books b ON b.slug = oi.slug WHERE oi.order_id = 'o1'"
    )
    check("the invoice can still name what was sold",
          line["title"] == "Kohinoor Class 10 Science", str(dict(line)))
    check("and the book still joins", line["id"] == "del-a",
          "an orphaned order line is an auditor's problem")

    print("\n=== but it is gone from every shopper surface ===")
    check("the shop list drops it",
          all(b["slug"] != "del-a" for b in books_repo.list_books()["items"]))
    check("search drops it",
          all(b["slug"] != "del-a" for b in suggest.suggest("science")["books"]))
    check("by-slug lookup drops it",
          books_repo.get_book("del-a") is None,
          "the product page must 404, not render a deleted book")
    # Facets share `_where` with the list query above, so the filter is
    # already proven. Asserting on the facet payload shape here would test the
    # shape, not the deletion — and a check that cannot fail is worse than none.
    check("the count agrees with the list",
          books_repo.list_books()["total"] == 1,
          "one of the two seeded books is deleted, so exactly one remains")

    print("\n=== related strips do not resurrect it ===")
    check("related() on a deleted slug returns nothing",
          books_repo.related("del-a") == [],
          "a deleted book must not be a recommendation source")

    print("\n=== deleting twice is idempotent, not an error ===")
    again = books_repo.soft_delete("del-a", actor_id="admin1")
    check("the second delete is a no-op", again["alreadyDeleted"] is True, str(again))

    print("\n=== the bin lists it, with who and when ===")
    binned = books_repo.deleted()
    check("it is in the bin", any(b["slug"] == "del-a" for b in binned["items"]),
          str(binned))
    check("the bin has a total for paging", binned["total"] == 1, str(binned["total"]))
    entry = next(b for b in binned["items"] if b["slug"] == "del-a")
    check("it says when", bool(entry["deletedAt"]))
    check("and who", entry["deletedBy"] == "admin1", str(entry["deletedBy"]))

    print("\n=== restoring ===")
    restored = books_repo.restore("del-a")
    check("it comes back", restored["alreadyLive"] is False, str(restored))
    check("as a DRAFT, not published",
          restored["status"] == "draft",
          "restoring straight to the shop is how a wrong price goes live twice")
    row = query_one("SELECT deleted_at, deleted_by, status FROM books WHERE slug='del-a'")
    check("the flag is cleared", row["deleted_at"] is None)
    check("and so is the actor", row["deleted_by"] is None)
    check("a restored draft is still not in the shop",
          all(b["slug"] != "del-a" for b in books_repo.list_books()["items"]),
          "draft means draft")

    print("\n=== restore refuses to publish ===")
    try:
        books_repo.restore("del-a", status="published")
        check("restoring to published is refused", False, "it was allowed")
    except ValueError:
        check("restoring to published is refused", True)

    print("\n=== missing books ===")
    for fn, label in [
        (lambda: books_repo.soft_delete("nope", actor_id="a"),
         "deleting a missing book raises"),
        (lambda: books_repo.restore("nope"), "restoring a missing book raises"),
    ]:
        try:
            fn()
            check(label, False, "no error raised")
        except LookupError:
            check(label, True)

    print("\n=== restoring a live book is a no-op ===")
    live = books_repo.restore("del-b")
    check("it reports already live", live["alreadyLive"] is True, str(live))

    print("\n=== route order: /books/deleted must beat /books/{slug} ===")
    import main  # noqa: PLC0415 — imported here so the DB env is set first

    paths = [
        getattr(r, "path", "") for r in main.app.routes
        if getattr(r, "path", "").startswith("/admin-api/books")
        and "GET" in (getattr(r, "methods", None) or set())
    ]
    check("the literal path is declared first",
          paths.index("/admin-api/books/deleted")
          < paths.index("/admin-api/books/{slug}"),
          f"{paths} — declared after, /books/deleted arrives as slug='deleted'")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Soft delete holds: gone from the shop, still in the history.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
