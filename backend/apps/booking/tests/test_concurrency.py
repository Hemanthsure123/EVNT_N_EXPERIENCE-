"""Two people submitting the same attendee form at once must not send two
copies of the same ticket.

`transaction=True` so each worker thread runs a REAL committed transaction
against Postgres — the only way to exercise the booking row's `SELECT ... FOR
UPDATE` for real. Under the default `@pytest.mark.django_db` every
"transaction" is a savepoint on one shared connection, which cannot reproduce
genuine concurrency and would pass whether the lock existed or not.

The invariant under test is the one the buyer feels: the "has this address
already been sent this ticket" decision reads a row that nobody else can be
mid-write on, so N racing assignments of the SAME address publish exactly one
TICKET_ASSIGNED. Without the lock both callers read a blank attendee, both
decide it is new, and the guest gets their ticket twice.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection

from apps.booking.services import TICKET_ASSIGNED
from core.models import OutboxEvent


def _run_concurrently(fn, n: int) -> list:
    """Run fn(i) on n threads, each closing its own DB connection afterwards so
    the pool doesn't leak connections between workers."""

    def worker(i: int):
        try:
            return fn(i)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=n) as executor:
        return list(executor.map(worker, range(n)))


@pytest.mark.django_db(transaction=True)
def test_concurrent_identical_assignments_send_exactly_one_copy(
    booking_service, event, buyer, make_tier
):
    tier = make_tier(name="Gold", quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )
    ticket = booking_service.confirm_booking(
        booking_id=result.booking.id, payment_ref="pay_1"
    ).tickets[0]

    def assign(_i: int) -> None:
        booking_service.assign_attendees(
            booking_id=result.booking.id,
            actor_id=buyer.id,
            assignments=[{"ticket_id": ticket.id, "name": "Asha Rao", "email": "asha@example.com"}],
        )

    _run_concurrently(assign, 8)

    assert OutboxEvent.objects.filter(event_type=TICKET_ASSIGNED).count() == 1
    ticket.refresh_from_db()
    assert ticket.attendee_email == "asha@example.com"
