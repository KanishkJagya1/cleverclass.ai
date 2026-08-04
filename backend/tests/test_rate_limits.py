"""Rate limits on the auth endpoints.

SEPARATE FILE ON PURPOSE. The limiters are module-level singletons, so every
request in a process shares their counters. Folding these checks into
`test_auth.py` would mean that suite's own logins ate into the budget and the
two files would fail each other depending on execution order — the flakiest
possible bug to chase.

    python -m tests.test_rate_limits
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_ratelimit_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)
os.environ.pop("SMTP_HOST", None)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.db.conn import query  # noqa: E402
from app.db.migrate import migrate  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def main_() -> int:
    logging.disable(logging.WARNING)
    migrate()
    client = TestClient(main.app)

    client.post(
        "/auth/signup",
        json={"email": "victim@example.com", "password": "realpassword1", "name": "V"},
    )
    client.post("/auth/logout")

    print("=== login throttling ===")
    codes = [
        client.post(
            "/auth/login",
            json={"email": "victim@example.com", "password": f"guess{i}"},
        ).status_code
        for i in range(12)
    ]
    check("login is throttled", 429 in codes, str(codes))

    # THE POINT OF THE PER-ACCOUNT LIMIT.
    #
    # `record_login_failure` locks an account after 10 consecutive failures. If
    # throttling only happened per IP, anyone who knew a customer's email could
    # burn 10 guesses and lock them out — repeatedly, for free, forever. The
    # per-account limiter has to refuse the attempt BEFORE it is counted as a
    # failed login, so the lock never triggers for an attacker who cannot guess.
    check(
        "throttle fires before the 10-failure account lock",
        codes.index(429) < 10,
        str(codes),
    )
    row = query(
        "SELECT failed_logins, locked_until FROM customers WHERE email_norm = ?",
        ("victim@example.com",),
    )[0]
    check(
        "an attacker CANNOT lock the real account out",
        row["locked_until"] is None,
        str(dict(row)),
    )
    check("failed_logins stayed below the lock threshold", row["failed_logins"] < 10, str(row["failed_logins"]))

    response = client.post(
        "/auth/login", json={"email": "victim@example.com", "password": "guess"}
    )
    check(
        "429 carries Retry-After so a client can back off",
        "retry-after" in {k.lower() for k in response.headers},
    )
    check(
        "the 429 body does not reveal whether the account exists",
        "victim" not in response.text and "exist" not in response.text.lower(),
        response.text[:120],
    )

    print("\n=== reset-email flooding ===")
    codes = [
        client.post("/auth/request-reset", json={"email": "victim@example.com"}).status_code
        for _ in range(6)
    ]
    check("reset requests are throttled", 429 in codes, str(codes))
    sent = query("SELECT COUNT(*) n FROM email_outbox WHERE subject LIKE 'Reset%'")[0]["n"]
    check(
        "only a few reset emails were actually queued",
        sent <= 3,
        f"{sent} queued — this endpoint sends mail to a third party's inbox",
    )

    print("\n=== the legitimate path still works ===")
    # A throttled endpoint that also blocks real customers is a worse outage
    # than the attack it prevents.
    fresh = TestClient(main.app)
    r = fresh.post(
        "/auth/signup",
        json={"email": "genuine@example.com", "password": "goodpassword1", "name": "G"},
    )
    check("a normal signup is not throttled", r.status_code == 200, r.text[:120])

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Auth rate limits hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
