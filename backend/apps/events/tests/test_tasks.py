from __future__ import annotations

import pytest

from apps.events.models import EventStatus
from apps.events.repositories import EventRepository
from apps.events.tasks import process_poster


@pytest.mark.django_db
def test_process_poster_replaces_the_url_with_a_processed_variant(make_event):
    event = make_event(status=EventStatus.LIVE)

    process_poster({"event_id": str(event.id), "poster_url": "https://cdn.test/original.jpg"})

    refreshed = EventRepository().get_active_by_id(event.id)
    assert refreshed is not None
    assert refreshed.poster_url == "https://cdn.test/original.jpg?variant=1280w"


@pytest.mark.django_db
def test_process_poster_is_a_noop_for_a_missing_event(caplog):
    # Must not raise — a broken background job must never surface as an error.
    process_poster({"event_id": "00000000-0000-0000-0000-000000000000", "poster_url": "x"})
