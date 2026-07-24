"""NotificationService: the exactly-once + reliability core, tested with fake
adapters (never through config.di — per the testing conventions)."""

from __future__ import annotations

import pytest

from apps.notifications.exceptions import TemplateMissingError
from apps.notifications.models import NotificationLog, NotificationStatus, NotificationType
from apps.notifications.services import DISPATCH_TASK

from .conftest import FailingEmail, InlineQueue, RecordingEmail, RecordingQueue, make_service


@pytest.mark.django_db
def test_notify_renders_claims_and_enqueues_a_dispatch(inline_service):
    service, email, _sms = inline_service

    log = service.notify(
        notification_type=NotificationType.WELCOME,
        recipient="alice@example.com",
        context={"name": "Alice", "email": "alice@example.com"},
        dedupe_key="welcome:u1:email:alice@example.com",
    )

    assert log is not None
    log.refresh_from_db()
    assert log.status == NotificationStatus.SENT
    assert log.provider_ref.startswith("email-ref-")
    assert log.sent_at is not None
    # Rendered once, sent once, through the email channel.
    assert len(email.sent) == 1
    assert email.sent[0]["to"] == "alice@example.com"
    assert "your account is ready" in email.sent[0]["body"]


@pytest.mark.django_db
def test_same_event_delivered_twice_sends_exactly_once(inline_service):
    """Idempotency: a duplicate event (same dedupe_key) never double-sends."""
    service, email, _sms = inline_service
    key = "welcome:u1:email:alice@example.com"
    ctx = {"name": "Alice", "email": "alice@example.com"}

    first = service.notify(
        notification_type=NotificationType.WELCOME,
        recipient="alice@example.com",
        context=ctx,
        dedupe_key=key,
    )
    second = service.notify(
        notification_type=NotificationType.WELCOME,
        recipient="alice@example.com",
        context=ctx,
        dedupe_key=key,
    )

    assert first is not None and second is not None
    assert first.id == second.id  # same claim returned
    assert len(email.sent) == 1  # exactly one send
    assert NotificationLog.objects.count() == 1


@pytest.mark.django_db
def test_dispatch_is_idempotent_a_second_delivery_does_not_resend(inline_service):
    """A redelivered dispatch task (Cloud Tasks is at-least-once) re-runs
    dispatch on an already-SENT log — it must be a no-op."""
    service, email, _sms = inline_service
    log = service.notify(
        notification_type=NotificationType.WELCOME,
        recipient="a@example.com",
        context={"name": "A", "email": "a@example.com"},
        dedupe_key="welcome:u2:email:a@example.com",
    )
    assert log is not None and len(email.sent) == 1

    service.dispatch(log.id)  # redelivery

    assert len(email.sent) == 1  # still one — never resent


@pytest.mark.django_db
def test_no_recipient_is_a_clean_skip_not_a_send(inline_service):
    """An SMS to a user with no phone: notify returns None, nothing claimed."""
    service, _email, sms = inline_service

    result = service.notify(
        notification_type=NotificationType.BOOKING_CONFIRMATION_SMS,
        recipient="",
        context={"booking_reference": "b1", "event_title": "X", "ticket_count": 1},
        dedupe_key="booking_sms:b1:sms:",
    )

    assert result is None
    assert len(sms.sent) == 0
    assert NotificationLog.objects.count() == 0


@pytest.mark.django_db
def test_failed_send_retries_then_dead_letters():
    """A send that keeps failing retries up to max_attempts, then dead-letters
    (status=failed, recorded) — never silently lost."""
    email = FailingEmail()
    queue = InlineQueue()
    service = make_service(email=email, queue=queue, max_attempts=3, retry_backoff_seconds=1)
    queue.service = service

    log = service.notify(
        notification_type=NotificationType.WELCOME,
        recipient="fail@example.com",
        context={"name": "F", "email": "fail@example.com"},
        dedupe_key="welcome:u3:email:fail@example.com",
    )

    assert log is not None
    log.refresh_from_db()
    assert log.status == NotificationStatus.FAILED  # dead-lettered
    assert log.attempts == 3  # exhausted
    assert email.calls == 3  # tried the provider each attempt
    assert log.error  # the failure was recorded


@pytest.mark.django_db
def test_missing_template_raises_clearly():
    """A type with no template raises TemplateMissingError — never a silent
    no-send. (Forced by rendering an unmapped type via a stripped registry.)"""
    from apps.notifications import templates

    service = make_service()
    original = dict(templates._TEMPLATES)
    templates._TEMPLATES.pop(NotificationType.WELCOME, None)
    try:
        with pytest.raises(TemplateMissingError):
            service.notify(
                notification_type=NotificationType.WELCOME,
                recipient="a@example.com",
                context={"email": "a@example.com"},
                dedupe_key="welcome:u4:email:a@example.com",
            )
    finally:
        templates._TEMPLATES.clear()
        templates._TEMPLATES.update(original)
    # Nothing was claimed — the failure happened before the claim.
    assert NotificationLog.objects.count() == 0


@pytest.mark.django_db
def test_otp_sms_uses_the_dlt_template_mapping(inline_service, settings):
    settings.NOTIFICATION_SMS_DLT_TEMPLATE_IDS = {NotificationType.OTP: "tmpl_otp_123"}
    service, _email, sms = inline_service

    service.notify(
        notification_type=NotificationType.OTP,
        recipient="+919000000009",
        context={"code": "482913", "ttl_minutes": 5},
        dedupe_key="otp:+919000000009:nonce1",
    )

    assert len(sms.sent) == 1
    assert sms.sent[0]["dlt_template_id"] == "tmpl_otp_123"
    assert "482913" in sms.sent[0]["message"]


@pytest.mark.django_db
def test_otp_dispatches_promptly_with_zero_delay():
    """OTP is time-sensitive: notify enqueues its dispatch with delay 0 (the
    prompt/fast path), not the slow polling worker."""
    queue = RecordingQueue()
    service = make_service(email=RecordingEmail(), queue=queue)

    service.notify(
        notification_type=NotificationType.OTP,
        recipient="+919000000009",
        context={"code": "111111", "ttl_minutes": 5},
        dedupe_key="otp:+919000000009:nonce2",
    )

    assert queue.enqueued[0][0] == DISPATCH_TASK
    assert queue.enqueued[0][2] == 0  # delay_seconds == 0 (prompt)
