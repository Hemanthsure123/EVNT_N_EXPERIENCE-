"""What the taxonomy DOES: the publish gate, the write boundary, the filter.

Split from `test_taxonomy.py`, which is about the vocabulary itself and the
frontend mirror and needs no database. These need one for every test, so
keeping them apart means the cheap contract checks stay cheap.

The filter tests are the ones that matter most. A tag column an organizer can
fill in but nobody can search by is decoration — collecting seven of them at
publish time and then offering no way to use them would be the worst version of
this feature, and it is the half that is easy to skip.
"""

from __future__ import annotations

import pytest

from apps.events.models import Event
from apps.events.taxonomy import ALL_TAGS, MAX_TAGS, MIN_TAGS_TO_PUBLISH

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures


@pytest.mark.django_db
class TestThePublishGate:
    """The minimum bites, and it bites at PUBLISH rather than at save.

    Both halves matter. A gate that never fires is decoration; a gate that
    fired on save would stop somebody keeping a draft while they think.
    """

    def test_an_event_without_enough_tags_cannot_be_submitted(
        self, authed_client, make_event, add_ticket_type
    ):
        draft = make_event(status="draft", tags=["outdoor"])
        # Satisfy ticketing's gate, so the refusal can only be about tags.
        add_ticket_type(draft)

        response = authed_client.post(f"/api/v1/events/{draft.id}/publish", format="json")

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "event_not_publishable"
        # The message NAMES the number, so an organizer knows how far off they
        # are rather than only that something is wrong.
        assert str(MIN_TAGS_TO_PUBLISH) in response.json()["error"]["message"]

    def test_an_event_with_enough_tags_is_submitted(
        self, authed_client, make_event, add_ticket_type
    ):
        draft = make_event(status="draft")
        add_ticket_type(draft)  # ticketing's own publish gate

        response = authed_client.post(f"/api/v1/events/{draft.id}/publish", format="json")

        assert response.status_code == 200

    def test_a_draft_with_no_tags_still_saves(self, authed_client, make_event):
        """The rule that keeps the wizard usable.

        The editor autosaves on a keystroke. If the minimum were a validation
        rule rather than a publish gate, somebody who had typed a title could
        not keep it while they decided on tags — and every later save on that
        event would 400 too, because the mapper sends the whole editable
        surface every time.
        """
        draft = make_event(status="draft", tags=[])

        response = authed_client.patch(
            f"/api/v1/events/{draft.id}",
            {"title": "Renamed while I think about tags", "version": draft.version},
            format="json",
        )

        assert response.status_code == 200


