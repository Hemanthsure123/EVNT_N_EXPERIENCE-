from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.exceptions import EventNotFoundError
from apps.events.repositories import EventRepository
from apps.ticketing.exceptions import (
    InvalidPhaseScheduleError,
    InvalidReservationQuantityError,
    NotTicketTypeOwnerError,
    PhasePriceAbovePriceError,
    QuantityBelowCommittedError,
    StaleTicketTypeVersionError,
)
from apps.ticketing.repositories import TicketTypeRepository
from core.models import OutboxEvent

# --- organizer tier CRUD ---------------------------------------------------


@pytest.mark.django_db
def test_create_ticket_type_by_owner(ticketing_service, event, owner):
    tt = ticketing_service.create_ticket_type(
        event_id=event.id, actor_id=owner.id, name="Gold", price_minor=5000, quantity=50
    )

    assert tt.name == "Gold"
    assert tt.event_id == event.id
    assert OutboxEvent.objects.filter(event_type="ticketing.ticket_type_added").exists()


@pytest.mark.django_db
def test_create_ticket_type_rejects_non_owner(ticketing_service, event, other_user):
    with pytest.raises(NotTicketTypeOwnerError):
        ticketing_service.create_ticket_type(
            event_id=event.id, actor_id=other_user.id, name="X", price_minor=100, quantity=10
        )


@pytest.mark.django_db
def test_create_ticket_type_rejects_missing_event(ticketing_service, owner):
    with pytest.raises(EventNotFoundError):
        ticketing_service.create_ticket_type(
            event_id="00000000-0000-0000-0000-000000000000",
            actor_id=owner.id,
            name="X",
            price_minor=100,
            quantity=10,
        )


