from __future__ import annotations

from datetime import timedelta
from typing import cast

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.booking.repositories import BookingRepository, TicketRepository
from apps.booking.services import BookingService
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from apps.organizations.models import Organization
from apps.organizations.repositories import OrganizationRepository
from apps.payments.models import Payment, PaymentStatus, Refund
from apps.payments.repositories import PaymentRepository
from apps.settlements.repositories import PayoutAttemptRepository, SettlementRepository
from apps.settlements.services import RELEASE_TASK, SettlementService
from apps.ticketing.models import TicketType
from apps.ticketing.repositories import TicketTypeRepository
from apps.ticketing.services import TicketingService
from apps.ticketing.strategies import RowLockReservationStrategy
from core.adapters.local.fake_payment import FakePaymentAdapter
from core.adapters.local.locmem_cache import LocMemCacheAdapter
from core.ports.payment_port import PaymentPort
from core.ports.task_queue_port import TaskQueuePort

QR_SECRET = "settle-test-qr-secret"
PAYOUT_ACCOUNT = "fake_linked_account_settle"
REFUND_WINDOW_HOURS = 48


def _access_token_for(user: User) -> str:
    return str(cast(RefreshToken, RefreshToken.for_user(user)).access_token)


# --- adapters / queues -----------------------------------------------------


class FailingPayoutAdapter(FakePaymentAdapter):
    """Payout always fails — drives the retry/dead-letter path."""

    def release_payout(self, *, account_id: str, amount_minor: int, idempotency_key: str) -> str:
        raise RuntimeError("payout provider down")


class RecordingQueue(TaskQueuePort):
    def __init__(self) -> None:
        self.enqueued: list[tuple[str, dict, int]] = []

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        self.enqueued.append((task_name, payload, delay_seconds))
        return f"task-{len(self.enqueued)}"


class InlineReleaseQueue(TaskQueuePort):
    """Runs a release task inline (like the sync dev queue) so the retry chain
    drives itself; `service` wired after construction."""

    def __init__(self) -> None:
        self.enqueued: list[tuple[str, dict, int]] = []
        self.service: SettlementService | None = None

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        self.enqueued.append((task_name, payload, delay_seconds))
        if self.service is not None and task_name == RELEASE_TASK:
            self.service.release_payout(payload["settlement_id"])
        return f"task-{len(self.enqueued)}"


def make_service(
    *,
    payments_port: PaymentPort | None = None,
    queue: TaskQueuePort | None = None,
    max_attempts: int = 3,
    retry_backoff_seconds: int = 1,
) -> SettlementService:
    return SettlementService(
        settlements=SettlementRepository(),
        attempts=PayoutAttemptRepository(),
        payments=PaymentRepository(),
        events=EventRepository(),
        payments_port=payments_port or FakePaymentAdapter(),
        task_queue=queue or RecordingQueue(),
        refund_window_hours=REFUND_WINDOW_HOURS,
        max_attempts=max_attempts,
        retry_backoff_seconds=retry_backoff_seconds,
    )


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def token_for():
    return _access_token_for


@pytest.fixture
def organizer() -> User:
    return UserRepository().create_user(email="settle-organizer@example.com", password="s3cur3pass")


@pytest.fixture
def other_organizer() -> User:
    return UserRepository().create_user(email="settle-other@example.com", password="s3cur3pass")


@pytest.fixture
def buyer() -> User:
    return UserRepository().create_user(email="settle-buyer@example.com", password="s3cur3pass")


@pytest.fixture
def fake_payment() -> FakePaymentAdapter:
    return FakePaymentAdapter()


@pytest.fixture
def organization(organizer) -> Organization:
    org = OrganizationRepository().create(owner_id=organizer.id, name="Settle Demo Co")
    Organization.objects.filter(pk=org.id).update(payout_account_id=PAYOUT_ACCOUNT)
    org.refresh_from_db()
    return org


def _make_event(organization, *, ends_ago: timedelta | None, starts_ago: timedelta) -> Event:
    now = timezone.now()
    ev = EventRepository().create(
        organization_id=organization.id,
        title="Settle Fest",
        venue="Arena",
        city="Mumbai",
        starts_at=now - starts_ago,
        ends_at=(now - ends_ago) if ends_ago is not None else None,
    )
    Event.objects.filter(pk=ev.id).update(status=EventStatus.LIVE)
    ev.refresh_from_db()
    return ev


@pytest.fixture
def finished_event(organization) -> Event:
    """Ended 3 days ago — past its 48h refund window, so releasable."""
    return _make_event(organization, starts_ago=timedelta(days=5), ends_ago=timedelta(days=3))


@pytest.fixture
def upcoming_event(organization) -> Event:
    """Starts in the future — not finished, not releasable."""
    now = timezone.now()
    ev = EventRepository().create(
        organization_id=organization.id,
        title="Future Fest",
        venue="Arena",
        city="Mumbai",
        starts_at=now + timedelta(days=3),
        ends_at=now + timedelta(days=3, hours=4),
    )
    Event.objects.filter(pk=ev.id).update(status=EventStatus.LIVE)
    ev.refresh_from_db()
    return ev


@pytest.fixture
def tier_for():
    def _make(event) -> TicketType:
        return TicketTypeRepository().create(
            event_id=event.id, name="GA", price_minor=50000, quantity=1000, max_per_order=100
        )

    return _make


@pytest.fixture
def booking_service(fake_payment) -> BookingService:
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
        payments=fake_payment,
        cache=LocMemCacheAdapter(),
        qr_secret=QR_SECRET,
        hold_minutes=10,
        # 100 bps = 1%, matching the shipped default. The fee is ADDED to the
        # total here as in production, so a test's expected total is
        # subtotal + 1% and not the bare ticket price.
        platform_fee_bps=100,
        donation_max_minor=100_000,
    )


@pytest.fixture
def payout_adapter() -> FakePaymentAdapter:
    """The adapter the settlement service pays out through — inspect
    `.payouts_by_key` to assert exactly-once / the released amount."""
    return FakePaymentAdapter()


@pytest.fixture
def settlement_service(payout_adapter) -> SettlementService:
    return make_service(payments_port=payout_adapter)


def book_and_pay(booking_service, service, *, buyer, event, tier, quantity=1) -> Payment:
    """Confirm a booking, create its PAID Payment record, and apply the
    running-total update — mirroring the real confirm → settlement flow."""
    booking = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": quantity}],
    ).booking
    booking_service.confirm_booking(booking_id=booking.id, payment_ref=f"pay_{booking.id}")
    payment = Payment.objects.create(
        booking_id=booking.id,
        rzp_order_id=f"order_{booking.id}",
        rzp_payment_id=f"pay_{booking.id}",
        amount_minor=booking.total_amount_minor,
        status=PaymentStatus.PAID,
    )
    service.apply_confirmed(
        event=event, amount=payment.amount_minor, fee=booking.platform_fee_minor
    )
    return payment


def refund(service, *, event, payment: Payment) -> None:
    """Mark a payment refunded, record the Refund, and apply the running-total
    update — mirroring the real refund → settlement flow."""
    Payment.objects.filter(pk=payment.id).update(status=PaymentStatus.REFUNDED)
    Refund.objects.create(
        payment_id=payment.id,
        rzp_refund_id=f"rfnd_{payment.id}",
        amount_minor=payment.amount_minor,
        reason="test",
    )
    service.apply_refund(event=event, amount=payment.amount_minor)
