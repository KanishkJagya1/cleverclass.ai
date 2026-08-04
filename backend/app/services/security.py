"""Password hashing, session tokens and CSRF.

Uses `hashlib.scrypt` from the standard library rather than bcrypt/argon2. It is
memory-hard, it is the same primitive those libraries compete with, and it adds
no dependency to an image that already has to fit alongside another service on a
2 vCPU box. The parameters below are the interactive-login profile from the
scrypt paper (N=2^15, r=8, p=1 — roughly 100 ms and 32 MB per verification),
which is the right trade for a login nobody runs in a loop.

Hash format is self-describing so parameters can be raised later without
invalidating existing hashes:

    scrypt$<n>$<r>$<p>$<salt_b64>$<key_b64>
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

# Interactive-login profile. Raising N later is safe: verify() reads the
# parameters out of the stored hash, so old hashes keep working.
_N = 2**15
_R = 8
_P = 1
_DKLEN = 32
_SALT_BYTES = 16

# scrypt needs maxmem >= 128 * N * r * p. CPython's default is too low for
# N=2^15 and raises "memory limit exceeded" rather than allocating.
_MAXMEM = 128 * _N * _R * _P * 2


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def hash_password(password: str) -> str:
    if not password or len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    salt = secrets.token_bytes(_SALT_BYTES)
    key = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN, maxmem=_MAXMEM
    )
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(key)}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verification. Never raises on a malformed hash — a corrupt
    row must read as 'wrong password', not as a 500 that reveals it exists."""
    try:
        scheme, n, r, p, salt_b64, key_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = _unb64(key_b64)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=_unb64(salt_b64),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
            maxmem=128 * int(n) * int(r) * int(p) * 2,
        )
        return hmac.compare_digest(actual, expected)
    except Exception:  # noqa: BLE001 — malformed hash is a failed login
        return False


# --------------------------------------------------------------------------
# Tokens
# --------------------------------------------------------------------------

def new_token(nbytes: int = 32) -> str:
    """A URL-safe random token. Used for session cookies and CSRF tokens."""
    return secrets.token_urlsafe(nbytes)


def token_fingerprint(token: str) -> str:
    """What actually goes in the database.

    The session cookie is a bearer credential: anyone holding it is logged in.
    Storing it verbatim means a leaked database dump is a set of live sessions.
    Storing the SHA-256 means it is not. No salt and no KDF here on purpose —
    the token already has 256 bits of entropy, so there is nothing to brute
    force and a slow hash would just add latency to every request.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a, b)
