from __future__ import annotations

import pytest
from django.db import IntegrityError

from apps.notifications.models import NotificationChannel, NotificationStatus, NotificationType
from apps.notifications.repositories import NotificationLogRepository


@pytest.mark.django_db
def test_claim_is_unique_on_dedupe_key():
    repo = NotificationLogRepository()

    def _claim():
        return repo.claim(
            dedupe_key="k1",
            notification_type=NotificationType.WELCOME,
            channel=NotificationChannel.EMAIL,
            recipient="a@example.com",
            subject="s",
            body="b",
        )

    first = _claim()
    assert first.status == NotificationStatus.PENDING
    # A second claim on the same key collides — the DB backstop behind
    # exactly-once (the service catches this and treats the first as the winner).
    with pytest.raises(IntegrityError):
        _claim()


@pytest.mark.django_db
def test_get_by_dedupe_key_round_trips():
    repo = NotificationLogRepository()
    repo.claim(
        dedupe_key="k2",
        notification_type=NotificationType.OTP,
        channel=NotificationChannel.SMS,
        recipient="+910000000000",
        subject="",
        body="123456 is your code",
    )
    found = repo.get_by_dedupe_key("k2")
    assert found is not None
    assert found.channel == NotificationChannel.SMS
    assert repo.get_by_dedupe_key("missing") is None
