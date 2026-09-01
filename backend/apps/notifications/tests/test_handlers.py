"""Event handlers → notifications, exercised through the REAL wiring (config.di
+ console adapters + the sync task queue), so notify -> dispatch -> console send
runs inline and the NotificationLog lands in `sent`. We assert on those rows —
the module's audit ledger — not on console output."""

from __future__ import annotations

import pytest

from apps.notifications.models import NotificationLog, NotificationStatus, NotificationType

from .conftest import confirm_a_booking


@pytest.fixture
def contexts(monkeypatch) -> list[tuple[str, dict]]:
    """Every `(type, context)` a handler hands to the ONE entry point.

    The receipt facts added for the ticket PDF — the organizer, the issue date,
    the venue link, each line's billed price — reach the reader as an ATTACHMENT
    and never touch `NotificationLog.body`, so the log rows cannot show whether
    the handler gathered them at all. This WRAPS `notify` rather than replacing
    it, so the delivery/dedupe assertions in the rest of this file still run
    through the real service.
    """
    from apps.notifications.services import NotificationService

    recorded: list[tuple[str, dict]] = []
    original = NotificationService.notify

    def spy(self, *, notification_type, recipient, context, dedupe_key, delay_seconds=0):
        recorded.append((notification_type, dict(context)))
        return original(
            self,
            notification_type=notification_type,
            recipient=recipient,
            context=context,
            dedupe_key=dedupe_key,
            delay_seconds=delay_seconds,
        )

    monkeypatch.setattr(NotificationService, "notify", spy)
    return recorded


def _ticket_delivery_context(contexts: list[tuple[str, dict]]) -> dict:
    return next(ctx for kind, ctx in contexts if kind == NotificationType.TICKET_DELIVERY)


def _confirm_and_notify(booking_service, *, buyer, event, tier, quantity=1):
    from apps.notifications import handlers

    result = confirm_a_booking(
        booking_service, buyer=buyer, event=event, tier=tier, quantity=quantity
    )
    handlers.handle_booking_confirmed(
        {
            "booking_id": str(result.booking.id),
            "user_id": str(buyer.id),
            "event_id": str(event.id),
            "ticket_ids": [str(t.id) for t in result.tickets],
        }
    )
    return result


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
def test_booking_confirmed_gathers_the_receipt_facts_the_document_needs(
    booking_service, buyer, event, tier, organization, contexts
):
    """Who is presenting it, when it was issued, and how to get there — none of
    which the log body carries, and all of which a filed receipt is opened for."""
    from apps.booking.models import Booking
    from apps.notifications.templates import format_when

    result = _confirm_and_notify(booking_service, buyer=buyer, event=event, tier=tier, quantity=2)
    ctx = _ticket_delivery_context(contexts)

    assert ctx["organizer_name"] == organization.name
    # `confirm_booking` marks paid and issues the tickets in one transaction, so
    # the booking's own `updated_at` IS the issue instant.
    booking = Booking.objects.get(pk=result.booking.id)
    assert ctx["issued_at"] == format_when(booking.updated_at)
    # Built the same way frontend/lib/api/maps.ts builds it — the event has no
    # coordinates, so it points at the venue text rather than an invented pin.
    assert (
        ctx["maps_url"]
        == "https://www.google.com/maps/search/?api=1&query=Grand%20Arena%2C%20Mumbai"
    )


@pytest.mark.django_db
def test_the_directions_link_prefers_coordinates_when_the_event_has_a_pin(
    booking_service, buyer, event, tier, contexts
):
    """A venue name is ambiguous and a lat/lng is not — but a coordinate is never
    invented, which is why the test above gets the venue text instead."""
    from apps.events.models import Event

    Event.objects.filter(pk=event.id).update(latitude="19.0759837", longitude="72.8776559")

    _confirm_and_notify(booking_service, buyer=buyer, event=event, tier=tier)

    assert _ticket_delivery_context(contexts)["maps_url"] == (
        "https://www.google.com/maps/search/?api=1&query=19.0759837%2C72.8776559"
    )


