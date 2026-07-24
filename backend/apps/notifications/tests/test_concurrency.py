"""Two workers dispatching the SAME claimed notification must send it exactly
once — the claim-before-send row lock in action.

`transaction=True` gives each thread a real committed transaction so the
`SELECT ... FOR UPDATE` on the log row is exercised for real (the default
`django_db` runs everything on one connection as savepoints and can't reproduce
genuine concurrency).
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection

from apps.notifications.models import NotificationLog, NotificationStatus, NotificationType

from .conftest import RecordingEmail, RecordingQueue, make_service


def _run_concurrently(fn, n: int) -> list:
    def worker(i: int):
        try:
            return fn(i)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=n) as executor:
        return list(executor.map(worker, range(n)))


@pytest.mark.django_db(transaction=True)
def test_two_dispatchers_of_one_notification_send_exactly_once():
    email = RecordingEmail()
    # A recording queue so notify() only CLAIMS (no inline dispatch); the test
    # drives the two competing dispatches itself.
    service = make_service(email=email, queue=RecordingQueue())

    log = service.notify(
        notification_type=NotificationType.WELCOME,
        recipient="race@example.com",
        context={"name": "Race", "email": "race@example.com"},
        dedupe_key="welcome:race:email:race@example.com",
    )
    assert log is not None

    _run_concurrently(lambda _i: service.dispatch(log.id), 2)

    log.refresh_from_db()
    assert log.status == NotificationStatus.SENT
    assert len(email.sent) == 1  # exactly one send, never two
    assert NotificationLog.objects.count() == 1
