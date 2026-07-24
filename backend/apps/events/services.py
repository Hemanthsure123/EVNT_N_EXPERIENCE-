"""Business rules for events: create a draft, edit it (optimistic-locked),
and publish it (draft -> live) behind an extensible readiness gate.

Performance rules from CLAUDE.md's checklist, applied here:
- Slow external I/O (the poster upload) happens OUTSIDE the UnitOfWork
  transaction, before it opens.
- Poster *processing* (resize/thumbnail) is handed to TaskQueuePort so the
  create/edit request returns immediately (see tasks.py).
- Edits use a single race-free conditional UPDATE (optimistic lock), not a
  read-modify-write, so concurrent editors can't clobber each other.
- Public caches are invalidated only when a change is actually publicly
  visible (a live event, or a publish), never for draft-only churn.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from django.core.files.uploadedfile import UploadedFile
from django.db import transaction

from apps.accounts.repositories import UserRepository
from apps.organizations.exceptions import OrganizationNotFoundError
from apps.organizations.repositories import OrganizationRepository
from core.audit import record_audit
from core.events import EVENT_CREATED, EVENT_PUBLISHED, EVENT_UPDATED
from core.ports.storage_port import StoragePort
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork

from .exceptions import (
    EventNotFoundError,
    InvalidEventStateError,
    NotEventOwnerError,
    StaleEventVersionError,
)
from .models import Event, EventStatus
from .publish_checks import run_publish_checks
from .repositories import EventRepository
from .selectors import invalidate_event_caches

logger = logging.getLogger(__name__)

_POSTER_PROCESS_TASK = "events.process_poster"
# Fields a client may edit, mapped straight onto the model. Status is not
# here on purpose — lifecycle transitions go through publish()/(future)
# pause()/finish(), never a blind PATCH.
_EDITABLE_FIELDS = ("title", "description", "venue", "city", "starts_at", "ends_at")


class EventService:
    def __init__(
        self,
        *,
        events: EventRepository,
        organizations: OrganizationRepository,
        users: UserRepository,
        storage: StoragePort,
        task_queue: TaskQueuePort,
    ) -> None:
        self._events = events
        self._organizations = organizations
        self._users = users
        self._storage = storage
        self._task_queue = task_queue

    # --- helpers -----------------------------------------------------------

    def _upload_poster(self, event_id: uuid.UUID | str, poster: UploadedFile) -> str:
        path = f"event-posters/{event_id}/{uuid.uuid4().hex}-{poster.name}"
        content_type = poster.content_type or "application/octet-stream"
        return self._storage.upload(path=path, content=poster.read(), content_type=content_type)

    def _load_owned_for_write(
        self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str
    ) -> Event:
        event = self._events.get_active_for_write(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        if str(event.organization.owner_id) != str(actor_id):
            raise NotEventOwnerError()
        return event

    def _enqueue_poster_processing(self, event_id: uuid.UUID | str, poster_url: str) -> None:
        transaction.on_commit(
            lambda: self._task_queue.enqueue(
                _POSTER_PROCESS_TASK,
                {"event_id": str(event_id), "poster_url": poster_url},
            )
        )

    # --- commands ----------------------------------------------------------

    def create_event(
        self,
        *,
        organization_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        title: str,
        venue: str,
        city: str,
        starts_at: datetime,
        description: str = "",
        ends_at: datetime | None = None,
        poster: UploadedFile | None = None,
    ) -> Event:
        org = self._organizations.get_active_by_id(organization_id)
        if org is None:
            raise OrganizationNotFoundError(str(organization_id))
        if str(org.owner_id) != str(actor_id):
            raise NotEventOwnerError()

        event_id = uuid.uuid4()
        poster_url = self._upload_poster(event_id, poster) if poster is not None else ""

        with UnitOfWork() as uow:
            event = self._events.create(
                organization_id=org.id,
                title=title,
                venue=venue,
                city=city,
                starts_at=starts_at,
                description=description,
                ends_at=ends_at,
                poster_url=poster_url,
            )
            # We already hold the loaded org — attach it so serializing the
            # response doesn't lazy-load organization.name (an N+1).
            event.organization = org

            uow.publish(
                EVENT_CREATED,
                {
                    "event_id": str(event.id),
                    "organization_id": str(org.id),
                    "title": event.title,
                },
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.created",
                target_type="event",
                target_id=str(event.id),
            )
            # A brand-new event is a draft — invisible to every public read —
            # so there's no public cache to invalidate here.
            if poster_url:
                self._enqueue_poster_processing(event.id, poster_url)

        logger.info("event_created", extra={"event_id": str(event.id)})
        return event

    def update_event(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        expected_version: int,
        changes: dict,
        poster: UploadedFile | None = None,
    ) -> Event:
        event = self._load_owned_for_write(event_id=event_id, actor_id=actor_id)

        applied_changes = {k: v for k, v in changes.items() if k in _EDITABLE_FIELDS}
        poster_url = self._upload_poster(event.id, poster) if poster is not None else None
        if poster_url is not None:
            applied_changes["poster_url"] = poster_url

        was_live = event.status == EventStatus.LIVE

        with UnitOfWork() as uow:
            applied = self._events.update_if_version_matches(
                event_id=event.id, expected_version=expected_version, changes=applied_changes
            )
            if not applied:
                # The row moved on (a concurrent edit) since the client's read.
                raise StaleEventVersionError()

            uow.publish(
                EVENT_UPDATED,
                {"event_id": str(event.id), "organization_id": str(event.organization_id)},
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.updated",
                target_type="event",
                target_id=str(event.id),
            )
            # Only a live event is publicly cached; editing a draft touches no
            # public cache.
            if was_live:
                transaction.on_commit(lambda: invalidate_event_caches(event.id))
            if poster_url is not None:
                self._enqueue_poster_processing(event.id, poster_url)

        refreshed = self._events.get_active_by_id(event.id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise EventNotFoundError(str(event_id))
        return refreshed

    def publish_event(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Event:
        event = self._load_owned_for_write(event_id=event_id, actor_id=actor_id)

        if event.status != EventStatus.DRAFT:
            raise InvalidEventStateError(
                f"Only draft events can be published (this one is '{event.status}')."
            )

        # Extensible readiness gate — core checks now, ticketing's "has a
        # ticket type" check later, all without editing this method.
        run_publish_checks(event)

        owner = self._users.get_by_id(event.organization.owner_id)

        with UnitOfWork() as uow:
            published = self._events.publish_if_draft(
                event_id=event.id, expected_version=event.version
            )
            if not published:
                # Version moved or it's no longer a draft — a concurrent change.
                raise StaleEventVersionError()

            uow.publish(
                EVENT_PUBLISHED,
                {
                    "event_id": str(event.id),
                    "organization_id": str(event.organization_id),
                    "owner_email": owner.email if owner else "",
                    "title": event.title,
                },
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.published",
                target_type="event",
                target_id=str(event.id),
            )
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

        logger.info("event_published", extra={"event_id": str(event.id)})
        refreshed = self._events.get_active_by_id(event.id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise EventNotFoundError(str(event_id))
        return refreshed
