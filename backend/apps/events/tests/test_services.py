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
    OrganizationNotVerifiedError,
    StaleEventVersionError,
)
from apps.events.models import EventStatus
from apps.events.repositories import EventRepository
from apps.events.services import EventService
from apps.organizations.exceptions import OrganizationNotFoundError
from apps.organizations.models import VerifiedLevel
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
def test_update_event_writes_the_content_fields(service, make_event, owner):
    """The columns the event page renders must be reachable by a PATCH.

    They were added read-only, which meant a detail page rendered a duration
    and an age policy that no organizer could ever set.
    """
    event = make_event(status=EventStatus.DRAFT)

    updated = service.update_event(
        event_id=event.id,
        actor_id=owner.id,
        expected_version=1,
        changes={
            "short_description": "One night, four stages, one city.",
            "duration_minutes": 240,
            "language": "Hindi, English",
            "age_restriction": "18+",
            "accessibility_notes": "Step-free access from Gate 2; ramp to the platform.",
            "seo_title": "Sunburn Arena — Mumbai",
            "seo_description": "Four stages, one night.",
        },
    )

    assert updated.duration_minutes == 240
    assert updated.age_restriction == "18+"
    assert updated.seo_title == "Sunburn Arena — Mumbai"
    # One version bump for the whole patch, not one per field.
    assert updated.version == 2


@pytest.mark.django_db
def test_update_event_ignores_a_field_that_is_not_editable(service, make_event, owner):
    """`status` is a lifecycle transition, not a column a PATCH may set —
    otherwise a draft could go live without passing a single publish check."""
    event = make_event(status=EventStatus.DRAFT)

    updated = service.update_event(
        event_id=event.id,
        actor_id=owner.id,
        expected_version=1,
        changes={"title": "New", "status": EventStatus.LIVE},
    )

    assert updated.status == EventStatus.DRAFT


@pytest.mark.django_db
class TestArchive:
    """Archiving is a lifecycle transition, and the states it REFUSES are the
    point — see `archive_if_archivable`."""

    def test_a_draft_can_be_archived(self, service, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)
        archived = service.archive_event(event_id=event.id, actor_id=owner.id)
        assert archived.status == EventStatus.ARCHIVED

    def test_a_rejected_event_can_be_archived(self, service, make_event, owner):
        """An organizer who does not intend to fix a rejection must be able to
        clear it off their list."""
        event = make_event(status=EventStatus.REJECTED)
        assert service.archive_event(event_id=event.id, actor_id=owner.id).status == (
            EventStatus.ARCHIVED
        )

    def test_a_live_event_cannot_be_archived(self, service, make_event, owner):
        """It is on sale. Hiding it while issued tickets stay valid is how an
        attendee turns up to an event that no longer appears to exist."""
        event = make_event(status=EventStatus.LIVE)
        with pytest.raises(InvalidEventStateError):
            service.archive_event(event_id=event.id, actor_id=owner.id)

    def test_an_event_awaiting_review_cannot_be_archived(self, service, make_event, owner):
        """It is in an operator's queue; withdrawing it silently would leave
        them deciding on a row that had vanished."""
        event = make_event(status=EventStatus.PENDING_REVIEW)
        with pytest.raises(InvalidEventStateError):
            service.archive_event(event_id=event.id, actor_id=owner.id)

    def test_a_stranger_cannot_archive(self, service, make_event, other_user):
        event = make_event(status=EventStatus.DRAFT)
        with pytest.raises(NotEventOwnerError):
            service.archive_event(event_id=event.id, actor_id=other_user.id)

    def test_archiving_twice_is_refused_rather_than_silently_repeated(
        self, service, make_event, owner
    ):
        event = make_event(status=EventStatus.DRAFT)
        service.archive_event(event_id=event.id, actor_id=owner.id)
        with pytest.raises(InvalidEventStateError):
            service.archive_event(event_id=event.id, actor_id=owner.id)

    def test_archiving_writes_an_outbox_event(
        self, service, make_event, owner, django_capture_on_commit_callbacks
    ):
        event = make_event(status=EventStatus.DRAFT)
        with django_capture_on_commit_callbacks(execute=True):
            service.archive_event(event_id=event.id, actor_id=owner.id)

        assert OutboxEvent.objects.filter(
            event_type="events.event_archived", aggregate_id=str(event.id)
        ).exists()


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
def test_publish_event_submits_for_review_rather_than_going_live(
    service, make_event, owner, add_ticket_type
):
    event = make_event(status=EventStatus.DRAFT)
    add_ticket_type(event)  # satisfy the ticketing publish gate

    published = service.publish_event(event_id=event.id, actor_id=owner.id)

    assert published.status == EventStatus.PENDING_REVIEW
    assert OutboxEvent.objects.filter(event_type="events.event_submitted_for_review").exists()
    # events.event_published is emitted on APPROVAL, not on submission.
    # `notifications` schedules its attendee reminder off that event, and
    # scheduling one for an event that is then rejected would message ticket
    # holders who do not exist.
    assert not OutboxEvent.objects.filter(event_type="events.event_published").exists()


