from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.settlements.models import PayoutAttemptStatus
from apps.settlements.repositories import PayoutAttemptRepository, SettlementRepository


@pytest.mark.django_db
def test_ensure_for_event_is_idempotent_and_totals_are_atomic(finished_event):
    repo = SettlementRepository()

    first = repo.ensure_for_event(finished_event.id, releasable_at=timezone.now())
    again = repo.ensure_for_event(finished_event.id, releasable_at=timezone.now())
    assert first.id == again.id  # one settlement per event

    repo.add_confirmed(finished_event.id, amount=50000, fee=10)
    repo.add_confirmed(finished_event.id, amount=50000, fee=10)
    repo.add_refund(finished_event.id, amount=50000)

    s = repo.get_by_event(finished_event.id)
    assert s is not None
    assert (s.gross, s.platform_fee, s.refunds) == (100000, 20, 50000)
    assert s.net == 100000 - 20 - 50000  # recomputed in each atomic update


@pytest.mark.django_db
def test_list_releasable_ids_filters_by_status_and_time(finished_event, upcoming_event):
    repo = SettlementRepository()
    now = timezone.now()
    repo.ensure_for_event(finished_event.id, releasable_at=now - timedelta(hours=1))
    repo.ensure_for_event(upcoming_event.id, releasable_at=now + timedelta(days=2))

    ids = repo.list_releasable_ids(now=now)

    due = repo.get_by_event(finished_event.id)
    assert due is not None
    assert ids == [due.id]  # only the past-due, still-pending one


@pytest.mark.django_db
def test_payout_attempt_record(finished_event):
    settlements = SettlementRepository()
    s = settlements.ensure_for_event(finished_event.id, releasable_at=timezone.now())

    attempt = PayoutAttemptRepository().record(
        settlement_id=s.id,
        amount_minor=99980,
        status=PayoutAttemptStatus.SUCCESS,
        provider_ref="fake_payout_1",
    )
    assert attempt.status == PayoutAttemptStatus.SUCCESS
    assert s.payout_attempts.count() == 1


@pytest.mark.django_db
def test_list_for_owner_scopes_to_the_owner(finished_event, organizer, other_organizer):
    repo = SettlementRepository()
    repo.ensure_for_event(finished_event.id, releasable_at=timezone.now())

    assert repo.list_for_owner(organizer.id).count() == 1
    assert repo.list_for_owner(other_organizer.id).count() == 0
