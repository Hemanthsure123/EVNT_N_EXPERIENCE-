from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.models import Booking, BookingStatus, Ticket, TicketStatus
from apps.payments.exceptions import InvalidWebhookSignatureError
from apps.payments.models import Payment, PaymentStatus, ProcessedWebhook, Refund
from apps.payments.tests.conftest import signed_webhook
from core.models import OutboxEvent
from core.ports.payment_port import OrderTransfer


def _captured(booking, *, amount=None, payment_id="pay_test_1"):
    return signed_webhook(
        event="payment.captured",
        order_id=booking.payment_order_id,
        payment_id=payment_id,
        amount_minor=amount if amount is not None else booking.total_amount_minor,
    )


# --- signature: the only source of truth -----------------------------------


@pytest.mark.django_db
def test_valid_signed_webhook_confirms_and_issues_tickets(payment_service, a_booking):
    body, sig = _captured(a_booking)

    outcome = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert outcome.status == "confirmed"
    payment = Payment.objects.get(rzp_order_id=a_booking.payment_order_id)
    assert payment.status == PaymentStatus.PAID
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.PAID
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert OutboxEvent.objects.filter(event_type="payments.payment_confirmed").exists()


@pytest.mark.django_db
def test_badly_signed_webhook_is_rejected_and_does_nothing(payment_service, a_booking):
    body, _good = _captured(a_booking)

    with pytest.raises(InvalidWebhookSignatureError):
        payment_service.handle_webhook(raw_body=body, signature="deadbeefbadsignature")

    # Nothing recorded, nothing confirmed.
    assert Payment.objects.count() == 0
    assert ProcessedWebhook.objects.count() == 0
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED


@pytest.mark.django_db
def test_missing_signature_is_rejected(payment_service, a_booking):
    body, _ = _captured(a_booking)
    with pytest.raises(InvalidWebhookSignatureError):
        payment_service.handle_webhook(raw_body=body, signature="")


# --- idempotency -----------------------------------------------------------


@pytest.mark.django_db
def test_duplicate_webhook_is_processed_once(payment_service, a_booking):
    body, sig = _captured(a_booking)

    first = payment_service.handle_webhook(raw_body=body, signature=sig)
    second = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert first.status == "confirmed"
    assert second.status == "duplicate"
    # Tickets issued exactly once despite two deliveries.
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert ProcessedWebhook.objects.count() == 1


# --- amount tampering ------------------------------------------------------


@pytest.mark.django_db
def test_amount_mismatch_is_not_confirmed_and_schedules_a_refund(
    payment_service, task_queue, a_booking, django_capture_on_commit_callbacks
):
    # Signed correctly, but the captured amount is wrong (tampered / underpaid).
    body, sig = _captured(a_booking, amount=1)

    with django_capture_on_commit_callbacks(execute=True):
        outcome = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert outcome.status == "amount_mismatch"
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED  # NOT confirmed
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    # A refund was scheduled (money never kept without a ticket).
    assert any(name == "payments.process_refund" for name, _ in task_queue.enqueued)


# --- hold expired: money never kept without a ticket -----------------------


@pytest.mark.django_db
def test_hold_expired_does_not_issue_tickets_and_schedules_refund(
    payment_service, task_queue, a_booking, django_capture_on_commit_callbacks
):
    # The hold lapsed before payment arrived.
    Booking.objects.filter(pk=a_booking.id).update(
        hold_expires_at=timezone.now() - timedelta(minutes=1)
    )
    body, sig = _captured(a_booking)

    with django_capture_on_commit_callbacks(execute=True):
        outcome = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert outcome.status == "hold_expired_refunding"
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    refund_tasks = [p for name, p in task_queue.enqueued if name == "payments.process_refund"]
    assert len(refund_tasks) == 1


# --- failed payment --------------------------------------------------------


