"""Event handlers → notifications, exercised through the REAL wiring (config.di
+ console adapters + the sync task queue), so notify -> dispatch -> console send
runs inline and the NotificationLog lands in `sent`. We assert on those rows —
the module's audit ledger — not on console output."""

from __future__ import annotations

import pytest

from apps.notifications.models import NotificationLog, NotificationStatus, NotificationType

from .conftest import confirm_a_booking


@pytest.mark.django_db
def test_user_registered_sends_a_welcome_email(buyer):
    from apps.notifications import handlers

    handlers.handle_user_registered(
        {"user_id": str(buyer.id), "email": buyer.email, "full_name": buyer.full_name}
    )

    log = NotificationLog.objects.get(type=NotificationType.WELCOME)
    assert log.channel == "email"
    assert log.recipient == buyer.email
    assert log.status == NotificationStatus.SENT
    assert log.provider_ref


@pytest.mark.django_db
def test_booking_confirmed_delivers_ticket_email_with_qr_and_an_sms(
    booking_service, buyer, event, tier
):
    from apps.notifications import handlers

    result = confirm_a_booking(booking_service, buyer=buyer, event=event, tier=tier)
    booking, tickets = result.booking, result.tickets

    handlers.handle_booking_confirmed(
        {
            "booking_id": str(booking.id),
            "user_id": str(buyer.id),
            "event_id": str(event.id),
            "ticket_ids": [str(t.id) for t in tickets],
        }
    )

    # The ticket delivery email — with the event, booking reference and the QR.
    email_log = NotificationLog.objects.get(type=NotificationType.TICKET_DELIVERY)
    assert email_log.status == NotificationStatus.SENT
    assert email_log.recipient == buyer.email
    assert str(booking.id) in email_log.body  # booking reference
    assert tickets[0].qr_token in email_log.body  # the QR
    assert event.title in email_log.subject

    # And the SMS confirmation (buyer has a phone on file).
    sms_log = NotificationLog.objects.get(type=NotificationType.BOOKING_CONFIRMATION_SMS)
    assert sms_log.status == NotificationStatus.SENT
    assert sms_log.recipient == buyer.phone


@pytest.mark.django_db
def test_booking_sms_is_skipped_when_the_buyer_has_no_phone(
    booking_service, organizer, event, tier
):
    from apps.accounts.repositories import UserRepository
    from apps.notifications import handlers

    # A buyer with NO phone on file.
    buyer = UserRepository().create_user(email="nophone@example.com", password="s3cur3pass")
    result = confirm_a_booking(booking_service, buyer=buyer, event=event, tier=tier)

    handlers.handle_booking_confirmed(
        {
            "booking_id": str(result.booking.id),
            "user_id": str(buyer.id),
            "event_id": str(event.id),
            "ticket_ids": [str(t.id) for t in result.tickets],
        }
    )

    # Email delivered; SMS cleanly skipped (no phone -> no claim).
    assert NotificationLog.objects.filter(type=NotificationType.TICKET_DELIVERY).exists()
    assert not NotificationLog.objects.filter(
        type=NotificationType.BOOKING_CONFIRMATION_SMS
    ).exists()


@pytest.mark.django_db
def test_booking_confirmed_delivered_twice_sends_each_message_once(
    booking_service, buyer, event, tier
):
    """The outbox is at-least-once; a duplicate BOOKING_CONFIRMED must not
    double-deliver."""
    from apps.notifications import handlers

    result = confirm_a_booking(booking_service, buyer=buyer, event=event, tier=tier)
    payload = {
        "booking_id": str(result.booking.id),
        "user_id": str(buyer.id),
        "event_id": str(event.id),
        "ticket_ids": [str(t.id) for t in result.tickets],
    }

    handlers.handle_booking_confirmed(payload)
    handlers.handle_booking_confirmed(payload)  # redelivery

    assert NotificationLog.objects.filter(type=NotificationType.TICKET_DELIVERY).count() == 1
    assert (
        NotificationLog.objects.filter(type=NotificationType.BOOKING_CONFIRMATION_SMS).count() == 1
    )


@pytest.mark.django_db
def test_payment_refunded_sends_refund_confirmation(booking_service, buyer, event, tier):
    from apps.notifications import handlers
    from apps.payments.models import Payment, PaymentStatus

    result = confirm_a_booking(booking_service, buyer=buyer, event=event, tier=tier)
    payment = Payment.objects.create(
        booking_id=result.booking.id,
        rzp_order_id=f"order_{result.booking.id}",
        rzp_payment_id="pay_refund_1",
        amount_minor=result.booking.total_amount_minor,
        status=PaymentStatus.REFUNDED,
    )

    handlers.handle_payment_refunded({"payment_id": str(payment.id), "reason": "organizer_refund"})

    email_log = NotificationLog.objects.get(type=NotificationType.REFUND_CONFIRMATION)
    assert email_log.status == NotificationStatus.SENT
    assert email_log.recipient == buyer.email
    assert "₹" in email_log.body  # the refunded amount is shown
    # Buyer has a phone -> refund SMS too.
    assert NotificationLog.objects.filter(type=NotificationType.REFUND_CONFIRMATION_SMS).exists()
