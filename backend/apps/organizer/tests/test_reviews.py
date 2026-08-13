"""`GET /organizer/reviews` — an organizer reads their own events' reviews.

The endpoint is READ-ONLY and PUBLISHED-ONLY, and both are decisions rather
than omissions. See `OrganizerRepository.reviews`.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.reviews.models import EventReview, ReviewStatus

from .conftest import World

pytestmark = pytest.mark.django_db

URL = "/api/v1/organizer/reviews"


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _review(event, user, *, rating=5, status=ReviewStatus.PUBLISHED, body="Great night."):
    return EventReview.objects.create(
        event=event, user=user, rating=rating, body=body, status=status
    )


class TestOwnership:
    def test_only_the_callers_own_events_are_listed(self, world: World) -> None:
        """The one assertion that matters. Reviews name customers and carry
        criticism; another organizer's must never appear here."""
        _review(world.event, world.customer, body="Mine")
        _review(world.rival_event, world.other_customer, body="The rival's")

        payload = auth(world.owner).get(URL).json()

        bodies = [row["body"] for row in payload["data"]]
        assert bodies == ["Mine"]

    def test_a_rival_sees_only_their_own(self, world: World) -> None:
        _review(world.event, world.customer, body="Mine")
        _review(world.rival_event, world.other_customer, body="The rival's")

        payload = auth(world.rival).get(URL).json()

        assert [row["body"] for row in payload["data"]] == ["The rival's"]

    def test_it_requires_authentication(self) -> None:
        assert APIClient().get(URL).status_code in (401, 403)


class TestModeration:
    def test_hidden_reviews_are_withheld_from_the_organizer(self, world: World) -> None:
        """A hidden review is one an operator REMOVED from the public page.

        Showing it here would hand the organizer a complaint the platform has
        already withdrawn, that they cannot act on, and that they are likely to
        answer — which is the outcome moderation existed to prevent.
        """
        _review(world.event, world.customer, body="Visible")
        _review(world.event, world.other_customer, body="Taken down", status=ReviewStatus.HIDDEN)

        payload = auth(world.owner).get(URL).json()

        assert [row["body"] for row in payload["data"]] == ["Visible"]


class TestShape:
    def test_the_row_names_the_event_and_the_reviewer(self, world: World) -> None:
        world.customer.full_name = "Asha Rao"
        world.customer.save(update_fields=["full_name"])
        _review(world.event, world.customer, rating=4)

        row = auth(world.owner).get(URL).json()["data"][0]

        assert row["rating"] == 4
        assert row["event_title"] == world.event.title
        assert row["reviewer_name"] == "Asha Rao"
        # The address is deliberately absent: naming is enough to recognise a
        # regular, and an email invites contact off-platform where no record of
        # it exists.
        assert "email" not in row

    def test_a_reviewer_with_no_name_does_not_render_an_empty_cell(self, world: World) -> None:
        world.customer.full_name = ""
        world.customer.save(update_fields=["full_name"])
        _review(world.event, world.customer)

        row = auth(world.owner).get(URL).json()["data"][0]
        assert row["reviewer_name"] == "A guest"

    def test_it_can_be_narrowed_to_one_event(self, world: World) -> None:
        _review(world.event, world.customer, body="First")
        _review(world.second_event, world.other_customer, body="Second")

        payload = auth(world.owner).get(f"{URL}?event_id={world.second_event.id}").json()

        assert [row["body"] for row in payload["data"]] == ["Second"]

    def test_the_response_is_never_shared_cacheable(self, world: World) -> None:
        """Per-organizer data carrying customer names."""
        response = auth(world.owner).get(URL)
        assert response["Cache-Control"] == "private, no-store"
