"""Where uploaded files live on disk.

    <MEDIA_ROOT>/
      pdf/<book_id>/<sha256>.pdf          0600, NEVER inside an nginx root
      preview/<asset_id>/<n>@<dpi>.webp   rendered FREE pages only
      covers/<sha1>.webp
      tmp/                                streaming upload staging

The source PDFs are deliberately not web-servable. The only way to see a page is
through the preview API, which checks the free-page ranges first — a static file
route would bypass that check entirely, which is the whole feature.

Every path here is built from validated integers and hex digests, never from a
client-supplied string, so directory traversal is impossible by construction
rather than by sanitising.
"""

from __future__ import annotations

import logging
import re
import shutil
import time
from pathlib import Path

from app.config import settings

log = logging.getLogger(__name__)

_HEX = re.compile(r"^[0-9a-f]{6,64}$")
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def root() -> Path:
    return Path(settings.media_root).expanduser()


def _ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def tmp_dir() -> Path:
    return _ensure(root() / "tmp")


def pdf_path(book_id: str, sha256: str) -> Path:
    if not _ID.match(book_id) or not _HEX.match(sha256):
        raise ValueError("Refusing to build a media path from unvalidated input")
    return _ensure(root() / "pdf" / book_id) / f"{sha256}.pdf"


def preview_path(asset_id: str, page_no: int, dpi: int) -> Path:
    if not _ID.match(asset_id):
        raise ValueError("Refusing to build a media path from unvalidated input")
    page_no = int(page_no)
    dpi = int(dpi)
    if page_no < 1 or page_no > 5000 or dpi not in (72, 144):
        raise ValueError("Page number or dpi out of range")
    return _ensure(root() / "preview" / asset_id) / f"{page_no}@{dpi}.webp"


def cover_path(sha1: str) -> Path:
    if not _HEX.match(sha1):
        raise ValueError("Refusing to build a media path from unvalidated input")
    return _ensure(root() / "covers") / f"{sha1}.webp"


def relative(path: Path) -> str:
    """Store paths relative to MEDIA_ROOT so the volume can be remounted
    anywhere without rewriting the database."""
    try:
        return str(path.relative_to(root()))
    except ValueError:
        return str(path)


def absolute(rel: str) -> Path:
    """Resolve a stored relative path, refusing anything that escapes the root.

    The stored values are ours, not the client's — but a path check that only
    runs on data you trust is a check that stops running the day the data
    source changes.
    """
    base = root().resolve()
    candidate = (base / rel).resolve()
    # `relative_to`, not `str.startswith`. A prefix test on strings accepts a
    # SIBLING whose name merely begins with the root's — "/data/media-evil"
    # starts with "/data/media" — and it also depends on `resolve()` being
    # idempotent, which it is not for every input on every platform. Path
    # containment answers the question that is actually being asked.
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise ValueError(f"Path escapes the media root: {rel}") from exc
    return candidate


def harden(path: Path) -> None:
    """Owner-only permissions on a stored PDF. No-op on Windows, where the
    POSIX bits are not meaningful — the container is the deployment target."""
    try:
        path.chmod(0o600)
    except (OSError, NotImplementedError):
        pass


def sweep_tmp(max_age_seconds: int = 3600) -> int:
    """Remove abandoned upload staging files.

    An upload that dies mid-stream leaves a .part behind; without this they
    accumulate until the disk fills, which on this box would take the LMS stack
    down with it.
    """
    removed = 0
    now = time.time()
    for path in tmp_dir().iterdir():
        try:
            if path.is_file() and now - path.stat().st_mtime > max_age_seconds:
                path.unlink()
                removed += 1
        except OSError as exc:  # noqa: PERF203
            log.warning("Could not sweep %s: %s", path, exc)
    if removed:
        log.info("Swept %d abandoned upload(s)", removed)
    return removed


def delete_preview_dir(asset_id: str) -> None:
    if not _ID.match(asset_id):
        return
    shutil.rmtree(root() / "preview" / asset_id, ignore_errors=True)


def disk_usage() -> dict:
    def size(sub: str) -> int:
        directory = root() / sub
        if not directory.is_dir():
            return 0
        return sum(f.stat().st_size for f in directory.rglob("*") if f.is_file())

    return {
        "pdfBytes": size("pdf"),
        "previewBytes": size("preview"),
        "coverBytes": size("covers"),
    }


def ebook_path(order_number: str, slug: str) -> Path:
    """Where a buyer's personalised copy lives.

    Keyed by order AND book, because the watermark names the buyer — one
    shared file per title would leak the first purchaser's details to everyone
    who bought it afterwards.

    Both parts are validated: they reach the filesystem, and an order number
    from a URL is exactly the kind of input that walks out of a directory.
    """
    safe_order = "".join(c for c in order_number if c.isalnum() or c == "-")
    safe_slug = "".join(c for c in slug if c.isalnum() or c in "-_")
    if not safe_order or not safe_slug:
        raise ValueError("Refusing to build a media path from unvalidated input")
    return _ensure(root() / "ebooks" / safe_order) / f"{safe_slug}.pdf"
