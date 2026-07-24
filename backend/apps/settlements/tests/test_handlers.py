"""Running-total handlers (fed by the money path's events) and the end-to-end
PayoutReleased -> organizer notification integration."""

from __future__ import annotations

import pytest

from apps.payments.models import Payment, PaymentStatus
from apps.settlements.models import SettlementStatus
from apps.settlements.repositories import SettlementRepository

from .conftest import book_and_pay


def _paid_payment(booking) -> Payment:
    return Payment.objects.create(
        booking_id=booking.id,
        rzp_order_id=f"order_{booking.id}",
        rzp_payment_id=f"pay_{booking.id}",
        amount_minor=booking.total_amount_minor,
        status=PaymentStatus.PAID,
    )


@pytest.mark.django_db
def test_payment_confirmed_handler_builds_the_settlement_totals(
    booking_service, buyer, finished_event, tier_for
):
    from apps.settlements import handlers

    tier = tier_for(finished_event)
    booking = booking_service.create_booking(
        user_id=buyer.id,
        event_id=finished_event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 2}],
    ).booking
    booking_service.confirm_booking(booking_id=booking.id, payment_ref="pay_x")
    payment = _paid_payment(booking)

    handlers.handle_payment_confirmed(
        {"payment_id": str(payment.id), "booking_id": str(booking.id)}
    )

    s = SettlementRepository().get_by_event(finished_event.id)
    assert s is not None
    assert s.gross == booking.total_amount_minor  # 2 x 50000
    assert s.platform_fee == booking.platform_fee_minor  # 2 x 10
    assert s.net == s.gross - s.platform_fee
    assert s.releasable_at is not None  # stamped for the release job


@pytest.mark.django_db
def test_payout_released_notifies_the_organizer_end_to_end(
    settlement_service,
    booking_service,
    buyer,
    organizer,
    finished_event,
    tier_for,
    django_capture_on_commit_callbacks,
):
    """release -> PayoutReleased (outbox) -> notifications -> organizer email.
    The whole chain runs through the real event bus + notifications wiring."""
    from apps.notifications.models import NotificationLog, NotificationType

    tier = tier_for(finished_event)
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier)
    s = SettlementRepository().get_by_event(finished_event.id)
    assert s is not None

    with django_capture_on_commit_callbacks(execute=True):
        settlement_service.release_payout(s.id)

    # The outbox drained on commit -> notifications sent the organizer a payout
    # confirmation to their account email.
    log = NotificationLog.objects.get(type=NotificationType.PAYOUT_RELEASED)
    assert log.recipient == organizer.email
    assert log.status == "sent"
    assert "₹" in log.body  # the payout amount is shown


@pytest.mark.django_db
def test_payment_refunded_handler_reduces_net(
    settlement_service, booking_service, buyer, finished_event, tier_for
):
    from apps.payments.models import Refund
    from apps.settlements import handlers

    tier = tier_for(finished_event)
    payment = book_and_pay(
        booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier
    )
    Payment.objects.filter(pk=payment.id).update(status=PaymentStatus.REFUNDED)
    Refund.objects.create(
        payment_id=payment.id, rzp_refund_id="r1", amount_minor=payment.amount_minor, reason="x"
    )

    handlers.handle_payment_refunded({"payment_id": str(payment.id), "reason": "x"})

    s = SettlementRepository().get_by_event(finished_event.id)
    assert s is not None
    assert s.refunds == payment.amount_minor
    assert s.net == s.gross - s.platform_fee - s.refunds
    assert s.status == SettlementStatus.PENDING
