"""Repository tests: checkin's ScanLog audit store, plus the check-in methods
booking's TicketRepository exposes (booking owns Ticket; checkin drives these
at the gate)."""

from __future__ import annotations

import pytest
from django.db import transaction
from django.utils import timezone

from apps.booking.models import TicketStatus
from apps.booking.repositories import TicketRepository
from apps.checkin.models import ScanResult
from apps.checkin.repositories import ScanLogRepository


@pytest.mark.django_db
def test_record_appends_a_scan_and_count_allowed_filters(issued_ticket, event, organizer):
    repo = ScanLogRepository()

    repo.record(
        ticket_id=issued_ticket.id,
        event_id=event.id,
        scanned_by_id=organizer.id,
        gate="North",
        result=ScanResult.ALLOWED,
    )
    repo.record(
        ticket_id=issued_ticket.id,
        event_id=event.id,
        scanned_by_id=organizer.id,
        gate="North",
        result=ScanResult.DENIED_ALREADY_USED,
    )

    # count_allowed_for_event ignores the denied row.
    assert repo.count_allowed_for_event(event.id) == 1


@pytest.mark.django_db
def test_get_for_checkin_loads_event_and_tier_in_one_query(
    issued_ticket, django_assert_num_queries
):
    repo = TicketRepository()
    with django_assert_num_queries(1):
        ticket = repo.get_for_checkin(issued_ticket.id)
        assert ticket is not None
        # Touch the joined columns — must not fire extra queries.
        _ = (ticket.booking.event_id, ticket.ticket_type.name)


@pytest.mark.django_db
def test_mark_used_sets_only_the_checkin_columns(issued_ticket):
    repo = TicketRepository()
    now = timezone.now()

    with transaction.atomic():
        locked = repo.lock_for_update(issued_ticket.id)
        assert locked is not None
        repo.mark_used(locked, used_at=now, gate="South")

    issued_ticket.refresh_from_db()
    assert issued_ticket.status == TicketStatus.USED
    assert issued_ticket.gate == "South"
    assert issued_ticket.used_at is not None


@pytest.mark.django_db
def test_void_active_for_booking_only_touches_active_tickets(issued_ticket):
    repo = TicketRepository()

    voided = repo.void_active_for_booking(issued_ticket.booking_id)
    assert voided == 1
    issued_ticket.refresh_from_db()
    assert issued_ticket.status == TicketStatus.VOID

    # Idempotent: a second call voids nothing (no active tickets remain).
    assert repo.void_active_for_booking(issued_ticket.booking_id) == 0
