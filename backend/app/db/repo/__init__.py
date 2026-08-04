"""Table-group repositories.

Import the modules, not the functions — `books.get_book(...)` reads better at
the call site than a bare `get_book(...)` and keeps the origin obvious.
"""

__all__ = ["books", "catalog"]
