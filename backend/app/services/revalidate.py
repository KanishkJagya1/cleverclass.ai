"""Tell the storefront to drop its cache after an admin change.

Product pages carry `export const revalidate = 43200`. Without this call a price
edit would not appear for twelve hours — long enough that staff assume the save
failed and save again. This is what makes the admin panel trustworthy.

Fire-and-forget by design: a storefront that cannot be reached must not fail the
save. The edit is already committed; the worst case is a stale page until the
ISR window elapses, and that is strictly better than losing the edit.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
import time
import urllib.error
import urllib.request

from app.config import settings

log = logging.getLogger(__name__)

_TIMEOUT = 5


def _post(tags: list[str], paths: list[str]) -> None:
    url = settings.frontend_revalidate_url
    secret = settings.frontend_revalidate_secret
    if not url or not secret:
        log.debug("Revalidation not configured; skipping (tags=%s)", tags)
        return

    body = json.dumps({"tags": tags, "paths": paths}, ensure_ascii=False)
    timestamp = str(int(time.time() * 1000))
    # Signature covers the timestamp too, so a captured request cannot be
    # replayed outside the receiver's skew window.
    signature = hmac.new(
        secret.encode("utf-8"), f"{timestamp}.{body}".encode("utf-8"), hashlib.sha256
    ).hexdigest()

    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-CC-Signature": signature,
            "X-CC-Timestamp": timestamp,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
            if response.status >= 300:
                log.warning("Revalidation returned %s for %s", response.status, tags)
            else:
                log.info("Revalidated %s", tags)
    except urllib.error.HTTPError as exc:
        log.warning("Revalidation rejected (%s) for %s", exc.code, tags)
    except Exception as exc:  # noqa: BLE001 — never fail the caller's save
        log.warning("Revalidation unreachable: %s", exc)


def _fire(tags: list[str], paths: list[str]) -> None:
    # A daemon thread rather than a background task: this is called from sync
    # route handlers, and blocking a request on the storefront's HTTP round trip
    # would make every admin save feel slow for no benefit.
    threading.Thread(target=_post, args=(tags, paths), daemon=True).start()


def book_changed(*slugs: str) -> None:
    """Invalidate one or more books plus every list they appear on."""
    unique = [s for s in dict.fromkeys(slugs) if s]
    tags = ["catalog", *(f"book:{s}" for s in unique)]
    paths = [f"/shop/{s}" for s in unique]
    _fire(tags, paths)


def combo_changed(slug: str) -> None:
    _fire(["catalog", f"combo:{slug}"], [f"/combo-packs/{slug}"])


def catalog_changed() -> None:
    """Everything — used after a bulk import or a settings change."""
    _fire(["catalog"], ["/", "/shop"])
