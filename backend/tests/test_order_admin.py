"""Order notes, bulk transitions and the shared pagination envelope.

    python -m tests.test_order_admin
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_ordadmin_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.api.pagination import attach_children, in_clause, paginate  # noqa: E402
from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import order_admin  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def seed_orders(n: int = 7) -> list[str]:
    now = dt.datetime.now(dt.timezone.utc)
    numbers = []
    with transaction() as conn:
        for i in range(n):
            number = f"CC-T{i:03d}"
            numbers.append(number)
            conn.execute(
                "INSERT INTO orders (id, order_number, status, customer_name, phone,"
                " email, total, subtotal, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    f"ord-{i}", number, "requested", f"Customer {i}",
                    f"90000000{i:02d}", f"c{i}@example.com",
                    100 * (i + 1), 100 * (i + 1),
                    (now - dt.timedelta(days=i)).isoformat(),
                    now.isoformat(),
                ),
            )
            # `id` is an INTEGER autoincrement — let SQLite assign it.
            conn.execute(
                "INSERT INTO order_items (order_id, slug, title, qty, unit_price,"
                " line_total) VALUES (?,?,?,?,?,?)",
                (f"ord-{i}", f"book-{i}", f"Book {i}", 1,
                 100 * (i + 1), 100 * (i + 1)),
            )
    return numbers


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    numbers = seed_orders()

    print("=== the pagination envelope ===")
    result = paginate([1, 2, 3], total=51, page=1, per_page=50)
    check("total is the count BEFORE slicing", result["total"] == 51, str(result))
    check("51 rows at 50/page is 2 pages, not 1",
          result["totalPages"] == 2,
          "a floor here strands the last rows past the end")
    empty = paginate([], total=0, page=1, per_page=50)
    check("an empty list reports 0 pages", empty["totalPages"] == 0, str(empty))

    print("\n=== in_clause is parameterised ===")
    marks, vals = in_clause(["a", "b", "c"])
    check("placeholders match the values", marks == "?,?,?" and vals == ["a", "b", "c"],
          f"{marks} {vals}")

    print("\n=== attach_children replaces the N+1 ===")
    calls: list[list] = []

    def fake_child_fn(ids):
        calls.append(list(ids))
        return [{"order_id": ids[0], "slug": "x"}]

    rows = [{"id": "ord-0"}, {"id": "ord-1"}, {"id": "ord-2"}]
    attach_children(rows, fake_child_fn, child_parent_key="order_id", field="items")
    check("one query for the whole page, not one per row",
          len(calls) == 1, f"{len(calls)} calls")
    check("the matching parent gets its child",
          rows[0]["items"] == [{"order_id": "ord-0", "slug": "x"}], str(rows[0]))
    check("a parent with no children gets an empty list, not a missing key",
          rows[1]["items"] == [],
          "a missing key makes the UI crash on .map")

    print("\n=== internal notes ===")
    note = order_admin.add_note(
        numbers[0], "Customer asked us to call after 6pm",
        author_id="admin1", author_name="Asha", pinned=True,
    )
    check("the note comes back public-shaped",
          note["pinned"] is True and note["author"] == "Asha", str(note))

    order_admin.add_note(numbers[0], "Second note", author_id="admin1")
    listed = order_admin.notes(numbers[0])
    check("both notes are listed", len(listed) == 2, str(len(listed)))
    check("pinned leads the list", listed[0]["pinned"] is True,
          "an unpinned note above a pinned one defeats the point of pinning")

    print("\n=== notes never touch the customer's own note ===")
    row = query_one("SELECT notes FROM orders WHERE order_number = ?", (numbers[0],))
    check("orders.notes is untouched by a staff note",
          (row["notes"] or "") == "",
          "staff remarks must not overwrite what the customer typed")

    print("\n=== note validation ===")
    for bad, label in [("", "an empty note is refused"),
                       ("   ", "a whitespace-only note is refused")]:
        try:
            order_admin.add_note(numbers[0], bad, author_id="a")
            check(label, False, "it was accepted")
        except order_admin.OrderAdminError:
            check(label, True)
    try:
        order_admin.add_note("CC-NOPE", "hi", author_id="a")
        check("a note on a missing order is refused", False)
    except order_admin.OrderAdminError:
        check("a note on a missing order is refused", True)

    print("\n=== deleting a note ===")
    check("delete reports success", order_admin.delete_note(note["id"]) is True)
    check("deleting a gone note reports failure",
          order_admin.delete_note(note["id"]) is False)
    check("the other note survives", len(order_admin.notes(numbers[0])) == 1)

    print("\n=== bulk transition moves what it can ===")
    result = order_admin.bulk_transition(
        [numbers[0], numbers[1], numbers[2]], "confirmed", actor="admin1",
    )
    check("all three moved", result["movedCount"] == 3, str(result))
    check("nothing failed", result["failedCount"] == 0, str(result["failed"]))
    check("the order really is confirmed",
          query_one("SELECT status FROM orders WHERE order_number = ?",
                    (numbers[0],))["status"] == "confirmed")

    print("\n=== a bad order in the batch does NOT stop the good ones ===")
    result = order_admin.bulk_transition(
        [numbers[3], "CC-MISSING", numbers[4]], "confirmed", actor="admin1",
    )
    check("the two real orders moved", result["movedCount"] == 2, str(result))
    check("the missing one is reported", result["failedCount"] == 1, str(result))
    check("and it is named, not just counted",
          result["failed"][0]["orderNumber"] == "CC-MISSING",
          str(result["failed"]))
    check("with a reason", bool(result["failed"][0]["reason"]),
          "'1 failed' with no reason is not actionable")

    print("\n=== bulk guards ===")
    try:
        order_admin.bulk_transition([], "confirmed")
        check("an empty selection is refused", False)
    except order_admin.OrderAdminError:
        check("an empty selection is refused", True)
    try:
        order_admin.bulk_transition([numbers[0]], "teleported")
        check("an invented status is refused", False)
    except order_admin.OrderAdminError:
        check("an invented status is refused", True)
    try:
        order_admin.bulk_transition([f"CC-{i}" for i in range(101)], "confirmed")
        check("an oversized batch is refused", False)
    except order_admin.OrderAdminError:
        check("an oversized batch is refused", True)

    print("\n=== a duplicated selection applies once ===")
    result = order_admin.bulk_transition(
        [numbers[5], numbers[5], numbers[5]], "confirmed", actor="admin1",
    )
    check("the duplicate is collapsed", result["requested"] == 1, str(result))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Order admin holds: notes are separate, bulk reports per order.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
