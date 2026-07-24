"""Composition root.

This is the ONLY place in the codebase allowed to know which concrete
adapter backs each port, and the ONLY place that wires a service to its
repositories/ports. Everything else — views, services, tests — depends on
abstractions (ports, repository classes) and gets its instances from the
factory functions here.

Adapter modules are imported lazily, inside each factory function, so
selecting `PAYMENTS_BACKEND=fake` never even attempts to import the
razorpay SDK. Each port's adapter is cached for the process lifetime via
`lru_cache` — this is a performance detail (build a Redis client once, not
per-request), not a hidden global dependency: business code never reaches
for these caches directly, it always goes through a factory call.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from django.conf import settings

from core.ports.cache_port import CachePort
from core.ports.email_port import EmailPort
from core.ports.event_bus_port import EventBusPort
from core.ports.payment_port import PaymentPort
from core.ports.sms_port import SmsPort
from core.ports.storage_port import StoragePort
from core.ports.task_queue_port import TaskQueuePort

if TYPE_CHECKING:
    from apps.accounts.services import AuthService
    from apps.events.services import EventService
    from apps.organizations.services import OrganizationService
    from apps.ticketing.services import TicketingService


# --- Port factories -------------------------------------------------------


@lru_cache(maxsize=1)
def payment_port() -> PaymentPort:
    backend = settings.PAYMENTS_BACKEND
    if backend == "fake":
        from core.adapters.local.fake_payment import FakePaymentAdapter

        return FakePaymentAdapter()
    if backend == "razorpay":
        from core.adapters.razorpay.adapter import RazorpayPaymentAdapter

        return RazorpayPaymentAdapter(
            key_id=settings.RAZORPAY_KEY_ID,
            key_secret=settings.RAZORPAY_KEY_SECRET,
            webhook_secret=settings.RAZORPAY_WEBHOOK_SECRET,
        )
    raise ValueError(f"Unknown PAYMENTS_BACKEND: {backend!r}")


@lru_cache(maxsize=1)
def storage_port() -> StoragePort:
    backend = settings.STORAGE_BACKEND
    if backend == "local":
        from core.adapters.local.local_storage import LocalStorageAdapter

        return LocalStorageAdapter()
    if backend == "gcs":
        from core.adapters.gcs.adapter import GCSStorageAdapter

        return GCSStorageAdapter(
            bucket_name=settings.GCS_BUCKET_NAME, project_id=settings.GCP_PROJECT_ID
        )
    raise ValueError(f"Unknown STORAGE_BACKEND: {backend!r}")


@lru_cache(maxsize=1)
def cache_port() -> CachePort:
    backend = settings.CACHE_BACKEND
    if backend == "locmem":
        from core.adapters.local.locmem_cache import LocMemCacheAdapter

        return LocMemCacheAdapter()
    if backend == "redis":
        from core.adapters.redis.adapter import RedisCacheAdapter

        return RedisCacheAdapter(url=settings.REDIS_URL)
    raise ValueError(f"Unknown CACHE_BACKEND: {backend!r}")


@lru_cache(maxsize=1)
def email_port() -> EmailPort:
    backend = settings.EMAIL_PROVIDER
    if backend == "console":
        from core.adapters.local.console_email import ConsoleEmailAdapter

        return ConsoleEmailAdapter()
    if backend == "http":
        from core.adapters.email_provider.adapter import HttpEmailAdapter

        return HttpEmailAdapter(
            api_key=settings.EMAIL_API_KEY,
            from_address=settings.EMAIL_FROM,
            api_base_url=settings.EMAIL_API_BASE_URL,
        )
    raise ValueError(f"Unknown EMAIL_PROVIDER: {backend!r}")


@lru_cache(maxsize=1)
def sms_port() -> SmsPort:
    backend = settings.SMS_PROVIDER
    if backend == "console":
        from core.adapters.local.console_sms import ConsoleSmsAdapter

        return ConsoleSmsAdapter()
    if backend == "http":
        from core.adapters.sms_provider.adapter import HttpSmsAdapter

        return HttpSmsAdapter(
            api_key=settings.SMS_API_KEY,
            sender_id=settings.SMS_SENDER_ID,
            dlt_entity_id=settings.SMS_DLT_ENTITY_ID,
            dlt_template_id=settings.SMS_DLT_TEMPLATE_ID,
            api_base_url=settings.SMS_API_BASE_URL,
        )
    raise ValueError(f"Unknown SMS_PROVIDER: {backend!r}")


@lru_cache(maxsize=1)
def event_bus_port() -> EventBusPort:
    backend = settings.EVENT_BUS_BACKEND
    if backend == "inprocess":
        from core.adapters.local.inprocess_event_bus import InProcessEventBusAdapter

        return InProcessEventBusAdapter()
    if backend == "pubsub":
        from core.adapters.pubsub.adapter import PubSubEventBusAdapter

        return PubSubEventBusAdapter(
            project_id=settings.GCP_PROJECT_ID, topic_name=settings.PUBSUB_TOPIC_EVENTS
        )
    raise ValueError(f"Unknown EVENT_BUS_BACKEND: {backend!r}")


@lru_cache(maxsize=1)
def task_queue_port() -> TaskQueuePort:
    backend = settings.QUEUE_BACKEND
    if backend == "local":
        from core.adapters.local.sync_task_queue import SyncTaskQueueAdapter

        return SyncTaskQueueAdapter()
    if backend == "cloud_tasks":
        from core.adapters.cloud_tasks.adapter import CloudTasksQueueAdapter

        # target_url is the internal endpoint Cloud Tasks will POST to. It
        # doesn't exist yet — add it (and a matching INTERNAL_TASKS_TARGET_URL
        # setting) alongside the first real consumer of this adapter.
        return CloudTasksQueueAdapter(
            project_id=settings.GCP_PROJECT_ID,
            location=settings.CLOUD_TASKS_LOCATION,
            queue=settings.CLOUD_TASKS_QUEUE,
            target_url=getattr(settings, "INTERNAL_TASKS_TARGET_URL", ""),
        )
    raise ValueError(f"Unknown QUEUE_BACKEND: {backend!r}")


# --- Service factories ------------------------------------------------
# One function per application service. As new modules are added, their
# service factories are added here too — this file is the single place that
# ever imports both a repository and an adapter side by side.


def build_auth_service() -> AuthService:
    from apps.accounts.repositories import UserRepository
    from apps.accounts.services import AuthService

    return AuthService(users=UserRepository(), email=email_port(), task_queue=task_queue_port())


def build_organization_service() -> OrganizationService:
    from apps.accounts.repositories import UserRepository
    from apps.organizations.repositories import OrganizationRepository
    from apps.organizations.services import OrganizationService

    return OrganizationService(
        organizations=OrganizationRepository(),
        users=UserRepository(),
        storage=storage_port(),
        payments=payment_port(),
        task_queue=task_queue_port(),
    )


def build_event_service() -> EventService:
    from apps.accounts.repositories import UserRepository
    from apps.events.repositories import EventRepository
    from apps.events.services import EventService
    from apps.organizations.repositories import OrganizationRepository

    return EventService(
        events=EventRepository(),
        organizations=OrganizationRepository(),
        users=UserRepository(),
        storage=storage_port(),
        task_queue=task_queue_port(),
    )


def build_ticketing_service() -> TicketingService:
    from apps.events.repositories import EventRepository
    from apps.ticketing.repositories import TicketTypeRepository
    from apps.ticketing.services import TicketingService
    from apps.ticketing.strategies import RowLockReservationStrategy

    ticket_types = TicketTypeRepository()
    return TicketingService(
        ticket_types=ticket_types,
        events=EventRepository(),
        reservation=RowLockReservationStrategy(ticket_types=ticket_types),
    )
