"""Document chunking.

Splits on paragraph boundaries first and only falls back to hard slicing when
a single paragraph exceeds the budget. Naive fixed-width slicing cuts mid
sentence, and a chunk that starts halfway through "…free shipping above" is
retrieved for the wrong questions and answers them wrongly.
"""

from __future__ import annotations

import re

from app.config import settings

_HEADING = re.compile(r"^#{1,6}\s+(.*)$", re.MULTILINE)


def _hard_split(text: str, size: int, overlap: int) -> list[str]:
    out: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        out.append(text[start:end].strip())
        if end == len(text):
            break
        start = end - overlap
    return [c for c in out if c]


def chunk_text(
    text: str,
    size: int | None = None,
    overlap: int | None = None,
) -> list[str]:
    size = size or settings.chunk_size
    overlap = overlap or settings.chunk_overlap

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        if len(para) > size:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_hard_split(para, size, overlap))
            continue

        candidate = f"{current}\n\n{para}" if current else para
        if len(candidate) <= size:
            current = candidate
        else:
            chunks.append(current)
            # Carry a tail of the previous chunk so a fact split across the
            # boundary is still retrievable from either side.
            tail = current[-overlap:] if overlap and len(current) > overlap else ""
            current = f"{tail}\n\n{para}".strip() if tail else para

    if current:
        chunks.append(current)

    return [c for c in chunks if c.strip()]


def extract_title(text: str, fallback: str) -> str:
    """First markdown heading, else the filename. Used for source citation."""
    match = _HEADING.search(text)
    return match.group(1).strip() if match else fallback
