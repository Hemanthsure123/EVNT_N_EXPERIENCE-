"""What a tier IS, and what it includes.

A ticket on this platform is not exchangeable, so buying the wrong tier is the
most expensive mistake a buyer can make — and the panel had only a name and a
price to tell two tiers apart. "Gold" and "Premium" are one organiser's
vocabulary; "Standing, front of the barrier" is the sentence that stops
somebody buying the wrong one.

Three columns, and each shape is a decision:

- `description` — one sentence, blank by default. Most tiers are
  self-describing and the panel omits the line rather than rendering an empty
  paragraph.
- `perks` — a JSON LIST, because a buyer comparing two tiers wants the
  difference, not two paragraphs to diff by eye.
- `position` — the organiser's own order, with price as the tiebreak. A
  festival's weekend pass belongs above the day tickets whatever it costs, and
  merchandising is the one thing a price sort cannot express.

None of the three can affect what is SOLD. They are what the panel reads, so
they ride the ordinary optimistic-locked update with no extra rule — which the
last test pins, because a content edit that could touch a counter would be a
money-path change wearing content clothes.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization
from apps.ticketing.models import TicketType


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="tier-owner@example.com", password="owner12345")
    org = Organization.objects.create(owner=owner, name="Tier Co")
    event = Event.objects.create(
        organization=org,
        title="Festival",
        venue="The Grounds",
        city="Goa",
        starts_at=timezone.now() + dt.timedelta(days=20),
        status=EventStatus.LIVE,
    )
    return {
        "owner": owner,
        "event": event,
        "url": f"/api/v1/events/{event.id}/ticket-types",
    }


def create(world, **payload):
    body = {"name": "GA", "price": 50_000, "quantity": 100, **payload}
    return auth(world["owner"]).post(world["url"], body, format="json")


@pytest.mark.django_db
class TestWriting:
    def test_a_tier_carries_a_description_and_perks(self, world):
        response = create(
            world,
            description="Standing, front of the barrier.",
            perks=["Early entry", "Dedicated bar"],
        )

        assert response.status_code == 201
        assert response.data["description"] == "Standing, front of the barrier."
        assert response.data["perks"] == ["Early entry", "Dedicated bar"]

    def test_blank_perks_are_dropped_rather_than_failing_the_save(self, world):
        """An organiser who tabbed through an empty row should not have their
        tier refused, and an empty tick on the panel is a rendering fault."""
        response = create(world, perks=["Early entry", "   ", ""])
        assert response.status_code == 201
        assert response.data["perks"] == ["Early entry"]

    def test_duplicate_perks_are_dropped(self, world):
        """The same promise twice reads as a bug."""
        response = create(world, perks=["Early entry", "Early entry"])
        assert response.data["perks"] == ["Early entry"]

    def test_perks_are_trimmed(self, world):
        assert create(world, perks=["  Early entry  "]).data["perks"] == ["Early entry"]

    def test_too_many_perks_are_refused(self, world):
        """Past this it is a brochure, and the panel renders them all — a perk
        behind a "show more" is one a buyer will say they were never promised."""
        response = create(world, perks=[f"Perk {n}" for n in range(9)])
        assert response.status_code == 400

    def test_a_tier_with_neither_is_the_ordinary_case(self, world):
        """Blank is the norm, not a gap: most tiers are self-describing."""
        response = create(world)
        assert response.data["description"] == ""
        assert response.data["perks"] == []

    def test_they_are_editable_after_creation(self, world):
        """A column the panel renders must be reachable by a PATCH, or the
        field is decoration."""
        tier_id = create(world).data["id"]
        response = auth(world["owner"]).patch(
            f"/api/v1/ticket-types/{tier_id}",
            {"version": 1, "description": "Seated, upper tier.", "perks": ["Cushioned seat"]},
            format="json",
        )

        assert response.status_code == 200
        assert response.data["description"] == "Seated, upper tier."
        assert response.data["perks"] == ["Cushioned seat"]

    def test_an_empty_list_CLEARS_the_perks(self, world):
        tier_id = create(world, perks=["Early entry"]).data["id"]
        response = auth(world["owner"]).patch(
            f"/api/v1/ticket-types/{tier_id}", {"version": 1, "perks": []}, format="json"
        )
        assert response.data["perks"] == []


@pytest.mark.django_db
class TestOrdering:
    def test_position_beats_price(self, world):
        """The festival case: the weekend pass sits above the day tickets even
        though it costs more."""
        TicketType.objects.create(
            event=world["event"], name="Day pass", price_minor=50_000, quantity=100, position=1
        )
        TicketType.objects.create(
            event=world["event"], name="Weekend pass", price_minor=150_000, quantity=100, position=0
        )

        body = APIClient().get(world["url"]).json()
        assert [row["name"] for row in body["data"]] == ["Weekend pass", "Day pass"]

    def test_an_untouched_event_still_sorts_cheapest_first(self, world):
        """Every tier defaults to position 0, so an organiser who never touches
        it gets exactly the old behaviour — this is the compatibility guard."""
        for name, price in (("Premium", 300_000), ("Basic", 50_000), ("Gold", 150_000)):
            TicketType.objects.create(
                event=world["event"], name=name, price_minor=price, quantity=100
            )

        body = APIClient().get(world["url"]).json()
        assert [row["name"] for row in body["data"]] == ["Basic", "Gold", "Premium"]


@pytest.mark.django_db
class TestItIsContentAndNotInventory:
    def test_editing_content_leaves_every_counter_alone(self, world):
        """The load-bearing property. These three fields are what the panel
        READS; a content edit that could touch a counter would be a money-path
        change wearing content clothes."""
        from config.di import build_ticketing_service

        tier = TicketType.objects.create(
            event=world["event"], name="GA", price_minor=50_000, quantity=100
        )
        build_ticketing_service().reserve(ticket_type_id=tier.id, quantity=4)
        tier.refresh_from_db()
        before = (tier.quantity, tier.sold, tier.reserved, tier.available)

        auth(world["owner"]).patch(
            f"/api/v1/ticket-types/{tier.id}",
            {
                "version": tier.version,
                "description": "Standing.",
                "perks": ["Early entry"],
                "position": 3,
            },
            format="json",
        )

        tier.refresh_from_db()
        assert (tier.quantity, tier.sold, tier.reserved, tier.available) == before

    def test_a_stale_version_is_still_a_409(self, world):
        """Content rides the SAME optimistic lock as price and quantity — one
        update path, so a concurrent editor cannot be clobbered by a
        description."""
        tier_id = create(world).data["id"]
        auth(world["owner"]).patch(
            f"/api/v1/ticket-types/{tier_id}", {"version": 1, "description": "A"}, format="json"
        )
        second = auth(world["owner"]).patch(
            f"/api/v1/ticket-types/{tier_id}", {"version": 1, "description": "B"}, format="json"
        )
        assert second.status_code == 409


@pytest.mark.django_db
def test_the_tier_list_stays_within_its_query_budget(world, django_assert_num_queries):
    """`perks` is a JSON column on the row, not a related table — so adding
    "what is included" cost the availability read, which is deliberately
    uncached, exactly nothing."""
    for name in ("Basic", "Gold"):
        TicketType.objects.create(
            event=world["event"],
            name=name,
            price_minor=50_000,
            quantity=100,
            perks=["Early entry", "Dedicated bar"],
        )

    from apps.ticketing.repositories import TicketTypeRepository
    from apps.ticketing.schemas import TicketTypeSerializer

    with django_assert_num_queries(2):  # the tiers, plus ONE prefetch for phases
        rows = list(TicketTypeRepository().list_for_event(world["event"].id))
        rendered = TicketTypeSerializer(rows, many=True).data

    assert [row["perks"] for row in rendered] == [
        ["Early entry", "Dedicated bar"],
        ["Early entry", "Dedicated bar"],
    ]
