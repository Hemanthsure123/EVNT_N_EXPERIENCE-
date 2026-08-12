"""SMS_PROVIDER=disabled: skip the message, never claim it, never pretend.

India's DLT registration takes weeks, so a deployment can be genuinely ready
to take money with no SMS capability. `disabled` is how that is stated. The
distinction these tests protect is between it and `console`:

    console  — a DEV fake. Accepts every message, logs it, returns a plausible
               provider reference. In production the log says `sent` and no
               customer receives an OTP. `core/preflight` refuses to boot on it.
    disabled — reports it CANNOT deliver, so the send is skipped before a row
               is written, and the reduction in service is visible.
"""

from __future__ import annotations

import pytest

from core.adapters.local.console_sms import ConsoleSmsAdapter
from core.adapters.local.disabled_sms import DisabledSmsAdapter, SmsDisabledError

from ..models import NotificationLog, NotificationType
from .conftest import RecordingEmail, make_service

pytestmark = pytest.mark.django_db


def test_the_port_states_whether_it_can_deliver():
    """The seam the whole feature rests on. `console` claiming it is configured
    is correct — it is a real adapter for development — which is precisely why
    production must reject it by NAME rather than by asking it."""
    assert DisabledSmsAdapter().is_configured() is False
    assert ConsoleSmsAdapter().is_configured() is True


def test_an_sms_is_skipped_and_no_log_row_is_claimed():
    """Skipped BEFORE the claim, not after.

    A claimed `pending` row could only ever fail in dispatch, so every
    undeliverable SMS would burn its retries and dead-letter — turning a
    deliberate configuration choice into what looks like a provider outage.
    """
    service = make_service(sms=DisabledSmsAdapter())

    result = service.notify(
        notification_type=NotificationType.BOOKING_CONFIRMATION_SMS,
        recipient="+919000000000",
        context={"booking_reference": "BK-1", "event_title": "Test"},
        dedupe_key="sms-disabled:1",
    )

    assert result is None
    assert not NotificationLog.objects.filter(dedupe_key="sms-disabled:1").exists()


def test_email_still_sends_while_sms_is_disabled():
    """The reason skipping is safe: SMS is never the only channel for anything
    that matters. A booking confirmation is an email AND an SMS, and the email
    carries the ticket."""
    email = RecordingEmail()
    service = make_service(email=email, sms=DisabledSmsAdapter())

    log = service.notify(
        notification_type=NotificationType.WELCOME,
        recipient="rider@example.com",
        context={},
        dedupe_key="welcome-while-sms-off:1",
    )

    assert log is not None
    assert len(email.sent) == 1


def test_sending_directly_raises_rather_than_silently_dropping():
    """Nothing should reach `send()` — `notify` checks first. If something
    does, a caller has bypassed the check, and the honest outcome is a loud
    failure rather than a message discarded while the log reads `sent`."""
    with pytest.raises(SmsDisabledError):
        DisabledSmsAdapter().send(to="+919000000000", message="hi")