@pytest.mark.django_db
def test_each_ticket_carries_who_it_admits_and_what_its_line_was_billed(
    booking_service, buyer, event, tier, contexts
):
    """The price comes off the BOOKING ITEM, not the tier: it is what this order
    was actually charged, so a later re-price cannot rewrite a filed invoice."""
    from apps.booking.models import BookingItem, Ticket

    result = confirm_a_booking(booking_service, buyer=buyer, event=event, tier=tier, quantity=2)
    BookingItem.objects.filter(booking_id=result.booking.id).update(phase_name="Early bird")
    Ticket.objects.filter(pk=result.tickets[0].id).update(attendee_name="Asha Rao")

    from apps.notifications import handlers

    handlers.handle_booking_confirmed(
        {
            "booking_id": str(result.booking.id),
            "user_id": str(buyer.id),
            "event_id": str(event.id),
            "ticket_ids": [str(t.id) for t in result.tickets],
        }
    )

    tickets = _ticket_delivery_context(contexts)["tickets"]
    # One named guest and one blank — blank stays blank rather than being
    # filled in with the buyer. NOT asserted positionally: a booking's tickets
    # are written by one `bulk_create`, so every row carries the same
    # `created_at` to the microsecond and only the id tiebreak makes the order
    # stable at all (see `TicketRepository.list_for_booking`). Which of the two
    # sorts first is arbitrary and means nothing.
    assert sorted(t["attendee"] for t in tickets) == ["", "Asha Rao"]
    assert [t["phase_name"] for t in tickets] == ["Early bird", "Early bird"]
    assert [t["unit_price_display"] for t in tickets] == ["₹500.00", "₹500.00"]


@pytest.mark.django_db
def test_the_amount_falls_back_to_the_booking_total_when_no_payment_row_resolves(
    booking_service, buyer, event, tier, contexts
):
    """BOOKING_CONFIRMED means the money moved, so a receipt with no amount on it
    would read as a charge that never happened. The total is the figure the
    booking was reserved at and the one payments amount-checks — not a guess.

    Everything the platform genuinely does not have stays ABSENT: no provider
    reference, no captured-at, no provider status.
    """
    _confirm_and_notify(booking_service, buyer=buyer, event=event, tier=tier, quantity=2)

    payment = _ticket_delivery_context(contexts)["payment"]
    # 2 x ₹500 of tickets plus the 1% now charged on top.
    assert payment["amount_display"] == "₹1010.00"
    # The fee is 1% of the ticket subtotal and IS part of the total above —
    # a receipt that showed the fee beside a total which excluded it would not
    # add up. It used to be 10 paise per ticket, deducted rather than charged.
    assert payment["platform_fee_display"] == "₹10.00"
    assert "reference" not in payment
    assert "paid_at" not in payment
    assert "status_label" not in payment


@pytest.mark.django_db
def test_a_resolved_payment_row_wins_over_the_fallback(
    booking_service, buyer, event, tier, contexts
):
    from apps.payments.models import Payment, PaymentStatus

    result = confirm_a_booking(booking_service, buyer=buyer, event=event, tier=tier)
    Payment.objects.create(
        booking_id=result.booking.id,
        rzp_order_id=result.booking.payment_order_id,
        rzp_payment_id="pay_receipt_1",
        amount_minor=result.booking.total_amount_minor,
        status=PaymentStatus.PAID,
    )

    from apps.notifications import handlers

    handlers.handle_booking_confirmed(
        {
            "booking_id": str(result.booking.id),
            "user_id": str(buyer.id),
            "event_id": str(event.id),
            "ticket_ids": [str(t.id) for t in result.tickets],
        }
    )

    payment = _ticket_delivery_context(contexts)["payment"]
    assert payment["reference"] == "pay_receipt_1"
    assert payment["amount_display"] == "₹505.00"
    assert payment["status_label"]
    assert payment["paid_at"]


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
