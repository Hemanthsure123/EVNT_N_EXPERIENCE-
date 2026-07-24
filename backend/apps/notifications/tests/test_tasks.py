"""The scheduled event reminder fans out to current ticket holders,
idempotently."""

from __future__ import annotations

import pytest

from apps.accounts.repositories import UserRepository
from apps.booking.repositories import TicketRepository
from apps.events.repositories import EventRepository
from apps.notifications.models import NotificationLog, NotificationType
from apps.notifications.services import ReminderService

from .conftest import confirm_a_booking


def _reminder_service(notification_service) -> ReminderService:
    return ReminderService(
        notifications=notification_service,
        tickets=TicketRepository(),
        users=UserRepository(),
        events=EventRepository(),
    )


@pytest.mark.django_db
def test_reminder_sends_to_every_ticket_holder_once(
    inline_service, booking_service, buyer, event, tier
):
    service, email, _sms = inline_service
    # Two holders for the event.
    confirm_a_booking(booking_service, buyer=buyer, event=event, tier=tier)
    buyer2 = UserRepository().create_user(email="holder2@example.com", password="s3cur3pass")
    confirm_a_booking(booking_service, buyer=buyer2, event=event, tier=tier)

    reminders = _reminder_service(service)
    sent = reminders.send_event_reminders(event.id)

    assert sent == 2
    logs = NotificationLog.objects.filter(type=NotificationType.EVENT_REMINDER)
    assert logs.count() == 2
    assert {log.recipient for log in logs} == {buyer.email, buyer2.email}
    assert len(email.sent) == 2

    # Re-running the job is idempotent — no duplicate reminders.
    again = reminders.send_event_reminders(event.id)
    assert again == 2  # attempted (per holder) ...
    assert NotificationLog.objects.filter(type=NotificationType.EVENT_REMINDER).count() == 2
    assert len(email.sent) == 2  # ... but nothing sent twice


@pytest.mark.django_db
def test_reminder_is_a_noop_for_an_event_with_no_holders(inline_service, event):
    service, email, _sms = inline_service
    reminders = _reminder_service(service)

    assert reminders.send_event_reminders(event.id) == 0
    assert len(email.sent) == 0
