"""The periodic jobs, and the one place that says how often each runs.

Several modules register a task meant to run "on a schedule" — the comments
say so — and nothing anywhere fired them. The consequences were not subtle:

- `booking.release_expired` is the sweeper CLAUDE.md calls "the reliability
  backstop". Without it, a hold whose best-effort release was missed stays
  reserved forever, and that tier's inventory is gone. Permanently. On the
  money path.
- `settlements.release_due_payouts` is the ONLY route by which an organizer
  is paid. Without it, money sits on hold at Razorpay indefinitely and every
  settlement stays `owed` while the dashboard cheerfully shows the amount.
- `notifications.retry` sweeps sends stuck between a claim and a dispatch.

The tasks themselves were all correct and tested. What was missing was the
clock.

── WHY A REGISTRY RATHER THAN CRON ENTRIES ───────────────────────────────

The schedule lives in code, next to the tasks, because a schedule written
only in a Cloud Scheduler console is invisible in review, untested, and
silently absent in every other environment. This module is the source of
truth; the deployment then picks how to drive it (see below), and both
options read the same list.

── TWO WAYS TO DRIVE IT, AND WHEN EACH IS RIGHT ──────────────────────────

1. `python manage.py run_scheduled_jobs --once` — one pass, then exit.
   For Cloud Scheduler, a Kubernetes CronJob, or a plain crontab. Preferred
   in production: the platform owns the clock, retries and alerting, and
   there is no long-lived process to leak or wedge.
2. `python manage.py run_scheduled_jobs` — a supervised loop, like
   `config/worker.py`. For docker-compose, a VM, or anywhere without a
   scheduler. Each job tracks its own next-due time, so one slow job never
   delays another.

Both go through `TaskQueuePort`, not straight to the handler: with
`QUEUE_BACKEND=local` that runs inline, and with `cloud_tasks` it enqueues,
so the sweep stays a short, cheap tick and the work retries under the
queue's own policy.
"""

from __future__ import annotations

import dataclasses
import logging

logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class ScheduledJob:
    task_name: str
    interval_seconds: int
    payload: dict
    why: str


# The interval for each is set from what it costs to be LATE, not from what it
# costs to run. Every one of these is idempotent and cheap on an empty result
# set, so running too often wastes a query; running too rarely holds somebody's
# inventory or somebody's money.
SCHEDULE: tuple[ScheduledJob, ...] = (
    ScheduledJob(
        task_name="booking.release_expired",
        # A minute. The hold window is BOOKING_HOLD_MINUTES (10 by default), so
        # a tighter interval buys nothing, and a looser one means a customer
        # watching "2 left" waits minutes longer than they should for a lapsed
        # hold to come back. During an on-sale that is the difference between
        # selling the ticket and not.
        interval_seconds=60,
        payload={"limit": 200},
        why="Frees inventory from holds that lapsed without payment.",
    ),
    ScheduledJob(
        task_name="settlements.release_due",
        # Hourly. Eligibility is already gated on the event having ended plus
        # SETTLEMENT_REFUND_WINDOW_HOURS (48 by default), so the payout is
        # days out — an hour of scan latency on top is immaterial, and a
        # tighter loop would scan the whole settlement table for nothing.
        interval_seconds=3600,
        payload={},
        why="Pays organizers once the event and its refund window have passed.",
    ),
    ScheduledJob(
        task_name="payments.reconcile_pending",
        # Two minutes, and the interval is doing real work here. A hold lives
        # BOOKING_HOLD_MINUTES (10), so a two-minute tick gets several chances
        # to find a captured payment while the hold is STILL ALIVE — which is
        # the difference between the customer getting their ticket and getting
        # a refund for an event they wanted to attend. Slower than the sweeper
        # would mean routinely losing that race to it.
        interval_seconds=120,
        payload={"limit": 100},
        why=(
            "Asks the provider about bookings holding an unresolved payment order, so a "
            "captured payment is fulfilled (or refunded) even if no webhook and no browser "
            "call ever arrived."
        ),
    ),
    ScheduledJob(
        task_name="notifications.sweep_stuck",
        # Five minutes. A notification stuck between claim and dispatch is a
        # ticket email that never arrived; the customer is at a gate with no QR.
        interval_seconds=300,
        payload={"limit": 200},
        why="Re-enqueues sends claimed but never dispatched.",
    ),
)


def run_due_jobs(now: float, last_run: dict[str, float]) -> list[str]:
    """Enqueue every job whose interval has elapsed. Mutates `last_run`.

    Pure apart from the enqueue and the dict it is handed, so the loop and
    the one-shot command share it and it can be tested without a clock.
    """
    from config.di import task_queue_port

    queue = task_queue_port()
    fired: list[str] = []

    for job in SCHEDULE:
        previous = last_run.get(job.task_name)
        if previous is not None and now - previous < job.interval_seconds:
            continue
        try:
            queue.enqueue(job.task_name, dict(job.payload))
            fired.append(job.task_name)
        except Exception:
            # One broken job must never stop the others — the sweeper failing
            # should not also stop organizers being paid. The next tick retries
            # it, and `last_run` is only advanced on success so a failure is
            # retried immediately rather than after a full interval.
            logger.exception("scheduler.enqueue_failed", extra={"task_name": job.task_name})
            continue
        last_run[job.task_name] = now

    return fired