@pytest.mark.django_db
def test_publish_is_refused_while_the_organization_is_unverified(
    service, make_event, unverified_organization, other_user, add_ticket_type
):
    """THE approval gate, in the layer that owns it.

    The frontend renders an "awaiting approval" shell, but
    `POST /events/{id}/publish` is only `IsAuthenticated` — a gate that exists
    solely in a React component is not a gate, it is a decoration a curl
    command walks past.
    """
    event = make_event(status=EventStatus.DRAFT, org=unverified_organization)
    add_ticket_type(event)  # every OTHER gate is satisfied

    with pytest.raises(OrganizationNotVerifiedError) as raised:
        service.publish_event(event_id=event.id, actor_id=other_user.id)

    assert raised.value.code == "organization_not_verified"
    assert raised.value.status_code == 403
    event.refresh_from_db()
    assert event.status == EventStatus.DRAFT


@pytest.mark.django_db
def test_publish_is_refused_while_verification_is_still_pending(
    service, make_event, unverified_organization, other_user, add_ticket_type
):
    """Submitted-and-waiting is its own state, and the message has to say so —
    telling somebody who is waiting on us to "get verified" is how a support
    ticket is born. The level rides in `details` so the UI need not parse
    prose."""
    unverified_organization.verified_level = VerifiedLevel.PENDING
    unverified_organization.save(update_fields=["verified_level"])
    event = make_event(status=EventStatus.DRAFT, org=unverified_organization)
    add_ticket_type(event)

    with pytest.raises(OrganizationNotVerifiedError) as raised:
        service.publish_event(event_id=event.id, actor_id=other_user.id)

    assert raised.value.details == {"verified_level": VerifiedLevel.PENDING}
    assert "still being verified" in raised.value.message


@pytest.mark.django_db
def test_an_unverified_organization_can_still_build_a_draft(
    service, unverified_organization, other_user
):
    """The gate is on SUBMISSION, not on work. An organizer waiting for a
    decision can prepare their event — they just cannot join the queue that
    ends in a public listing."""
    event = service.create_event(
        organization_id=unverified_organization.id,
        actor_id=other_user.id,
        title="Prepared While Waiting",
        venue="Rooftop",
        city="Bengaluru",
        starts_at=_future(),
    )

    assert event.status == EventStatus.DRAFT

    updated = service.update_event(
        event_id=event.id,
        actor_id=other_user.id,
        expected_version=1,
        changes={"title": "Still Preparing"},
    )
    assert updated.title == "Still Preparing"


@pytest.mark.django_db
def test_the_verified_check_costs_no_extra_query(make_event, django_assert_num_queries):
    """`organization__verified_level` is in `_WRITE_LOAD_FIELDS`, so the gate
    reads an already-joined column. Left out it would be a DEFERRED LOAD — one
    extra query on every publish, invisible until somebody counted."""
    event = make_event(status=EventStatus.DRAFT)

    loaded = EventRepository().get_active_for_write(event.id)
    assert loaded is not None
    assert "verified_level" not in loaded.organization.get_deferred_fields()
    with django_assert_num_queries(0):
        assert loaded.organization.verified_level == VerifiedLevel.VERIFIED


@pytest.mark.django_db
def test_publish_event_rejects_a_non_draft(service, make_event, owner):
    event = make_event(status=EventStatus.LIVE)

    with pytest.raises(InvalidEventStateError):
        service.publish_event(event_id=event.id, actor_id=owner.id)


