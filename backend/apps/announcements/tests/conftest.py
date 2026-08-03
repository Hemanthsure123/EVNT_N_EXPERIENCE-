"""Shared fixtures for the email side of announcements.

Services are constructed DIRECTLY with local doubles here, never through
`config.di` — a unit test that went through the composition root would be
asserting on which backend the settings happen to select.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest

from apps.accounts.models import User
from apps.announcements.models import Announcement, AnnouncementKind, Subscriber
from apps.announcements.repositories import (
    AnnouncementDeliveryRepository,
    AnnouncementRepository,
    SubscriberRepository,
)
from apps.announcements.services import (
    BroadcastService,
    ClickTrackingService,
    SubscriptionService,
)

TRACKING_BASE = "https://api.curatix.test"
SITE_BASE = "https://curatix.test"


@dataclass
class FakeLog:
    """Stands in for a `notifications.NotificationLog` row."""

    id: uuid.UUID


@dataclass
class RecordingNotifier:
    """A double for `NotificationService.notify`.

    Structural, matching the `Notifier` protocol. The real service would need
    an `announcement` template registered in a module this slice does not own —
    and whether notifications can render a type is notifications' test, not
    this one's. What matters here is that each recipient is handed over exactly
    once, with the right key and the right links.
    """

    calls: list[dict[str, Any]] = field(default_factory=list)
    #: Addresses to return None for, the way the real service does when there
    #: is no usable recipient.
    skip: set[str] = field(default_factory=set)

    def notify(
        self,
        *,
        notification_type: str,
        recipient: str,
        context: dict,
        dedupe_key: str,
        delay_seconds: int = 0,
    ) -> FakeLog | None:
        self.calls.append(
            {
                "type": notification_type,
                "recipient": recipient,
                "context": context,
                "dedupe_key": dedupe_key,
            }
        )
        if recipient in self.skip:
            return None
        return FakeLog(id=uuid.uuid4())


@dataclass
class CountingQueue:
    """Records enqueues instead of running them.

    `SyncTaskQueueAdapter` runs the registered task, and that task rebuilds its
    service from the composition root — so it would quietly bypass the notifier
    double these tests are asserting on. Recording the enqueue is what the
    operator's press actually promises; `send_pending` is then called directly,
    which is exactly what the task's one line does.
    """

    calls: list[tuple[str, dict]] = field(default_factory=list)

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        self.calls.append((task_name, payload))
        return f"fake_task_{len(self.calls)}"


@pytest.fixture
def subscriptions(db) -> SubscriptionService:
    return SubscriptionService(subscribers=SubscriberRepository())


@pytest.fixture
def notifier() -> RecordingNotifier:
    return RecordingNotifier()


@pytest.fixture
def queue() -> CountingQueue:
    return CountingQueue()


@pytest.fixture
def clicks(db) -> ClickTrackingService:
    return ClickTrackingService(deliveries=AnnouncementDeliveryRepository(), site_url=SITE_BASE)


def make_broadcast_service(
    *,
    notifier: Any,
    task_queue: Any,
    tracking_base_url: str = TRACKING_BASE,
    site_url: str = SITE_BASE,
) -> BroadcastService:
    return BroadcastService(
        announcements=AnnouncementRepository(),
        subscribers=SubscriberRepository(),
        deliveries=AnnouncementDeliveryRepository(),
        subscriptions=SubscriptionService(subscribers=SubscriberRepository()),
        notifier=notifier,
        task_queue=task_queue,
        tracking_base_url=tracking_base_url,
        site_url=site_url,
    )


@pytest.fixture
def broadcast(db, notifier: RecordingNotifier, queue: CountingQueue) -> BroadcastService:
    return make_broadcast_service(notifier=notifier, task_queue=queue)


@pytest.fixture
def announcement(db) -> Announcement:
    return Announcement.objects.create(
        kind=AnnouncementKind.FEATURE,
        title="Curatix now sends you the good stuff",
        body="A short note about what is on.",
        link_path="/events?city=Mumbai",
        link_label="Browse",
    )


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_user(
        email="campaign-ops@example.com", password="opspass12345", is_staff=True
    )


def make_subscribers(count: int, *, prefix: str = "reader") -> list[Subscriber]:
    return [
        Subscriber.objects.create(email=f"{prefix}{index}@example.com", source="homepage_card")
        for index in range(count)
    ]
