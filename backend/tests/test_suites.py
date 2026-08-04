"""One command to run every backend suite: `pytest`.

Each suite runs in its own subprocess with its own database and its own fresh
module state — see `conftest.py` for why that isolation is mandatory rather than
tidy.

The suites keep their script form deliberately. Their output is a readable list
of named invariants ("locked pages cannot reach the assistant", "an attacker
CANNOT lock the real account out"), which is more useful during a deploy than
pytest's dots, and they stay runnable on the server with plain `python -m`
inside the container, where pytest is not installed.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent

# Declared here rather than imported from conftest: `tests/` is a package, so
# `conftest` is not importable as a top-level module.
#
# Ordered cheapest-first, so a broken contract fails in seconds instead of after
# the embedding model has loaded twice.
SUITES = [
    "test_catalog_contract",
    "test_corpus_isolation",
    "test_sales_guard",
    "test_auth",
    "test_rate_limits",
    "test_permissions",
    "test_inventory",
    "test_order_flow",
    "test_payments",
    "test_invoices",
    "test_reviews",
    "test_razorpay",
    "test_coupons",
    "test_exports",
    "test_shipping",
    "test_support",
    "test_templates",
    "test_phase2_remainder",
    "test_jobs",
]


@pytest.mark.parametrize("suite", SUITES)
def test_suite(suite: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", f"tests.{suite}"],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        # Generous: the corpus and sales suites load an embedding model on first
        # run. A timeout here should mean "hung", not "slow machine".
        timeout=900,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        # Print the suite's own output — its per-check labels say what broke far
        # better than an assertion on an exit code ever could.
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        pytest.fail(f"{suite} failed (exit {result.returncode})")
