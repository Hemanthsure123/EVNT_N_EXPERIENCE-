"""The gallery's two bounds, and why they are enforced in two different places.

A gallery holds between 2 and 10 photographs. The two halves of that sentence
are NOT symmetrical, and the asymmetry is the thing worth pinning:

* The **maximum** is an upload-time refusal. The eleventh image is a request
  that can be answered on its own terms — there is no room, and nothing about
  the event's other state changes that.
* The **minimum** is a PUBLISH gate. Images arrive one request at a time, so a
  save-time floor would refuse the first upload for being the first; and a
  removal-time floor would trap an organizer replacing both of their photos
  unless they added before subtracting, in an order nobody would guess.

Zero is not a failure. Most events publish no gallery at all.
"""

from __future__ import annotations

import pytest

from apps.events import publish_checks
from apps.events.exceptions import EventNotPublishableError
from apps.events.models import EventMedia, EventStatus, MediaKind
from apps.events.repositories import MEDIA_LIMITS, MIN_GALLERY_IMAGES

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures


def add_gallery_rows(event, count: int) -> None:
    """Rows straight through the ORM: this file is about the COUNT, not about
    the upload path (which `test_content.py` already covers end to end)."""
    for position in range(count):
        EventMedia.objects.create(
            event=event,
            kind=MediaKind.GALLERY,
            url=f"https://cdn.test/gallery-{position}.jpg",
            alt_text=f"Photo {position}",
            position=position,
        )


@pytest.mark.django_db
class TestTheMinimumIsAPublishGate:
    def test_no_gallery_publishes_perfectly_well(self, make_event, add_ticket_type):
        # The rule is about a gallery that EXISTS being worth the name. A gate
        # demanding two photographs of a club night would refuse to publish it.
        #
        # `add_ticket_type` passes ticketing's own gate — every "does not raise"
        # case here has to clear EVERY registered check, not just this one.
        event = make_event(status=EventStatus.DRAFT)
        add_ticket_type(event)
        publish_checks.run_publish_checks(event)  # does not raise

    def test_one_photo_is_refused(self, make_event):
        event = make_event(status=EventStatus.DRAFT)
        add_gallery_rows(event, 1)

        with pytest.raises(EventNotPublishableError) as caught:
            publish_checks.run_publish_checks(event)

        # It NAMES the number and both ways out. "Invalid gallery" would send
        # the organizer nowhere.
        assert str(MIN_GALLERY_IMAGES) in caught.value.message
        assert "remove" in caught.value.message.lower()

    def test_the_minimum_itself_publishes(self, make_event, add_ticket_type):
        event = make_event(status=EventStatus.DRAFT)
        add_ticket_type(event)
        add_gallery_rows(event, MIN_GALLERY_IMAGES)
        publish_checks.run_publish_checks(event)  # does not raise

    def test_a_full_gallery_publishes(self, make_event, add_ticket_type):
        event = make_event(status=EventStatus.DRAFT)
        add_ticket_type(event)
        add_gallery_rows(event, MEDIA_LIMITS[MediaKind.GALLERY])
        publish_checks.run_publish_checks(event)  # does not raise

    def test_a_soft_deleted_photo_does_not_count(self, make_event):
        # Removing one of two must actually refuse the publish, or the gate is
        # counting rows rather than pictures anybody can see.
        event = make_event(status=EventStatus.DRAFT)
        add_gallery_rows(event, 2)
        row = EventMedia.objects.filter(event=event).first()
        assert row is not None
        row.deleted_at = row.created_at
        row.save(update_fields=["deleted_at"])

        with pytest.raises(EventNotPublishableError):
            publish_checks.run_publish_checks(event)

    def test_another_kind_is_not_a_gallery(self, make_event):
        # A hero image is not one of the two. Counting every media row would
        # let a poster satisfy a rule about photographs.
        event = make_event(status=EventStatus.DRAFT)
        add_gallery_rows(event, 1)
        EventMedia.objects.create(
            event=event,
            kind=MediaKind.HERO,
            url="https://cdn.test/hero.jpg",
            alt_text="Hero",
        )

        with pytest.raises(EventNotPublishableError):
            publish_checks.run_publish_checks(event)


def test_the_bounds_are_the_ones_the_brief_asked_for():
    # Pinned as VALUES, because both are quoted to organizers in copy and in an
    # API error message — moving either silently is how the two disagree.
    assert MIN_GALLERY_IMAGES == 2
    assert MEDIA_LIMITS[MediaKind.GALLERY] == 10
    assert MEDIA_LIMITS[MediaKind.GALLERY] > MIN_GALLERY_IMAGES
