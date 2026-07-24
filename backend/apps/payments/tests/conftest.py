from __future__ import annotations

import hashlib
import hmac
import json
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
from apps.payments.repositories import (
    PaymentRepository,
    ProcessedWebhookRepository,
    RefundRepository,
)
from apps.payments.services import PaymentService
from apps.ticketing.repositories import TicketTypeRepository
from apps.ticketing.services import TicketingService
from apps.ticketing.strategies import RowLockReservationStrategy
from core.adapters.local.fake_payment import FakePaymentAdapter
from core.adapters.local.locmem_cache import LocMemCacheAdapter
from core.ports.task_queue_port import TaskQueuePort

WEBHOOK_SECRET = "payments-test-webhook-secret"
PAYOUT_ACCOUNT = "fake_linked_account_test"


def _access_token_for(user: User) -> str:
    return str(cast(RefreshToken, RefreshToken.for_user(user)).access_token)


def signed_webhook(
    *, event: str, order_id: str, payment_id: str, amount_minor: int, secret: str = WEBHOOK_SECRET
) -> tuple[bytes, str]:
    """Build a raw webhook body and its correct HMAC signature — exactly what
    Razorpay sends."""
    body = json.dumps(
        {
            "event": event,
            "payload": {
                "payment": {
                    "entity": {"id": payment_id, "order_id": order_id, "amount": amount_minor}
                }
            },
        }
    ).encode()
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return body, signature


class _RecordingTaskQueue(TaskQueuePort):
    def __init__(self) -> None:
        self.enqueued: list[tuple[str, dict]] = []

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        self.enqueued.append((task_name, payload))
        return "task-1"


@pytest.fixture(autouse=True)
def _isolate_cache():
    from config.di import cache_port

    cache_port.cache_clear()
    yield
    cache_port.cache_clear()


@pytest.fixture
def token_for():
    return _access_token_for


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def buyer() -> User:
    return UserRepository().create_user(email="pay-buyer@example.com", password="s3cur3pass")


@pytest.fixture
def organizer() -> User:
    return UserRepository().create_user(email="pay-organizer@example.com", password="s3cur3pass")


@pytest.fixture
def other_user() -> User:
    return UserRepository().create_user(email="pay-other@example.com", password="s3cur3pass")


@pytest.fixture
def organization(organizer) -> Organization:
    org = OrganizationRepository().create(owner_id=organizer.id, name="Payments Demo Co")
    # A linked payout account so bookings build the Route split.
    Organization.objects.filter(pk=org.id).update(payout_account_id=PAYOUT_ACCOUNT)
    org.refresh_from_db()
    return org


@pytest.fixture
def event(organization) -> Event:
    ev = EventRepository().create(
        organization_id=organization.id,
        title="Payments Demo Gig",
        venue="Arena",
        city="Mumbai",
        starts_at=timezone.now() + timedelta(days=30),
    )
    Event.objects.filter(pk=ev.id).update(status=EventStatus.LIVE)
    ev.refresh_from_db()
    return ev


@pytest.fixture
def tier(event):
    return TicketTypeRepository().create(
        event_id=event.id, name="GA", price_minor=50000, quantity=100, max_per_order=10
    )


@pytest.fixture
def fake_payment() -> FakePaymentAdapter:
    return FakePaymentAdapter(webhook_secret=WEBHOOK_SECRET)


@pytest.fixture
def task_queue() -> _RecordingTaskQueue:
    return _RecordingTaskQueue()


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
        qr_secret="pay-test-qr-secret",
        hold_minutes=10,
        platform_fee_per_ticket=10,
    )


@pytest.fixture
def payment_service(fake_payment, task_queue, booking_service) -> PaymentService:
    return PaymentService(
        payments=PaymentRepository(),
        refunds=RefundRepository(),
        webhooks=ProcessedWebhookRepository(),
        bookings=BookingRepository(),
        booking_service=booking_service,
        payments_port=fake_payment,
        task_queue=task_queue,
    )


@pytest.fixture
def a_booking(booking_service, buyer, event, tier):
    """A fresh reserved booking (2 x 50000 = 100000; fee 20)."""
    return booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    ).booking
