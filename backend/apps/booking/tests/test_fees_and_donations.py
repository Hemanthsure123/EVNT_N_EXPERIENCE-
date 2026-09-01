"""The two amounts a customer is charged on top of the tickets.

The platform fee and the donation reach the same place — `total_amount_minor`,
the number a card is actually debited for — by different rules, and both are
excluded from the organizer's payout for different reasons. That combination is
easy to get subtly wrong in a way no arithmetic check would notice: fold the
donation into the fee and every total still balances while the organizer is
quietly paid the charity's money.

So these tests assert WHERE money ends up, not only that the sums add up.
"""

from __future__ import annotations

import pytest

from apps.booking.exceptions import InvalidBookingItemsError
from apps.booking.models import BookingStatus

# --- the fee is a percentage, added on top ---------------------------------


@pytest.mark.django_db
def test_the_fee_is_one_percent_of_the_ticket_subtotal_and_is_added(
    booking_service, event, buyer, make_tier
):
    tier = make_tier(price_minor=50_000, quantity=10)

    booking = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    ).booking

    assert booking.platform_fee_minor == 1_000  # 1% of 100000
    assert booking.total_amount_minor == 101_000  # and the customer pays it


@pytest.mark.django_db
def test_the_fee_rounds_half_up_in_whole_paise(booking_service, event, buyer, make_tier):
    """A price whose 1% lands on half a paise must not produce a fractional
    charge. `subtotal * bps / 10000` as a float is where a binary rounding error
    would reach an amount somebody is billed; the integer form rounds half up."""
    tier = make_tier(price_minor=1_050, quantity=10)  # 1% = 10.5 paise

    booking = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    ).booking

    assert booking.platform_fee_minor == 11
    assert booking.total_amount_minor == 1_061
    assert isinstance(booking.platform_fee_minor, int)


@pytest.mark.django_db
def test_a_free_ticket_carries_no_fee(booking_service, event, buyer, make_tier):
    """1% of nothing is nothing. A free event must not acquire a charge, which
    is the whole reason the fee is a percentage rather than a flat amount."""
    tier = make_tier(price_minor=0, quantity=10)

    booking = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 3}]
    ).booking

    assert booking.platform_fee_minor == 0
    assert booking.total_amount_minor == 0


# --- the donation ----------------------------------------------------------


@pytest.mark.django_db
def test_a_donation_is_recorded_and_charged(booking_service, event, buyer, make_tier):
    tier = make_tier(price_minor=50_000, quantity=10)

    booking = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 1}],
        donation_minor=1_500,
    ).booking

    assert booking.donation_amount_minor == 1_500
    # 50000 tickets + 500 fee + 1500 donation.
    assert booking.total_amount_minor == 52_000


@pytest.mark.django_db
def test_the_platform_does_not_take_a_cut_of_a_donation(booking_service, event, buyer, make_tier):
    """The fee is computed on the TICKET subtotal. Charging a percentage of
    somebody's charity contribution would be indefensible, and it is the kind of
    thing that happens by accident when a fee is computed from the total."""
    tier = make_tier(price_minor=50_000, quantity=10)

    with_donation = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 1}],
        donation_minor=10_000,
    ).booking
    without = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 1}],
    ).booking

    assert with_donation.platform_fee_minor == without.platform_fee_minor == 500


@pytest.mark.django_db
def test_a_donation_is_bounded(booking_service, event, buyer, make_tier):
    """The amount arrives from the client, so this is the only thing between a
    chip on a checkout screen and an arbitrary charge. Rejected, not clamped:
    silently billing a different number than the one requested is worse."""
    tier = make_tier(price_minor=50_000, quantity=10)

    with pytest.raises(InvalidBookingItemsError):
        booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": tier.id, "quantity": 1}],
            donation_minor=100_001,
        )


@pytest.mark.django_db
def test_a_rejected_donation_reserves_nothing(booking_service, event, buyer, make_tier):
    """The donation is validated BEFORE any inventory is touched. Validating it
    afterwards would leave a tier holding reserved seats for a booking that was
    never created."""
    tier = make_tier(price_minor=50_000, quantity=10)

    with pytest.raises(InvalidBookingItemsError):
        booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": tier.id, "quantity": 2}],
            donation_minor=-1,
        )

    from apps.ticketing.repositories import TicketTypeRepository

    refreshed = TicketTypeRepository().get_active_by_id(tier.id)
    assert refreshed is not None
    assert refreshed.reserved == 0


# --- who ends up with the money -------------------------------------------


@pytest.mark.django_db
def test_the_organizer_receives_the_ticket_subtotal_and_nothing_else(
    booking_service, event, buyer, make_tier
):
    """The Route transfer is the organizer's money leaving our control, so this
    is the assertion that matters most in this file. Fee and donation both come
    out; what remains is exactly what the tickets cost.
    """
    organization = event.organization
    organization.payout_account_id = "acc_test_organizer"
    organization.save(update_fields=["payout_account_id"])
    tier = make_tier(price_minor=50_000, quantity=10)

    booking = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 2}],
        donation_minor=1_500,
    ).booking

    transfers = booking_service._build_transfers(booking)
    assert transfers is not None
    (transfer,) = transfers
    assert transfer.account_id == "acc_test_organizer"
    assert transfer.amount_minor == 100_000  # not 101000, and not 102500
    assert transfer.on_hold is True


# --- what comes back on a refund ------------------------------------------


@pytest.mark.django_db
def test_a_refunded_ticket_does_not_return_the_donation(booking_service, event, buyer, make_tier):
    """A donation is given, not paid for. Refunding the ticket returns the
    ticket price and the fee charged on it, and leaves the gift alone."""
    tier = make_tier(price_minor=50_000, quantity=10)
    booking = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 1}],
        donation_minor=1_500,
    ).booking
    booking_service.confirm_booking(booking_id=booking.id, payment_ref="pay_test")

    assert booking_service.refundable_amount_minor(booking_id=booking.id) == 50_500


@pytest.mark.django_db
def test_a_booking_that_delivered_nothing_refunds_in_full(booking_service, event, buyer, make_tier):
    """The two auto-refund paths — a lapsed hold, and a captured amount that did
    not match — issued no ticket at all. Keeping a donation out of a transaction
    that delivered nothing is money retained for nothing, which is the single
    outcome the payments module exists to prevent.

    The test is the booking's STATE rather than the refund's `reason` string, so
    a future caller cannot get this wrong by passing a label nobody anticipated.
    """
    tier = make_tier(price_minor=50_000, quantity=10)
    booking = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 1}],
        donation_minor=1_500,
    ).booking
    assert booking.status == BookingStatus.RESERVED  # never confirmed

    assert booking_service.refundable_amount_minor(booking_id=booking.id) == 52_000
