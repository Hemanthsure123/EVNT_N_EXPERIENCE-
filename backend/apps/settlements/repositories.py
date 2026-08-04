"""ORM access for settlements — the only place its queries live.

The running-total updates (`add_confirmed`/`add_refund`) are atomic single
`UPDATE`s using `F()` expressions (no lost updates under concurrent events, no
lock needed — these are DISPLAY figures). The payout release path uses
`lock_for_update` so exactly one payout is ever made per settlement.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from django.db.models import F, QuerySet
from django.utils import timezone

from core.base_repository import BaseRepository

from .models import PayoutAttempt, Settlement, SettlementStatus

# The columns the organizer list/detail response needs — plus the event title
# and the org owner id (for the ownership check) via the joins.
_LIST_FIELDS = (
    "id",
    "gross",
    "platform_fee",
    "refunds",
    "net",
    "status",
    "payout_at",
    # In the lean set because the serializer exposes it. A field the serializer
    # reads but `.only()` omits is fetched again PER ROW — the same deferred
    # re-fetch `provider_ref` above is here to avoid.
    "releasable_at",
    "provider_ref",
    "created_at",
    "event_id",
    "event__title",
    "event__organization__owner_id",
)


class SettlementRepository(BaseRepository[Settlement]):
    model = Settlement

    # --- running totals (fast display; recomputed authoritatively at release) --

    def ensure_for_event(
        self, event_id: uuid.UUID | str, *, releasable_at: datetime | None
    ) -> Settlement:
        """Get-or-create the event's settlement (race-safe on the unique event).
        Sets `releasable_at` on first creation so the release job can find it."""
        settlement, _ = Settlement.objects.get_or_create(
            event_id=event_id,
            defaults={"releasable_at": releasable_at, "status": SettlementStatus.PENDING},
        )
        return settlement

    def add_confirmed(self, event_id: uuid.UUID | str, *, amount: int, fee: int) -> None:
        """gross += amount, platform_fee += fee, net recomputed — atomically.
        All F() refer to the pre-update values, so net = new_gross − new_fee −
        refunds in one statement."""
        Settlement.objects.filter(event_id=event_id).update(
            gross=F("gross") + amount,
            platform_fee=F("platform_fee") + fee,
            net=F("gross") + amount - (F("platform_fee") + fee) - F("refunds"),
            updated_at=timezone.now(),
        )

    def add_refund(self, event_id: uuid.UUID | str, *, amount: int) -> None:
        """refunds += amount, net -= amount — atomically."""
        Settlement.objects.filter(event_id=event_id).update(
            refunds=F("refunds") + amount,
            net=F("gross") - F("platform_fee") - (F("refunds") + amount),
            updated_at=timezone.now(),
        )

    # --- release path ------------------------------------------------------

    def get_by_event(self, event_id: uuid.UUID | str) -> Settlement | None:
        return Settlement.objects.filter(event_id=event_id).first()

    def lock_for_update(self, settlement_id: uuid.UUID | str) -> Settlement | None:
        """SELECT ... FOR UPDATE on the settlement row — serialises concurrent
        release attempts so exactly one payout is ever made. MUST run inside the
        caller's transaction."""
        return Settlement.objects.select_for_update().filter(pk=settlement_id).first()

    def list_releasable_ids(self, *, now: datetime, limit: int = 100) -> list[uuid.UUID]:
        """Ids of pending settlements whose release time has arrived (event
        ended + refund window closed) — the scheduled job's work list. Ids only;
        each is re-loaded under lock and re-verified before paying."""
        return list(
            Settlement.objects.filter(
                status=SettlementStatus.PENDING,
                releasable_at__isnull=False,
                releasable_at__lte=now,
            ).values_list("id", flat=True)[:limit]
        )

    # --- reads: organizer --------------------------------------------------

    def list_for_owner(self, owner_id: uuid.UUID | str) -> QuerySet[Settlement]:
        """Every settlement across the events this user's organizations own,
        newest first. One join to event→organization; no N+1."""
        return (
            self.get_queryset()
            .select_related("event", "event__organization")
            .filter(event__organization__owner_id=owner_id)  # type: ignore[misc]
            .only(*_LIST_FIELDS)
            .order_by("-created_at", "id")
        )

    def get_for_owner_check(self, event_id: uuid.UUID | str) -> Settlement | None:
        """Detail load for GET /organizer/settlements/{event_id}: the settlement
        plus enough of the event→org chain to render it and check ownership, in
        one query."""
        return (
            self.get_queryset()
            .select_related("event", "event__organization")
            .filter(event_id=event_id)
            .only(*_LIST_FIELDS)
            .first()
        )


class PayoutAttemptRepository(BaseRepository[PayoutAttempt]):
    model = PayoutAttempt

    def record(
        self,
        *,
        settlement_id: uuid.UUID | str,
        amount_minor: int,
        status: str,
        provider_ref: str = "",
        error: str = "",
    ) -> PayoutAttempt:
        return PayoutAttempt.objects.create(
            settlement_id=settlement_id,
            amount_minor=amount_minor,
            status=status,
            provider_ref=provider_ref,
            error=error,
        )
