from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.booking.repositories import BookingRepository, TicketRepository
from apps.booking.services import BookingService
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from apps.notifications.repositories import NotificationLogRepository
from apps.notifications.services import DISPATCH_TASK, NotificationService
from apps.notifications.templates import TemplateService
from apps.organizations.repositories import OrganizationRepository
from apps.ticketing.models import TicketType
from apps.ticketing.repositories import TicketTypeRepository
from apps.ticketing.services import TicketingService
from apps.ticketing.strategies import RowLockReservationStrategy
from core.adapters.local.fake_payment import FakePaymentAdapter
from core.adapters.local.locmem_cache import LocMemCacheAdapter
from core.ports.email_port import EmailPort
from core.ports.sms_port import SmsPort
from core.ports.task_queue_port import TaskQueuePort

QR_SECRET = "notif-test-qr-secret"


# --- capturing/failing adapters -------------------------------------------


class RecordingEmail(EmailPort):
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, *, to: str, subject: str, body: str) -> str:
        self.sent.append({"to": to, "subject": subject, "body": body})
        return f"email-ref-{len(self.sent)}"


class RecordingSms(SmsPort):
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, *, to: str, message: str, dlt_template_id: str = "") -> str:
        self.sent.append({"to": to, "message": message, "dlt_template_id": dlt_template_id})
        return f"sms-ref-{len(self.sent)}"


class FailingEmail(EmailPort):
    """Always fails — drives the retry/dead-letter path."""

    def __init__(self) -> None:
        self.calls = 0

    def send(self, *, to: str, subject: str, body: str) -> str:
        self.calls += 1
        raise RuntimeError("provider down")


class RecordingQueue(TaskQueuePort):
    """Records enqueues; does NOT run them (the test drives dispatch)."""

    def __init__(self) -> None:
        self.enqueued: list[tuple[str, dict, int]] = []

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        self.enqueued.append((task_name, payload, delay_seconds))
        return f"task-{len(self.enqueued)}"


class InlineQueue(TaskQueuePort):
    """Runs a dispatch task inline (like the sync dev queue), so notify() ->
    enqueue -> dispatch -> send happens in one call. `service` is wired after
    construction (the service needs the queue in __init__)."""

    def __init__(self) -> None:
        self.enqueued: list[tuple[str, dict, int]] = []
        self.service: NotificationService | None = None

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        self.enqueued.append((task_name, payload, delay_seconds))
        if self.service is not None and task_name == DISPATCH_TASK:
            self.service.dispatch(payload["notification_id"])
        return f"task-{len(self.enqueued)}"


def make_service(
    *,
    email: EmailPort | None = None,
    sms: SmsPort | None = None,
    queue: TaskQueuePort | None = None,
    max_attempts: int = 5,
    retry_backoff_seconds: int = 1,
) -> NotificationService:
    return NotificationService(
        logs=NotificationLogRepository(),
        templates=TemplateService(),
        email=email or RecordingEmail(),
        sms=sms or RecordingSms(),
        task_queue=queue or RecordingQueue(),
        max_attempts=max_attempts,
        retry_backoff_seconds=retry_backoff_seconds,
    )


@pytest.fixture
def inline_service():
    """A service whose queue dispatches inline; returns (service, email, sms)."""
    email = RecordingEmail()
    sms = RecordingSms()
    queue = InlineQueue()
    service = make_service(email=email, sms=sms, queue=queue)
    queue.service = service
    return service, email, sms


# --- domain data for handler/reminder tests --------------------------------


@pytest.fixture
def organizer() -> User:
    return UserRepository().create_user(email="notif-organizer@example.com", password="s3cur3pass")


@pytest.fixture
def buyer() -> User:
    user = UserRepository().create_user(email="notif-buyer@example.com", password="s3cur3pass")
    User.objects.filter(pk=user.id).update(full_name="Bill Buyer", phone="+919000000001")
    user.refresh_from_db()
    return user


@pytest.fixture
def organization(organizer):
    return OrganizationRepository().create(owner_id=organizer.id, name="Notify Demo Co")


@pytest.fixture
def event(organization) -> Event:
    ev = EventRepository().create(
        organization_id=organization.id,
        title="Notify Fest",
        venue="Grand Arena",
        city="Mumbai",
        starts_at=timezone.now() + timedelta(days=3),
    )
    Event.objects.filter(pk=ev.id).update(status=EventStatus.LIVE)
    ev.refresh_from_db()
    return ev


@pytest.fixture
def tier(event) -> TicketType:
    return TicketTypeRepository().create(
        event_id=event.id, name="GA", price_minor=50000, quantity=100, max_per_order=10
    )


@pytest.fixture
def booking_service() -> BookingService:
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
        payments=FakePaymentAdapter(),
        cache=LocMemCacheAdapter(),
        qr_secret=QR_SECRET,
        hold_minutes=10,
        platform_fee_per_ticket=10,
    )


def confirm_a_booking(booking_service, *, buyer, event, tier, quantity=1):
    """Reserve + confirm a booking so real tickets are issued; returns the
    ConfirmResult (booking + tickets)."""
    booking = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": quantity}],
    ).booking
    return booking_service.confirm_booking(booking_id=booking.id, payment_ref="pay_notif_test")
