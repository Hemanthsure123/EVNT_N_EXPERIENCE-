"""The event editor's tier read.

The same rows the public ticket panel gets, behind a different door. Three
things have to be true, and the middle one is the reason the endpoint exists at
all:

1. It is scoped to the caller's own events, and says "not found" rather than
   "forbidden" for somebody else's — otherwise it is a way to test whether an
   event id is real.
2. It is `private, no-store`. Every row carries `version`, the editor's writes
   are conditional on that version, and a version out of a shared cache is a
   version that may already be one behind. The consequence is not a stale
   number on a screen: it is a 409 the wizard answers by RELOADING rather than
   retrying, so the organizer edits, saves, gets reloaded, and never finds out
   why nothing sticks.
3. It carries the fields an editor needs to round-trip a tier — `version`
   above all, plus the merchandising `position` the public panel now sorts by.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.ticketing.models import TicketType

from .conftest import World


def authed(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def url(event_id) -> str:
    return f"/api/v1/organizer/events/{event_id}/ticket-types"


@pytest.mark.django_db
def test_the_owner_gets_their_events_tiers(world: World) -> None:
    response = authed(world.owner).get(url(world.event.id))

    assert response.status_code == 200
    ids = [row["id"] for row in response.json()["data"]]
    assert str(world.tier.id) in ids
    # And nothing from the rival's event, which the fixture gives its own tiers.
    rival_ids = {
        str(pk)
        for pk in TicketType.objects.filter(event=world.rival_event).values_list("id", flat=True)
    }
    assert rival_ids.isdisjoint(ids)


@pytest.mark.django_db
def test_a_rival_organizer_is_told_it_does_not_exist(world: World) -> None:
    """Not 403. A different answer for "yours" and "someone else's" turns this
    into an oracle for whether an id is a real event."""
    response = authed(world.rival).get(url(world.event.id))

    assert response.status_code == 404


@pytest.mark.django_db
def test_an_unknown_event_answers_the_same_way(world: World) -> None:
    response = authed(world.owner).get(url("11111111-1111-4111-8111-111111111111"))

    assert response.status_code == 404


@pytest.mark.django_db
def test_anonymous_is_refused(world: World) -> None:
    assert APIClient().get(url(world.event.id)).status_code in (401, 403)


@pytest.mark.django_db
def test_nothing_may_cache_it(world: World) -> None:
    """THE POINT OF THE ENDPOINT.

    The public tier list is `public` with an `s-maxage`, which is correct for
    availability display and wrong for an editor: a cached `version` is a 409
    loop. If this assertion ever fails, the editor has quietly been given a
    shared cache to read its optimistic locks out of.
    """
    response = authed(world.owner).get(url(world.event.id))

    assert response["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_it_carries_what_an_editor_has_to_round_trip(world: World) -> None:
    rows = authed(world.owner).get(url(world.event.id)).json()["data"]
    row = next(candidate for candidate in rows if candidate["id"] == str(world.tier.id))

    # `version` is what makes the conditional UPDATE safe; `position` is what
    # the public panel sorts by, so an editor that could not read it back would
    # renumber the organizer's arrangement on every save.
    for field in ("id", "version", "position", "name", "price", "quantity", "max_per_order"):
        assert field in row, field


@pytest.mark.django_db
def test_it_reflects_a_write_immediately(world: World) -> None:
    """No server-side cache either. An editor reopened straight after a save
    must see the row it just wrote, not the one before it."""
    TicketType.objects.filter(id=world.tier.id).update(
        name="Renamed", version=world.tier.version + 1
    )

    rows = authed(world.owner).get(url(world.event.id)).json()["data"]
    row = next(candidate for candidate in rows if candidate["id"] == str(world.tier.id))

    assert row["name"] == "Renamed"
    assert row["version"] == world.tier.version + 1