@pytest.mark.django_db
class TestTheWriteBoundary:
    def test_the_new_fields_round_trip_through_a_patch(self, authed_client, make_event):
        event = make_event(status="draft")

        response = authed_client.patch(
            f"/api/v1/events/{event.id}",
            {
                "highlights_included": ["Two rounds of chai", "   ", "All materials"],
                "highlights_excluded": ["Travel to the venue"],
                "guidelines": ["Carry a photo ID"],
                "event_type": "open-mic",
                "tags": ["outdoor", "solo-friendly", "outdoor"],
                "version": event.version,
            },
            format="json",
        )

        assert response.status_code == 200, response.data
        body = response.json()
        # Blanks dropped, duplicates collapsed, order preserved — the order is
        # the organiser's and a set would reshuffle the chips on every save.
        assert body["highlights_included"] == ["Two rounds of chai", "All materials"]
        assert body["tags"] == ["outdoor", "solo-friendly"]
        assert body["event_type"] == "open-mic"

    def test_an_empty_list_clears_the_field(self, authed_client, make_event):
        """Wholesale replacement, the contract `policies` already has. If an
        empty list were treated as "leave it alone", deleting your last bullet
        would silently fail."""
        event = make_event(status="draft")
        Event.objects.filter(pk=event.id).update(guidelines=["Carry a photo ID"])
        event.refresh_from_db()

        response = authed_client.patch(
            f"/api/v1/events/{event.id}",
            {"guidelines": [], "version": event.version},
            format="json",
        )

        assert response.status_code == 200, response.data
        assert response.json()["guidelines"] == []

    def test_an_unknown_tag_is_refused_and_named(self, authed_client, make_event):
        """A write refuses what it does not know, unlike a browse filter.

        A tag outside the vocabulary matches no filter and appears on no chip,
        so accepting one would store a silent no-op for the life of the event.
        """
        event = make_event(status="draft")

        response = authed_client.patch(
            f"/api/v1/events/{event.id}",
            {"tags": ["outdoor", "vibes-immaculate"]},
            format="json",
        )

        assert response.status_code == 400
        assert "vibes-immaculate" in str(response.data)

    def test_an_unknown_event_type_is_refused(self, authed_client, make_event):
        event = make_event(status="draft")

        response = authed_client.patch(
            f"/api/v1/events/{event.id}",
            {"event_type": "interpretive-spreadsheet", "version": event.version},
            format="json",
        )

        assert response.status_code == 400

    def test_the_event_type_can_be_cleared_back_to_not_said(self, authed_client, make_event):
        """Blank is a real state, distinct from every value in the list."""
        event = make_event(status="draft")
        Event.objects.filter(pk=event.id).update(event_type="open-mic")
        event.refresh_from_db()

        response = authed_client.patch(
            f"/api/v1/events/{event.id}",
            {"event_type": "", "version": event.version},
            format="json",
        )

        assert response.status_code == 200
        assert response.json()["event_type"] == ""

    def test_more_than_the_maximum_tags_is_refused(self, authed_client, make_event):
        event = make_event(status="draft")
        too_many = sorted(ALL_TAGS)[: MAX_TAGS + 1]

        response = authed_client.patch(
            f"/api/v1/events/{event.id}",
            {"tags": too_many, "version": event.version},
            format="json",
        )

        assert response.status_code == 400


@pytest.mark.django_db
class TestBrowseFiltering:
    """The half that makes the column worth collecting."""

    def test_the_browse_list_filters_by_tag(self, api_client, make_event):
        make_event(title="Rooftop set", tags=["rooftop", "high-energy"])
        make_event(title="Basement gig", tags=["indoor", "high-energy"])

        response = api_client.get("/api/v1/events?tag=rooftop")

        assert response.status_code == 200
        assert [row["title"] for row in response.json()["data"]] == ["Rooftop set"]

    def test_the_browse_list_filters_by_event_type(self, api_client, make_event):
        listed = make_event(title="Open mic night")
        Event.objects.filter(pk=listed.id).update(event_type="open-mic")
        make_event(title="Something else")

        response = api_client.get("/api/v1/events?event_type=open-mic")

        assert [row["title"] for row in response.json()["data"]] == ["Open mic night"]

    def test_an_unknown_filter_value_matches_nothing_rather_than_400ing(
        self, api_client, make_event
    ):
        """These arrive in links people share and hand-edit. The browse view is
        already scoped safely, so the worst an unrecognised value can do is
        return nothing — which is honest — where a 400 is a broken page."""
        make_event(title="Rooftop set", tags=["rooftop"])

        response = api_client.get("/api/v1/events?tag=not-a-real-tag")

        assert response.status_code == 200
        assert response.json()["data"] == []

    def test_two_different_tags_do_not_share_a_cached_page(self, api_client, make_event):
        """The filter must be in `api.py`'s `filters` dict, which is what
        `compute_filter_hash` sees. Omitted there, the first page of one tag
        would be served for another for the life of the cache generation —
        silently, and only on the cached first page."""
        make_event(title="Rooftop set", tags=["rooftop"])
        make_event(title="Quiet room", tags=["mindful"])

        first = api_client.get("/api/v1/events?tag=rooftop").json()["data"]
        second = api_client.get("/api/v1/events?tag=mindful").json()["data"]

        assert [row["title"] for row in first] == ["Rooftop set"]
        assert [row["title"] for row in second] == ["Quiet room"]
