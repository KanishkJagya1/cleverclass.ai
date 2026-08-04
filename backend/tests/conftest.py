"""Pytest configuration for the backend suites.

WHY THE SUITES ARE NOT COLLECTED DIRECTLY

Each suite in this directory is a standalone script with its own `main()`. They
are excluded from normal collection and executed as SUBPROCESSES by
`test_suites.py` instead. That is not laziness — it is the only way to keep them
honest:

  * **Module state is shared within a process.** The rate limiters in
    `auth_routes` are module-level singletons. Collected together, the auth
    suite's own logins would eat the rate-limit suite's budget and the two would
    fail each other depending on collection order.
  * **`app.config.Settings` is `@lru_cache`d at import.** A suite that needs a
    different `DB_PATH` or a missing `SMTP_HOST` has to set it *before* the app
    is imported. One process cannot satisfy two different configurations.
  * **The DB path is process-wide.** Two suites sharing a database is exactly
    how the corpus and auth suites produced false failures: a passing run
    depended on what a previous run happened to leave behind.

A subprocess per suite costs a second or two and removes that entire class of
bug. Run everything with `pytest` from `backend/`.
"""

from __future__ import annotations

import pathlib

HERE = pathlib.Path(__file__).parent

# Everything except the runner. These are executed as subprocesses, not
# collected — see the module docstring.
collect_ignore_glob = ["test_auth.py", "test_rate_limits.py", "test_corpus_isolation.py",
                       "test_sales_guard.py", "test_catalog_contract.py",
                       "test_permissions.py", "test_inventory.py",
                       "test_order_flow.py", "test_payments.py",
                       "test_invoices.py", "test_reviews.py",
                       "test_razorpay.py", "test_coupons.py",
                       "test_exports.py", "test_shipping.py",
                       "test_support.py", "test_templates.py",
                       "test_phase2_remainder.py", "test_jobs.py"]

__all__ = ["HERE", "collect_ignore_glob"]
