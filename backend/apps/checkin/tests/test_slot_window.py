"""The scan window belongs to the SESSION, not to the event.

A comedy night at 18:00 and 21:00 is one event with two shows, and the 21:00
door must not open at 17:00 because `Event.starts_at` says so — that column is
the FIRST show. Two rooms of people, two windows.

This is the door's half of the same rule ticketing already holds for money:
the display can be about the event, the DECISION is about the row that owns
the fact. A single-show event has no slot and behaves exactly as before,
which the last test pins.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.models import EventSlot
from apps.ticketing.models import TicketType

from .conftest import build_checkin_service, issue_one_ticket


def slot_at(event, *, offset: timedelta, label: str = "", ends: timedelta | None = None):
    now = timezone.now()
    return EventSlot.objects.create(
        event=event,
        label=label,
        starts_at=now + offset,
        ends_at=(now + ends) if ends is not None else None,
    )


def tier_for(event, slot, *, name="GA") -> TicketType:
    return TicketType.objects.create(
        event=event, slot=slot, name=name, price_minor=50_000, quantity=10, max_per_order=10
    )


@pytest.fixture
def gate():
    """The same 180-minutes-before / 360-minutes-after window the rest of the
    check-in tests use."""
    return build_checkin_service()


@pytest.mark.django_db
class TestTheWindowFollowsTheSession:
    def test_a_ticket_for_a_LATER_session_is_denied_at_the_early_door(
        self, gate, booking_service, buyer, event
    ):
        """`event` started an hour ago, so the EVENT window is wide open. The
        ticket is for a show four days out — under the old event-derived
        window it would have been admitted.
        """
        late = slot_at(event, offset=timedelta(days=4), label="Sunday late")
        ticket = issue_one_ticket(
            booking_service, buyer=buyer, event=event, tier=tier_for(event, late)
        )

        result = gate.verify_and_mark_used(
            event_id=event.id,
            qr_token=ticket.qr_token,
            gate="North",
            scanned_by_id=event.organization.owner_id,
        )

        assert result.allowed is False
        assert result.reason == "denied_out_of_window"

    def test_a_ticket_for_the_session_happening_NOW_is_admitted(
        self, gate, booking_service, buyer, event
    ):
        now_slot = slot_at(event, offset=timedelta(minutes=-10), label="Early show")
        ticket = issue_one_ticket(
            booking_service, buyer=buyer, event=event, tier=tier_for(event, now_slot)
        )

        result = gate.verify_and_mark_used(
            event_id=event.id,
            qr_token=ticket.qr_token,
            gate="North",
            scanned_by_id=event.organization.owner_id,
        )

        assert result.allowed is True

    def test_a_ticket_for_a_session_that_ENDED_long_ago_is_denied(
        self, gate, booking_service, buyer, event
    ):
        """The grace period is 360 minutes; this one closed a day ago. Under an
        event-derived window it would still be inside, because the event's own
        end is three hours from now."""
        past = slot_at(
            event, offset=timedelta(days=-1, hours=-3), ends=timedelta(days=-1), label="Yesterday"
        )
        ticket = issue_one_ticket(
            booking_service, buyer=buyer, event=event, tier=tier_for(event, past)
        )

        result = gate.verify_and_mark_used(
            event_id=event.id,
            qr_token=ticket.qr_token,
            gate="North",
            scanned_by_id=event.organization.owner_id,
        )

        assert result.allowed is False
        assert result.reason == "denied_out_of_window"

    def test_a_session_with_no_end_gets_its_grace_from_its_OWN_start(
        self, gate, booking_service, buyer, event
    ):
        """Not from the event's end. A slot with no end is not the same fact as
        a slot ending when the event does — the event's end is the LAST show's,
        so borrowing it would keep an early session's door open all night.
        """
        early = slot_at(event, offset=timedelta(hours=-8), label="Afternoon")
        ticket = issue_one_ticket(
            booking_service, buyer=buyer, event=event, tier=tier_for(event, early)
        )

        result = gate.verify_and_mark_used(
            event_id=event.id,
            qr_token=ticket.qr_token,
            gate="North",
            scanned_by_id=event.organization.owner_id,
        )

        # 8 hours ago + 6 hours of grace = closed 2 hours ago.
        assert result.allowed is False
        assert result.reason == "denied_out_of_window"


@pytest.mark.django_db
class TestTheGateScreenNamesTheSession:
    def test_the_tier_summary_carries_the_session_label(self, gate, booking_service, buyer, event):
        """Two tiers on a multi-session event are usually called the same thing
        — "GA" at 18:00 and "GA" at 21:00 — so the tier name alone leaves a
        steward with no way to tell a wrong-show ticket from a right one."""
        now_slot = slot_at(event, offset=timedelta(minutes=-10), label="Early show")
        ticket = issue_one_ticket(
            booking_service, buyer=buyer, event=event, tier=tier_for(event, now_slot)
        )

        result = gate.verify_and_mark_used(
            event_id=event.id,
            qr_token=ticket.qr_token,
            gate="North",
            scanned_by_id=event.organization.owner_id,
        )

        assert result.ticket_type == "GA · Early show"

    def test_an_unlabelled_session_is_named_by_its_TIME(self, gate, booking_service, buyer, event):
        now_slot = slot_at(event, offset=timedelta(minutes=-10))
        ticket = issue_one_ticket(
            booking_service, buyer=buyer, event=event, tier=tier_for(event, now_slot)
        )

        result = gate.verify_and_mark_used(
            event_id=event.id,
            qr_token=ticket.qr_token,
            gate="North",
            scanned_by_id=event.organization.owner_id,
        )

        assert result.ticket_type.startswith("GA · ")
        assert result.ticket_type != "GA · "


@pytest.mark.django_db
def test_a_single_show_event_is_completely_unaffected(gate, issued_ticket, event):
    """No slot, so the window comes from the event exactly as it always did and
    the summary is the bare tier name. The ordinary case must not pay for the
    multi-session one."""
    result = gate.verify_and_mark_used(
        event_id=event.id,
        qr_token=issued_ticket.qr_token,
        gate="North",
        scanned_by_id=event.organization.owner_id,
    )

    assert result.allowed is True
    assert result.ticket_type == "GA"


@pytest.mark.django_db
def test_the_verify_path_stays_within_its_query_budget(
    api_client, token_for, booking_service, buyer, event, django_assert_num_queries
):
    """The session join must ride on the load the gate ALREADY does. Reading
    `ticket_type.slot` lazily would be one extra query per scan on the hottest
    write path in the system — which is exactly what the fixed budget catches.
    """
    now_slot = slot_at(event, offset=timedelta(minutes=-10), label="Early show")
    ticket = issue_one_ticket(
        booking_service, buyer=buyer, event=event, tier=tier_for(event, now_slot)
    )
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(event.organization.owner)}")

    with django_assert_num_queries(9):
        api_client.post(
            "/api/v1/checkin/verify",
            {"event_id": str(event.id), "qr_token": ticket.qr_token, "gate": "North"},
            format="json",
        )
