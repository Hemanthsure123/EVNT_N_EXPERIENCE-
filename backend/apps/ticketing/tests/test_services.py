from __future__ import annotations

import pytest

from apps.events.exceptions import EventNotFoundError
from apps.events.repositories import EventRepository
from apps.ticketing.exceptions import (
    InvalidReservationQuantityError,
    NotTicketTypeOwnerError,
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
