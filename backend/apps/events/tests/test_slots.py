"""Sessions — an event that runs more than once.

A comedy night at 18:00 and 21:00 is ONE event with TWO shows, and a ticket
for one must not admit to the other. That is what every ticketing platform
calls a showtime, and the shape here follows from a single observation:

    Inventory already lives per TICKET TIER — `quantity`/`sold`/`reserved` on
    one row, guarded by a `SELECT ... FOR UPDATE` and the `ticket_type_
    no_oversell` CHECK constraint.

So a session-scoped tier is just another tier row, and per-session inventory
falls out of the money path UNCHANGED. Nothing in reserve/confirm/release
learned what a slot is, which is why this module could be added without
touching the code that handles money. The first test below is the one that
proves it.

The other properties worth pinning: the event's own window follows its
sessions (three separate systems read `Event.starts_at` as truth), and a slot
that sells something cannot be deleted out from under it.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import Event, EventSlot, EventStatus
from apps.organizations.models import Organization
from apps.ticketing.models import TicketType


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="slots-owner@example.com", password="owner12345")
    stranger = User.objects.create_user(email="slots-other@example.com", password="other12345")
    org = Organization.objects.create(owner=owner, name="Slot Co")
    event = Event.objects.create(
        organization=org,
        title="Two Shows A Night",
        venue="The Cellar",
        city="Bengaluru",
        starts_at=timezone.now() + dt.timedelta(days=3),
        status=EventStatus.LIVE,
    )
    base = (timezone.now() + dt.timedelta(days=3)).replace(microsecond=0)
    return {
        "owner": owner,
        "stranger": stranger,
        "org": org,
        "event": event,
        "base": base,
        "url": f"/api/v1/events/{event.id}/slots",
    }


def make_slot(event, *, hours: int, label: str = "", position: int = 0) -> EventSlot:
    return EventSlot.objects.create(
        event=event,
        label=label,
        starts_at=timezone.now() + dt.timedelta(days=3, hours=hours),
        position=position,
    )


# ---------------------------------------------------------------- the point


@pytest.mark.django_db
class TestPerSessionInventory:
    def test_selling_out_the_early_show_leaves_the_late_one_untouched(self, world):
        """THE load-bearing property of the whole design.

        Two sessions, one tier each, ten seats each. Sell every seat of the
        early show; the late show still has all ten. If inventory had been
        modelled anywhere but on the tier row — an event-level counter, a
        column on the slot — this is the test that would fail, and it would
        fail as OVERSELLING rather than as an error.
        """
        from config.di import build_ticketing_service

        early, late = make_slot(world["event"], hours=0), make_slot(world["event"], hours=3)
        service = build_ticketing_service()
        tiers = {
            "early": TicketType.objects.create(
                event=world["event"], slot=early, name="GA", price_minor=50_000, quantity=10
            ),
            "late": TicketType.objects.create(
                event=world["event"], slot=late, name="GA", price_minor=50_000, quantity=10
            ),
        }

        service.reserve(ticket_type_id=tiers["early"].id, quantity=10)

        tiers["early"].refresh_from_db()
        tiers["late"].refresh_from_db()
        assert tiers["early"].available == 0
        assert tiers["late"].available == 10

    def test_the_sold_out_session_refuses_an_eleventh_seat(self, world):
        from apps.ticketing.exceptions import SoldOutError
        from config.di import build_ticketing_service

        early = make_slot(world["event"], hours=0)
        tier = TicketType.objects.create(
            event=world["event"], slot=early, name="GA", price_minor=50_000, quantity=10
        )
        service = build_ticketing_service()
        service.reserve(ticket_type_id=tier.id, quantity=10)

        with pytest.raises(SoldOutError):
            service.reserve(ticket_type_id=tier.id, quantity=1)

    def test_the_no_oversell_constraint_still_covers_a_session_tier(self, world):
        """The DB backstop is on the tier row, so it protects a session-scoped
        tier with no change — proven by trying to break it with raw SQL."""
        from django.db import IntegrityError, transaction

        slot = make_slot(world["event"], hours=0)
        tier = TicketType.objects.create(
            event=world["event"], slot=slot, name="GA", price_minor=50_000, quantity=5
        )

        with pytest.raises(IntegrityError), transaction.atomic():
            TicketType.objects.filter(pk=tier.id).update(sold=6)


# ---------------------------------------------------------------- the API


@pytest.mark.django_db
class TestOrganizerCrud:
    def test_an_organizer_adds_a_session(self, world, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["owner"]).post(
                world["url"],
                {"label": "Early show", "starts_at": world["base"].isoformat()},
                format="json",
            )

        assert resp.status_code == 201
        assert resp.data["label"] == "Early show"
        assert resp.data["is_active"] is True

    def test_two_sessions_may_start_together_when_they_are_named_apart(
        self, world, django_capture_on_commit_callbacks
    ):
        """A main stage and a side stage genuinely do start at the same minute,
        which is why the unique key includes the label rather than being
        `(event, starts_at)` alone."""
        client = auth(world["owner"])
        with django_capture_on_commit_callbacks(execute=True):
            first = client.post(
                world["url"],
                {"label": "Main stage", "starts_at": world["base"].isoformat()},
                format="json",
            )
            second = client.post(
                world["url"],
                {"label": "Side stage", "starts_at": world["base"].isoformat()},
                format="json",
            )
        assert (first.status_code, second.status_code) == (201, 201)

    def test_the_same_time_and_the_same_name_twice_is_a_conflict(
        self, world, django_capture_on_commit_callbacks
    ):
        client = auth(world["owner"])
        body = {"label": "Early show", "starts_at": world["base"].isoformat()}
        with django_capture_on_commit_callbacks(execute=True):
            client.post(world["url"], body, format="json")
            duplicate = client.post(world["url"], body, format="json")

        assert duplicate.status_code == 409
        assert duplicate.data["error"]["code"] == "duplicate_slot"

    def test_a_session_that_ends_before_it_starts_is_refused(self, world):
        resp = auth(world["owner"]).post(
            world["url"],
            {
                "starts_at": world["base"].isoformat(),
                "ends_at": (world["base"] - dt.timedelta(hours=1)).isoformat(),
            },
            format="json",
        )
        assert resp.status_code == 400

    def test_the_owner_sees_switched_off_sessions_and_the_public_does_not(
        self, world, django_capture_on_commit_callbacks
    ):
        """The only way to bring a cancelled session back is to be able to see
        it. To a buyer it is simply not on sale."""
        slot = make_slot(world["event"], hours=0, label="Early show")
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["owner"]).patch(
                f"{world['url']}/{slot.id}", {"is_active": False}, format="json"
            )

        owner_view = auth(world["owner"]).get(world["url"]).data
        public = APIClient().get(f"/api/v1/events/{world['event'].id}/content").data

        assert [row["label"] for row in owner_view] == ["Early show"]
        assert public["slots"] == []

    def test_a_session_is_renamed_in_place(self, world, django_capture_on_commit_callbacks):
        slot = make_slot(world["event"], hours=0, label="Show 1")
        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["owner"]).patch(
                f"{world['url']}/{slot.id}", {"label": "Matinee"}, format="json"
            )
        assert resp.status_code == 200
        assert resp.data["label"] == "Matinee"

    def test_moving_only_the_start_past_an_existing_end_is_refused(
        self, world, django_capture_on_commit_callbacks
    ):
        """Checked against the MERGED row. A PATCH carrying one half of the pair
        can invert it just as surely as one carrying both."""
        slot = EventSlot.objects.create(
            event=world["event"],
            starts_at=world["base"],
            ends_at=world["base"] + dt.timedelta(hours=2),
        )
        resp = auth(world["owner"]).patch(
            f"{world['url']}/{slot.id}",
            {"starts_at": (world["base"] + dt.timedelta(hours=5)).isoformat()},
            format="json",
        )
        assert resp.status_code == 422

    def test_an_empty_session_is_deleted(self, world, django_capture_on_commit_callbacks):
        slot = make_slot(world["event"], hours=0)
        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["owner"]).delete(f"{world['url']}/{slot.id}")

        assert resp.status_code == 204
        assert not EventSlot.objects.filter(pk=slot.id).exists()

    def test_a_session_with_tiers_is_refused_rather_than_cascaded(self, world):
        """`TicketType.slot` is PROTECT — those tiers hold the counters and, once
        anything sells, the issued tickets. Deleting the session under them
        would leave real tickets admitting to a show that no longer exists."""
        slot = make_slot(world["event"], hours=0)
        TicketType.objects.create(
            event=world["event"], slot=slot, name="GA", price_minor=50_000, quantity=10
        )

        resp = auth(world["owner"]).delete(f"{world['url']}/{slot.id}")

        assert resp.status_code == 409
        assert resp.data["error"]["code"] == "slot_in_use"
        assert EventSlot.objects.filter(pk=slot.id).exists()

    def test_switching_it_off_is_the_operation_that_always_works(
        self, world, django_capture_on_commit_callbacks
    ):
        """Which is what a cancelled session actually is."""
        slot = make_slot(world["event"], hours=0)
        TicketType.objects.create(
            event=world["event"], slot=slot, name="GA", price_minor=50_000, quantity=10
        )

        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["owner"]).patch(
                f"{world['url']}/{slot.id}", {"is_active": False}, format="json"
            )
        assert resp.status_code == 200
        assert resp.data["is_active"] is False


@pytest.mark.django_db
class TestAccess:
    def test_a_stranger_cannot_list_them(self, world):
        make_slot(world["event"], hours=0)
        # 404 rather than 403: a 403 confirms the event exists to anyone
        # walking ids, which is the rule the rest of this service follows.
        assert auth(world["stranger"]).get(world["url"]).status_code == 404

    def test_a_stranger_cannot_add_one(self, world):
        resp = auth(world["stranger"]).post(
            world["url"], {"starts_at": world["base"].isoformat()}, format="json"
        )
        assert resp.status_code == 404

    def test_anonymous_is_refused(self, world):
        assert APIClient().get(world["url"]).status_code == 401

    def test_the_public_content_payload_needs_no_account(self, world):
        make_slot(world["event"], hours=0, label="Early show")
        body = APIClient().get(f"/api/v1/events/{world['event'].id}/content").json()
        assert [row["label"] for row in body["slots"]] == ["Early show"]


# ------------------------------------------------------- the event's window


@pytest.mark.django_db
class TestTheEventWindowFollowsItsSessions:
    def test_adding_an_earlier_session_moves_the_events_start(
        self, world, django_capture_on_commit_callbacks
    ):
        """Browse sorts and cursor-pages on `Event.starts_at`, the check-in
        window opens against it and settlements decide "finished" from it. An
        event whose sessions are at 18:00 while the row says 14:00 is wrong in
        three places at once, and the one people SEE is the listing.
        """
        event = world["event"]
        earlier = (event.starts_at - dt.timedelta(hours=4)).replace(microsecond=0)

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["owner"]).post(
                world["url"], {"starts_at": earlier.isoformat()}, format="json"
            )

        event.refresh_from_db()
        assert event.starts_at == earlier

    def test_it_takes_the_EARLIEST_session_not_the_last_one_added(
        self, world, django_capture_on_commit_callbacks
    ):
        event = world["event"]
        early = (event.starts_at - dt.timedelta(hours=4)).replace(microsecond=0)
        late = (event.starts_at + dt.timedelta(hours=4)).replace(microsecond=0)
        client = auth(world["owner"])

        with django_capture_on_commit_callbacks(execute=True):
            client.post(world["url"], {"starts_at": early.isoformat()}, format="json")
            client.post(world["url"], {"starts_at": late.isoformat()}, format="json")

        event.refresh_from_db()
        assert event.starts_at == early

    def test_a_switched_off_session_stops_holding_the_start_time(
        self, world, django_capture_on_commit_callbacks
    ):
        event = world["event"]
        early = (event.starts_at - dt.timedelta(hours=4)).replace(microsecond=0)
        late = (event.starts_at + dt.timedelta(hours=4)).replace(microsecond=0)
        client = auth(world["owner"])

        with django_capture_on_commit_callbacks(execute=True):
            created = client.post(world["url"], {"starts_at": early.isoformat()}, format="json")
            client.post(world["url"], {"starts_at": late.isoformat()}, format="json")
            client.patch(
                f"{world['url']}/{created.data['id']}", {"is_active": False}, format="json"
            )

        event.refresh_from_db()
        assert event.starts_at == late

    def test_the_events_end_is_left_alone_when_no_session_carries_one(
        self, world, django_capture_on_commit_callbacks
    ):
        """A slot with no end is not the same fact as a slot ending when the
        event does. Inventing one would be the confident lie this codebase
        refuses elsewhere."""
        event = world["event"]
        original_end = event.starts_at + dt.timedelta(hours=6)
        Event.objects.filter(pk=event.id).update(ends_at=original_end)

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["owner"]).post(
                world["url"],
                {"starts_at": (event.starts_at + dt.timedelta(hours=1)).isoformat()},
                format="json",
            )

        event.refresh_from_db()
        assert event.ends_at == original_end

    def test_the_sync_does_not_bump_the_events_version(
        self, world, django_capture_on_commit_callbacks
    ):
        """`version` is the optimistic-lock token an organiser holds while they
        edit the description. A derived schedule write must not invalidate it —
        the same rule `set_ticketing_fields` follows."""
        event = world["event"]
        before = event.version

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["owner"]).post(
                world["url"],
                {"starts_at": (event.starts_at - dt.timedelta(hours=2)).isoformat()},
                format="json",
            )

        event.refresh_from_db()
        assert event.version == before


# ------------------------------------------------------------ tier ↔ session


@pytest.mark.django_db
class TestTiersBelongToSessions:
    def test_a_tier_is_created_against_a_session(self, world, django_capture_on_commit_callbacks):
        slot = make_slot(world["event"], hours=0)
        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["owner"]).post(
                f"/api/v1/events/{world['event'].id}/ticket-types",
                {"name": "GA", "price": 50_000, "quantity": 10, "slot_id": str(slot.id)},
                format="json",
            )
        assert resp.status_code == 201
        assert str(resp.data["slot_id"]) == str(slot.id)

    def test_a_session_from_ANOTHER_event_cannot_be_attached(
        self, world, django_capture_on_commit_callbacks
    ):
        """Without the event scoping, every counter on this tier would be sold
        against a show its organiser does not run."""
        other = Event.objects.create(
            organization=world["org"],
            title="Someone Else",
            venue="V",
            city="Pune",
            starts_at=timezone.now() + dt.timedelta(days=9),
        )
        foreign = make_slot(other, hours=0)

        resp = auth(world["owner"]).post(
            f"/api/v1/events/{world['event'].id}/ticket-types",
            {"name": "GA", "price": 50_000, "quantity": 10, "slot_id": str(foreign.id)},
            format="json",
        )
        assert resp.status_code == 404
        assert resp.data["error"]["code"] == "slot_not_found"

    def test_the_tier_list_filters_to_one_session(self, world, django_capture_on_commit_callbacks):
        early, late = make_slot(world["event"], hours=0), make_slot(world["event"], hours=3)
        TicketType.objects.create(
            event=world["event"], slot=early, name="Early GA", price_minor=50_000, quantity=10
        )
        TicketType.objects.create(
            event=world["event"], slot=late, name="Late GA", price_minor=50_000, quantity=10
        )

        body = (
            APIClient()
            .get(f"/api/v1/events/{world['event'].id}/ticket-types?slot={early.id}")
            .json()
        )
        assert [row["name"] for row in body["data"]] == ["Early GA"]

    def test_an_unknown_session_returns_NOTHING_rather_than_everything(self, world):
        """A chooser that silently falls back to "all sessions" is how somebody
        buys a ticket for the wrong show."""
        make_slot(world["event"], hours=0)
        TicketType.objects.create(event=world["event"], name="GA", price_minor=50_000, quantity=10)

        body = (
            APIClient()
            .get(f"/api/v1/events/{world['event'].id}/ticket-types?slot=not-a-uuid")
            .json()
        )
        assert body["data"] == []

    def test_an_event_with_no_sessions_is_completely_unaffected(self, world):
        """The ordinary single-show event. `slot` is null, the tier list is what
        it always was, and nothing about the money path changed."""
        TicketType.objects.create(event=world["event"], name="GA", price_minor=50_000, quantity=10)
        body = APIClient().get(f"/api/v1/events/{world['event'].id}/ticket-types").json()
        assert [row["name"] for row in body["data"]] == ["GA"]
        assert body["data"][0]["slot_id"] is None
