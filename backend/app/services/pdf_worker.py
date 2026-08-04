"""Background PDF processing.

Text extraction from a 400-page book takes 20–60 seconds. Doing it inside the
upload request would mean the admin stares at a spinner and any proxy timeout
kills the job halfway; so the upload returns 202 immediately and this runs
after.

A single worker thread with a queue, not a pool: the database has one writer,
and two extractions committing in parallel would spend their time contending
for it rather than working.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
from pathlib import Path

from app.db.repo import pages as pages_repo
from app.services import pdf, storage

log = logging.getLogger(__name__)

# Commit every N pages. One transaction for a whole book would hold the write
# lock for a minute; one per page would fsync 400 times.
COMMIT_EVERY = 25

_queue: "queue.Queue[str]" = queue.Queue()
_worker: threading.Thread | None = None
_lock = threading.Lock()


def enqueue(asset_id: str) -> None:
    _ensure_worker()
    _queue.put(asset_id)


def _ensure_worker() -> None:
    global _worker
    with _lock:
        if _worker is not None and _worker.is_alive():
            return
        _worker = threading.Thread(target=_run, name="pdf-worker", daemon=True)
        _worker.start()
        log.info("PDF worker started")


def _run() -> None:
    while True:
        asset_id = _queue.get()
        try:
            _process(asset_id)
        except Exception as exc:  # noqa: BLE001 — one bad PDF must not kill the worker
            log.exception("PDF processing failed for %s", asset_id)
            try:
                pages_repo.set_asset_state(asset_id, "failed", error=str(exc))
            except Exception:  # noqa: BLE001
                log.error("Could not even record the failure for %s", asset_id)
        finally:
            _queue.task_done()


def _process(asset_id: str) -> None:
    asset = pages_repo.get_asset(asset_id)
    if asset is None:
        log.warning("Asset %s vanished before processing", asset_id)
        return

    path = storage.absolute(asset["storage_path"])
    if not path.is_file():
        pages_repo.set_asset_state(asset_id, "failed", error="The uploaded file is missing.")
        return

    pages_repo.set_asset_state(asset_id, "processing", pages_done=0)

    info = pdf.inspect(path)
    pages_repo.set_asset_state(
        asset_id,
        "processing",
        page_count=info.page_count,
        outline=json.dumps(info.outline, ensure_ascii=False),
    )
    log.info("Extracting %d pages from %s", info.page_count, path.name)

    batch: list[tuple[int, str]] = []
    done = 0
    for page_no, text in pdf.extract_pages(path):
        batch.append((page_no, text))
        if len(batch) >= COMMIT_EVERY:
            pages_repo.upsert_pages(asset_id, batch)
            done += len(batch)
            batch.clear()
            # Drives the determinate progress bar in the admin panel.
            pages_repo.set_asset_state(asset_id, "processing", pages_done=done)

    if batch:
        pages_repo.upsert_pages(asset_id, batch)
        done += len(batch)

    # A scanned book still previews as images but contributes nothing to the
    # assistant. Say so on the asset rather than letting the admin wonder.
    note = None
    if pdf.looks_scanned(pages_repo.page_char_counts(asset_id)):
        note = (
            "This PDF appears to be scanned images with no selectable text. "
            "Preview pages will work, but the assistant will have nothing to "
            "read from the free pages."
        )
        log.warning("Asset %s looks scanned", asset_id)

    pages_repo.set_asset_state(
        asset_id, "ready", page_count=info.page_count, pages_done=done, error=note
    )
    log.info("Asset %s ready: %d pages extracted", asset_id, done)


def pending_count() -> int:
    return _queue.qsize()
