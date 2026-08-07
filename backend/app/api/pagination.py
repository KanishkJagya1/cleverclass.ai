"""One pagination shape for every list endpoint.

Before this, most admin lists took a bare `limit` and returned a plain array.
That looks like pagination and is not: a shop with 600 orders could see the
newest 500 and had no way to reach the rest, and nothing in the response told
the operator that rows had been cut off. Silent truncation is worse than an
error, because the screen looks complete.

Every list now returns the same envelope:

    {"items": [...], "total": 613, "page": 1, "perPage": 50, "totalPages": 13}

`total` is the count BEFORE the page slice, so the UI can say "613 orders" and
render controls that reach the last one. Matching the shape `/books` and
`/customers` already used means one component paginates every table.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

from fastapi import Query

# A hard ceiling on rows per request. High enough for an export-shaped read,
# low enough that one call cannot pull the whole table into memory.
MAX_PER_PAGE = 200
DEFAULT_PER_PAGE = 50


def page_params(
    page: int = Query(default=1, ge=1, description="1-based page number"),
    perPage: int = Query(  # noqa: N803 — camelCase to match the JSON the UI sends
        default=DEFAULT_PER_PAGE, ge=1, le=MAX_PER_PAGE,
        description=f"Rows per page (max {MAX_PER_PAGE})",
    ),
) -> tuple[int, int, int]:
    """FastAPI dependency returning `(page, per_page, offset)`.

    Declared once so every endpoint validates identically — a `perPage=100000`
    that one route rejects and another honours is how a list endpoint becomes
    an accidental denial of service.
    """
    return page, perPage, (page - 1) * perPage


def paginate(items: Sequence[Any], total: int, page: int, per_page: int) -> dict:
    """Wrap an already-sliced page of rows in the standard envelope."""
    return {
        "items": list(items),
        "total": total,
        "page": page,
        "perPage": per_page,
        # ceil, so 51 rows at 50/page is 2 pages rather than 1 with a row
        # stranded past the end.
        "totalPages": max(1, math.ceil(total / per_page)) if total else 0,
    }


def paginated_query(
    query_fn,
    query_one_fn,
    *,
    select: str,
    from_where: str,
    order_by: str,
    params: Sequence[Any] = (),
    page: int = 1,
    per_page: int = DEFAULT_PER_PAGE,
) -> dict:
    """Run the count and the page against the SAME `from_where` clause.

    Taking one clause rather than two strings is deliberate: a count computed
    over different filters than the rows is the classic pagination bug, and it
    shows up as a total that disagrees with what the operator can actually
    reach.
    """
    total = query_one_fn(f"SELECT COUNT(*) AS n FROM {from_where}", list(params))["n"]
    rows = query_fn(
        f"SELECT {select} FROM {from_where} ORDER BY {order_by} LIMIT ? OFFSET ?",
        [*params, per_page, (page - 1) * per_page],
    )
    return paginate([dict(r) for r in rows], total, page, per_page)


def attach_children(
    rows: list[dict],
    child_fn,
    *,
    parent_key: str = "id",
    child_parent_key: str,
    field: str,
) -> list[dict]:
    """Attach child rows to parents with ONE query instead of one per parent.

    `child_fn` is called once with the full list of parent ids. The loop it
    replaces issued a query per row, so a 100-order page cost 101 round trips
    and got slower exactly as the shop grew.
    """
    if not rows:
        return rows
    ids = [r[parent_key] for r in rows]
    grouped: dict[Any, list[dict]] = {i: [] for i in ids}
    for child in child_fn(ids):
        child = dict(child)
        grouped.setdefault(child[child_parent_key], []).append(child)
    for row in rows:
        row[field] = grouped.get(row[parent_key], [])
    return rows


def in_clause(values: Iterable[Any]) -> tuple[str, list[Any]]:
    """`(placeholders, params)` for a SQL `IN (...)`, parameterised.

    Never interpolate ids into SQL by hand — that is the shape SQL injection
    arrives in, even when the values "are just integers from our own table".
    """
    vals = list(values)
    return ",".join("?" * len(vals)), vals
