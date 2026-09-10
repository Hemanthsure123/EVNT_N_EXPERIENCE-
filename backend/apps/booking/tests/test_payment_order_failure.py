"""What happens when the payment provider will not start a payment.

The reported failure: "That did not go through — something went wrong on our
side", on recently published events, on every press of Try again. Three
defects made that shape, and each case here pins one of them:

1. `RazorpayPaymentAdapter.create_order` had no error handling, so a refusal
   left the booking service as a raw SDK exception and became a 500.
2. The seats are reserved and COMMITTED before the order call, so the failed
   booking kept holding them for ten minutes.
3. Try again replayed that same booking by its idempotency key straight back
   into the same refused call — a deterministic loop.

The Route transfer is the one per-ORGANIZER input to an order, which is why one
organizer's events fail while another's succeed; the fallback case pins what
happens when that is the thing refused.
"""

from __future__ import annotations

import pytest

from apps.booking.exceptions import PaymentOrderFailedError
from apps.booking.models import Booking, BookingStatus
from apps.booking.repositories import BookingRepository, TicketRepository
from apps.booking.services import BookingService
from apps.events.repositories import EventRepository
from apps.organizations.models import Organization
from apps.ticketing.models import TicketType
from apps.ticketing.repositories import TicketTypeRepository
from apps.ticketing.services import TicketingService
from apps.ticketing.strategies import RowLockReservationStrategy
from core.adapters.local.fake_payment import FakePaymentAdapter
from core.adapters.local.locmem_cache import LocMemCacheAdapter
from core.ports.payment_port import (
    OrderTransfer,
    PaymentOrderRejected,
    PaymentProviderUnavailable,
)

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures
from .conftest import QR_SECRET


class _ScriptedPayments(FakePaymentAdapter):
    """A provider whose `create_order` answers from a script, one entry per call.

    Each entry is either an exception to raise or `None` for "succeed". The
    calls themselves are recorded, so a test can assert whether a retry
    carried the Route split.
    """

    def __init__(self, script: list[Exception | None]) -> None:
        super().__init__()
        self._script = list(script)
        self.calls: list[list[OrderTransfer] | None] = []

    def create_order(
        self,
        *,
        amount_minor: int,
        currency: str,
        receipt: str,
        notes: dict,
        transfers: list[OrderTransfer] | None = None,
    ) -> str:
        self.calls.append(transfers)
        outcome = self._script.pop(0) if self._script else None
        if outcome is not None:
            raise outcome
        return super().create_order(
            amount_minor=amount_minor,
            currency=currency,
            receipt=receipt,
            notes=notes,
            transfers=transfers,
        )


def _service(payments: FakePaymentAdapter) -> BookingService:
    ticket_types = TicketTypeRepository()
    ticketing = TicketingService(
        ticket_types=ticket_types,
        events=EventRepository(),
        reservation=RowLockReservationStrategy(ticket_types=ticket_types),
    )
    return BookingService(
        bookings=BookingRepository(),
        tickets=TicketRepository(),
        ticket_types=ticket_types,
        ticketing=ticketing,
        events=EventRepository(),
        payments=payments,
        cache=LocMemCacheAdapter(),
        qr_secret=QR_SECRET,
        hold_minutes=10,
        platform_fee_bps=100,
        donation_max_minor=100_000,
    )


def _with_linked_account(event) -> None:
    Organization.objects.filter(pk=event.organization_id).update(
        payout_account_id="acc_not_activated"
    )


def _reserved(tier_id) -> int:
    return TicketType.objects.get(pk=tier_id).reserved


@pytest.mark.django_db
class TestARefusedRouteSplitFallsBackToNoSplit:
    def test_the_sale_goes_through_without_the_transfer(self, event, make_tier, buyer):
        _with_linked_account(event)
        tier = make_tier()
        payments = _ScriptedPayments(
            [PaymentOrderRejected("linked account not activated", had_transfers=True), None]
        )

        result = _service(payments).create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 2}],
        )

        assert result.booking.status == BookingStatus.RESERVED
        assert result.payment_order_id
        # First call carried the split and was refused; the retry did not.
        assert payments.calls[0] is not None
        assert payments.calls[1] is None
        assert _reserved(tier.id) == 2

    def test_a_refusal_without_a_split_is_not_retried(self, event, make_tier, buyer):
        # No linked account, so there was never a transfer to drop — retrying
        # the identical request would be refused identically.
        tier = make_tier()
        payments = _ScriptedPayments([PaymentOrderRejected("amount too low", had_transfers=False)])

        with pytest.raises(PaymentOrderFailedError):
            _service(payments).create_booking(
                user_id=buyer.id,
                event_id=event.id,
                items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
            )

        assert len(payments.calls) == 1


