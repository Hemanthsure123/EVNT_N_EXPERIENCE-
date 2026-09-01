"""Changing the donation on a live hold.

The rule this file exists to hold down: **a donation is not inventory**. It
arrives after the tickets are already reserved, so something has to move the
amount — and the tempting way to do that (cancel, then re-reserve with the new
number) would put a live hold through a release-and-reserve cycle over a
decision that has nothing to do with stock. The tier could be gone by the time
the second reserve ran, so choosing to give ₹15 could cost somebody their seats.
"""

from __future__ import annotations

import pytest

from apps.booking.exceptions import (
    BookingNotCancellableError,
    InvalidBookingItemsError,
    NotBookingOwnerError,
)
from apps.booking.models import BookingStatus
from apps.ticketing.repositories import TicketTypeRepository


def _reserved(tier_id) -> int:
    tier = TicketTypeRepository().get_active_by_id(tier_id)
    assert tier is not None
    return tier.reserved


@pytest.fixture
def held(booking_service, event, buyer, make_tier):
    tier = make_tier(price_minor=50_000, quantity=10)
    booking = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    ).booking
    return booking, tier


@pytest.mark.django_db
def test_setting_a_donation_raises_the_total_and_nothing_else(booking_service, buyer, held):
    booking, _ = held
    before_fee = booking.platform_fee_minor

    updated = booking_service.set_donation(
        booking_id=booking.id, actor_id=buyer.id, donation_minor=1_500
    )

    assert updated.donation_amount_minor == 1_500
    assert updated.total_amount_minor == 101_000 + 1_500
    # The tickets and the fee charged on them are untouched: this changed what
    # somebody chose to give, not what they bought.
    assert updated.platform_fee_minor == before_fee


@pytest.mark.django_db
def test_it_does_not_touch_the_reservation(booking_service, buyer, held):
    """The assertion this file is really for. Two seats were held before; two
    seats are held after, without ever passing through zero."""
    booking, tier = held
    assert _reserved(tier.id) == 2

    booking_service.set_donation(booking_id=booking.id, actor_id=buyer.id, donation_minor=1_500)

    assert _reserved(tier.id) == 2


@pytest.mark.django_db
def test_the_payment_order_is_re_issued_for_the_new_amount(booking_service, buyer, held):
    """`total_amount_minor` is both the number the order is created for and the
    number the webhook amount-checks against. A stale order would guarantee a
    mismatch — the customer pays the old amount, the check refuses it, and they
    are auto-refunded a payment that was in every other sense fine."""
    booking, _ = held
    original_order = booking.payment_order_id
    assert original_order

    updated = booking_service.set_donation(
        booking_id=booking.id, actor_id=buyer.id, donation_minor=1_500
    )

    assert updated.payment_order_id
    assert updated.payment_order_id != original_order


@pytest.mark.django_db
def test_setting_the_same_amount_twice_churns_nothing(booking_service, buyer, held):
    """A no-op must not issue a new order. The review screen writes on every
    change of a chip, and a control that re-creates a payment order when nothing
    changed is one stray re-render away from a stream of abandoned orders."""
    booking, _ = held
    first = booking_service.set_donation(
        booking_id=booking.id, actor_id=buyer.id, donation_minor=1_500
    )
    again = booking_service.set_donation(
        booking_id=booking.id, actor_id=buyer.id, donation_minor=1_500
    )

    assert again.payment_order_id == first.payment_order_id


@pytest.mark.django_db
def test_clearing_it_returns_the_total_to_the_tickets_and_fee(booking_service, buyer, held):
    booking, _ = held
    booking_service.set_donation(booking_id=booking.id, actor_id=buyer.id, donation_minor=1_500)

    cleared = booking_service.set_donation(
        booking_id=booking.id, actor_id=buyer.id, donation_minor=0
    )

    assert cleared.donation_amount_minor == 0
    assert cleared.total_amount_minor == 101_000


@pytest.mark.django_db
def test_it_is_bounded(booking_service, buyer, held):
    booking, _ = held
    with pytest.raises(InvalidBookingItemsError):
        booking_service.set_donation(
            booking_id=booking.id, actor_id=buyer.id, donation_minor=100_001
        )


@pytest.mark.django_db
def test_only_the_owner_may_change_it(booking_service, held, organizer):
    booking, _ = held
    with pytest.raises(NotBookingOwnerError):
        booking_service.set_donation(
            booking_id=booking.id, actor_id=organizer.id, donation_minor=500
        )


@pytest.mark.django_db
def test_a_paid_booking_refuses(booking_service, buyer, held):
    """Once money has moved the amount is settled. Letting a donation be added
    afterwards would change a total the payment has already been checked
    against."""
    booking, _ = held
    booking_service.confirm_booking(booking_id=booking.id, payment_ref="pay_test")

    with pytest.raises(BookingNotCancellableError):
        booking_service.set_donation(booking_id=booking.id, actor_id=buyer.id, donation_minor=500)


@pytest.mark.django_db
def test_a_cancelled_booking_refuses(booking_service, buyer, held):
    booking, _ = held
    booking_service.cancel_booking(booking_id=booking.id, actor_id=buyer.id)
    booking.refresh_from_db()
    assert booking.status == BookingStatus.CANCELLED

    with pytest.raises(BookingNotCancellableError):
        booking_service.set_donation(booking_id=booking.id, actor_id=buyer.id, donation_minor=500)
