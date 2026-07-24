"""The most important test in this module: one ticket admits exactly one
person, even under simultaneous scans at different gates.

The door analog of ticketing's no-oversell test. `transaction=True` makes each
worker thread run a REAL committed transaction against Postgres, so the
`SELECT ... FOR UPDATE` per-ticket lock is exercised for real — under the
default `django_db` every "transaction" is a savepoint on one connection and
can't reproduce genuine concurrency.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection

from apps.booking.models import TicketStatus
from apps.booking.repositories import TicketRepository
from apps.checkin.models import ScanLog, ScanResult

from .conftest import build_checkin_service, issue_one_ticket


def _run_concurrently(fn, n: int) -> list:
    """Run fn(i) on n threads; each closes its own DB connection afterwards so
    the pool doesn't leak connections between workers."""

    def worker(i: int):
        try:
            return fn(i)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=n) as executor:
        return list(executor.map(worker, range(n)))


@pytest.mark.django_db(transaction=True)
def test_two_simultaneous_scans_admit_exactly_one(booking_service, buyer, event, tier, organizer):
    ticket = issue_one_ticket(booking_service, buyer=buyer, event=event, tier=tier)

    def scan(i: int) -> bool:
        service = build_checkin_service()
        result = service.verify_and_mark_used(
            event_id=event.id,
            qr_token=ticket.qr_token,
            gate=f"gate-{i}",
            scanned_by_id=organizer.id,
        )
        return result.allowed

    results = _run_concurrently(scan, 2)

    # EXACTLY ONE admit — the door never lets two people in on one ticket.
    assert sum(1 for r in results if r) == 1
    ticket.refresh_from_db()
    assert ticket.status == TicketStatus.USED
    assert TicketRepository().count_used_for_event(event.id) == 1
    assert ScanLog.objects.filter(ticket_id=ticket.id, result=ScanResult.ALLOWED).count() == 1
    assert (
        ScanLog.objects.filter(ticket_id=ticket.id, result=ScanResult.DENIED_ALREADY_USED).count()
        == 1
    )


@pytest.mark.django_db(transaction=True)
def test_ten_simultaneous_scans_of_one_ticket_admit_exactly_one(
    booking_service, buyer, event, tier, organizer
):
    # A heavier stampede on a single ticket — still exactly one admit.
    ticket = issue_one_ticket(booking_service, buyer=buyer, event=event, tier=tier)

    def scan(i: int) -> bool:
        service = build_checkin_service()
        return service.verify_and_mark_used(
            event_id=event.id,
            qr_token=ticket.qr_token,
            gate=f"gate-{i}",
            scanned_by_id=organizer.id,
        ).allowed

    results = _run_concurrently(scan, 10)

    assert sum(1 for r in results if r) == 1
    assert TicketRepository().count_used_for_event(event.id) == 1
    assert ScanLog.objects.filter(ticket_id=ticket.id, result=ScanResult.ALLOWED).count() == 1
    assert ScanLog.objects.filter(ticket_id=ticket.id).count() == 10