@pytest.mark.django_db
class TestAFailedOrderReleasesTheHold:
    def test_a_refusal_hands_the_seats_back(self, event, make_tier, buyer):
        tier = make_tier()
        payments = _ScriptedPayments([PaymentOrderRejected("nope", had_transfers=False)])

        with pytest.raises(PaymentOrderFailedError):
            _service(payments).create_booking(
                user_id=buyer.id,
                event_id=event.id,
                items=[{"ticket_type_id": str(tier.id), "quantity": 3}],
            )

        # The seats are back on sale NOW, not when the sweeper next runs.
        assert _reserved(tier.id) == 0

    def test_an_unreachable_provider_hands_the_seats_back(self, event, make_tier, buyer):
        tier = make_tier()
        payments = _ScriptedPayments([PaymentProviderUnavailable("timed out")])

        with pytest.raises(PaymentOrderFailedError):
            _service(payments).create_booking(
                user_id=buyer.id,
                event_id=event.id,
                items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
            )

        assert _reserved(tier.id) == 0

    def test_the_error_is_a_502_with_its_own_code(self):
        # Not a 500. The API envelope names what happened, which is what lets
        # the checkout say something true instead of "an unexpected error".
        assert PaymentOrderFailedError.status_code == 502
        assert PaymentOrderFailedError.code == "payment_order_failed"


@pytest.mark.django_db
class TestAFailedReissueKeepsTheHold:
    """A donation or a coupon re-issues the order on a hold that ALREADY exists.

    Releasing that hold because the provider blinked while somebody pressed a
    ₹15 chip would cost them their seats over a decision with nothing to do
    with stock — so the re-issue paths keep it and say so.
    """

    def test_a_donation_during_an_outage_does_not_cost_the_seats(self, event, make_tier, buyer):
        tier = make_tier()
        # The create succeeds; the re-issue after the donation does not.
        payments = _ScriptedPayments([None, PaymentProviderUnavailable("timed out")])
        service = _service(payments)
        created = service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 2}],
        )

        with pytest.raises(PaymentOrderFailedError):
            service.set_donation(
                booking_id=created.booking.id, actor_id=buyer.id, donation_minor=1500
            )

        booking = Booking.objects.get(pk=created.booking.id)
        assert booking.status == BookingStatus.RESERVED
        assert not booking.payment_order_id
        assert _reserved(tier.id) == 2

    def test_pressing_the_same_amount_again_fills_the_order_in(self, event, make_tier, buyer):
        # It used to return early on an unchanged amount, so once the amount
        # had been written by the failed attempt nothing could ever issue the
        # order — the booking stayed unpayable until it expired.
        tier = make_tier()
        payments = _ScriptedPayments([None, PaymentProviderUnavailable("blip"), None])
        service = _service(payments)
        created = service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        with pytest.raises(PaymentOrderFailedError):
            service.set_donation(
                booking_id=created.booking.id, actor_id=buyer.id, donation_minor=1500
            )

        retried = service.set_donation(
            booking_id=created.booking.id, actor_id=buyer.id, donation_minor=1500
        )

        assert retried.payment_order_id
        assert retried.donation_amount_minor == 1500
        assert len(payments.calls) == 3


@pytest.mark.django_db
def test_try_again_is_a_fresh_reserve_not_a_replay_of_the_failure(event, make_tier, buyer):
    """THE LOOP. Before the fix, the same idempotency key replayed the stuck
    reserved booking into the same refused call on every press."""
    tier = make_tier()
    payments = _ScriptedPayments([PaymentProviderUnavailable("blip"), None])
    service = _service(payments)
    request = {
        "user_id": buyer.id,
        "event_id": event.id,
        "items": [{"ticket_type_id": str(tier.id), "quantity": 2}],
        "idempotency_key": "same-press-twice",
    }

    with pytest.raises(PaymentOrderFailedError):
        service.create_booking(**request)

    retried = service.create_booking(**request)

    assert retried.booking.status == BookingStatus.RESERVED
    assert retried.payment_order_id
    # Exactly the seats of ONE booking are held — the failed one gave its back.
    assert _reserved(tier.id) == 2
