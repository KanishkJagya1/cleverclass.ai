"""In-process sliding-window rate limiting.

Ported from the LMS tutor's limiter, which is proven on this box, with the
sweep it was missing — without one the deque map grows for every distinct IP
seen and never shrinks, which on a public endpoint is a slow memory leak.

Single-process only. If this ever runs more than one worker, swap the store for
Redis behind the same `check()` signature; nothing above this module changes.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


class SlidingWindowLimiter:
    """One limiter, several windows.

    `limits` is a list of (max_requests, window_seconds), so a single limiter
    can enforce "15 per minute AND 150 per hour" — the pair that stops both a
    burst and a slow drain.
    """

    def __init__(self, limits: list[tuple[int, int]]):
        if not limits:
            raise ValueError("at least one (limit, window) pair is required")
        self._limits = sorted(limits, key=lambda lw: lw[1])
        self._widest = self._limits[-1][1]
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def check(self, key: str) -> tuple[bool, int]:
        """(allowed, retry_after_seconds). retry_after is 0 when allowed."""
        now = time.monotonic()
        with self._lock:
            self._maybe_sweep(now)

            hits = self._hits[key]
            while hits and now - hits[0] > self._widest:
                hits.popleft()

            for limit, window in self._limits:
                recent = sum(1 for t in hits if now - t <= window)
                if recent >= limit:
                    oldest = next(t for t in hits if now - t <= window)
                    return False, max(1, int(window - (now - oldest)) + 1)

            hits.append(now)
            return True, 0

    def _maybe_sweep(self, now: float) -> None:
        """Drop keys with no recent activity. Called opportunistically rather
        than on a timer so there is no background thread to manage."""
        if now - self._last_sweep < 300:
            return
        self._last_sweep = now
        stale = [
            key
            for key, hits in self._hits.items()
            if not hits or now - hits[-1] > self._widest
        ]
        for key in stale:
            del self._hits[key]

    def reset(self, key: str) -> None:
        """Clear a key — used after a successful login so a user who fumbled
        their password twice is not then throttled while working."""
        with self._lock:
            self._hits.pop(key, None)


def client_ip(request) -> str:
    """First hop of X-Forwarded-For; this always runs behind nginx.

    Deliberately the FIRST entry: later entries are added by proxies we control,
    the first is the client. It is spoofable by a direct caller, which is why
    nginx is the only thing allowed to reach this service.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