@pytest.mark.django_db
def test_failed_webhook_marks_payment_failed(payment_service, a_booking):
    body, sig = signed_webhook(
        event="payment.failed",
        order_id=a_booking.payment_order_id,
        payment_id="pay_failed_1",
        amount_minor=a_booking.total_amount_minor,
    )

    outcome = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert outcome.status == "failed"
    payment = Payment.objects.get(rzp_order_id=a_booking.payment_order_id)
    assert payment.status == PaymentStatus.FAILED
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    assert OutboxEvent.objects.filter(event_type="payments.payment_failed").exists()


# --- the Route split -------------------------------------------------------


@pytest.mark.django_db
def test_create_order_carries_the_route_split(a_booking, fake_payment):
    # a_booking was created through booking_service using this fake adapter, so
    # the recorded order shows the split: organizer share on hold, fee retained.
    order = fake_payment.orders[a_booking.payment_order_id]
    transfers = order["transfers"]

    assert len(transfers) == 1
    transfer = transfers[0]
    assert isinstance(transfer, OrderTransfer)
    assert transfer.account_id == "fake_linked_account_test"
    # organizer share = total (100000) - platform fee (20)
    assert transfer.amount_minor == a_booking.total_amount_minor - a_booking.platform_fee_minor
    assert transfer.amount_minor == 99980
    assert transfer.on_hold is True  # held until settlements releases it after the event


# --- refunds ---------------------------------------------------------------


def _make_paid_payment(booking) -> Payment:
    return Payment.objects.create(
        booking_id=booking.id,
        rzp_order_id=booking.payment_order_id,
        rzp_payment_id="pay_paid_1",
        amount_minor=booking.total_amount_minor,
        status=PaymentStatus.PAID,
    )


@pytest.mark.django_db
def test_refund_is_idempotent_never_double_refunds(payment_service, fake_payment, a_booking):
    payment = _make_paid_payment(a_booking)

    first = payment_service.execute_refund(payment_id=payment.id, reason="hold_expired")
    second = payment_service.execute_refund(payment_id=payment.id, reason="hold_expired")

    assert first is True
    assert second is False  # already refunded — no-op
    payment.refresh_from_db()
    assert payment.status == PaymentStatus.REFUNDED
    # Exactly one refund recorded, and the vendor was asked once (same idem key).
    assert Refund.objects.filter(payment_id=payment.id).count() == 1
    assert len(fake_payment.refunds_by_key) == 1
    assert OutboxEvent.objects.filter(event_type="payments.payment_refunded").exists()


@pytest.mark.django_db
def test_refund_voids_the_bookings_tickets(payment_service, booking_service, a_booking):
    # Confirm the booking so real tickets are issued, then refund it.
    result = booking_service.confirm_booking(booking_id=a_booking.id, payment_ref="pay_paid_1")
    assert result.issued is True
    assert Ticket.objects.filter(booking_id=a_booking.id, status=TicketStatus.ACTIVE).count() == 2

    payment = _make_paid_payment(a_booking)
    assert payment_service.execute_refund(payment_id=payment.id, reason="organizer_refund") is True

    # A refunded ticket can't enter the gate: every active ticket is now void
    # (checkin then denies by status — defense in depth).
    assert Ticket.objects.filter(booking_id=a_booking.id, status=TicketStatus.ACTIVE).count() == 0
    assert Ticket.objects.filter(booking_id=a_booking.id, status=TicketStatus.VOID).count() == 2


@pytest.mark.django_db
def test_refund_no_ops_on_a_non_paid_payment(payment_service, a_booking):
    payment = Payment.objects.create(
        booking_id=a_booking.id,
        rzp_order_id=a_booking.payment_order_id,
        rzp_payment_id="pay_failed",
        amount_minor=a_booking.total_amount_minor,
        status=PaymentStatus.FAILED,
    )

    assert payment_service.execute_refund(payment_id=payment.id, reason="x") is False
    assert Refund.objects.count() == 0
