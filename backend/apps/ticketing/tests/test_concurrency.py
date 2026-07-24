"""The most important tests in this module: no oversell under contention.

These use `transaction=True` so each worker thread runs a REAL committed
transaction against Postgres — the only way to exercise the `SELECT ... FOR
UPDATE` row lock for real. Under `@pytest.mark.django_db` (the default) every
"transaction" is a nested savepoint on one connection, which can't reproduce
genuine concurrency.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection

from apps.ticketing.exceptions import SoldOutError
from apps.ticketing.models import TicketType


def _run_concurrently(fn, n: int) -> list:
    """Run fn(i) on n threads. Each thread closes its own DB connection
    afterwards so the pool doesn't leak connections between workers."""

    def worker(i: int):
        try:
            return fn(i)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=n) as executor:
        return list(executor.map(worker, range(n)))


@pytest.mark.django_db(transaction=True)
def test_concurrent_reserves_never_oversell_the_last_tickets(ticketing_service, make_ticket_type):
    # 10 tickets, 40 buyers race for the last ones, each grabbing 1.
    tt = make_ticket_type(quantity=10, max_per_order=5)

    def try_reserve(_i: int) -> bool:
        try:
            ticketing_service.reserve(ticket_type_id=tt.id, quantity=1)
            return True
        except SoldOutError:
            return False

    results = _run_concurrently(try_reserve, 40)

    successes = sum(results)
    tt.refresh_from_db()
    # Exactly the available count succeeds — no more, no fewer.
    assert successes == 10
    assert tt.reserved == 10
    assert tt.sold == 0
    # The invariant holds: zero oversell.
    assert tt.available == 0
    assert tt.sold + tt.reserved == tt.quantity


@pytest.mark.django_db(transaction=True)
def test_concurrent_multi_quantity_reserves_never_oversell(ticketing_service, make_ticket_type):
    # 100 tickets, 60 buyers each want 3 → only 33 can fully succeed (99), the
    # 34th would need 3 but only 1 remains → it fails; total reserved == 99.
    tt = make_ticket_type(quantity=100, max_per_order=5)

    def try_reserve(_i: int) -> bool:
        try:
            ticketing_service.reserve(ticket_type_id=tt.id, quantity=3)
            return True
        except SoldOutError:
            return False

    results = _run_concurrently(try_reserve, 60)

    tt.refresh_from_db()
    assert sum(results) == 33
    assert tt.reserved == 99
    assert tt.available == 1
    assert tt.sold + tt.reserved <= tt.quantity  # never exceeds


@pytest.mark.django_db(transaction=True)
def test_release_then_reserve_restores_availability(ticketing_service, make_ticket_type):
    tt = make_ticket_type(quantity=1)
    ticketing_service.reserve(ticket_type_id=tt.id, quantity=1)
    tt.refresh_from_db()
    assert tt.available == 0

    # Releasing frees the seat back up so a later reserve succeeds.
    ticketing_service.release(ticket_type_id=tt.id, quantity=1)
    tt.refresh_from_db()
    assert tt.available == 1

    ticketing_service.reserve(ticket_type_id=tt.id, quantity=1)
    tt.refresh_from_db()
    assert tt.reserved == 1
    assert tt.available == 0


@pytest.mark.django_db(transaction=True)
def test_confirm_converts_reserved_to_sold_without_changing_availability(
    ticketing_service, make_ticket_type
):
    tt = make_ticket_type(quantity=10)
    ticketing_service.reserve(ticket_type_id=tt.id, quantity=4)

    ticketing_service.confirm_sold(ticket_type_id=tt.id, quantity=4)

    tt.refresh_from_db()
    assert tt.sold == 4
    assert tt.reserved == 0
    assert tt.available == 6  # unchanged by the confirm (reserved -> sold)


@pytest.mark.django_db
def test_check_constraint_is_the_db_backstop_against_oversell(make_ticket_type):
    """Even a raw write that bypasses the service can't oversell — the DB
    rejects it. This is defense-in-depth behind the app-level checks."""
    from django.db import IntegrityError, transaction
    from django.db.models import F

    tt = make_ticket_type(quantity=10, sold=0, reserved=8)

    with pytest.raises(IntegrityError), transaction.atomic():
        TicketType.objects.filter(pk=tt.id).update(reserved=F("reserved") + 5)  # 8+5 > 10
