"""Scheduled background work.

WHY THIS EXISTS

Several pieces of this system were built and then never invoked:
`mailer.send_queued()` drains the outbox, `customers.purge_expired_sessions()`
clears dead sessions, `inventory.reconcile()` catches stock drift,
`basket.abandoned()` finds stalled carts — and nothing called any of them. Code
that is never called is indistinguishable from code that does not work, and the
outbox one is the worst: mail sat queued forever with nobody noticing.

WHY NOT APSCHEDULER

A daemon thread and a loop is about sixty lines. This box is memory-constrained
and shared with the LMS, and the dependency would buy cron expressions we do not
need — every job here runs on a plain interval.

THREE RULES

  1. **A job never raises into the loop.** One failing job must not stop the
     others, so every run is wrapped and logged.
  2. **A job never overlaps itself.** A slow outbox drain must not have a second
     copy start beside it and send everything twice.
  3. **Every run is recorded.** `last_run`, duration and outcome are readable
     from /admin-api, because a scheduler you cannot observe is one you cannot
     trust.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

log = logging.getLogger(__name__)


@dataclass
class Job:
    name: str
    interval_seconds: int
    run: Callable[[], object]
    # Delay before the FIRST run. Staggered across jobs so boot does not fire
    # six of them at once on a 2 vCPU box that is also serving requests.
    initial_delay: int = 30
    description: str = ""

    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    last_run: str | None = None
    last_ok: bool | None = None
    last_result: str = ""
    last_ms: int = 0
    runs: int = 0
    failures: int = 0
    _next_at: float = 0.0


class Scheduler:
    def __init__(self) -> None:
        self._jobs: list[Job] = []
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def add(self, job: Job) -> None:
        job._next_at = time.monotonic() + job.initial_delay
        self._jobs.append(job)

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        # Daemon: the process must be able to exit without waiting for a sleep
        # to finish, or every deploy adds a shutdown delay.
        self._thread = threading.Thread(
            target=self._loop, name="cc-jobs", daemon=True
        )
        self._thread.start()
        log.info("Job scheduler started with %d job(s)", len(self._jobs))

    def stop(self) -> None:
        self._stop.set()
        self._thread = None

    def _loop(self) -> None:
        while not self._stop.is_set():
            now = time.monotonic()
            for job in self._jobs:
                if now < job._next_at:
                    continue
                job._next_at = now + job.interval_seconds
                self._run(job)
            # One second of granularity is ample for intervals measured in
            # minutes, and keeps the thread effectively free.
            self._stop.wait(1.0)

    def _run(self, job: Job) -> None:
        # Non-blocking: if the previous run of THIS job is still going, skip
        # this tick rather than queueing a second copy behind it.
        if not job._lock.acquire(blocking=False):
            log.warning("Job %s is still running; skipping this tick", job.name)
            return
        started = time.perf_counter()
        try:
            result = job.run()
            job.last_ok = True
            job.last_result = str(result)[:200] if result is not None else "ok"
        except Exception as exc:  # noqa: BLE001 — one bad job must not stop the rest
            job.last_ok = False
            job.failures += 1
            job.last_result = f"{type(exc).__name__}: {exc}"[:200]
            log.exception("Job %s failed", job.name)
        finally:
            job.last_ms = int((time.perf_counter() - started) * 1000)
            job.last_run = dt.datetime.now(dt.timezone.utc).isoformat()
            job.runs += 1
            job._lock.release()

    def status(self) -> list[dict]:
        return [
            {
                "name": j.name,
                "description": j.description,
                "intervalSeconds": j.interval_seconds,
                "lastRun": j.last_run,
                "lastOk": j.last_ok,
                "lastResult": j.last_result,
                "lastMs": j.last_ms,
                "runs": j.runs,
                "failures": j.failures,
            }
            for j in self._jobs
        ]

    def run_now(self, name: str) -> dict | None:
        """Trigger a job by hand from the admin panel."""
        for job in self._jobs:
            if job.name == name:
                self._run(job)
                return self.status()[self._jobs.index(job)]
        return None


scheduler = Scheduler()


# ------------------------------------------------------------------- jobs --
def _drain_outbox() -> str:
    from app.services import mailer

    if not mailer.configured():
        # Not a failure. Says so plainly, so the admin screen shows WHY nothing
        # is being sent rather than a silent zero.
        return "skipped: SMTP not configured"
    result = mailer.send_queued(limit=50)
    return f"sent {result['sent']}, failed {result['failed']}"


def _purge_sessions() -> str:
    from app.db.repo import admin as admin_repo
    from app.db.repo import customers as customers_repo

    customer = customers_repo.purge_expired_sessions()
    staff = admin_repo.purge_expired_sessions()
    return f"purged {customer} customer + {staff} admin session(s)"


def _sweep_tmp() -> str:
    from app.services import storage

    storage.sweep_tmp()
    return "ok"


def _reconcile_stock() -> str:
    from app.services import inventory

    drifted = inventory.reconcile()
    if drifted:
        # Loud: a mismatch means something wrote stock outside the ledger, and
        # the symptom of ignoring it is overselling.
        log.error("Stock drift corrected on %d book(s): %s", len(drifted), drifted[:5])
    return f"{len(drifted)} drift(s) corrected"


def _scan_low_stock() -> str:
    from app.services import inventory, notifications

    low = inventory.low_stock(limit=50)
    for book in low:
        notifications.low_stock(book["slug"], book["title"], book["stock_qty"])
    return f"{len(low)} title(s) at or below threshold"


def _abandoned_carts() -> str:
    from app.services import basket, notifications

    stalled = basket.abandoned(hours=24, limit=50)
    for entry in stalled:
        notifications.notify(
            audience="admin", kind="cart.abandoned",
            title=f"Abandoned cart: {entry['name'] or entry['email']}",
            body=f"{entry['lines']} item(s), untouched since {entry['last_touch'][:10]}",
            link="/admin/customers",
            entity="cart", entity_id=entry["customer_id"],
        )
    return f"{len(stalled)} stalled cart(s)"


def register_default_jobs() -> None:
    """Wire up the standard set. Called once from the app lifespan."""
    if scheduler._jobs:
        return  # already registered; --reload would otherwise double them up

    scheduler.add(Job(
        name="email.drain", interval_seconds=300, initial_delay=20,
        run=_drain_outbox,
        description="Send anything queued in email_outbox",
    ))
    scheduler.add(Job(
        name="sessions.purge", interval_seconds=3600, initial_delay=60,
        run=_purge_sessions,
        description="Delete expired customer and admin sessions",
    ))
    scheduler.add(Job(
        name="storage.sweep", interval_seconds=3600, initial_delay=90,
        run=_sweep_tmp,
        description="Remove abandoned upload staging files",
    ))
    scheduler.add(Job(
        name="stock.reconcile", interval_seconds=86400, initial_delay=120,
        run=_reconcile_stock,
        description="Rebuild cached stock from the ledger and report drift",
    ))
    scheduler.add(Job(
        name="stock.low", interval_seconds=43200, initial_delay=150,
        run=_scan_low_stock,
        description="Notify staff about titles at or below their threshold",
    ))
    scheduler.add(Job(
        name="carts.abandoned", interval_seconds=86400, initial_delay=180,
        run=_abandoned_carts,
        description="Flag carts untouched for 24 hours",
    ))
