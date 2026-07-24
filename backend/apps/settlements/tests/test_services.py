"""The money-integrity core of settlements, tested with fake adapters (never
through config.di — per the testing conventions). The concurrency guarantee
lives separately in test_concurrency.py."""

from __future__ import annotations

import pytest

from apps.settlements.exceptions import EventNotFinishedError
from apps.settlements.models import PayoutAttemptStatus, Settlement, SettlementStatus
from apps.settlements.repositories import SettlementRepository
from apps.settlements.services import RELEASE_TASK
from core.models import OutboxEvent

from .conftest import (
    FailingPayoutAdapter,
    InlineReleaseQueue,
    book_and_pay,
    make_service,
    refund,
)


def _settlement(event) -> Settlement:
    s = SettlementRepository().get_by_event(event.id)
    assert s is not None
    return s


@pytest.mark.django_db
def test_running_totals_reconcile_gross_fee_refunds_net(
    settlement_service, booking_service, buyer, finished_event, tier_for
):
    tier = tier_for(finished_event)
    p1 = book_and_pay(
        booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier
    )
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier)
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier)
    # Refund one of the three.
    refund(settlement_service, event=finished_event, payment=p1)

    s = _settlement(finished_event)
    # 3 x (gross 50000, fee 10); one fully refunded (refunds 50000).
    assert s.gross == 150000
    assert s.platform_fee == 30
    assert s.refunds == 50000
    assert s.net == s.gross - s.platform_fee - s.refunds == 99970


@pytest.mark.django_db
def test_release_pays_the_authoritative_net_after_the_event(
    settlement_service, payout_adapter, booking_service, buyer, finished_event, tier_for
):
    tier = tier_for(finished_event)
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier)
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier)
    s = _settlement(finished_event)

    settlement_service.release_payout(s.id)

    s.refresh_from_db()
    assert s.status == SettlementStatus.PAID
    assert s.net == 100000 - 20  # 2 x 50000 gross, 2 x 10 fee
    assert s.payout_at is not None
    assert s.provider_ref.startswith("fake_payout_")
    # Exactly the authoritative net was paid to the organizer's linked account.
    payouts = list(payout_adapter.payouts_by_key.values())
    assert len(payouts) == 1
    assert payouts[0]["amount_minor"] == s.net
    # The attempt is recorded for the audit trail.
    assert s.payout_attempts.filter(status=PayoutAttemptStatus.SUCCESS).count() == 1


@pytest.mark.django_db
def test_release_before_event_end_is_refused(
    settlement_service, booking_service, buyer, upcoming_event, tier_for
):
    tier = tier_for(upcoming_event)
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=upcoming_event, tier=tier)
    s = _settlement(upcoming_event)

    with pytest.raises(EventNotFinishedError):
        settlement_service.release_payout(s.id)

    s.refresh_from_db()
    assert s.status == SettlementStatus.PENDING  # still owed, not paid


@pytest.mark.django_db
def test_release_is_idempotent_never_double_pays(
    settlement_service, payout_adapter, booking_service, buyer, finished_event, tier_for
):
    tier = tier_for(finished_event)
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier)
    s = _settlement(finished_event)

    settlement_service.release_payout(s.id)
    settlement_service.release_payout(s.id)  # retry / redelivery

    s.refresh_from_db()
    assert s.status == SettlementStatus.PAID
    assert len(payout_adapter.payouts_by_key) == 1  # paid exactly once
    assert s.payout_attempts.count() == 1


@pytest.mark.django_db
def test_refund_before_payout_reduces_net_and_the_payout(
    settlement_service, payout_adapter, booking_service, buyer, finished_event, tier_for
):
    tier = tier_for(finished_event)
    p1 = book_and_pay(
        booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier
    )
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier)
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier)
    refund(settlement_service, event=finished_event, payment=p1)  # refund one before payout

    s = _settlement(finished_event)
    settlement_service.release_payout(s.id)

    s.refresh_from_db()
    # gross 150000, fee 30, refunds 50000 -> net 99970, and that's what's paid.
    assert s.net == 99970
    assert list(payout_adapter.payouts_by_key.values())[0]["amount_minor"] == 99970


@pytest.mark.django_db
def test_net_zero_or_negative_settles_without_a_payout(
    settlement_service, payout_adapter, booking_service, buyer, finished_event, tier_for
):
    """Fully refunded (net = gross − fee − refunds ≤ 0): the net>=0 guard settles
    it to zero — marked paid, NO external payout, NO organizer notification."""
    tier = tier_for(finished_event)
    p1 = book_and_pay(
        booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier
    )
    refund(settlement_service, event=finished_event, payment=p1)  # fully refunded
    s = _settlement(finished_event)

    settlement_service.release_payout(s.id)

    s.refresh_from_db()
    assert s.net <= 0  # 50000 - 10 - 50000 = -10
    assert s.status == SettlementStatus.PAID  # settled (nothing owed)
    assert s.provider_ref == "settled_zero"
    assert len(payout_adapter.payouts_by_key) == 0  # no money moved
    assert not OutboxEvent.objects.filter(event_type="settlements.payout_released").exists()


@pytest.mark.django_db
def test_payout_failure_retries_then_dead_letters_and_stays_owed(
    booking_service, buyer, finished_event, tier_for
):
    tier = tier_for(finished_event)
    queue = InlineReleaseQueue()
    service = make_service(payments_port=FailingPayoutAdapter(), queue=queue, max_attempts=3)
    queue.service = service
    book_and_pay(booking_service, service, buyer=buyer, event=finished_event, tier=tier)
    s = _settlement(finished_event)

    service.release_payout(s.id)

    s.refresh_from_db()
    assert s.status == SettlementStatus.FAILED  # dead-lettered
    assert s.attempts == 3
    assert s.net > 0  # still owed — never lost
    assert s.payout_attempts.filter(status=PayoutAttemptStatus.FAILED).count() == 3
    assert OutboxEvent.objects.filter(event_type="settlements.payout_failed").exists()


@pytest.mark.django_db
def test_refund_after_payout_is_flagged_as_an_adjustment(
    settlement_service, booking_service, buyer, finished_event, tier_for
):
    tier = tier_for(finished_event)
    p1 = book_and_pay(
        booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier
    )
    book_and_pay(booking_service, settlement_service, buyer=buyer, event=finished_event, tier=tier)
    s = _settlement(finished_event)
    settlement_service.release_payout(s.id)  # paid

    # A refund arrives AFTER the payout — must be flagged, not silently applied.
    refund(settlement_service, event=finished_event, payment=p1)

    s.refresh_from_db()
    assert s.status == SettlementStatus.PAID  # payout already went out
    assert s.payout_attempts.filter(status=PayoutAttemptStatus.ADJUSTMENT).count() == 1


@pytest.mark.django_db
def test_release_due_job_enqueues_only_releasable_settlements(
    booking_service, buyer, finished_event, upcoming_event, tier_for
):
    from .conftest import RecordingQueue

    queue = RecordingQueue()
    service = make_service(queue=queue)
    # One finished (releasable), one upcoming (not).
    book_and_pay(
        booking_service, service, buyer=buyer, event=finished_event, tier=tier_for(finished_event)
    )
    book_and_pay(
        booking_service, service, buyer=buyer, event=upcoming_event, tier=tier_for(upcoming_event)
    )

    count = service.release_due_payouts()

    assert count == 1  # only the finished event's settlement is due
    due = _settlement(finished_event)
    assert queue.enqueued == [(RELEASE_TASK, {"settlement_id": str(due.id)}, 0)]
