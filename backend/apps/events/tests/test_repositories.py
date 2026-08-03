from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository


@pytest.fixture
def repo() -> EventRepository:
    return EventRepository()


@pytest.mark.django_db
def test_create_defaults_to_a_draft_at_version_1(repo, organization):
    event = repo.create(
        organization_id=organization.id,
        title="Draft Event",
        venue="Hall A",
        city="Delhi",
        starts_at=timezone.now() + timedelta(days=5),
    )

    assert event.status == EventStatus.DRAFT
    assert event.version == 1


@pytest.mark.django_db
def test_get_published_by_id_hides_drafts(repo, make_event):
    draft = make_event(status=EventStatus.DRAFT)
    live = make_event(status=EventStatus.LIVE)

    assert repo.get_published_by_id(draft.id) is None
    assert repo.get_published_by_id(live.id) is not None


@pytest.mark.django_db
def test_get_active_by_id_returns_any_status(repo, make_event):
    draft = make_event(status=EventStatus.DRAFT)

    assert repo.get_active_by_id(draft.id) is not None


@pytest.mark.django_db
def test_list_published_excludes_drafts_past_and_deleted(repo, make_event):
    live = make_event(title="Upcoming Live", status=EventStatus.LIVE)
    make_event(title="A Draft", status=EventStatus.DRAFT)
    make_event(
        title="Past Live",
        status=EventStatus.LIVE,
        starts_at=timezone.now() - timedelta(days=1),
    )
    deleted = make_event(title="Deleted Live", status=EventStatus.LIVE)
    Event.objects.filter(pk=deleted.id).update(deleted_at=timezone.now())

    titles = [e.title for e in repo.list_published()]

    assert titles == ["Upcoming Live"]
    assert live.title in titles


@pytest.mark.django_db
def test_list_published_orders_by_soonest_first(repo, make_event):
    later = make_event(title="Later", starts_at=timezone.now() + timedelta(days=20))
    sooner = make_event(title="Sooner", starts_at=timezone.now() + timedelta(days=2))

    titles = [e.title for e in repo.list_published()]

    assert titles.index("Sooner") < titles.index("Later")
    assert {sooner.title, later.title} <= set(titles)


@pytest.mark.django_db
def test_list_published_full_text_search_matches_title_and_description(repo, make_event):
    make_event(title="Sunburn Jazz Night", description="smooth saxophone")
    make_event(title="Rock Marathon", description="loud guitars")

    titles = [e.title for e in repo.list_published(search="jazz")]

    assert titles == ["Sunburn Jazz Night"]


@pytest.mark.django_db
def test_list_published_full_text_search_ignores_non_matches(repo, make_event):
    make_event(title="Sunburn Jazz Night")

    assert list(repo.list_published(search="cricket")) == []


@pytest.mark.django_db
def test_list_published_filters_by_city(repo, make_event):
    make_event(title="Mumbai Show", city="Mumbai")
    make_event(title="Delhi Show", city="Delhi")

    titles = [e.title for e in repo.list_published(city="Delhi")]

    assert titles == ["Delhi Show"]


@pytest.mark.django_db
def test_update_if_version_matches_applies_and_bumps_version(repo, make_event):
    event = make_event(title="Old Title", status=EventStatus.DRAFT)

    applied = repo.update_if_version_matches(
        event_id=event.id, expected_version=1, changes={"title": "New Title"}
    )

    assert applied is True
    refreshed = repo.get_active_by_id(event.id)
    assert refreshed.title == "New Title"
    assert refreshed.version == 2


@pytest.mark.django_db
def test_update_if_version_matches_rejects_a_stale_version(repo, make_event):
    event = make_event(title="Old Title", status=EventStatus.DRAFT)

    applied = repo.update_if_version_matches(
        event_id=event.id, expected_version=99, changes={"title": "Hijacked"}
    )

    assert applied is False
    assert repo.get_active_by_id(event.id).title == "Old Title"


@pytest.mark.django_db
def test_update_of_source_column_refreshes_the_search_vector(repo, make_event):
    # Editing the title must keep full-text search consistent (trigger-driven).
    event = make_event(title="Original Salsa Fiesta")
    repo.update_if_version_matches(
        event_id=event.id, expected_version=1, changes={"title": "Techno Warehouse Rave"}
    )

    assert [e.id for e in repo.list_published(search="techno")] == [event.id]
    assert list(repo.list_published(search="salsa")) == []


@pytest.mark.django_db
def test_submit_for_review_transitions_only_from_draft_or_rejected(repo, make_event):
    draft = make_event(status=EventStatus.DRAFT)
    live = make_event(status=EventStatus.LIVE)
    rejected = make_event(status=EventStatus.REJECTED)

    assert repo.submit_for_review_if_draft(event_id=draft.id, expected_version=1) is True
    assert repo.get_active_by_id(draft.id).status == EventStatus.PENDING_REVIEW

    # A rejection is recoverable: editing and resubmitting is the whole point
    # of recording a reason rather than deleting the event.
    assert repo.submit_for_review_if_draft(event_id=rejected.id, expected_version=1) is True

    # Already live -> nothing to submit.
    assert repo.submit_for_review_if_draft(event_id=live.id, expected_version=1) is False


@pytest.mark.django_db
def test_moderating_the_same_event_twice_only_lands_once(repo, make_event, owner):
    """Two operators clicking Approve on one queue entry. The conditional
    UPDATE is the guard — the second matches zero rows."""
    event = make_event(status=EventStatus.DRAFT)
    repo.submit_for_review_if_draft(event_id=event.id, expected_version=1)

    assert (
        repo.moderate_if_pending(event_id=event.id, approve=True, actor_id=owner.id, note="")
        is True
    )
    assert (
        repo.moderate_if_pending(event_id=event.id, approve=False, actor_id=owner.id, note="no")
        is False
    )
    assert repo.get_active_by_id(event.id).status == EventStatus.LIVE


@pytest.mark.django_db
def test_rejection_records_the_reason_and_resubmission_clears_it(repo, make_event, owner):
    event = make_event(status=EventStatus.DRAFT)
    repo.submit_for_review_if_draft(event_id=event.id, expected_version=1)
    repo.moderate_if_pending(
        event_id=event.id, approve=False, actor_id=owner.id, note="Poster is unreadable."
    )

    rejected = repo.get_active_by_id(event.id)
    assert rejected.status == EventStatus.REJECTED
    assert rejected.moderation_note == "Poster is unreadable."

    # Resubmitting clears the note: a stale reason on an event now awaiting a
    # fresh review is how it gets rejected twice for a problem already fixed.
    repo.submit_for_review_if_draft(event_id=event.id, expected_version=rejected.version)
    assert repo.get_active_by_id(event.id).moderation_note == ""


@pytest.mark.django_db
def test_list_by_owner_includes_drafts_and_excludes_other_owners(
    repo, make_event, owner, other_user
):
    from apps.organizations.repositories import OrganizationRepository

    make_event(title="Owner Live", status=EventStatus.LIVE)
    make_event(title="Owner Draft", status=EventStatus.DRAFT)
    other_org = OrganizationRepository().create(owner_id=other_user.id, name="Rival Co")
    make_event(title="Rival Event", status=EventStatus.LIVE, org=other_org)

    titles = {e.title for e in repo.list_by_owner(owner.id)}

    assert titles == {"Owner Live", "Owner Draft"}