@pytest.mark.django_db
@pytest.mark.parametrize("status", [EventStatus.PENDING_REVIEW, EventStatus.LIVE])
def test_publish_event_names_the_current_status_in_details(service, make_event, owner, status):
    """The refusal carries the status in `details`, not only in the sentence.

    Re-submitting an event that is already in the review queue is the outcome
    the organizer asked for, and the frontend treats it as success rather than
    painting a red wall on the screen of somebody who did the right thing. It
    can only tell that case apart from a genuinely wrong transition (archived,
    finished) by the status — and reading it back out of the message would
    break the first time the wording changed.
    """
    event = make_event(status=status)

    with pytest.raises(InvalidEventStateError) as caught:
        service.publish_event(event_id=event.id, actor_id=owner.id)

    assert caught.value.details["status"] == status
    # The sentence still names it too, for anything reading only the message.
    assert status in caught.value.message


@pytest.mark.django_db
def test_publish_event_runs_readiness_checks(service, make_event, owner):
    # A draft whose start has already passed fails the built-in future-start check.
    event = make_event(status=EventStatus.DRAFT, starts_at=timezone.now() - timedelta(days=1))

    with pytest.raises(EventNotPublishableError):
        service.publish_event(event_id=event.id, actor_id=owner.id)


@pytest.mark.django_db
def test_publish_checks_are_extensible(service, make_event, owner, add_ticket_type):
    event = make_event(status=EventStatus.DRAFT)
    add_ticket_type(event)  # pass the ticketing gate so _always_fails is what fires

    def _always_fails(_event):
        raise EventNotPublishableError("custom gate")

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
    from core.tests.images import event_image

    # A real 16:9 JPEG: the poster path validates like every other upload
    # now, so `b"bytes"` is refused rather than stored.
    poster = event_image("p.jpg")

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


# ─────────────────────────────────────────────────────────────────────────────
# The URL slug — derived, never client-supplied
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_create_event_derives_the_slug_from_the_title(service, organization, owner):
    event = service.create_event(
        actor_id=owner.id,
        organization_id=organization.id,
        title="Sunburn Arena 2026",
        venue="V",
        city="Goa",
        starts_at=_future(),
    )

    assert event.slug == "sunburn-arena-2026"


@pytest.mark.django_db
def test_two_events_with_the_same_title_both_save(service, organization, owner):
    """The test that documents why there is NO unique constraint on `slug`.

    Five cities each running a "New Year's Eve Party" is not a conflict: the
    uuid in the same path segment tells them apart. A unique slug would have
    needed a collision suffix, a retry loop inside this transaction, and a
    backfill that could fail on real duplicate titles in production.
    """
    first = service.create_event(
        actor_id=owner.id,
        organization_id=organization.id,
        title="New Year's Eve Party",
        venue="V",
        city="Goa",
        starts_at=_future(),
    )
    second = service.create_event(
        actor_id=owner.id,
        organization_id=organization.id,
        title="New Year's Eve Party",
        venue="V",
        city="Mumbai",
        starts_at=_future(),
    )

    assert first.slug == second.slug == "new-years-eve-party"
    assert first.id != second.id


@pytest.mark.django_db
def test_renaming_an_event_regenerates_the_slug(service, make_event, owner):
    event = make_event(title="Old Name", status=EventStatus.DRAFT)

    updated = service.update_event(
        event_id=event.id,
        actor_id=owner.id,
        expected_version=1,
        changes={"title": "Brand New Name"},
    )

    # Safe precisely because the OLD url still resolves — it carries the same
    # uuid — and 308s to this one.
    assert updated.slug == "brand-new-name"


@pytest.mark.django_db
def test_an_edit_that_does_not_change_the_slug_does_not_rewrite_it(service, make_event, owner):
    """ "Sunburn Arena!" -> "Sunburn Arena" is the same slug.

    Writing it anyway would manufacture a redirect for an edit that changed no
    URL, and churn a link people have shared for a punctuation fix.
    """
    event = make_event(title="Sunburn Arena", status=EventStatus.DRAFT)

    updated = service.update_event(
        event_id=event.id,
        actor_id=owner.id,
        expected_version=1,
        changes={"title": "Sunburn Arena!"},
    )

    assert updated.slug == "sunburn-arena"


@pytest.mark.django_db
def test_editing_something_other_than_the_title_leaves_the_slug_alone(service, make_event, owner):
    event = make_event(title="Jazz Night", status=EventStatus.DRAFT)

    updated = service.update_event(
        event_id=event.id,
        actor_id=owner.id,
        expected_version=1,
        changes={"city": "Pune"},
    )

    assert updated.slug == "jazz-night"


