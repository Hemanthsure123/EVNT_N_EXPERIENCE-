"""`GET /bookings/{id}/hold` — the guard against a zombie checkout.

The bug it ends: a customer cancels at the review screen (the back arrow
releases the seats), leaves, and presses the browser's BACK button. The
checkout remounts carrying a `?booking=` id, and nothing in the page knows the
hold behind it is dead — so it reserved AGAIN, taking inventory back off sale
for somebody who had just deliberately given it up, and starting a fresh
countdown over a session they had ended.

Only the server can answer this: `release_expired` runs on a schedule, the
cancel is a request that may not have landed, and the id outlives all of it in
history, in a restored tab and in a pasted link.
"""

from __future__ import annotations

import datetime
import uuid

import pytest
from django.utils import timezone

from apps.booking.exceptions import BookingNotFoundError, HoldNotLiveError
from apps.booking.models import BookingStatus

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures

pytestmark = pytest.mark.django_db


@pytest.fixture
def held(booking_service, event, buyer, make_tier):
    """A live hold, made the way the checkout makes one."""
    tier = make_tier(price_minor=50000, quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 2}],
    )
    return result.booking


class TestALiveHoldIsReturned:
    def test_a_reserved_booking_with_time_left_is_live(self, booking_service, held, buyer):
        found = booking_service.get_live_hold(booking_id=held.id, actor_id=buyer.id)

        assert found.id == held.id
        assert found.status == BookingStatus.RESERVED


class TestWhatIsRefused:
    """Each of these used to remount as a payable-looking checkout."""

    def test_a_cancelled_booking_is_refused(self, booking_service, held, buyer):
        """The exact reported path: cancel, leave, press Back."""
        held.status = BookingStatus.CANCELLED
        held.save(update_fields=["status"])

        with pytest.raises(HoldNotLiveError) as caught:
            booking_service.get_live_hold(booking_id=held.id, actor_id=buyer.id)

        assert caught.value.status == BookingStatus.CANCELLED
        assert caught.value.status_code == 409

    def test_a_reserved_but_lapsed_hold_is_refused_and_reads_as_expired(
        self, booking_service, held, buyer
    ):
        """The sweeper runs on a schedule, so `reserved` with a deadline in the
        past is genuinely reachable. Answering 200 would hand the screen a
        countdown that was already over — and reporting `reserved` would send
        the customer back into a checkout the next minute would end."""
        held.hold_expires_at = timezone.now() - datetime.timedelta(seconds=1)
        held.save(update_fields=["hold_expires_at"])

        with pytest.raises(HoldNotLiveError) as caught:
            booking_service.get_live_hold(booking_id=held.id, actor_id=buyer.id)

        assert caught.value.status == BookingStatus.EXPIRED

    def test_an_expired_booking_is_refused(self, booking_service, held, buyer):
        held.status = BookingStatus.EXPIRED
        held.save(update_fields=["status"])

        with pytest.raises(HoldNotLiveError):
            booking_service.get_live_hold(booking_id=held.id, actor_id=buyer.id)

    def test_a_paid_booking_is_refused_but_says_so(self, booking_service, held, buyer):
        """Not a live checkout — but the client must send this one to the
        CONFIRMATION screen rather than back to the event, which is why the
        status travels in the error instead of being flattened to a refusal."""
        held.status = BookingStatus.PAID
        held.save(update_fields=["status"])

        with pytest.raises(HoldNotLiveError) as caught:
            booking_service.get_live_hold(booking_id=held.id, actor_id=buyer.id)

        assert caught.value.status == BookingStatus.PAID

    def test_the_status_reaches_the_error_envelope(self, booking_service, held, buyer):
        held.status = BookingStatus.CANCELLED
        held.save(update_fields=["status"])

        with pytest.raises(HoldNotLiveError) as caught:
            booking_service.get_live_hold(booking_id=held.id, actor_id=buyer.id)

        assert caught.value.code == "hold_not_live"
        assert caught.value.details == {"status": BookingStatus.CANCELLED}


class TestItIsNotAnOracle:
    def test_somebody_elses_booking_answers_exactly_like_a_missing_one(
        self, booking_service, held, other_user
    ):
        """Same answer for "not yours" and "does not exist", so this cannot be
        used to test whether a booking id is real — the rule the organizer
        reads already follow."""
        with pytest.raises(BookingNotFoundError):
            booking_service.get_live_hold(booking_id=held.id, actor_id=other_user.id)

    def test_an_unknown_id_is_not_found(self, booking_service, buyer):
        with pytest.raises(BookingNotFoundError):
            booking_service.get_live_hold(booking_id=uuid.uuid4(), actor_id=buyer.id)
