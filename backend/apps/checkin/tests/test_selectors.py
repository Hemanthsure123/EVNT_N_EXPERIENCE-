"""Live-attendance read path: cache the count, trust the DB.

Proves the two properties the design promises: (1) a warm read is served from
the cache with zero DB queries, and (2) the cache can never become
authoritative — a reconcile always corrects it back to the DB truth.
"""

from __future__ import annotations

import pytest

from apps.booking.repositories import TicketRepository
from apps.checkin import selectors
from apps.checkin.repositories import ScanLogRepository
from apps.ticketing.repositories import TicketTypeRepository
from core.adapters.local.locmem_cache import LocMemCacheAdapter

from .conftest import build_checkin_service, issue_one_ticket


def _admit(service, *, ticket, event, organizer) -> None:
    service.verify_and_mark_used(
        event_id=event.id, qr_token=ticket.qr_token, gate="North", scanned_by_id=organizer.id
    )


@pytest.mark.django_db
def test_attendance_counts_admitted_vs_capacity(booking_service, buyer, event, tier, organizer):
    cache = LocMemCacheAdapter()
    service = build_checkin_service(cache)
    ticket = issue_one_ticket(booking_service, buyer=buyer, event=event, tier=tier)
    _admit(service, ticket=ticket, event=event, organizer=organizer)

    payload = selectors.get_attendance(
        event.id,
        tickets=TicketRepository(),
        ticket_types=TicketTypeRepository(),
        cache=cache,
    )

    assert payload.admitted == 1
    assert payload.capacity == 100  # the single tier's quantity


@pytest.mark.django_db
def test_warm_read_is_served_from_cache_with_no_db_queries(
    booking_service, buyer, event, tier, organizer, django_assert_num_queries
):
    cache = LocMemCacheAdapter()
    ticket = issue_one_ticket(booking_service, buyer=buyer, event=event, tier=tier)
    _admit(build_checkin_service(cache), ticket=ticket, event=event, organizer=organizer)

    tickets, ticket_types = TicketRepository(), TicketTypeRepository()

    # Cold: reconcile from the DB — the used-count + the capacity aggregate.
    with django_assert_num_queries(2):
        cold = selectors.get_attendance(
            event.id, tickets=tickets, ticket_types=ticket_types, cache=cache
        )
    # Warm: entirely from Redis/locmem — zero DB queries.
    with django_assert_num_queries(0):
        warm = selectors.get_attendance(
            event.id, tickets=tickets, ticket_types=ticket_types, cache=cache
        )

    assert cold.admitted == warm.admitted == 1
    assert cold.capacity == warm.capacity == 100


@pytest.mark.django_db
def test_cache_never_becomes_authoritative_reconciles_from_db(
    booking_service, buyer, event, tier, organizer
):
    cache = LocMemCacheAdapter()
    ticket = issue_one_ticket(booking_service, buyer=buyer, event=event, tier=tier)
    _admit(build_checkin_service(cache), ticket=ticket, event=event, organizer=organizer)

    # Poison the cached counter and expire the freshness marker, as a lost/
    # drifted increment would. The next read MUST ignore the stale cache and
    # recompute from the authoritative used-ticket count.
    cache.set(selectors.attendance_counter_key(event.id), 999)
    cache.delete(selectors.attendance_fresh_key(event.id))

    payload = selectors.get_attendance(
        event.id, tickets=TicketRepository(), ticket_types=TicketTypeRepository(), cache=cache
    )

    assert payload.admitted == 1  # DB truth wins, not the poisoned 999


@pytest.mark.django_db
def test_admitted_count_matches_the_scan_audit_trail(
    booking_service, buyer, event, make_tier, organizer
):
    # The two independent admitted sources — used tickets and allowed scan
    # logs — must always agree.
    tier = make_tier(event, quantity=100)
    cache = LocMemCacheAdapter()
    service = build_checkin_service(cache)
    for _ in range(3):
        ticket = issue_one_ticket(booking_service, buyer=buyer, event=event, tier=tier)
        _admit(service, ticket=ticket, event=event, organizer=organizer)

    used = TicketRepository().count_used_for_event(event.id)
    allowed = ScanLogRepository().count_allowed_for_event(event.id)
    assert used == allowed == 3
