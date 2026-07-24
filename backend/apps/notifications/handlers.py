"""Observers that turn other modules' domain events into notifications.

Wired in apps.py AppConfig.ready(); they run after commit, off the request
path (via the outbox -> event bus). Each handler GATHERS the cross-module
context it needs (user, booking, event, tickets) and calls the ONE entry point,
`NotificationService.notify`, which owns rendering, dedupe, claim and dispatch.

Notifications is the downstream consumer of the money path, so reading booking/
payment/event rows here is a permitted one-way dependency (notifications ->
those modules, never the reverse).
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import NotificationType
from .templates import format_when

logger = logging.getLogger(__name__)


def _amount_display(minor: int) -> str:
    return f"₹{minor / 100:.2f}"


def handle_user_registered(payload: dict) -> None:
    """USER_REGISTERED -> welcome email. (Consolidated here from accounts.)"""
    from config.di import build_notification_service

    email = payload["email"]
    build_notification_service().notify(
        notification_type=NotificationType.WELCOME,
        recipient=email,
        context={"name": payload.get("full_name"), "email": email},
        dedupe_key=f"welcome:{payload['user_id']}:email:{email}",
    )


def handle_booking_confirmed(payload: dict) -> None:
    """BOOKING_CONFIRMED -> the ticket delivery email (event + reference + QR)
    and an SMS confirmation. The most important message in the system."""
    from apps.accounts.repositories import UserRepository
    from apps.booking.repositories import BookingRepository, TicketRepository
    from config.di import build_notification_service

    booking_id = payload["booking_id"]
    user = UserRepository().get_by_id(payload["user_id"])
    booking = BookingRepository().get_detail(booking_id)
    if user is None or booking is None:
        logger.warning("notifications.booking_confirmed.missing", extra={"booking_id": booking_id})
        return

    tickets = [
        {"ticket_type": t.ticket_type.name, "qr_token": t.qr_token}
        for t in TicketRepository().list_for_booking(booking_id)
    ]
    event = booking.event
    reference = str(booking.id)
    service = build_notification_service()

    # The ticket delivery email — event details + booking reference + the QR(s).
    service.notify(
        notification_type=NotificationType.TICKET_DELIVERY,
        recipient=user.email,
        context={
            "name": user.full_name,
            "event_title": event.title,
            "event_when": format_when(event.starts_at),
            "event_where": f"{event.venue}, {event.city}",
            "booking_reference": reference,
            "tickets": tickets,
        },
        dedupe_key=f"ticket_delivery:{booking_id}:email:{user.email}",
    )
    # An SMS confirmation — skipped cleanly if the user has no phone on file.
    service.notify(
        notification_type=NotificationType.BOOKING_CONFIRMATION_SMS,
        recipient=user.phone,
        context={
            "booking_reference": reference,
            "event_title": event.title,
            "ticket_count": len(tickets),
        },
        dedupe_key=f"booking_sms:{booking_id}:sms:{user.phone}",
    )


def handle_payment_refunded(payload: dict) -> None:
    """PAYMENT_REFUNDED -> refund confirmation (email + SMS if a phone is set)."""
    from apps.payments.repositories import PaymentRepository
    from config.di import build_notification_service

    payment_id = payload["payment_id"]
    payment = PaymentRepository().get_with_event_owner(payment_id)
    if payment is None:
        logger.warning("notifications.refund.payment_missing", extra={"payment_id": payment_id})
        return

    booking = payment.booking
    user = booking.user
    context = {
        "name": user.full_name,
        "event_title": booking.event.title,
        "booking_reference": str(booking.id),
        "amount_display": _amount_display(payment.amount_minor),
    }
    service = build_notification_service()
    service.notify(
        notification_type=NotificationType.REFUND_CONFIRMATION,
        recipient=user.email,
        context=context,
        dedupe_key=f"refund:{payment_id}:email:{user.email}",
    )
    service.notify(
        notification_type=NotificationType.REFUND_CONFIRMATION_SMS,
        recipient=user.phone,
        context=context,
        dedupe_key=f"refund_sms:{payment_id}:sms:{user.phone}",
    )


def handle_event_published(payload: dict) -> None:
    """EVENT_PUBLISHED -> SCHEDULE the reminder job for a configurable time
    before the event, via TaskQueuePort (Cloud Tasks fires it near event time
    in prod; the sync dev queue runs it at once, harmlessly, since there are no
    ticket holders yet). The job itself fans out to holders idempotently."""
    from apps.events.repositories import EventRepository
    from apps.notifications.services import EVENT_REMINDER_TASK
    from config.di import task_queue_port

    event = EventRepository().get_active_by_id(payload["event_id"])
    if event is None:
        return
    lead = timedelta(hours=settings.NOTIFICATION_EVENT_REMINDER_HOURS_BEFORE)
    delay = max(0, int((event.starts_at - lead - timezone.now()).total_seconds()))
    task_queue_port().enqueue(EVENT_REMINDER_TASK, {"event_id": str(event.id)}, delay_seconds=delay)
    logger.info(
        "notifications.reminder_scheduled",
        extra={"event_id": str(event.id), "delay_seconds": delay},
    )
