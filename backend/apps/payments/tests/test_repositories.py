from __future__ import annotations

import pytest

from apps.payments.models import PaymentStatus
from apps.payments.repositories import PaymentRepository, ProcessedWebhookRepository


@pytest.mark.django_db
def test_record_captured_is_an_upsert_keyed_on_order_id(a_booking):
    repo = PaymentRepository()

    first = repo.record_captured(
        booking_id=a_booking.id,
        rzp_order_id=a_booking.payment_order_id,
        rzp_payment_id="pay_1",
        amount_minor=a_booking.total_amount_minor,
    )
    again = repo.record_captured(
        booking_id=a_booking.id,
        rzp_order_id=a_booking.payment_order_id,
        rzp_payment_id="pay_1",
        amount_minor=a_booking.total_amount_minor,
    )

    assert first.id == again.id  # same order id -> same payment row
    assert first.status == PaymentStatus.PAID


@pytest.mark.django_db
def test_processed_webhook_dedupe(a_booking):
    repo = ProcessedWebhookRepository()

    assert repo.exists("payment.captured:pay_1") is False
    repo.create(dedupe_key="payment.captured:pay_1")
    assert repo.exists("payment.captured:pay_1") is True


@pytest.mark.django_db
def test_get_with_event_owner_loads_the_chain_in_one_query(a_booking, django_assert_num_queries):
    from apps.payments.models import Payment

    payment = Payment.objects.create(
        booking_id=a_booking.id,
        rzp_order_id=a_booking.payment_order_id,
        rzp_payment_id="pay_1",
        amount_minor=a_booking.total_amount_minor,
        status=PaymentStatus.PAID,
    )
    repo = PaymentRepository()

    with django_assert_num_queries(1):
        loaded = repo.get_with_event_owner(payment.id)
        assert loaded is not None
        # Touch the joined chain — must not fire extra queries.
        _ = (loaded.booking.user_id, loaded.booking.event.organization.owner_id)

    assert loaded.id == payment.id
