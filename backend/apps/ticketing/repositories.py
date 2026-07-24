"""ORM access for ticket types — the only place tier queries live.

The reservation path (`lock_for_update` + `save_counts`) is deliberately the
leanest possible: lock one row, read the counters, write them back. Nothing
else runs while the lock is held (see CLAUDE.md's reservation contract).
"""

from __future__ import annotations

import uuid

from django.db.models import F, Min, QuerySet, Sum
from django.utils import timezone

from core.base_repository import BaseRepository

from .models import TicketType

# Columns the locked reservation path needs — nothing heavy, so the critical
# section stays tiny.
_LOCK_FIELDS = (
    "id",
    "event_id",
    "quantity",
    "sold",
    "reserved",
    "sale_start",
    "sale_end",
    "max_per_order",
)


class TicketTypeRepository(BaseRepository[TicketType]):
    model = TicketType

    # --- reservation path (called under the caller's transaction) ----------

    def lock_for_update(self, ticket_type_id: uuid.UUID | str) -> TicketType | None:
        """SELECT ... FOR UPDATE on the single tier row. MUST run inside a
        transaction (the caller's UnitOfWork provides it) — this is the row
        lock that serialises concurrent reserves for this tier, and only this
        tier (each tier is its own row, so Gold never waits on Basic)."""
        return (
            self.get_queryset()
            .select_for_update()
            .filter(pk=ticket_type_id, deleted_at__isnull=True)
            .only(*_LOCK_FIELDS)
            .first()
        )

    def save_counts(self, ticket_type: TicketType) -> None:
        """Persist only the reservation counters (the CHECK constraint backstops
        the invariant on write). Targeted update keeps the write minimal and
        avoids clobbering columns an organizer edit may have changed."""
        ticket_type.save(update_fields=["sold", "reserved", "updated_at"])

    # --- reads -------------------------------------------------------------

    def list_for_event(self, event_id: uuid.UUID | str) -> QuerySet[TicketType]:
        """All of an event's live tiers, cheapest first. One query, no joins —
        tiers don't traverse an FK for their display payload."""
        return (
            self.get_queryset()
            .filter(event_id=event_id, deleted_at__isnull=True)
            .order_by("price_minor", "created_at")
        )

    def get_active_by_id(self, ticket_type_id: uuid.UUID | str) -> TicketType | None:
        return self.get_queryset().filter(pk=ticket_type_id, deleted_at__isnull=True).first()

    def get_with_event_owner(self, ticket_type_id: uuid.UUID | str) -> TicketType | None:
        """Load a tier plus its event's organization owner id in one query, for
        the ownership check on organizer edits."""
        return (
            self.get_queryset()
            .select_related("event__organization")
            .filter(pk=ticket_type_id, deleted_at__isnull=True)
            .first()
        )

    def exists_for_event(self, event_id: uuid.UUID | str) -> bool:
        """Backs the events publish gate ('an event needs >= 1 ticket type')."""
        return self.get_queryset().filter(event_id=event_id, deleted_at__isnull=True).exists()

    def total_quantity_for_event(self, event_id: uuid.UUID | str) -> int:
        """The event's total sellable capacity = sum of its live tiers'
        quantities. Backs the check-in attendance display's "admitted / capacity"
        denominator. One aggregate query, no rows materialized."""
        agg = (
            self.get_queryset()
            .filter(event_id=event_id, deleted_at__isnull=True)
            .aggregate(total=Sum("quantity"))
        )
        return agg["total"] or 0

    def aggregate_event_availability(self, event_id: uuid.UUID | str) -> dict:
        """The event's denormalized ticketing fields, recomputed from the
        authoritative tier rows: cheapest active price + total remaining."""
        agg = (
            self.get_queryset()
            .filter(event_id=event_id, deleted_at__isnull=True)
            .aggregate(
                from_price_minor=Min("price_minor"),
                tickets_available=Sum(F("quantity") - F("sold") - F("reserved")),
            )
        )
        return {
            "from_price_minor": agg["from_price_minor"],  # None when no tiers
            "tickets_available": agg["tickets_available"] or 0,
        }

    # --- writes ------------------------------------------------------------

    def create(
        self,
        *,
        event_id: uuid.UUID | str,
        name: str,
        price_minor: int,
        quantity: int,
        sale_start=None,
        sale_end=None,
        max_per_order: int = 10,
    ) -> TicketType:
        return TicketType.objects.create(
            event_id=event_id,
            name=name,
            price_minor=price_minor,
            quantity=quantity,
            sale_start=sale_start,
            sale_end=sale_end,
            max_per_order=max_per_order,
        )

    def update_if_version_matches(
        self, *, ticket_type_id: uuid.UUID | str, expected_version: int, changes: dict
    ) -> bool:
        """Optimistic-locked organizer edit (name/price/quantity/sale window/
        max_per_order). Race-free conditional UPDATE; a mismatch means another
        editor got there first. The no_oversell CHECK still backstops a quantity
        reduction that races a reserve."""
        updated = (
            self.get_queryset()
            .filter(pk=ticket_type_id, version=expected_version, deleted_at__isnull=True)
            .update(version=expected_version + 1, updated_at=timezone.now(), **changes)
        )
        return updated == 1
