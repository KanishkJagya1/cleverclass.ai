"""PDF inspection, per-page text extraction and page rendering.

Uses PyMuPDF (fitz). pypdf cannot render a page to an image at all, and fitz's
text extraction is markedly better on Devanagari, which most of this catalogue
is set in.

⚠ LICENCE: PyMuPDF is AGPL-3.0 (or commercial). This service is network-served,
which triggers §13 — the source has to be offered to users of the service. The
LMS stack on the same box already carries the same exposure. If that becomes a
problem, poppler-utils (`pdftoppm` / `pdftotext`, GPL-2, invoked as a
subprocess, no linking) is the drop-in escape hatch and only this module changes.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from app.config import settings

log = logging.getLogger(__name__)

# %PDF- — the only thing that actually identifies a PDF. Filenames and
# Content-Type headers are supplied by the client and mean nothing.
PDF_MAGIC = b"%PDF-"


class PdfError(Exception):
    """A problem with the file itself, phrased for the admin who uploaded it."""


@dataclass
class PdfInfo:
    page_count: int
    encrypted: bool
    title: str = ""
    producer: str = ""
    outline: list[dict] = field(default_factory=list)


def _open(path: Path):
    import fitz

    try:
        doc = fitz.open(str(path))
    except Exception as exc:  # noqa: BLE001
        raise PdfError("That file could not be opened as a PDF.") from exc

    if doc.is_encrypted:
        # An empty password unlocks most "protected" PDFs; a real one we cannot
        # process, and saying so is better than failing three steps later.
        if not doc.authenticate(""):
            doc.close()
            raise PdfError(
                "That PDF is password-protected. Remove the password and upload it again."
            )
    return doc


def inspect(path: Path) -> PdfInfo:
    doc = _open(path)
    try:
        meta = doc.metadata or {}
        outline: list[dict] = []
        try:
            # [level, title, page] — used by the "first chapter" preset in the
            # range editor, so an admin does not have to find the page number.
            for level, title, page in doc.get_toc(simple=True):
                if level <= 2 and page > 0:
                    outline.append({"level": level, "title": title.strip()[:200], "page": page})
        except Exception:  # noqa: BLE001 — a missing or broken TOC is not an error
            outline = []

        return PdfInfo(
            page_count=doc.page_count,
            encrypted=False,
            title=(meta.get("title") or "").strip()[:300],
            producer=(meta.get("producer") or "").strip()[:200],
            outline=outline[:200],
        )
    finally:
        doc.close()


def extract_pages(path: Path) -> Iterator[tuple[int, str]]:
    """Yield (page_no, text) for EVERY page, 1-indexed.

    Every page is extracted, free or locked. Storing only the free pages would
    mean re-parsing the whole PDF each time an admin edits the range — and the
    ranges get edited far more often than the PDF gets replaced. What keeps
    locked text out of the corpus is `book_pages.is_free`, not this function.
    """
    doc = _open(path)
    try:
        for index in range(doc.page_count):
            try:
                text = doc.load_page(index).get_text("text") or ""
            except Exception as exc:  # noqa: BLE001
                # One unreadable page must not abort a 400-page book.
                log.warning("Page %d of %s failed to extract: %s", index + 1, path.name, exc)
                text = ""
            yield index + 1, text.strip()
    finally:
        doc.close()


def render_page(path: Path, page_no: int, dpi: int = 144, watermark: str | None = None) -> bytes:
    """Render one page to WebP.

    144 dpi is 2× the 72 dpi PDF unit: an A5 study guide lands at roughly
    1240×1750, which is sharp on a retina phone. The reader renders into a
    box capped at 60vh, so anything above this is bytes nobody sees.
    """
    import fitz

    doc = _open(path)
    try:
        if page_no < 1 or page_no > doc.page_count:
            raise PdfError(f"Page {page_no} does not exist in this PDF.")

        page = doc.load_page(page_no - 1)

        if watermark:
            _stamp(page, watermark)

        pixmap = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), alpha=False)

        # PyMuPDF CANNOT WRITE WEBP.
        #
        # `pixmap.tobytes("webp")` raises
        #   ValueError: Image format webp not in ('png', … 'jpg', 'jpeg')
        # so every page request was a 500 — the whole preview feature was dead
        # the moment a real PDF existed. It went unnoticed because with no asset
        # uploaded the route returns 404 first, and that 404 is what got tested.
        #
        # WebP is still the right output: the URLs end in .webp, the response is
        # served as image/webp, and the ~370 MB storage estimate for the whole
        # catalogue assumes WebP's size. So the pixmap goes through Pillow,
        # which is already a dependency here and has WebP compiled in.
        from io import BytesIO

        from PIL import Image

        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        buffer = BytesIO()
        # `method=4` is Pillow's quality/speed midpoint. The default (0) is
        # noticeably worse per byte, and 6 costs several hundred ms per page on
        # 2 vCPU — paid on the first view of every page.
        image.save(
            buffer, format="WEBP", quality=settings.preview_quality, method=4
        )
        return buffer.getvalue()
    finally:
        doc.close()


def _stamp(page, text: str) -> None:
    """Diagonal watermark plus a footer line, drawn before rasterising.

    Baked into the cached image rather than composited per request: compositing
    on every request would be a trivial way to exhaust 2 vCPU, and the mark is
    identical for every viewer anyway.
    """
    import fitz

    rect = page.rect
    try:
        # Low-contrast diagonal repeat across the page.
        for row in range(0, int(rect.height), 190):
            pivot = fitz.Point(28, row + 90)
            # An arbitrary angle needs `morph`; `rotate=` accepts only
            # 0/90/180/270 and raises "bad rotate value" otherwise. That
            # exception was caught and logged, so preview pages rendered with
            # NO watermark at all — the failure looked like a working preview.
            page.insert_text(
                pivot,
                text,
                fontsize=13,
                morph=(pivot, fitz.Matrix(45)),
                color=(0.55, 0.55, 0.62),
                fill_opacity=0.16,
                overlay=True,
            )
        # A readable footer, so a screenshot still says where it came from.
        page.insert_textbox(
            fitz.Rect(0, rect.height - 26, rect.width, rect.height - 6),
            text,
            fontsize=7.5,
            align=fitz.TEXT_ALIGN_CENTER,
            color=(0.42, 0.42, 0.48),
            fill_opacity=0.55,
            overlay=True,
        )
    except Exception as exc:  # noqa: BLE001
        # A page we cannot stamp is still a page worth serving; losing the
        # watermark is better than losing the preview.
        log.warning("Watermarking failed: %s", exc)


def sha256_file(path: Path, chunk: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while block := fh.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def looks_scanned(samples: list[int]) -> bool:
    """True when the first pages carry almost no extractable text.

    A scanned book renders fine as images but contributes nothing to the sales
    corpus, and the admin should be told that up front rather than wondering why
    the assistant has nothing to say about it. OCR is deliberately out of scope.
    """
    if not samples:
        return True
    return (sum(samples) / len(samples)) < 40
