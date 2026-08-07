"""Master data: class, series, board, subject, stream.

    python -m tests.test_masters
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_masters_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.conn import query_one, transaction  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.services import masters  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def seed_books() -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    rows = [
        ("m-a", "kohinoor", "state", "10", "Science", ""),
        ("m-b", "kohinoor", "state", "10", "Mathematics", ""),
        ("m-c", "vidyamitra", "cbse", "12", "Physics", "science-pcm"),
    ]
    with transaction() as conn:
        for slug, series, board, cls, subject, stream in rows:
            conn.execute(
                "INSERT INTO books (id, slug, title, series, board, class_id,"
                " medium, subject, stream, price, status, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,'english',?,?,250,'published',?,?)",
                (slug, slug, f"Book {slug}", series, board, cls, subject,
                 stream or None, now, now),
            )


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()
    seed_books()

    print("=== seeding derives masters from the books that already exist ===")
    # migrate() seeds on an empty table, but the books were inserted after, so
    # seed explicitly here — the real deployment has books before the migration.
    created = masters.seed_from_books()
    check("something was created for every kind",
          all(k in created for k in masters.KINDS), str(created))

    grouped = masters.grouped()
    check("series came across",
          {m["code"] for m in grouped["series"]} == {"kohinoor", "vidyamitra"},
          str(grouped["series"]))
    check("classes came across",
          {m["code"] for m in grouped["class"]} == {"10", "12"},
          str([m["code"] for m in grouped["class"]]))
    check("subjects keep their display case",
          "Book" not in str(grouped["subject"]) and
          {m["code"] for m in grouped["subject"]} == {"Science", "Mathematics", "Physics"},
          str([m["code"] for m in grouped["subject"]]))
    check("a blank stream did not become a master",
          {m["code"] for m in grouped["stream"]} == {"science-pcm"},
          str([m["code"] for m in grouped["stream"]]))

    print("\n=== classes sort numerically, not as strings ===")
    labels = [m["code"] for m in grouped["class"]]
    check("10 before 12", labels.index("10") < labels.index("12"), str(labels))
    check("and they are labelled for humans",
          any(m["label"] == "Class 10" for m in grouped["class"]),
          str([m["label"] for m in grouped["class"]]))

    print("\n=== seeding twice does not duplicate ===")
    again = masters.seed_from_books()
    check("the second run creates nothing",
          all(v == 0 for v in again.values()), str(again))

    print("\n=== creating ===")
    made = masters.create("series", code="spark", label="Spark")
    check("it comes back with an id", bool(made["id"]), str(made))
    check("and no usage yet", made["usageCount"] == 0, str(made))

    print("\n=== a duplicate code is refused ===")
    try:
        masters.create("series", code="spark", label="Spark Again")
        check("duplicate refused", False, "it was allowed")
    except masters.MasterError:
        check("duplicate refused", True)
    check("but the same code under a DIFFERENT kind is fine",
          bool(masters.create("subject", code="spark", label="Spark")["id"]),
          "kinds are separate namespaces")

    print("\n=== codes are NORMALISED, not rejected, because they reach URLs ===")
    # Refusing "Kohinoor Books" would teach the admin to guess at a format
    # instead of naming their series. Only unusable input is an error.
    for typed, expected in (
        ("Has Space", "has-space"),
        ("UPPER", "upper"),
        ("trailing-", "trailing"),
        ("double--hyphen", "double-hyphen"),
    ):
        made = masters.create("series", code=typed, label=f"L {typed}")
        check(f"{typed!r} becomes {expected!r}", made["code"] == expected,
              made["code"])
        masters.delete(made["id"])

    for bad in ("@@@", "   ", "###-###"):
        try:
            masters.create("series", code=bad, label="x")
            check(f"{bad!r} refused", False, "it was allowed")
        except masters.MasterError:
            check(f"{bad!r} refused", True)

    print("\n=== A MASTER IN USE CANNOT BE DELETED ===")
    kohinoor = next(
        m for m in masters.listing("series", with_usage=True)
        if m["code"] == "kohinoor"
    )
    check("its usage is counted", kohinoor["usageCount"] == 2,
          str(kohinoor["usageCount"]))
    try:
        masters.delete(kohinoor["id"])
        check("delete refused while books reference it", False, "IT WAS DELETED")
    except masters.MasterError as exc:
        check("delete refused while books reference it", True)
        check("and the message says how many and what to do instead",
              "2 books" in str(exc) and "eactivate" in str(exc), str(exc))
    check("the books are untouched",
          query_one("SELECT COUNT(*) n FROM books WHERE series='kohinoor'")["n"] == 2)

    print("\n=== an unused master CAN be deleted ===")
    spark = next(m for m in masters.listing("series") if m["code"] == "spark")
    masters.delete(spark["id"])
    check("it is gone",
          all(m["code"] != "spark" for m in masters.listing("series")))

    print("\n=== renaming a code in use is refused, the label is not ===")
    try:
        masters.update(kohinoor["id"], code="kohinoor-new")
        check("code change refused while in use", False, "it was allowed")
    except masters.MasterError:
        check("code change refused while in use", True)
    renamed = masters.update(kohinoor["id"], label="Kohinoor Publications")
    check("the label changes freely",
          renamed["label"] == "Kohinoor Publications", str(renamed["label"]))
    check("and the code is untouched, so books still resolve",
          renamed["code"] == "kohinoor", str(renamed["code"]))

    print("\n=== deactivating hides without breaking ===")
    off = masters.update(kohinoor["id"], is_active=False)
    check("it reads as inactive", off["isActive"] is False)
    check("it leaves the active pickers",
          all(m["code"] != "kohinoor" for m in masters.grouped(active_only=True)["series"]))
    check("but the admin list still shows it",
          any(m["code"] == "kohinoor" for m in masters.listing("series")))
    check("and its books are still published",
          query_one(
              "SELECT COUNT(*) n FROM books WHERE series='kohinoor'"
              " AND status='published'"
          )["n"] == 2,
          "deactivating a master must never unpublish books")
    masters.update(kohinoor["id"], is_active=True)

    print("\n=== streams are scoped to 11-12 ===")
    stream = masters.create("stream", code="science-pcb", label="Science (PCB)")
    check("it defaults to classes 11 and 12",
          stream["appliesTo"] == ["11", "12"], str(stream["appliesTo"]))
    scoped = masters.create(
        "stream", code="commerce", label="Commerce", applies_to=["12"],
    )
    check("an explicit scope is kept", scoped["appliesTo"] == ["12"],
          str(scoped["appliesTo"]))
    plain = masters.create("board", code="icse", label="ICSE", applies_to=["11"])
    check("appliesTo is ignored for non-streams", plain["appliesTo"] == [],
          "only streams are class-scoped")

    print("\n=== unknown kinds are refused ===")
    try:
        masters.create("colour", code="red", label="Red")
        check("an invented kind is refused", False, "it was allowed")
    except masters.MasterError:
        check("an invented kind is refused", True)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Masters hold: seeded from real data, in-use rows protected.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
