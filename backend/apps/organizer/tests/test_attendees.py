"""The gate list — `GET /organizer/events/{id}/attendees`.

The read side of `checkin`. The scan desk resolves ONE token at a time, which
is right at a door and useless for "has Priya arrived" or "export the list
before we lose signal".

Three themes, and each is a way this endpoint could be quietly wrong:

1. **One row per TICKET, never per booking.** A booking for six seats is six
   people through a door. Getting this wrong produces a list that is the right
   shape, sorted correctly, and the wrong length.
2. **The holder is not always the buyer**, and the phone number is the buyer's.
   A re-addressed ticket that carries the buyer's number under somebody else's
   name is the quietest possible way for a steward to ring the wrong person.
3. **Somebody else's attendees.** This list is names, emails and phone numbers,
   so the ownership check is not a cosmetic 403 — and it answers 404, because a
   403 confirms the event exists to anybody guessing ids.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.booking.models import Ticket, TicketStatus

from .conftest import World


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def path(event_id) -> str:
    return f"/api/v1/organizer/events/{event_id}/attendees"


@pytest.mark.django_db
class TestAccess:
    def test_anonymous_is_refused(self, world: World) -> None:
        assert APIClient().get(path(world.event.id)).status_code == 401

    def test_a_rival_gets_404_not_403(self, world: World) -> None:
        """A 403 would confirm the event exists to anybody guessing ids."""
        response = auth(world.rival).get(path(world.event.id))
        assert response.status_code == 404

    def test_the_owner_cannot_read_a_rival_event(self, world: World) -> None:
        assert auth(world.owner).get(path(world.rival_event.id)).status_code == 404

    def test_the_response_is_private_and_uncached(self, world: World) -> None:
        """Names, emails and phone numbers. Never a shared or CDN cache."""
        response = auth(world.owner).get(path(world.event.id))
        assert response.status_code == 200
        assert response["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
class TestOneRowPerTicket:
    def test_a_multi_seat_booking_is_several_rows(self, world: World) -> None:
        # The fixture's event has two paid bookings: two seats and one seat.
        # A per-BOOKING list would return 2 here, and be wrong in a way that
        # looks entirely reasonable.
        response = auth(world.owner).get(path(world.event.id))
        rows = response.json()["data"]
        assert len(rows) == Ticket.objects.filter(booking__event=world.event).count() == 3

    def test_it_carries_the_tier_each_ticket_admits_to(self, world: World) -> None:
        rows = auth(world.owner).get(path(world.event.id)).json()["data"]
        assert {row["ticket_type"] for row in rows} == {"Gold"}

    def test_a_voided_ticket_is_still_listed(self, world: World) -> None:
        # A refund voids a booking's tickets, and the person whose ticket was
        # voided is exactly the one who turns up anyway. Hiding them leaves a
        # steward with no way to see WHY somebody was refused.
        ticket = Ticket.objects.filter(booking__event=world.event).first()
        assert ticket is not None
        ticket.status = TicketStatus.VOID
        ticket.save(update_fields=["status"])

        rows = auth(world.owner).get(path(world.event.id)).json()["data"]
        assert len(rows) == 3
        assert any(row["status"] == "void" for row in rows)


@pytest.mark.django_db
class TestWhoThisAdmits:
    def test_the_buyer_is_the_holder_by_default(self, world: World) -> None:
        rows = auth(world.owner).get(path(world.event.id)).json()["data"]
        assert {row["holder_email"] for row in rows} == {
            "asha@example.com",
            "bala@example.com",
        }
        assert all(row["is_reassigned"] is False for row in rows)

    def test_an_assigned_attendee_replaces_the_buyer(self, world: World) -> None:
        ticket = Ticket.objects.filter(booking=world.booking).first()
        assert ticket is not None
        ticket.attendee_name = "Priya Nair"
        ticket.attendee_email = "priya@example.com"
        ticket.save(update_fields=["attendee_name", "attendee_email"])

        rows = auth(world.owner).get(path(world.event.id)).json()["data"]
        row = next(r for r in rows if r["ticket_id"] == str(ticket.id))

        assert row["holder_name"] == "Priya Nair"
        assert row["holder_email"] == "priya@example.com"
        assert row["is_reassigned"] is True
        # The buyer stays reachable — "who paid for this" has no other way to
        # be asked once a ticket has been re-addressed.
        assert row["buyer_email"] == "asha@example.com"

    def test_the_phone_is_the_buyers_and_only_when_they_are_the_one_admitted(
        self, world: World
    ) -> None:
        world.customer.phone = "+919876543210"
        world.customer.save(update_fields=["phone"])

        theirs, reassigned = Ticket.objects.filter(booking=world.booking).order_by("id")[:2]
        reassigned.attendee_name = "Priya Nair"
        reassigned.attendee_email = "priya@example.com"
        reassigned.save(update_fields=["attendee_name", "attendee_email"])

        rows = {
            row["ticket_id"]: row
            for row in auth(world.owner).get(path(world.event.id)).json()["data"]
        }

        assert rows[str(theirs.id)]["phone"] == "+919876543210"
        # NOT the buyer's number under Priya's name. Nothing stores an assigned
        # attendee's phone, so the honest answer is blank.
        assert rows[str(reassigned.id)]["phone"] == ""


@pytest.mark.django_db
class TestFilters:
    def test_checked_in_returns_only_the_admitted_ticket(self, world: World) -> None:
        rows = auth(world.owner).get(path(world.event.id), {"state": "checked_in"}).json()["data"]
        assert len(rows) == 1
        assert rows[0]["status"] == "used"
        assert rows[0]["gate"] == "Gate A"
        assert rows[0]["used_at"] is not None

    def test_expected_excludes_the_one_already_inside(self, world: World) -> None:
        rows = auth(world.owner).get(path(world.event.id), {"state": "expected"}).json()["data"]
        assert len(rows) == 2
        assert all(row["status"] == "active" for row in rows)

    def test_an_unknown_state_widens_rather_than_raising(self, world: World) -> None:
        # These arrive from a dropdown in a browser and the list is already
        # scoped to the caller's own event, so the worst a junk value can do is
        # show everybody.
        response = auth(world.owner).get(path(world.event.id), {"state": "nonsense"})
        assert response.status_code == 200
        assert len(response.json()["data"]) == 3

    def test_search_matches_a_buyer_by_email(self, world: World) -> None:
        rows = auth(world.owner).get(path(world.event.id), {"q": "bala@"}).json()["data"]
        assert len(rows) == 1
        assert rows[0]["holder_email"] == "bala@example.com"

    def test_search_matches_an_assigned_attendee_by_name(self, world: World) -> None:
        ticket = Ticket.objects.filter(booking=world.booking).first()
        assert ticket is not None
        ticket.attendee_name = "Priya Nair"
        ticket.save(update_fields=["attendee_name"])

        rows = auth(world.owner).get(path(world.event.id), {"q": "priya"}).json()["data"]
        assert [row["ticket_id"] for row in rows] == [str(ticket.id)]

    def test_search_matches_a_whole_ticket_id(self, world: World) -> None:
        # What a support desk pastes. The column is a uuid, so it is matched
        # EXACTLY — a substring search would need a cast that throws the index
        # away, for a query nobody performs.
        ticket = Ticket.objects.filter(booking__event=world.event).first()
        assert ticket is not None
        rows = auth(world.owner).get(path(world.event.id), {"q": str(ticket.id)}).json()["data"]
        assert [row["ticket_id"] for row in rows] == [str(ticket.id)]

    def test_a_search_term_that_is_not_a_uuid_does_not_raise(self, world: World) -> None:
        # A search box is where people type ordinary words, and `UUID(...)`
        # raises on every one of them.
        response = auth(world.owner).get(path(world.event.id), {"q": "not-a-uuid"})
        assert response.status_code == 200
        assert response.json()["data"] == []


@pytest.mark.django_db
class TestSort:
    def test_admitted_covers_only_tickets_that_have_a_used_at(self, world: World) -> None:
        # `used_at` is NULL for everybody who has not come through the door, and
        # a NULL in a keyset makes cursor paging SKIP rows. Ordering by it
        # therefore restricts the set to rows that have one.
        rows = auth(world.owner).get(path(world.event.id), {"sort": "admitted"}).json()["data"]
        assert len(rows) == 1
        assert rows[0]["used_at"] is not None

    def test_oldest_reverses_recent(self, world: World) -> None:
        recent = auth(world.owner).get(path(world.event.id), {"sort": "recent"}).json()["data"]
        oldest = auth(world.owner).get(path(world.event.id), {"sort": "oldest"}).json()["data"]
        assert [row["ticket_id"] for row in oldest] == [row["ticket_id"] for row in recent][::-1]

    def test_an_unknown_sort_falls_back_rather_than_pairing_a_mismatched_paginator(
        self, world: World
    ) -> None:
        # THE failure this guards: cursor pagination does not check that its
        # `ordering` matches the queryset's, and given a mismatch it returns
        # wrong pages silently. The sort key picks BOTH, from one mapping.
        response = auth(world.owner).get(path(world.event.id), {"sort": "sideways"})
        assert response.status_code == 200
        assert len(response.json()["data"]) == 3


@pytest.mark.django_db
class TestQueryBudget:
    def test_a_page_costs_the_same_whatever_its_size(
        self, world: World, django_assert_num_queries
    ) -> None:
        """No N+1 on the tier, the booking or the buyer.

        Every one of those is a join the row renders, so a missing
        `select_related` costs three extra queries per attendee — invisible on
        a fixture of three and fatal on a five-hundred-seat event.

        THREE: the ownership check, the page, and the FILTERED count the list
        prints as "Showing X of Y" — one COUNT over one event's tickets through
        an FK index, and a constant, so it cannot grow with the page. There is
        no fourth for the caller because `force_authenticate` skips the token
        lookup a real request pays — the same harness every other test in this
        module uses, so the number is comparable with theirs.
        """
        client = auth(world.owner)
        with django_assert_num_queries(3):
            client.get(path(world.event.id))

        # Same page, more rows: a booking of ten, whose tickets each carry a
        # tier, a booking and a buyer.
        from .conftest import _paid_booking  # noqa: PLC0415

        _paid_booking(world.other_customer, world.event, world.tier, quantity=10, amount=250_000)

        with django_assert_num_queries(3):
            response = client.get(path(world.event.id))
        assert len(response.json()["data"]) == 13
