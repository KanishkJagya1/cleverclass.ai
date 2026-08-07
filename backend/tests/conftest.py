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

import os
import pathlib

HERE = pathlib.Path(__file__).parent

# ---------------------------------------------------------------------------
# Test scratch goes somewhere with room, BEFORE anything calls mkdtemp().
#
# Every suite creates a throwaway SQLite database under `tempfile.mkdtemp()`
# and nothing removes it — a suite that fails half way through never reaches
# its own cleanup. 262 of them accumulated on the system drive until it hit
# zero bytes free and pytest died with `OSError: [Errno 28] No space left on
# device` in the middle of an unrelated change.
#
# Set here rather than in pytest.ini because `env =` there needs the pytest-env
# plugin; without it pytest prints "Unknown config option: env" as a warning
# and carries on using the full drive — a config that looks right and does
# nothing.
#
# The subprocess suites inherit this environment, so one assignment covers all
# of them. Silently skipped when the target drive does not exist, so this does
# nothing surprising on another machine or in CI.
_SCRATCH = os.environ.get("CC_TEST_TMP", r"D:\cctmp")
if os.path.isdir(os.path.splitdrive(_SCRATCH)[0] + os.sep):
    os.makedirs(_SCRATCH, exist_ok=True)
    for _var in ("TMP", "TEMP", "TMPDIR"):
        os.environ[_var] = _SCRATCH

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
                       "test_phase2_remainder.py", "test_jobs.py",
                       "test_search.py", "test_bulk.py",
                       "test_order_admin.py", "test_soft_delete.py",
                       "test_ticket_email.py", "test_masters.py",
                       "test_analytics.py", "test_ebook.py",
                       "test_ebook_delivery.py", "test_basket.py",
                       "test_security.py", "test_storage.py",
                       "test_addresses.py", "test_customer_admin.py",
                       "test_reader.py"]

__all__ = ["HERE", "collect_ignore_glob"]
