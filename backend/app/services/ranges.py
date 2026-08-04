"""Free-page range parsing.

The admin types page ranges the way a publisher thinks about a print sample:

    1-12, 45, 60-64

Everything downstream — which pages the preview API will serve, which page text
is allowed into the sales corpus — is derived from the normalised output of
`parse_spec`. It is the narrowest and most load-bearing piece of logic in the
whole feature, so it is pure, has no imports beyond the standard library, and is
tested directly.

Normalisation rules, in order:
  * accept , ; and whitespace as separators
  * accept - – — (en/em dash) as the range separator, because a spec pasted out
    of Word will not contain a hyphen
  * clamp to 1..page_count rather than rejecting, so "1-9999" means "all of it"
  * sort, then merge overlapping AND adjacent ranges: 1-5 and 6-9 become 1-9,
    which is what the person meant and what makes the reader's gap detection
    correct
"""

from __future__ import annotations

import re

Range = tuple[int, int]

# A single entry: "12" or "1-12", with any dash and any spacing.
_ENTRY = re.compile(r"^\s*(\d+)\s*(?:[-–—]\s*(\d+)\s*)?$")
_SPLIT = re.compile(r"[,;\n]+")


class RangeSpecError(ValueError):
    """Raised with a message written for the admin, not for a log."""


def parse_spec(spec: str, page_count: int) -> list[Range]:
    """Parse and normalise a spec. Raises RangeSpecError with a usable message.

    An empty spec is valid and means "no free pages" — that is how an admin
    removes a sample without deleting the PDF.
    """
    if page_count <= 0:
        raise RangeSpecError("This book has no pages yet — upload a PDF first.")

    text = (spec or "").strip()
    if not text:
        return []

    out: list[Range] = []
    for chunk in _SPLIT.split(text):
        if not chunk.strip():
            continue
        match = _ENTRY.match(chunk)
        if not match:
            raise RangeSpecError(
                f'"{chunk.strip()}" is not a page or a range. '
                f'Use numbers and ranges, like "1-12, 45, 60-64".'
            )

        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else start

        if start == 0 or end == 0:
            raise RangeSpecError("Pages are numbered from 1, so there is no page 0.")
        if start > end:
            raise RangeSpecError(
                f'"{chunk.strip()}" runs backwards — write it as {end}-{start}.'
            )
        if start > page_count:
            raise RangeSpecError(
                f"This book has {page_count} pages, so page {start} does not exist."
            )

        # Clamp rather than reject: "1-9999" is a reasonable way to say
        # "everything", and erroring on it helps nobody.
        out.append((start, min(end, page_count)))

    return _merge(out)


def _merge(ranges: list[Range]) -> list[Range]:
    """Sort, then merge overlapping and ADJACENT ranges.

    Adjacency matters: if 1-8 and 9-12 stayed separate, the reader would draw a
    locked-gap card between page 8 and page 9 covering nothing at all.
    """
    if not ranges:
        return []
    ordered = sorted(ranges)
    merged: list[Range] = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end + 1:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def format_spec(ranges: list[Range]) -> str:
    """Canonical text form. `parse_spec(format_spec(r)) == r` for normalised r."""
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in ranges)


def expand(ranges: list[Range]) -> set[int]:
    """Every page number covered. Only for page-level work — never for display,
    where the ranges themselves are the useful form."""
    pages: set[int] = set()
    for start, end in ranges:
        pages.update(range(start, end + 1))
    return pages


def total_pages(ranges: list[Range]) -> int:
    return sum(end - start + 1 for start, end in ranges)


def fraction(ranges: list[Range], page_count: int) -> float:
    if page_count <= 0:
        return 0.0
    return total_pages(ranges) / page_count


def describe(ranges: list[Range], page_count: int) -> str:
    """The sentence shown under the range editor."""
    n = total_pages(ranges)
    if n == 0:
        return "No free pages — the preview button will be hidden."
    pct = round(fraction(ranges, page_count) * 100, 1)
    return f"Giving away {n} of {page_count} pages ({pct}%)."


def gaps(ranges: list[Range], page_count: int) -> list[Range]:
    """The locked runs between free ranges.

    This is what the reader renders as "pages 9–23 are in the full book" — the
    single strongest conversion cue in a sample-based model, and the reason the
    reader must never silently skip from page 8 to page 24.
    """
    out: list[Range] = []
    cursor = 1
    for start, end in ranges:
        if start > cursor:
            out.append((cursor, start - 1))
        cursor = end + 1
    if cursor <= page_count:
        out.append((cursor, page_count))
    return out
