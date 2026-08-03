"""The clock.

`booking.release_expired` and `settlements.release_due` were registered,
tested and documented as "scheduler-fired in prod" — and nothing fired them.
The consequence was not subtle: held inventory would never be released, and
organizers would never be paid.

These tests assert the schedule is real, that the intervals hold, and that
one broken job cannot stop the others.
"""

from __future__ import annotations

import pytest

from core import scheduling
from core.scheduling import SCHEDULE, run_due_jobs


class _RecordingQueue:
    def __init__(self, *, failing: set[str] | None = None) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._failing = failing or set()

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        if task_name in self._failing:
            raise RuntimeError("queue unavailable")
        self.calls.append((task_name, payload))
        return "task-id"


@pytest.fixture
def queue(monkeypatch):
    recorder = _RecordingQueue()
    monkeypatch.setattr("config.di.task_queue_port", lambda: recorder)
    return recorder


def test_the_two_jobs_that_were_never_fired_are_on_the_schedule():
    """The whole point. If either drops off this list, inventory leaks or
    organizers stop being paid, and nothing else in the system notices."""
    names = {job.task_name for job in SCHEDULE}
    assert "booking.release_expired" in names
    assert "settlements.release_due" in names


def test_every_scheduled_job_has_a_registered_handler():
    """A name that does not resolve enqueues fine and fails invisibly at
    delivery — which is precisely the failure this module exists to end."""
    import apps.booking.tasks  # noqa: F401
    import apps.notifications.tasks  # noqa: F401
    import apps.settlements.tasks  # noqa: F401
    from core.tasks import _registry

    for job in SCHEDULE:
        assert job.task_name in _registry, f"{job.task_name} has no handler"


def test_every_job_explains_why_it_exists():
    # A schedule entry with no stated reason is one nobody can safely change.
    for job in SCHEDULE:
        assert job.why.strip()
        assert job.interval_seconds > 0


class TestIntervals:
    def test_the_hold_sweeper_runs_at_least_once_a_minute(self):
        # Slower than this and a customer watching "2 left" waits noticeably
        # longer than they should for a lapsed hold to come back.
        job = next(j for j in SCHEDULE if j.task_name == "booking.release_expired")
        assert job.interval_seconds <= 60

    def test_the_payout_scan_is_not_run_more_than_hourly(self):
        # Eligibility is already gated on the event ending plus a refund
        # window, so a tighter loop scans the whole table for nothing.
        job = next(j for j in SCHEDULE if j.task_name == "settlements.release_due")
        assert job.interval_seconds >= 3600


class TestDueLogic:
    def test_an_empty_history_fires_everything(self, queue):
        fired = run_due_jobs(1000.0, {})
        assert set(fired) == {job.task_name for job in SCHEDULE}
        assert len(queue.calls) == len(SCHEDULE)

    def test_a_job_is_not_refired_inside_its_interval(self, queue):
        last_run: dict[str, float] = {}
        run_due_jobs(1000.0, last_run)
        queue.calls.clear()

        run_due_jobs(1001.0, last_run)  # one second later
        assert queue.calls == []

    def test_a_job_fires_again_once_its_interval_elapses(self, queue):
        last_run: dict[str, float] = {}
        run_due_jobs(1000.0, last_run)
        queue.calls.clear()

        # 61s: past the sweeper's minute, nowhere near the hourly payout scan.
        fired = run_due_jobs(1061.0, last_run)
        assert fired == ["booking.release_expired"]

    def test_each_job_keeps_its_own_clock(self, queue):
        last_run: dict[str, float] = {}
        run_due_jobs(1000.0, last_run)
        run_due_jobs(1400.0, last_run)  # sweeper + notifications due, payout not

        assert last_run["booking.release_expired"] == 1400.0
        assert last_run["settlements.release_due"] == 1000.0


class TestFailureIsolation:
    def test_one_failing_job_does_not_stop_the_others(self, monkeypatch):
        """The sweeper failing must not also stop organizers being paid."""
        recorder = _RecordingQueue(failing={"booking.release_expired"})
        monkeypatch.setattr("config.di.task_queue_port", lambda: recorder)

        fired = run_due_jobs(1000.0, {})
        assert "booking.release_expired" not in fired
        assert "settlements.release_due" in fired

    def test_a_failed_enqueue_is_retried_on_the_next_tick(self, monkeypatch):
        # `last_run` advances only on success, so a failure is retried
        # immediately rather than after a full interval — an hour of not
        # paying anybody because one enqueue timed out would be absurd.
        recorder = _RecordingQueue(failing={"settlements.release_due"})
        monkeypatch.setattr("config.di.task_queue_port", lambda: recorder)

        last_run: dict[str, float] = {}
        run_due_jobs(1000.0, last_run)
        assert "settlements.release_due" not in last_run

        recorder._failing.clear()
        fired = run_due_jobs(1001.0, last_run)
        assert "settlements.release_due" in fired


def test_the_module_exposes_the_schedule_for_the_command(monkeypatch):
    # `manage.py run_scheduled_jobs --list` reads this; a schedule that lives
    # only in a Cloud Scheduler console is invisible in review and untested.
    assert scheduling.SCHEDULE is SCHEDULE
    assert len(SCHEDULE) >= 3
