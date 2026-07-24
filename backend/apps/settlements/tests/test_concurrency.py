"""Concurrent release attempts pay out EXACTLY ONCE — the settlement-row lock in
action. `transaction=True` gives each thread a real committed transaction so the
`SELECT ... FOR UPDATE` on the settlement row is exercised for real."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection

from apps.settlements.models import PayoutAttemptStatus, SettlementStatus
from apps.settlements.repositories import SettlementRepository
from core.adapters.local.fake_payment import FakePaymentAdapter

from .conftest import book_and_pay, make_service


def _run_concurrently(fn, n: int) -> list:
    def worker(i: int):
        try:
            return fn(i)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=n) as executor:
        return list(executor.map(worker, range(n)))


@pytest.mark.django_db(transaction=True)
def test_concurrent_release_attempts_pay_exactly_once(
    booking_service, buyer, finished_event, tier_for
):
    payout_adapter = FakePaymentAdapter()  # shared across the racing releases
    tier = tier_for(finished_event)
    book_and_pay(
        booking_service,
        make_service(payments_port=payout_adapter),
        buyer=buyer,
        event=finished_event,
        tier=tier,
    )
    settlement = SettlementRepository().get_by_event(finished_event.id)
    assert settlement is not None

    def release(_i: int) -> None:
        make_service(payments_port=payout_adapter).release_payout(settlement.id)

    _run_concurrently(release, 4)

    settlement.refresh_from_db()
    # EXACTLY ONE payout — the organizer is never double-paid under contention.
    assert settlement.status == SettlementStatus.PAID
    assert len(payout_adapter.payouts_by_key) == 1
    assert settlement.payout_attempts.filter(status=PayoutAttemptStatus.SUCCESS).count() == 1
