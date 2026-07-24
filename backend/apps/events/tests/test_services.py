from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.repositories import UserRepository
from apps.events import publish_checks
from apps.events.exceptions import (
    EventNotFoundError,
    EventNotPublishableError,
    InvalidEventStateError,
    NotEventOwnerError,
    StaleEventVersionError,
)
from apps.events.models import EventStatus
from apps.events.repositories import EventRepository
from apps.events.services import EventService
from apps.organizations.exceptions import OrganizationNotFoundError
from apps.organizations.repositories import OrganizationRepository
from core.models import OutboxEvent
from core.ports.storage_port import StoragePort
from core.ports.task_queue_port import TaskQueuePort


class _FakeStorage(StoragePort):
    def upload(self, *, path: str, content: bytes, content_type: str) -> str:
        return f"https://cdn.test/{path}"

    def delete(self, *, path: str) -> None:  # pragma: no cover
        pass

    def signed_url(self, *, path: str, expires_in_seconds: int = 3600) -> str:  # pragma: no cover
        return f"https://cdn.test/{path}"


class _RecordingTaskQueue(TaskQueuePort):
    def __init__(self) -> None:
        self.enqueued: list[tuple[str, dict]] = []

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        self.enqueued.append((task_name, payload))
        return "task-1"


@pytest.fixture
def task_queue() -> _RecordingTaskQueue:
    return _RecordingTaskQueue()


@pytest.fixture
def service(task_queue) -> EventService:
    return EventService(
        events=EventRepository(),
        organizations=OrganizationRepository(),
        users=UserRepository(),
        storage=_FakeStorage(),
        task_queue=task_queue,
    )


def _future():
    return timezone.now() + timedelta(days=10)


@pytest.mark.django_db
def test_create_event_makes_a_draft_owned_by_the_org_owner(service, organization, owner):
    event = service.create_event(
        organization_id=organization.id,
        actor_id=owner.id,
        title="Launch Party",
        venue="Rooftop",
        city="Bengaluru",
        starts_at=_future(),
    )

    assert event.status == EventStatus.DRAFT
    assert event.organization_id == organization.id


@pytest.mark.django_db
def test_create_event_writes_an_event_created_outbox_event(service, organization, owner):
    event = service.create_event(
        organization_id=organization.id,
        actor_id=owner.id,
        title="Launch Party",
        venue="Rooftop",
        city="Bengaluru",
        starts_at=_future(),
    )

    stored = OutboxEvent.objects.get(event_type="events.event_created")
    assert stored.aggregate_id == str(event.id)


@pytest.mark.django_db
def test_create_event_rejects_a_non_owner(service, organization, other_user):
    with pytest.raises(NotEventOwnerError):
        service.create_event(
            organization_id=organization.id,
            actor_id=other_user.id,
            title="Sneaky",
            venue="X",
            city="Y",
            starts_at=_future(),
        )


@pytest.mark.django_db
def test_create_event_rejects_a_missing_organization(service, owner):
    with pytest.raises(OrganizationNotFoundError):
        service.create_event(
            organization_id="00000000-0000-0000-0000-000000000000",
            actor_id=owner.id,
            title="Ghost",
            venue="X",
            city="Y",
            starts_at=_future(),
        )


@pytest.mark.django_db
def test_update_event_applies_changes_and_bumps_version(service, make_event, owner):
    event = make_event(title="Old", status=EventStatus.DRAFT)

    updated = service.update_event(
        event_id=event.id,
        actor_id=owner.id,
        expected_version=1,
        changes={"title": "New"},
    )

    assert updated.title == "New"
    assert updated.version == 2


@pytest.mark.django_db
def test_update_event_rejects_a_stale_version(service, make_event, owner):
    event = make_event(title="Old", status=EventStatus.DRAFT)

    with pytest.raises(StaleEventVersionError):
        service.update_event(
            event_id=event.id, actor_id=owner.id, expected_version=99, changes={"title": "New"}
        )


@pytest.mark.django_db
def test_update_event_rejects_a_non_owner(service, make_event, other_user):
    event = make_event(status=EventStatus.DRAFT)

    with pytest.raises(NotEventOwnerError):
        service.update_event(
            event_id=event.id, actor_id=other_user.id, expected_version=1, changes={"title": "X"}
        )


@pytest.mark.django_db
def test_update_event_missing_event(service, owner):
    with pytest.raises(EventNotFoundError):
        service.update_event(
            event_id="00000000-0000-0000-0000-000000000000",
            actor_id=owner.id,
            expected_version=1,
            changes={"title": "X"},
        )


@pytest.mark.django_db
def test_publish_event_transitions_draft_to_live(service, make_event, owner):
    event = make_event(status=EventStatus.DRAFT)

    published = service.publish_event(event_id=event.id, actor_id=owner.id)

    assert published.status == EventStatus.LIVE
    assert OutboxEvent.objects.filter(event_type="events.event_published").exists()


@pytest.mark.django_db
def test_publish_event_rejects_a_non_draft(service, make_event, owner):
    event = make_event(status=EventStatus.LIVE)

    with pytest.raises(InvalidEventStateError):
        service.publish_event(event_id=event.id, actor_id=owner.id)


@pytest.mark.django_db
def test_publish_event_runs_readiness_checks(service, make_event, owner):
    # A draft whose start has already passed fails the built-in future-start check.
    event = make_event(status=EventStatus.DRAFT, starts_at=timezone.now() - timedelta(days=1))

    with pytest.raises(EventNotPublishableError):
        service.publish_event(event_id=event.id, actor_id=owner.id)


@pytest.mark.django_db
def test_publish_checks_are_extensible(service, make_event, owner):
    event = make_event(status=EventStatus.DRAFT)

    def _always_fails(_event):
        raise EventNotPublishableError("needs a ticket type")

    publish_checks.register_publish_check(_always_fails)
    try:
        with pytest.raises(EventNotPublishableError):
            service.publish_event(event_id=event.id, actor_id=owner.id)
    finally:
        publish_checks._PUBLISH_CHECKS.remove(_always_fails)


@pytest.mark.django_db
def test_create_with_poster_enqueues_async_processing(
    service, task_queue, organization, owner, django_capture_on_commit_callbacks
):
    from django.core.files.uploadedfile import SimpleUploadedFile

    poster = SimpleUploadedFile("p.jpg", b"bytes", content_type="image/jpeg")

    with django_capture_on_commit_callbacks(execute=True):
        event = service.create_event(
            organization_id=organization.id,
            actor_id=owner.id,
            title="With Poster",
            venue="Hall",
            city="Pune",
            starts_at=_future(),
            poster=poster,
        )

    assert event.poster_url.startswith("https://cdn.test/event-posters/")
    assert task_queue.enqueued == [
        ("events.process_poster", {"event_id": str(event.id), "poster_url": event.poster_url})
    ]
