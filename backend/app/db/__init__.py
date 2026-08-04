"""SQLite persistence layer.

`conn` owns connections and transactions, `migrate` owns schema evolution, and
everything under `repo/` owns one table group each. Nothing outside this package
writes SQL.
"""

from app.db import conn  # noqa: F401  — re-exported for `from app.db import conn`

__all__ = ["conn"]