@pytest.mark.django_db
def test_create_ticket_type_populates_event_denormals(
    ticketing_service, event, owner, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        ticketing_service.create_ticket_type(
            event_id=event.id, actor_id=owner.id, name="Basic", price_minor=1500, quantity=80
        )

    refreshed = EventRepository().get_active_by_id(event.id)
    assert refreshed is not None
    assert refreshed.from_price_minor == 1500
    assert refreshed.tickets_available == 80


@pytest.mark.django_db
def test_update_ticket_type_applies_and_bumps_version(ticketing_service, make_ticket_type, owner):
    tt = make_ticket_type(name="Old", price_minor=1000)

    updated = ticketing_service.update_ticket_type(
        ticket_type_id=tt.id, actor_id=owner.id, expected_version=1, changes={"name": "New"}
    )

    assert updated.name == "New"
    assert updated.version == 2


@pytest.mark.django_db
def test_update_ticket_type_rejects_stale_version(ticketing_service, make_ticket_type, owner):
    tt = make_ticket_type(name="Old")

    with pytest.raises(StaleTicketTypeVersionError):
        ticketing_service.update_ticket_type(
            ticket_type_id=tt.id, actor_id=owner.id, expected_version=99, changes={"name": "New"}
        )


@pytest.mark.django_db
def test_update_ticket_type_rejects_non_owner(ticketing_service, make_ticket_type, other_user):
    tt = make_ticket_type()

    with pytest.raises(NotTicketTypeOwnerError):
        ticketing_service.update_ticket_type(
            ticket_type_id=tt.id, actor_id=other_user.id, expected_version=1, changes={"name": "X"}
        )


@pytest.mark.django_db
def test_update_ticket_type_cannot_drop_quantity_below_committed(
    ticketing_service, make_ticket_type, owner
):
    tt = make_ticket_type(quantity=100, sold=20, reserved=10)  # 30 committed

    with pytest.raises(QuantityBelowCommittedError):
        ticketing_service.update_ticket_type(
            ticket_type_id=tt.id, actor_id=owner.id, expected_version=1, changes={"quantity": 25}
        )


# --- the phase schedule on the organizer write path -------------------------


@pytest.mark.django_db
def test_create_ticket_type_accepts_a_phase_schedule(ticketing_service, event, owner):
    ends_at = timezone.now() + timedelta(days=7)

    tt = ticketing_service.create_ticket_type(
        event_id=event.id,
        actor_id=owner.id,
        name="Gold",
        price_minor=50_000,
        quantity=50,
        phases=[
            {"name": "Early bird", "price_minor": 30_000, "ends_at": ends_at, "quantity": 10},
            {"name": "Phase 2", "price_minor": 40_000, "quantity": 25},
        ],
    )

    phases = tt.pricing_phases()
    assert [(p.name, p.price_minor, p.position) for p in phases] == [
        ("Early bird", 30_000, 0),
        ("Phase 2", 40_000, 1),
    ]
    assert phases[0].ends_at == ends_at
    assert phases[0].quantity == 10


@pytest.mark.django_db
def test_create_ticket_type_rejects_a_phase_above_the_face_price(ticketing_service, event, owner):
    """A "phase" dearer than the face price would silently overcharge."""
    with pytest.raises(PhasePriceAbovePriceError):
        ticketing_service.create_ticket_type(
            event_id=event.id,
            actor_id=owner.id,
            name="Gold",
            price_minor=50_000,
            quantity=50,
            phases=[{"name": "Early bird", "price_minor": 60_000, "quantity": 5}],
        )


@pytest.mark.django_db
def test_create_ticket_type_rejects_decreasing_phase_prices(ticketing_service, event, owner):
    """Early is cheapest: a later cheaper phase would make the straddle rule
    bill a straddling order MORE than the phase it fell out of promised."""
    with pytest.raises(InvalidPhaseScheduleError):
        ticketing_service.create_ticket_type(
            event_id=event.id,
            actor_id=owner.id,
            name="Gold",
            price_minor=50_000,
            quantity=50,
            phases=[
                {"name": "Early bird", "price_minor": 40_000, "quantity": 5},
                {"name": "Phase 2", "price_minor": 30_000, "quantity": 10},
            ],
        )


@pytest.mark.django_db
def test_create_ticket_type_rejects_a_phase_with_no_bound(ticketing_service, event, owner):
    """A phase with no deadline and no threshold never ends — everything
    scheduled after it would be unreachable decoration."""
    with pytest.raises(InvalidPhaseScheduleError):
        ticketing_service.create_ticket_type(
            event_id=event.id,
            actor_id=owner.id,
            name="Gold",
            price_minor=50_000,
            quantity=50,
            phases=[{"name": "Forever bird", "price_minor": 30_000}],
        )


@pytest.mark.django_db
def test_create_ticket_type_rejects_a_blank_phase_name(ticketing_service, event, owner):
    with pytest.raises(InvalidPhaseScheduleError):
        ticketing_service.create_ticket_type(
            event_id=event.id,
            actor_id=owner.id,
            name="Gold",
            price_minor=50_000,
            quantity=50,
            phases=[{"name": "   ", "price_minor": 30_000, "quantity": 5}],
        )


@pytest.mark.django_db
def test_create_ticket_type_rejects_more_than_five_phases(ticketing_service, event, owner):
    with pytest.raises(InvalidPhaseScheduleError):
        ticketing_service.create_ticket_type(
            event_id=event.id,
            actor_id=owner.id,
            name="Gold",
            price_minor=50_000,
            quantity=50,
            phases=[
                {"name": f"Phase {i}", "price_minor": 10_000 + i, "quantity": i + 1}
                for i in range(6)
            ],
        )


@pytest.mark.django_db
def test_update_ticket_type_sets_and_clears_a_schedule(ticketing_service, make_ticket_type, owner):
    tt = make_ticket_type(price_minor=50_000)

    with_phases = ticketing_service.update_ticket_type(
        ticket_type_id=tt.id,
        actor_id=owner.id,
        expected_version=1,
        changes={"phases": [{"name": "Early bird", "price_minor": 30_000, "quantity": 5}]},
    )
    assert [p.name for p in with_phases.pricing_phases()] == ["Early bird"]

    # An empty list CLEARS the schedule (absence means "not in this PATCH").
    cleared = ticketing_service.update_ticket_type(
        ticket_type_id=tt.id, actor_id=owner.id, expected_version=2, changes={"phases": []}
    )
    assert cleared.pricing_phases() == []


@pytest.mark.django_db
def test_update_ticket_type_replaces_the_schedule_wholesale(
    ticketing_service, make_ticket_type, owner
):
    tt = make_ticket_type(
        price_minor=50_000,
        phases=[{"name": "Early bird", "price_minor": 30_000, "quantity": 5}],
    )

    updated = ticketing_service.update_ticket_type(
        ticket_type_id=tt.id,
        actor_id=owner.id,
        expected_version=1,
        changes={
            "phases": [
                {"name": "Launch", "price_minor": 25_000, "quantity": 3},
                {"name": "Phase 2", "price_minor": 40_000, "quantity": 10},
            ]
        },
    )

    assert [(p.name, p.position) for p in updated.pricing_phases()] == [
        ("Launch", 0),
        ("Phase 2", 1),
    ]


@pytest.mark.django_db
def test_update_ticket_type_rejects_cutting_the_price_below_a_phase(
    ticketing_service, make_ticket_type, owner
):
    """The rule is checked against the MERGED row: this PATCH carries only the
    face price, and lowering it under a stored phase's price is the same
    error as submitting a phase priced above it."""
    tt = make_ticket_type(
        price_minor=50_000,
        phases=[{"name": "Early bird", "price_minor": 30_000, "quantity": 5}],
    )

    with pytest.raises(PhasePriceAbovePriceError):
        ticketing_service.update_ticket_type(
            ticket_type_id=tt.id,
            actor_id=owner.id,
            expected_version=1,
            changes={"price_minor": 20_000},
        )


@pytest.mark.django_db
def test_reserve_returns_the_price_and_phase_it_decided(ticketing_service, make_ticket_type):
    tt = make_ticket_type(
        quantity=10,
        price_minor=50_000,
        phases=[{"name": "Early bird", "price_minor": 30_000, "quantity": 8}],
    )

    outcome = ticketing_service.reserve(ticket_type_id=tt.id, quantity=2)

    # These are what booking records on the order — not the tier's face
    # price, which nothing serialised.
    assert outcome.unit_price_minor == 30_000
    assert outcome.phase_name == "Early bird"


# --- reservation primitives via the service --------------------------------


@pytest.mark.django_db
def test_reserve_rejects_non_positive_quantity(ticketing_service, make_ticket_type):
    tt = make_ticket_type(quantity=10)

    with pytest.raises(InvalidReservationQuantityError):
        ticketing_service.reserve(ticket_type_id=tt.id, quantity=0)


@pytest.mark.django_db
def test_reserve_records_sold_out_event_when_last_tickets_go(ticketing_service, make_ticket_type):
    tt = make_ticket_type(quantity=2)

    ticketing_service.reserve(ticket_type_id=tt.id, quantity=2)

    # The outbox row is written atomically with the reserve (draining happens
    # on_commit, but the row is present immediately).
    assert OutboxEvent.objects.filter(event_type="ticketing.ticket_type_sold_out").exists()


@pytest.mark.django_db
def test_reserve_does_not_record_sold_out_when_stock_remains(ticketing_service, make_ticket_type):
    tt = make_ticket_type(quantity=10)

    ticketing_service.reserve(ticket_type_id=tt.id, quantity=1)

    assert not OutboxEvent.objects.filter(event_type="ticketing.ticket_type_sold_out").exists()


@pytest.mark.django_db
def test_reserve_updates_event_availability_denormal(
    ticketing_service, make_ticket_type, event, django_capture_on_commit_callbacks
):
    tt = make_ticket_type(quantity=100, max_per_order=30)

    with django_capture_on_commit_callbacks(execute=True):
        ticketing_service.reserve(ticket_type_id=tt.id, quantity=30)

    refreshed = EventRepository().get_active_by_id(event.id)
    assert refreshed is not None
    assert refreshed.tickets_available == 70


@pytest.mark.django_db
def test_release_via_service_frees_availability(ticketing_service, make_ticket_type):
    tt = make_ticket_type(quantity=10, reserved=4)

    ticketing_service.release(ticket_type_id=tt.id, quantity=3)

    refreshed = TicketTypeRepository().get_active_by_id(tt.id)
    assert refreshed is not None
    assert refreshed.reserved == 1


@pytest.mark.django_db
def test_confirm_via_service_moves_reserved_to_sold(ticketing_service, make_ticket_type):
    tt = make_ticket_type(quantity=10, reserved=5)

    ticketing_service.confirm_sold(ticket_type_id=tt.id, quantity=5)

    refreshed = TicketTypeRepository().get_active_by_id(tt.id)
    assert refreshed is not None
    assert refreshed.sold == 5
    assert refreshed.reserved == 0
