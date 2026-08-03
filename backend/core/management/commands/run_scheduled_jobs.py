"""Fire the periodic jobs in `core/scheduling.py`.

    python manage.py run_scheduled_jobs --once   # one pass, then exit
    python manage.py run_scheduled_jobs          # supervised loop

`--once` is what production should run, driven by Cloud Scheduler, a
Kubernetes CronJob or crontab: the platform then owns the clock, the retry
and the alert on a missed run, and there is no long-lived process to wedge.
The loop exists for docker-compose and anywhere without a scheduler.

Both share `run_due_jobs`, so the interval each job runs at is the same
number in both modes and lives in exactly one file.
"""

from __future__ import annotations

import signal
import time
from typing import Any

from django.core.management.base import BaseCommand

from core.scheduling import SCHEDULE, run_due_jobs

TICK_SECONDS = 5


class Command(BaseCommand):
    help = "Enqueue the periodic jobs whose interval has elapsed."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--once",
            action="store_true",
            help="Run every job once and exit. For an external scheduler.",
        )
        parser.add_argument(
            "--job",
            default="",
            help="Run a single task by name (e.g. booking.release_expired). Implies --once.",
        )
        parser.add_argument(
            "--list", action="store_true", help="Print the schedule and exit without running."
        )

    def handle(self, *args: Any, **options: Any) -> None:
        if options["list"]:
            for job in SCHEDULE:
                self.stdout.write(
                    f"{job.task_name:<34} every {job.interval_seconds:>5}s   {job.why}"
                )
            return

        if options["job"]:
            self._run_one(options["job"])
            return

        if options["once"]:
            # An empty `last_run` makes every job due, which is exactly right
            # for a one-shot: the external scheduler already decided it is time.
            fired = run_due_jobs(time.time(), {})
            self.stdout.write(self.style.SUCCESS(f"enqueued: {', '.join(fired) or 'nothing'}"))
            return

        self._loop()

    def _run_one(self, task_name: str) -> None:
        from config.di import task_queue_port

        known = {job.task_name: job for job in SCHEDULE}
        job = known.get(task_name)
        if job is None:
            # Named rather than guessed. Enqueueing an unknown name would
            # succeed against the queue and fail invisibly at delivery.
            raise SystemExit(f"Unknown job {task_name!r}. Known jobs: {', '.join(sorted(known))}")
        task_queue_port().enqueue(job.task_name, dict(job.payload))
        self.stdout.write(self.style.SUCCESS(f"enqueued: {job.task_name}"))

    def _loop(self) -> None:
        stopping = False

        def stop(signum: int, frame: object) -> None:
            nonlocal stopping
            stopping = True

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)

        # Starts empty, so every job runs once immediately on boot rather than
        # after a full interval. A container that restarts hourly would
        # otherwise never reach the hourly payout scan at all.
        last_run: dict[str, float] = {}
        self.stdout.write(self.style.SUCCESS(f"scheduler started ({len(SCHEDULE)} jobs)"))

        while not stopping:
            run_due_jobs(time.time(), last_run)
            # Sleep in short slices so SIGTERM is honoured promptly. A
            # container given ten seconds to shut down must not be sitting in
            # the middle of a sixty-second sleep when the clock runs out.
            for _ in range(TICK_SECONDS):
                if stopping:
                    break
                time.sleep(1)

        self.stdout.write("scheduler stopped")
