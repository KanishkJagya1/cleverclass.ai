"""Background job runner.

    python -m tests.test_jobs
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_jobs_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)
os.environ.pop("SMTP_HOST", None)

from app.db.migrate import migrate  # noqa: E402
from app.services.jobs import Job, Scheduler, register_default_jobs, scheduler  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== a failing job does not stop the others ===")
    ran: list[str] = []
    s = Scheduler()
    s.add(Job(name="boom", interval_seconds=1, initial_delay=0,
              run=lambda: (_ for _ in ()).throw(RuntimeError("kaboom"))))
    s.add(Job(name="fine", interval_seconds=1, initial_delay=0,
              run=lambda: ran.append("fine")))
    s._run(s._jobs[0])
    s._run(s._jobs[1])
    check("the failing job is recorded as failed", s._jobs[0].last_ok is False)
    check("and its error is captured", "kaboom" in s._jobs[0].last_result,
          s._jobs[0].last_result)
    check("the healthy job still ran", ran == ["fine"], str(ran))
    check("failures are counted", s._jobs[0].failures == 1)

    print("\n=== a job never overlaps itself ===")
    started = threading.Event()
    release = threading.Event()
    calls: list[int] = []

    def slow() -> str:
        calls.append(1)
        started.set()
        release.wait(2)
        return "done"

    s2 = Scheduler()
    s2.add(Job(name="slow", interval_seconds=1, initial_delay=0, run=slow))
    worker = threading.Thread(target=lambda: s2._run(s2._jobs[0]))
    worker.start()
    started.wait(2)
    # Second tick arrives while the first is still inside the job.
    s2._run(s2._jobs[0])
    check("the overlapping tick was skipped", len(calls) == 1,
          f"{len(calls)} concurrent runs — a slow outbox drain would send twice")
    release.set()
    worker.join(3)

    print("\n=== every run is observable ===")
    s3 = Scheduler()
    s3.add(Job(name="counted", interval_seconds=1, initial_delay=0,
               run=lambda: "42 things", description="does a thing"))
    s3._run(s3._jobs[0])
    status = s3.status()[0]
    check("name and description reported", status["name"] == "counted" and status["description"])
    check("the result is captured", status["lastResult"] == "42 things", str(status))
    check("a timestamp is recorded", bool(status["lastRun"]))
    check("duration is recorded", status["lastMs"] >= 0)
    check("run count increments", status["runs"] == 1)

    print("\n=== manual trigger ===")
    check("run_now executes a known job", s3.run_now("counted")["runs"] == 2)
    check("and returns None for an unknown one", s3.run_now("nonesuch") is None)

    print("\n=== the default set is registered exactly once ===")
    register_default_jobs()
    first = len(scheduler.status())
    register_default_jobs()
    check("registering twice does not duplicate", len(scheduler.status()) == first,
          f"{first} -> {len(scheduler.status())} (uvicorn --reload would double them)")
    names = {j["name"] for j in scheduler.status()}
    for expected in ("email.drain", "sessions.purge", "stock.reconcile",
                     "stock.low", "carts.abandoned", "storage.sweep"):
        check(f"{expected} is scheduled", expected in names, str(sorted(names)))

    print("\n=== jobs run for real against the database ===")
    for name in ("sessions.purge", "stock.reconcile", "carts.abandoned", "stock.low"):
        result = scheduler.run_now(name)
        check(f"{name} completes", result and result["lastOk"] is True,
              str(result))

    drain = scheduler.run_now("email.drain")
    check("email.drain says WHY it did nothing",
          "SMTP not configured" in drain["lastResult"],
          f"{drain['lastResult']} — a silent zero hides the real reason")

    print("\n=== initial delays are staggered ===")
    delays = [j.initial_delay for j in scheduler._jobs]
    check("no two jobs fire at the same moment on boot",
          len(set(delays)) == len(delays), str(delays))

    print("\n=== the loop starts and stops cleanly ===")
    scheduler.start()
    time.sleep(0.2)
    check("thread is alive", scheduler._thread is not None and scheduler._thread.is_alive())
    check("it is a daemon so deploys are not delayed", scheduler._thread.daemon)
    scheduler.stop()
    check("stop clears the thread", scheduler._thread is None)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Jobs hold: isolated, non-overlapping, observable.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
