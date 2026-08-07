"""Password hashing, tokens and the rate limiter.

These are the authentication defences and they had no direct tests. The
failures they guard against are silent: a hash that verifies anything, a
comparison that leaks timing, a limiter that resets when you need it most.
None of those announce themselves in normal use.

    python -m tests.test_security
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_sec_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.services import security  # noqa: E402
from app.services.ratelimit import SlidingWindowLimiter  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def main_() -> int:
    logging.disable(logging.ERROR)

    print("=== password hashing ===")
    stored = security.hash_password("correct horse battery staple")
    check("the plaintext is nowhere in the hash",
          "correct horse" not in stored,
          "a hash containing the password is not a hash")
    check("the right password verifies",
          security.verify_password("correct horse battery staple", stored) is True)
    check("a wrong password does not",
          security.verify_password("wrong", stored) is False)
    check("an empty password does not",
          security.verify_password("", stored) is False,
          "empty-string bypass is a classic")

    print("\n=== the same password hashes differently every time ===")
    again = security.hash_password("correct horse battery staple")
    check("two hashes of one password differ",
          stored != again,
          "identical hashes mean no salt — one rainbow table breaks every account")
    check("but both still verify",
          security.verify_password("correct horse battery staple", again) is True)

    print("\n=== a malformed stored hash is refused, not crashed on ===")
    for bad in ("", "garbage", "a$b$c", "$$$$"):
        try:
            result = security.verify_password("anything", bad)
            check(f"{bad!r} refused", result is False, f"returned {result}")
        except Exception as exc:  # noqa: BLE001
            # A raise is acceptable; an accidental True is not.
            check(f"{bad!r} refused", True, f"raised {type(exc).__name__}")

    print("\n=== tokens ===")
    a, b = security.new_token(), security.new_token()
    check("tokens are unique", a != b)
    check("and long enough to not be guessed", len(a) >= 32, str(len(a)))

    fp1 = security.token_fingerprint(a)
    check("a fingerprint is not the token itself",
          fp1 != a,
          "storing the token verbatim means a database leak is a session leak")
    check("the same token fingerprints the same way",
          security.token_fingerprint(a) == fp1)
    check("a different token does not",
          security.token_fingerprint(b) != fp1)

    print("\n=== constant-time comparison ===")
    check("equal strings match", security.constant_time_equals("abc", "abc") is True)
    check("different strings do not",
          security.constant_time_equals("abc", "abd") is False)
    check("None is handled rather than raising",
          security.constant_time_equals(None, "abc") is False)
    check("None on both sides is still False",
          security.constant_time_equals(None, None) is False,
          "two missing values are not a match")

    print("\n=== rate limiter ===")
    limiter = SlidingWindowLimiter([(3, 60)])
    results = [limiter.check("ip-1")[0] for _ in range(4)]
    check("the first three are allowed", results[:3] == [True, True, True], str(results))
    check("the fourth is refused", results[3] is False, str(results))

    allowed, retry = limiter.check("ip-1")
    check("a refusal says when to come back", retry > 0, str(retry))

    print("\n=== limits are per key ===")
    check("a different caller is unaffected",
          limiter.check("ip-2")[0] is True,
          "one abusive IP must not lock out everyone else")

    print("\n=== the tighter of two windows wins ===")
    # Burst + drain: 2 per second, 3 per hour. After the burst refills, the
    # hourly cap must still hold — otherwise a patient script is unlimited.
    paired = SlidingWindowLimiter([(2, 1), (3, 3600)])
    check("burst allows two", [paired.check("k")[0] for _ in range(2)] == [True, True])
    check("the third is refused by the burst", paired.check("k")[0] is False)
    time.sleep(1.1)
    check("after the burst window one more is allowed",
          paired.check("k")[0] is True)
    check("but the hourly cap then refuses",
          paired.check("k")[0] is False,
          "a limiter that only enforces the burst is defeated by waiting")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Security holds: salted hashes, fingerprinted tokens, layered limits.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
