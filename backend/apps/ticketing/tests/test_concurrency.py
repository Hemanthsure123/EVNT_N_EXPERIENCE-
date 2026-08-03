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


# --- the price decision under contention -----------------------------------


@pytest.mark.django_db(transaction=True)
def test_exactly_the_allocated_number_of_early_bird_seats_are_discounted(
    ticketing_service, make_ticket_type
):
    """THE test for this slice: 30 buyers race for 5 early-bird seats.

    Exactly 5 units are billed at the early-bird price and the other 25 at the
    normal price — no more, no fewer, with zero oversell. If the price were
    read from the display cache or from a pre-lock read of the tier, several
    of these threads would all see "sold + reserved = 4" and every one of them
    would take the discount.
    """
    k = 5
    tt = make_ticket_type(
        quantity=100,
        price_minor=50_000,
        phases=[{"name": "Early bird", "price_minor": 30_000, "quantity": k}],
        max_per_order=5,
    )

    def buy(_i: int) -> int:
        return ticketing_service.reserve(ticket_type_id=tt.id, quantity=1).unit_price_minor

    prices = _run_concurrently(buy, 30)

    assert prices.count(30_000) == k
    assert prices.count(50_000) == 30 - k
    tt.refresh_from_db()
    assert tt.reserved == 30  # every buyer got a seat; only the price differed
    assert tt.sold + tt.reserved <= tt.quantity


@pytest.mark.django_db(transaction=True)
def test_multi_unit_orders_never_exceed_the_early_bird_allocation(
    ticketing_service, make_ticket_type
):
    """Same race with 2-unit orders against 6 discounted seats: at most 3
    orders can fit, and no combination of winners can bill more than 6 units
    at the early-bird price."""
    k = 6
    tt = make_ticket_type(
        quantity=100,
        price_minor=50_000,
        phases=[{"name": "Early bird", "price_minor": 30_000, "quantity": k}],
        max_per_order=5,
    )

    def buy(_i: int) -> tuple[int, int]:
        outcome = ticketing_service.reserve(ticket_type_id=tt.id, quantity=2)
        return outcome.unit_price_minor, outcome.quantity

    results = _run_concurrently(buy, 20)

    discounted_units = sum(q for price, q in results if price == 30_000)
    assert discounted_units == k  # 3 orders x 2 units, exactly the allocation
    assert all(price in (30_000, 50_000) for price, _ in results)
    tt.refresh_from_db()
    assert tt.reserved == 40
    assert tt.sold + tt.reserved <= tt.quantity


@pytest.mark.django_db(transaction=True)
def test_the_last_early_bird_seat_and_the_last_ticket_are_decided_together(
    ticketing_service, make_ticket_type
):
    """Both decisions come from the same locked row: 8 buyers, 3 tickets in
    total and 2 of them discounted. Exactly 3 succeed, of which exactly 2 pay
    the early-bird price."""
    tt = make_ticket_type(
        quantity=3,
        price_minor=50_000,
        phases=[{"name": "Early bird", "price_minor": 30_000, "quantity": 2}],
    )

    def buy(_i: int) -> int | None:
        try:
            return ticketing_service.reserve(ticket_type_id=tt.id, quantity=1).unit_price_minor
        except SoldOutError:
            return None

    prices = _run_concurrently(buy, 8)

    assert prices.count(30_000) == 2
    assert prices.count(50_000) == 1
    assert prices.count(None) == 5
    tt.refresh_from_db()
    assert tt.reserved == 3
    assert tt.available == 0


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


@pytest.mark.django_db(transaction=True)
def test_an_overpriced_phase_can_never_be_the_price_a_buyer_is_charged(
    ticketing_service, make_ticket_type
):
    """WHY THIS IS NOT A CHECK CONSTRAINT ANY MORE.

    The single early-bird price used to be a column ON the tier, so
    `early_bird_price_minor <= price_minor` was a same-row CHECK and the
    database itself refused an overpriced discount. A named schedule lives in
    a CHILD table, and Postgres cannot express a CHECK across two tables — so
    that particular backstop is genuinely gone, not merely relocated. The
    service is now the only writer that validates it (see the rejection tests
    in test_services.py).

    What survives at the money path — and what this test pins — is the
    property that actually protects a buyer: the CHARGED price is decided from
    the locked row's own face price, so even a schedule forced past the
    service by a raw write can only ever make a buyer pay LESS, never more.
    A phase above face price is ignored rather than billed.
    """
    from apps.ticketing.models import SalePhase

    tt = make_ticket_type(
        quantity=10,
        price_minor=50_000,
        phases=[{"name": "Early bird", "price_minor": 30_000, "quantity": 5}],
    )
    # A raw write, bypassing the service and its validation entirely.
    SalePhase.objects.filter(ticket_type_id=tt.id).update(price_minor=60_000)

    charged = ticketing_service.reserve(ticket_type_id=tt.id, quantity=1).unit_price_minor

    assert charged == 50_000, "an above-face phase must be ignored, never charged"
