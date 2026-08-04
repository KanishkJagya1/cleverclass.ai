"""Customer auth: sessions, verification, reset, profile, enumeration safety.

Runs against a THROWAWAY database. Point DB_PATH at a temp file before the app
imports anything — the corpus suite taught this the hard way: reusing the dev
database made a passing run depend on what a previous run happened to leave
behind, and the second run of the same test failed for reasons that had nothing
to do with the code.

    python -m tests.test_auth
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

# MUST be set before `app.config` is imported anywhere, or Settings caches the
# real path and the suite writes into the development database.
_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_auth_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)
os.environ.pop("SMTP_HOST", None)          # exercise the "no SMTP" path
os.environ.pop("GOOGLE_CLIENT_ID", None)   # and the "Google off" path

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

    print("=== 1. signup ===")
    r = client.post(
        "/auth/signup",
        json={"email": "Ravi@Example.COM", "password": "hunter2hunter", "name": "Ravi"},
    )
    check("signup returns 200", r.status_code == 200, r.text[:160])
    check("session cookie is HttpOnly", "httponly" in (r.headers.get("set-cookie") or "").lower())
    me = client.get("/auth/me").json()
    check("session works immediately", (me.get("user") or {}).get("email", "").lower() == "ravi@example.com", str(me))
    check("password is never echoed back", "hunter2" not in client.get("/auth/me").text)

    print("\n=== 2. account enumeration is not possible ===")
    dup = client.post("/auth/signup", json={"email": "ravi@example.com", "password": "zzzzzzzzzz"})
    check("duplicate signup does not reveal the account", dup.status_code == 200 and "user" not in dup.json(), dup.text[:160])
    n = query("SELECT COUNT(*) c FROM customers WHERE email_norm = 'ravi@example.com'")[0]["c"]
    check("mixed-case email did not create a second account", n == 1, str(n))
    unknown = client.post("/auth/login", json={"email": "no@one.com", "password": "whatever12"})
    wrong = client.post("/auth/login", json={"email": "ravi@example.com", "password": "wrong-passwd"})
    check("unknown email is 401, not 500", unknown.status_code == 401, str(unknown.status_code))

    # Compare the parts a caller can learn something from, NOT the whole body:
    # the error envelope carries a per-request `requestId`, so two identical
    # failures legitimately differ there. Asserting on the full JSON made this
    # fail the moment request ids were added, for a difference that is random
    # and reveals nothing about whether the account exists.
    def _signal(response) -> tuple:
        body = response.json()
        return (
            response.status_code,
            body.get("detail"),
            (body.get("error") or {}).get("code"),
        )

    check(
        "unknown and wrong-password are indistinguishable",
        _signal(unknown) == _signal(wrong),
        f"{_signal(unknown)} vs {_signal(wrong)}",
    )

    print("\n=== 3. profile ===")
    r = client.put("/auth/profile", json={"name": "Ravi K", "city": "Nagpur", "pincode": "440016"})
    check("profile updates", r.status_code == 200 and r.json()["user"]["address"]["city"] == "Nagpur", r.text[:160])
    check("a bad pincode is rejected", client.put("/auth/profile", json={"pincode": "12"}).status_code == 422)
    client.put("/auth/profile", json={"status": "disabled", "password_hash": "x"})
    row = query("SELECT status, password_hash FROM customers WHERE email_norm='ravi@example.com'")[0]
    check("privileged columns are not writable from the profile route", row["status"] == "active" and row["password_hash"] != "x")

    print("\n=== 4. email verification ===")
    outbox = query("SELECT subject, status, body_text FROM email_outbox ORDER BY created_at")
    check("verification email was queued", any(x["subject"].startswith("Confirm") for x in outbox), str([x["subject"] for x in outbox]))
    check("duplicate signup emailed the REAL owner a reset", any(x["subject"].startswith("Reset") for x in outbox))
    check("with no SMTP mail is recorded as skipped, never dropped", all(x["status"] == "skipped" for x in outbox))
    token = [x["body_text"] for x in outbox if x["subject"].startswith("Confirm")][0].split("token=")[1].split()[0].strip()
    check("verification link works", client.post("/auth/verify-email", json={"token": token}).status_code == 200)
    check("the link cannot be replayed", client.post("/auth/verify-email", json={"token": token}).status_code == 400)

    print("\n=== 5. password reset invalidates sessions ===")
    client.post("/auth/request-reset", json={"email": "ravi@example.com"})
    resets = query("SELECT body_text FROM email_outbox WHERE subject LIKE 'Reset%' ORDER BY created_at DESC")
    rtoken = resets[0]["body_text"].split("token=")[1].split()[0].strip()
    check("reset for an unknown email still returns ok (no enumeration)", client.post("/auth/request-reset", json={"email": "ghost@nowhere.com"}).status_code == 200)
    other = TestClient(main.app)
    other.post("/auth/login", json={"email": "ravi@example.com", "password": "hunter2hunter"})
    check("second device is signed in", other.get("/auth/me").json()["user"] is not None)
    r = client.post("/auth/reset-password", json={"token": rtoken, "password": "brand-new-pass"})
    check("reset succeeds", r.status_code == 200, r.text[:160])
    check("the other device was signed out by the reset", other.get("/auth/me").json()["user"] is None)
    check("the new password works", client.post("/auth/login", json={"email": "ravi@example.com", "password": "brand-new-pass"}).status_code == 200)
    check("the old password does not", client.post("/auth/login", json={"email": "ravi@example.com", "password": "hunter2hunter"}).status_code == 401)

    print("\n=== 6. everything private requires a session ===")
    anon = TestClient(main.app)
    check("profile requires auth", anon.get("/auth/profile").status_code == 401)
    check("orders require auth", anon.get("/auth/orders").status_code == 401)
    check("change-password requires auth", anon.post("/auth/change-password", json={"newPassword": "aaaaaaaaaa"}).status_code == 401)

    print("\n=== 7. unconfigured providers degrade honestly ===")
    providers = anon.get("/auth/providers").json()
    check("providers reports google off", providers["google"] is False, str(providers))
    check("google/start refuses rather than 500s", anon.get("/auth/google/start", follow_redirects=False).status_code == 503)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Customer auth holds.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
