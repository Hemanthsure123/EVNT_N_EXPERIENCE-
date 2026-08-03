"""Event content: media, FAQs and running order.

Two rules carry the weight here and are tested first:

1. **The media caps are real.** One hero, ten gallery, one video — enforced in
   the service, because a partial index can enforce a singleton but not a
   count, and a rule split across two layers drifts.
2. **Ordering is correct across midnight.** A festival's after-party starts at
   00:30 the following morning; a time-of-day sort would put it before the
   doors. Storing an instant makes the order right by construction.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone

from apps.events.models import EventFaq, EventMedia, EventStatus, MediaKind, TimelineKind
from apps.events.repositories import MEDIA_LIMITS, EventContentRepository, EventRepository
from apps.events.services import EventContentService
from core.adapters.local.local_storage import LocalStorageAdapter
from core.errors import InvalidInputError

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures


@pytest.fixture
def content() -> EventContentService:
    # Real repositories and the LOCAL storage adapter, never `config.di` — a
    # unit test must not depend on settings-driven backend selection.
    return EventContentService(
        events=EventRepository(),
        content=EventContentRepository(),
        storage=LocalStorageAdapter(),
    )


@pytest.fixture
def repo() -> EventContentRepository:
    return EventContentRepository()


def add_image(service: EventContentService, event, owner, **overrides):
    payload = {
        "event_id": event.id,
        "actor_id": owner.id,
        "kind": MediaKind.GALLERY,
        "url": "https://cdn.example/a.jpg",
        "alt_text": "A crowd at the front of the stage",
        **overrides,
    }
    return service.add_media(**payload)


@pytest.mark.django_db
class TestMediaCaps:
    def test_a_second_hero_is_refused(self, content, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)
        add_image(content, event, owner, kind=MediaKind.HERO)

        with pytest.raises(InvalidInputError) as caught:
            add_image(content, event, owner, kind=MediaKind.HERO)
        # The message names the limit, because that is the only version an
        # organizer can act on.
        assert "maximum of 1" in str(caught.value)

    def test_the_eleventh_gallery_image_is_refused(self, content, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)
        for index in range(MEDIA_LIMITS[MediaKind.GALLERY]):
            add_image(content, event, owner, position=index)

        with pytest.raises(InvalidInputError):
            add_image(content, event, owner)

    def test_removing_one_frees_a_slot(self, content, repo, make_event, owner):
        """A soft delete must actually free capacity, or an organizer who
        swaps an image is permanently one short."""
        event = make_event(status=EventStatus.DRAFT)
        hero = add_image(content, event, owner, kind=MediaKind.HERO)

        content.remove_media(event_id=event.id, actor_id=owner.id, media_id=hero.id)
        replacement = add_image(content, event, owner, kind=MediaKind.HERO)

        assert replacement.id != hero.id
        assert repo.count_media(event.id, MediaKind.HERO) == 1

    def test_the_caps_are_per_event(self, content, make_event, owner):
        first = make_event(status=EventStatus.DRAFT)
        second = make_event(status=EventStatus.DRAFT)
        add_image(content, first, owner, kind=MediaKind.HERO)

        # Not a global limit — the second event has its own allowance.
        assert add_image(content, second, owner, kind=MediaKind.HERO)


@pytest.mark.django_db
class TestAltText:
    def test_alt_text_is_required(self, content, make_event, owner):
        """The most-viewed image on the platform must not be invisible to a
        screen reader."""
        event = make_event(status=EventStatus.DRAFT)
        with pytest.raises(InvalidInputError) as caught:
            add_image(content, event, owner, alt_text="   ")
        assert "screen reader" in str(caught.value)

    def test_the_column_still_allows_blank_for_historical_rows(self, make_event):
        """Backfilling must not fail. The service is the gate, not the column."""
        event = make_event(status=EventStatus.DRAFT)
        assert EventMedia.objects.create(event=event, url="https://cdn/x.jpg", alt_text="")


@pytest.mark.django_db
class TestOwnership:
    def test_another_organizer_cannot_add_media(self, content, make_event, other_user):
        event = make_event(status=EventStatus.DRAFT)
        from apps.events.exceptions import EventNotFoundError

        # NotFound rather than PermissionDenied — a 403 would confirm the event
        # exists to anyone guessing ids.
        with pytest.raises(EventNotFoundError):
            add_image(content, event, other_user)


@pytest.mark.django_db
class TestReads:
    def test_soft_deleted_and_hidden_media_are_excluded(self, content, repo, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)
        keep = add_image(content, event, owner, position=0)
        drop = add_image(content, event, owner, position=1)
        hidden = add_image(content, event, owner, position=2)

        content.remove_media(event_id=event.id, actor_id=owner.id, media_id=drop.id)
        EventMedia.objects.filter(pk=hidden.id).update(is_visible=False)

        assert [media.id for media in repo.media_for(event.id)] == [keep.id]

    def test_media_is_ordered_by_position(self, content, repo, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)
        add_image(content, event, owner, position=2, caption="third")
        add_image(content, event, owner, position=0, caption="first")
        add_image(content, event, owner, position=1, caption="second")

        assert [media.caption for media in repo.media_for(event.id)] == [
            "first",
            "second",
            "third",
        ]

    def test_unpublished_faqs_are_excluded(self, content, repo, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)
        shown = content.add_faq(
            event_id=event.id, actor_id=owner.id, question="Is there parking?", answer="Yes."
        )
        hidden = content.add_faq(
            event_id=event.id, actor_id=owner.id, question="Draft?", answer="Not ready."
        )
        EventFaq.objects.filter(pk=hidden.id).update(is_published=False)

        assert [faq.id for faq in repo.faqs_for(event.id)] == [shown.id]

    def test_an_faq_needs_both_halves(self, content, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)
        with pytest.raises(InvalidInputError):
            content.add_faq(event_id=event.id, actor_id=owner.id, question="Why?", answer="  ")


@pytest.mark.django_db
class TestTimeline:
    def test_entries_sort_correctly_across_midnight(self, content, repo, make_event, owner):
        """The bug this prevents: a time-of-day sort puts a 00:30 after-party
        BEFORE the 19:00 doors."""
        event = make_event(status=EventStatus.DRAFT)
        doors = timezone.now().replace(hour=19, minute=0, second=0, microsecond=0)

        content.add_timeline_entry(
            event_id=event.id,
            actor_id=owner.id,
            kind=TimelineKind.AFTER_PARTY,
            label="After party",
            starts_at=doors + dt.timedelta(hours=5, minutes=30),  # 00:30 next day
            position=1,
        )
        content.add_timeline_entry(
            event_id=event.id,
            actor_id=owner.id,
            kind=TimelineKind.DOORS,
            label="Doors open",
            starts_at=doors,
            position=0,
        )

        assert [entry.label for entry in repo.timeline_for(event.id)] == [
            "Doors open",
            "After party",
        ]

    def test_entries_without_a_time_sort_last(self, content, repo, make_event, owner):
        """An organizer may know the running order before the clock times; a
        null must not float to the top."""
        event = make_event(status=EventStatus.DRAFT)
        content.add_timeline_entry(
            event_id=event.id, actor_id=owner.id, kind=TimelineKind.MAIN, label="TBC", position=0
        )
        content.add_timeline_entry(
            event_id=event.id,
            actor_id=owner.id,
            kind=TimelineKind.DOORS,
            label="Doors",
            starts_at=timezone.now(),
            position=0,
        )

        assert [entry.label for entry in repo.timeline_for(event.id)] == ["Doors", "TBC"]

    def test_a_timeline_entry_needs_a_label(self, content, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)
        with pytest.raises(InvalidInputError):
            content.add_timeline_entry(
                event_id=event.id, actor_id=owner.id, kind=TimelineKind.MAIN, label="  "
            )


@pytest.mark.django_db
def test_content_fields_default_to_empty_rather_than_placeholder(make_event):
    """Blank means "the organizer did not say", and the UI omits the row.
    A default of "2 hours" or "All ages" would be a claim nobody made."""
    event = make_event(status=EventStatus.DRAFT)

    assert event.short_description == ""
    assert event.duration_minutes is None
    assert event.language == ""
    assert event.age_restriction == ""
    assert event.accessibility_notes == ""
    assert event.seo_title == ""
