"""The moderation gate: an operator's decisions on submitted events.

The governing rule this file exists to prove:

    **Approval is the only path to `live`.** An organizer can submit; only a
    platform operator can publish. Nothing an organizer does — publishing,
    editing, resubmitting, racing a second request — can put an event in front
    of an attendee.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.events.exceptions import (
    EventNotLiveError,
    EventNotUnderReviewError,
    NotPlatformOperatorError,
)
from apps.events.models import EventStatus
from apps.events.repositories import EventRepository
from apps.events.services import EventModerationService
from core.errors import InvalidInputError
from core.models import AuditLog, OutboxEvent


@pytest.fixture
def moderation() -> EventModerationService:
    # Built directly with real repositories, never through `config.di` — a
    # unit test must not depend on settings-driven backend selection.
    return EventModerationService(events=EventRepository(), users=UserRepository())


@pytest.fixture
def operator() -> User:
    """A platform operator — `is_staff`, the platform's one definition of one.

    Every decision below is made by this user rather than by the event's own
    owner, because that is who is allowed to make it: approval is the only
    path to `live`, and the service now proves the caller is staff instead of
    trusting the console view to have done it.
    """
    return User.objects.create_user(
        email="ev-ops@example.com", password="opspass12345", is_staff=True
    )


@pytest.fixture
def submitted(make_event):
    """An event an organizer has put into the queue."""
    event = make_event(status=EventStatus.DRAFT)
    EventRepository().submit_for_review_if_draft(event_id=event.id, expected_version=event.version)
    reloaded = EventRepository().get_active_by_id(event.id)
    assert reloaded is not None
    return reloaded


@pytest.mark.django_db
class TestApproval:
    def test_approval_is_the_only_path_to_live(self, moderation, submitted, operator):
        assert submitted.status == EventStatus.PENDING_REVIEW

        approved = moderation.moderate(event_id=submitted.id, actor_id=operator.id, approve=True)

        assert approved.status == EventStatus.LIVE
        assert approved.moderated_by_id == operator.id
        assert approved.moderated_at is not None

    def test_approval_emits_the_published_event_the_platform_listens_for(
        self, moderation, submitted, operator
    ):
        """`notifications` schedules its attendee reminder off EVENT_PUBLISHED.
        Emitting it at submission would schedule reminders for events that are
        then rejected."""
        moderation.moderate(event_id=submitted.id, actor_id=operator.id, approve=True)

        assert OutboxEvent.objects.filter(event_type="events.event_approved").exists()
        assert OutboxEvent.objects.filter(event_type="events.event_published").exists()

    def test_approval_is_audited(self, moderation, submitted, operator):
        moderation.moderate(event_id=submitted.id, actor_id=operator.id, approve=True)

        entry = AuditLog.objects.get(action="event.approved", target_id=str(submitted.id))
        # `AuditLog.actor_id` is a plain string column, not an FK — the trail
        # has to survive the actor being deleted.
        assert entry.actor_id == str(operator.id)
        assert entry.target_type == "event"

    def test_a_second_decision_is_refused_rather_than_silently_reapplied(
        self, moderation, submitted, operator
    ):
        """Two operators working the same queue entry."""
        moderation.moderate(event_id=submitted.id, actor_id=operator.id, approve=True)

        with pytest.raises(EventNotUnderReviewError):
            moderation.moderate(
                event_id=submitted.id, actor_id=operator.id, approve=False, note="too late"
            )

        settled = EventRepository().get_active_by_id(submitted.id)
        assert settled is not None
        assert settled.status == EventStatus.LIVE


@pytest.mark.django_db
class TestOnlyAnOperatorDecides:
    """Approval is the ONLY write that can set `status = live` (one conditional
    UPDATE in `EventRepository.moderate_if_pending`), so the service that owns
    it refuses a non-operator for itself. The console view checks too — this is
    the check that survives a second caller being added."""

    def test_the_events_own_owner_cannot_approve_it(self, moderation, submitted, owner):
        with pytest.raises(NotPlatformOperatorError):
            moderation.moderate(event_id=submitted.id, actor_id=owner.id, approve=True)

        untouched = EventRepository().get_active_by_id(submitted.id)
        assert untouched is not None
        assert untouched.status == EventStatus.PENDING_REVIEW

    def test_a_suspended_operator_cannot_decide(self, moderation, submitted, operator):
        """Suspension is an access decision, not a label — the console's own
        suspension endpoint sets exactly this flag."""
        operator.is_active = False
        operator.save(update_fields=["is_active"])

        with pytest.raises(NotPlatformOperatorError):
            moderation.moderate(event_id=submitted.id, actor_id=operator.id, approve=True)

    def test_a_non_operator_cannot_take_a_live_event_down(
        self, moderation, submitted, operator, owner
    ):
        moderation.moderate(event_id=submitted.id, actor_id=operator.id, approve=True)

        with pytest.raises(NotPlatformOperatorError):
            moderation.unpublish(event_id=submitted.id, actor_id=owner.id, note="mine now")

        still_live = EventRepository().get_active_by_id(submitted.id)
        assert still_live is not None
        assert still_live.status == EventStatus.LIVE


@pytest.mark.django_db
class TestRejection:
    def test_rejection_records_a_reason_the_organizer_can_act_on(
        self, moderation, submitted, operator
    ):
        rejected = moderation.moderate(
            event_id=submitted.id,
            actor_id=operator.id,
            approve=False,
            note="The poster is unreadable at card size.",
        )

        assert rejected.status == EventStatus.REJECTED
        assert rejected.moderation_note == "The poster is unreadable at card size."
        assert OutboxEvent.objects.filter(event_type="events.event_rejected").exists()
        # NOT published — nothing downstream should treat this as on sale.
        assert not OutboxEvent.objects.filter(event_type="events.event_published").exists()

    def test_a_rejection_without_a_reason_is_refused(self, moderation, submitted, operator):
        """A rejection an organizer cannot act on is a support ticket."""
        with pytest.raises(InvalidInputError):
            moderation.moderate(
                event_id=submitted.id, actor_id=operator.id, approve=False, note="   "
            )

        untouched = EventRepository().get_active_by_id(submitted.id)
        assert untouched is not None
        assert untouched.status == EventStatus.PENDING_REVIEW

    def test_a_rejected_event_can_be_fixed_and_resubmitted(self, moderation, submitted, operator):
        moderation.moderate(
            event_id=submitted.id, actor_id=operator.id, approve=False, note="Fix it."
        )

        repo = EventRepository()
        rejected = repo.get_active_by_id(submitted.id)
        assert rejected is not None
        assert repo.submit_for_review_if_draft(
            event_id=rejected.id, expected_version=rejected.version
        )
        resubmitted = repo.get_active_by_id(submitted.id)
        assert resubmitted is not None
        assert resubmitted.status == EventStatus.PENDING_REVIEW


@pytest.mark.django_db
class TestUnpublish:
    def test_a_live_event_can_be_taken_down_with_a_reason(self, moderation, submitted, operator):
        moderation.moderate(event_id=submitted.id, actor_id=operator.id, approve=True)

        taken_down = moderation.unpublish(
            event_id=submitted.id, actor_id=operator.id, note="Reported as misleading."
        )

        assert taken_down.status == EventStatus.REJECTED
        assert taken_down.moderation_note == "Reported as misleading."
        assert AuditLog.objects.filter(action="event.unpublished").exists()

    def test_taking_down_needs_a_reason(self, moderation, submitted, operator):
        moderation.moderate(event_id=submitted.id, actor_id=operator.id, approve=True)

        with pytest.raises(InvalidInputError):
            moderation.unpublish(event_id=submitted.id, actor_id=operator.id, note="")

    def test_only_a_live_event_can_be_taken_down(self, moderation, submitted, operator):
        with pytest.raises(EventNotLiveError):
            moderation.unpublish(event_id=submitted.id, actor_id=operator.id, note="not live yet")


@pytest.mark.django_db
class TestQueue:
    def test_the_queue_is_oldest_first(self, make_event):
        repo = EventRepository()
        first = make_event(title="First in", status=EventStatus.DRAFT)
        second = make_event(title="Second in", status=EventStatus.DRAFT)
        repo.submit_for_review_if_draft(event_id=first.id, expected_version=first.version)
        repo.submit_for_review_if_draft(event_id=second.id, expected_version=second.version)

        # FIFO: the organizer who has waited longest is served first.
        assert [event.title for event in repo.list_pending_review()] == ["First in", "Second in"]

    def test_the_queue_holds_only_events_awaiting_a_decision(
        self, make_event, moderation, operator
    ):
        repo = EventRepository()
        make_event(status=EventStatus.DRAFT)
        make_event(status=EventStatus.LIVE)
        pending = make_event(status=EventStatus.DRAFT)
        repo.submit_for_review_if_draft(event_id=pending.id, expected_version=pending.version)

        assert [event.id for event in repo.list_pending_review()] == [pending.id]

        moderation.moderate(event_id=pending.id, actor_id=operator.id, approve=True)
        assert list(repo.list_pending_review()) == []