@pytest.mark.django_db
def test_a_client_supplied_slug_is_ignored(service, make_event, owner):
    """`slug` is DERIVED, so it is deliberately absent from `_EDITABLE_FIELDS`.

    Accepting one would need validation this design otherwise does not need,
    and would let a client point an event's URL at whatever text it liked.
    """
    event = make_event(title="Jazz Night", status=EventStatus.DRAFT)

    updated = service.update_event(
        event_id=event.id,
        actor_id=owner.id,
        expected_version=1,
        changes={"slug": "something-else", "city": "Pune"},
    )

    assert updated.slug == "jazz-night"


@pytest.mark.django_db
def test_a_title_with_no_ascii_leaves_the_slug_empty(service, organization, owner):
    # The event then serves `/events/{uuid}` — the URL this platform served
    # before slugs existed. Not an error state.
    event = service.create_event(
        actor_id=owner.id,
        organization_id=organization.id,
        title="संगीत की रात",
        venue="V",
        city="Delhi",
        starts_at=_future(),
    )

    assert event.slug == ""


@pytest.mark.django_db
class TestDuplicate:
    """Cloning an event. What it REFUSES to carry over is the whole design —
    a copy is a new event, not a continuation, so nothing the original earned
    comes with it."""

    def test_it_copies_the_content_and_names_the_copy(self, service, make_event, owner):
        source = make_event(status=EventStatus.LIVE, venue="Phoenix", city="Mumbai")
        clone = service.duplicate_event(event_id=source.id, actor_id=owner.id)

        assert clone.id != source.id
        assert clone.title == f"Copy of {source.title}"
        assert clone.venue == "Phoenix"
        assert clone.city == "Mumbai"
        assert clone.organization_id == source.organization_id

    def test_a_copy_of_a_live_event_is_a_draft(self, service, make_event, owner):
        """THE invariant. Arriving already live would be an event published
        without anybody deciding to publish it."""
        source = make_event(status=EventStatus.LIVE)
        assert service.duplicate_event(event_id=source.id, actor_id=owner.id).status == (
            EventStatus.DRAFT
        )

    def test_moderation_history_does_not_transfer(self, service, make_event, owner):
        """A previous approval was for a specific event on a specific date, and
        is not a credential the copy inherits."""
        source = make_event(status=EventStatus.REJECTED)
        source.moderation_note = "Poster breaches the guidelines"
        source.save(update_fields=["moderation_note"])

        clone = service.duplicate_event(event_id=source.id, actor_id=owner.id)

        assert clone.moderation_note == ""
        assert clone.moderated_at is None

    def test_it_carries_no_ticketing_denormals(self, service, make_event, owner):
        """`from_price_minor` and `tickets_available` are display columns
        `ticketing` recomputes from real tier rows. The clone has no tiers, so
        copying them would put a price on a page with nothing behind it."""
        source = make_event(status=EventStatus.LIVE)
        source.from_price_minor = 49900
        source.tickets_available = 120
        source.save(update_fields=["from_price_minor", "tickets_available"])

        clone = service.duplicate_event(event_id=source.id, actor_id=owner.id)

        assert clone.from_price_minor is None
        assert clone.tickets_available is None

    def test_the_slug_is_derived_from_the_new_title(self, service, make_event, owner):
        clone = service.duplicate_event(
            event_id=make_event(status=EventStatus.DRAFT).id, actor_id=owner.id
        )
        assert clone.slug.startswith("copy-of-")

    def test_policies_are_copied_by_value(self, service, make_event, owner):
        """A list column. Copying the REFERENCE would mean editing the clone's
        policies edits the original's for the life of the process."""
        source = make_event(status=EventStatus.DRAFT)
        source.policies = [{"title": "ID required", "body": "Carry a photo ID"}]
        source.save(update_fields=["policies"])

        clone = service.duplicate_event(event_id=source.id, actor_id=owner.id)
        clone.policies.append({"title": "Added later", "body": "..."})

        source.refresh_from_db()
        assert len(source.policies) == 1

    def test_somebody_elses_event_cannot_be_cloned(self, service, make_event, other_user):
        """Ownership is checked on the SOURCE. Without it, cloning would be a
        read of any event on the platform dressed up as a write."""
        source = make_event(status=EventStatus.LIVE)
        with pytest.raises(NotEventOwnerError):
            service.duplicate_event(event_id=source.id, actor_id=other_user.id)
