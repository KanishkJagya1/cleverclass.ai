"""Media paths — the layer that turns user input into filesystem paths.

Every function here builds a path from something that arrived over HTTP: an
asset id, a slug, an order number. That makes path traversal the failure that
matters, and it is why each builder validates rather than trusting its caller.

    python -m tests.test_storage
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_ROOT = pathlib.Path(tempfile.mkdtemp(prefix="cc_storage_"))
os.environ["MEDIA_ROOT"] = str(_ROOT / "media")
os.environ["DB_PATH"] = str(_ROOT / "t.db")

from app.services import storage  # noqa: E402

failures: list[str] = []

# The shapes an attacker actually sends. `%2e%2e` is included because a proxy
# or framework may decode it before this code sees it.
TRAVERSAL = [
    "../../etc/passwd",
    "..\\..\\windows\\system32",
    "/etc/shadow",
    "....//....//etc",
    "a/../../b",
    "%2e%2e%2fetc",
]


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def escapes(path: pathlib.Path) -> bool:
    """True when `path` lands outside MEDIA_ROOT.

    Deliberately does NOT call `.resolve()` again. The builders already return
    a resolved path, and on Windows `resolve()` is not idempotent — it strips
    trailing dots, so a literal directory named `....` collapses on a second
    pass and looks like an escape that does not exist on Linux, which is what
    the containers run. Re-resolving here measured the platform, not the code.
    """
    try:
        pathlib.Path(os.path.normpath(str(path))).relative_to(
            pathlib.Path(os.path.normpath(str(storage.root().resolve())))
        )
        return False
    except ValueError:
        return True


def main_() -> int:
    logging.disable(logging.ERROR)

    print("=== every builder stays inside MEDIA_ROOT ===")
    good = [
        storage.pdf_path("book1", "a" * 64),
        storage.preview_path("asset1", 3, 144),
        storage.cover_path("b" * 40),
        storage.ebook_path("CC-AB12CD", "some-book"),
        storage.tmp_dir(),
    ]
    for p in good:
        check(f"{p.name or p} is inside the media root", not escapes(p), str(p))

    print("\n=== traversal is refused, not sanitised into something odd ===")
    for evil in TRAVERSAL:
        for name, fn in (
            ("pdf_path", lambda v: storage.pdf_path(v, "a" * 64)),
            ("pdf_path sha", lambda v: storage.pdf_path("book1", v)),
            ("preview_path", lambda v: storage.preview_path(v, 1, 144)),
            ("cover_path", lambda v: storage.cover_path(v)),
            ("ebook_path order", lambda v: storage.ebook_path(v, "book")),
            ("ebook_path slug", lambda v: storage.ebook_path("CC-AB12CD", v)),
        ):
            try:
                out = fn(evil)
                # Not raising is acceptable ONLY if the result is still inside
                # the root — some builders strip rather than reject.
                ok = not escapes(out)
                check(f"{name}({evil!r}) cannot escape", ok, str(out))
            except (ValueError, OSError):
                check(f"{name}({evil!r}) cannot escape", True)

    print("\n=== relative/absolute round-trip ===")
    p = storage.pdf_path("book1", "c" * 64)
    rel = storage.relative(p)
    check("a stored path is relative, so the volume can be remounted",
          not pathlib.Path(rel).is_absolute(), rel)
    check("and it round-trips",
          storage.absolute(rel).resolve() == p.resolve(),
          f"{storage.absolute(rel)} vs {p}")

    print("\n=== absolute() refuses to leave the root ===")
    for evil in TRAVERSAL:
        try:
            out = storage.absolute(evil)
            check(f"absolute({evil!r}) cannot escape", not escapes(out), str(out))
        except (ValueError, OSError):
            check(f"absolute({evil!r}) cannot escape", True)

    print("\n=== tmp sweep removes only what is old ===")
    tmp = storage.tmp_dir()
    fresh = tmp / "fresh.part"
    fresh.write_bytes(b"x")
    removed = storage.sweep_tmp(max_age_seconds=3600)
    check("a fresh file survives", fresh.exists(), f"removed {removed}")

    stale = tmp / "stale.part"
    stale.write_bytes(b"x")
    old = os.stat(stale).st_atime - 7200
    os.utime(stale, (old, old))
    storage.sweep_tmp(max_age_seconds=3600)
    check("a stale one is swept",
          not stale.exists(),
          "abandoned uploads are how a disk fills quietly")
    check("and the fresh one is still there", fresh.exists())

    print("\n=== disk usage reports something usable ===")
    usage = storage.disk_usage()
    check("it returns numbers", isinstance(usage, dict) and len(usage) > 0, str(usage))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Storage holds: no path built from input escapes the media root.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
