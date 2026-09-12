"""A booking on an event that was published through the SELF-SERVE path.

The report: holds fail on RECENTLY PUBLISHED events and succeed on older ones.
The one thing that changed about how an event becomes public is
`EventService.PUBLISH_STRAIGHT_TO_LIVE` — a verified organization's publish now
lands in `live` through `publish_if_draft` rather than through an operator's
approval. Every other booking test forces `status=LIVE` with a raw UPDATE, so
none of them exercised an event that arrived there the new way.

This one does: a real organization, verified; a real draft; a real tier; the
real publish; the real reserve. If the self-serve path left the row in a state
the money path cannot read, it fails HERE rather than on somebody's phone.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.repositories import UserRepository
from apps.booking.models import BookingStatus
from apps.events.models import EventStatus
from apps.events.repositories import EventRepository
from apps.events.services import EventService
from apps.organizations.models import Organization, VerifiedLevel
from apps.organizations.repositories import OrganizationRepository
from apps.ticketing.repositories import TicketTypeRepository
from core.adapters.local.local_storage import LocalStorageAdapter
from core.ports.task_queue_port import TaskQueuePort

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures


class _NoQueue(TaskQueuePort):
    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        return "task"


@pytest.mark.django_db
def test_an_event_published_by_its_organizer_can_be_booked(booking_service, buyer):
    owner = UserRepository().create_user(email="fresh-org@example.com", password="s3cur3pass")
    org = OrganizationRepository().create(owner_id=owner.id, name="Fresh Collective")
    Organization.objects.filter(pk=org.id).update(verified_level=VerifiedLevel.VERIFIED)

    events = EventService(
        events=EventRepository(),
        organizations=OrganizationRepository(),
        users=UserRepository(),
        storage=LocalStorageAdapter(),
        task_queue=_NoQueue(),
    )
    draft = events.create_event(
        organization_id=org.id,
        actor_id=owner.id,
        title="Brand New Night",
        venue="Somewhere Real",
        city="Bengaluru",
        starts_at=timezone.now() + timedelta(days=20),
    )
    # Tags are a publish gate (`MIN_TAGS_TO_PUBLISH`) and a fresh draft has
    # none. Read the threshold rather than hard-coding it, so this test does
    # not start failing for an unrelated reason the day the gate moves.
    from apps.events.models import Event
    from apps.events.taxonomy import MIN_TAGS_TO_PUBLISH

    # A poster is a publish gate too, and `create_event` was given no file.
    Event.objects.filter(pk=draft.id).update(
        tags=[f"tag-{n}" for n in range(MIN_TAGS_TO_PUBLISH)],
        poster_url="https://cdn.test/posters/fresh-night.jpg",
    )
    tier = TicketTypeRepository().create(
        event_id=draft.id, name="General", price_minor=49900, quantity=50, max_per_order=10
    )

    published = events.publish_event(event_id=draft.id, actor_id=owner.id)
    assert published.status == EventStatus.LIVE  # the self-serve path

    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=published.id,
        items=[{"ticket_type_id": str(tier.id), "quantity": 2}],
        idempotency_key="fresh-event-probe",
    )

    assert result.booking.status == BookingStatus.RESERVED
    assert result.payment_order_id
