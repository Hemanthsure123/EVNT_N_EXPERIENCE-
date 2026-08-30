"""ORM access for ticket types and their sale phases — the only place tier
queries live.

The reservation path (`lock_for_update` + `phases_for_pricing` +
`save_counts`) is deliberately the leanest possible: lock one row, read its
schedule with one indexed child SELECT, write the counters back. Nothing
else runs while the lock is held (see CLAUDE.md's reservation contract).
"""

from __future__ import annotations

import uuid

from django.db.models import F, Min, QuerySet, Sum
from django.utils import timezone

from core.base_repository import BaseRepository

from .models import SalePhase, TicketType
from .pricing import Phase

# Columns the locked reservation path needs — nothing heavy, so the critical
# section stays tiny. `price_minor` is here because the PRICE decision is made
# under the same lock as the availability decision (see strategies.py): if it
# were deferred, pricing would trigger a second fetch on the same row, which
# defeats the point of holding it.
_LOCK_FIELDS = (
    "id",
    "event_id",
    "quantity",
    "sold",
    "reserved",
    "sale_start",
    "sale_end",
    "max_per_order",
    "price_minor",
)

# Columns the pricing rule needs from a phase row — the locked read stays lean.
_PHASE_FIELDS = ("id", "ticket_type_id", "name", "price_minor", "ends_at", "quantity", "position")


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

    def phases_for_pricing(self, ticket_type_id: uuid.UUID | str) -> list[Phase]:
        """The tier's schedule, ascending position, as the pure rule's input.

        This is the ONE extra statement the locked reserve section allows: a
        single child SELECT backed by the `sale_phase_position_uniq` index
        (ticket_type, position), which also hands back the rows already in
        schedule order. Phase writes happen in the same transaction as the
        tier's version-bump UPDATE (see services.py), so a read made while
        holding the tier's row lock can never see a half-replaced schedule.
        """
        return [
            row.as_phase()
            for row in SalePhase.objects.filter(ticket_type__pk=ticket_type_id)
            .only(*_PHASE_FIELDS)
            .order_by("position")
        ]

    def save_counts(self, ticket_type: TicketType) -> None:
        """Persist only the reservation counters (the CHECK constraint backstops
        the invariant on write). Targeted update keeps the write minimal and
        avoids clobbering columns an organizer edit may have changed."""
        ticket_type.save(update_fields=["sold", "reserved", "updated_at"])

    # --- reads -------------------------------------------------------------

    def list_for_event(
        self, event_id: uuid.UUID | str, *, slot_id: uuid.UUID | str | None = None
    ) -> QuerySet[TicketType]:
        """All of an event's live tiers, cheapest first, with their phase
        schedules attached. Two queries total however many tiers there are —
        the tier list plus ONE prefetch for every schedule — never a phases
        query per tier."""
        qs = (
            self.get_queryset()
            .filter(event_id=event_id, deleted_at__isnull=True)
            .prefetch_related("phases")
        )
        if slot_id is not None:
            qs = qs.filter(slot_id=slot_id)  # type: ignore[misc]
        # Slot first, so a multi-session event's tiers arrive already grouped by
        # the session a buyer picked; price within it, as before. `slot__position`
        # rather than the slot's start time, because the organiser's arrangement
        # is the one the ticket panel renders.
        # `position` FIRST, price second. An organiser running a festival wants
        # their weekend pass above the day tickets whatever it costs, and
        # merchandising the list is the one thing a price sort cannot express.
        # Every tier defaults to 0, so an organiser who never touches it gets
        # exactly the old cheapest-first behaviour.
        return qs.order_by(
            "slot__position", "slot__starts_at", "position", "price_minor", "created_at"
        )

    def get_active_by_id(self, ticket_type_id: uuid.UUID | str) -> TicketType | None:
        return (
            self.get_queryset()
            .filter(pk=ticket_type_id, deleted_at__isnull=True)
            .prefetch_related("phases")
            .first()
        )

    def get_with_event_owner(self, ticket_type_id: uuid.UUID | str) -> TicketType | None:
        """Load a tier plus its event's organization owner id in one joined
        query (plus the phases prefetch), for the ownership check and the
        merged price-vs-schedule validation on organizer edits."""
        return (
            self.get_queryset()
            .select_related("event__organization")
            .prefetch_related("phases")
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
        authoritative tier rows: cheapest active FACE price + total remaining.
        Phases deliberately don't feed this — a "from ₹X" that lapses with a
        phase deadline would go stale on every event card at once."""
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
        slot_id: uuid.UUID | str | None = None,
        description: str = "",
        perks: list[str] | None = None,
        position: int = 0,
    ) -> TicketType:
        return TicketType.objects.create(
            event_id=event_id,
            slot_id=slot_id,
            name=name,
            description=description,
            # `or []` is not laziness: the DEFAULT must be a fresh list per row.
            # A shared one would let an append on one tier reach another.
            perks=perks or [],
            position=position,
            price_minor=price_minor,
            quantity=quantity,
            sale_start=sale_start,
            sale_end=sale_end,
            max_per_order=max_per_order,
        )

    def set_phases(self, *, ticket_type_id: uuid.UUID | str, phases: list[dict]) -> None:
        """Replace the tier's schedule wholesale — delete + recreate (max 5
        rows, so no diffing is worth its complexity). Array order IS position.
        MUST run in the same transaction as the tier's version-bump UPDATE
        (the caller's UnitOfWork) so a schedule edit serialises with in-flight
        reserves and a locked reader never sees it half-applied."""
        SalePhase.objects.filter(ticket_type__pk=ticket_type_id).delete()
        SalePhase.objects.bulk_create(
            [
                SalePhase(
                    ticket_type_id=ticket_type_id,
                    name=phase["name"],
                    price_minor=phase["price_minor"],
                    ends_at=phase.get("ends_at"),
                    quantity=phase.get("quantity"),
                    position=position,
                )
                for position, phase in enumerate(phases)
            ]
        )

    def copy_ticket_types_to(
        self,
        *,
        source_event_id: uuid.UUID | str,
        target_event_id: uuid.UUID | str,
        slot_map: dict[str, str] | None = None,
    ) -> None:
        """Copy all active ticket types (and their sale phases) from source_event_id to target_event_id,
        resetting sold=0 and reserved=0."""
        slot_map = slot_map or {}
        source_tiers = (
            self.get_queryset()
            .filter(event_id=source_event_id, deleted_at__isnull=True)
            .prefetch_related("phases")
        )
        for src in source_tiers:
            target_slot_id = slot_map.get(str(src.slot_id)) if src.slot_id else None
            new_tt = TicketType.objects.create(
                event_id=target_event_id,
                slot_id=target_slot_id,
                name=src.name,
                description=src.description,
                perks=list(src.perks or []),
                position=src.position,
                price_minor=src.price_minor,
                quantity=src.quantity,
                sold=0,
                reserved=0,
                sale_start=src.sale_start,
                sale_end=src.sale_end,
                max_per_order=src.max_per_order,
            )
            phases = list(src.phases.all())
            if phases:
                SalePhase.objects.bulk_create(
                    [
                        SalePhase(
                            ticket_type_id=new_tt.id,
                            name=p.name,
                            price_minor=p.price_minor,
                            ends_at=p.ends_at,
                            quantity=p.quantity,
                            position=p.position,
                        )
                        for p in phases
                    ]
                )

    def update_if_version_matches(
        self, *, ticket_type_id: uuid.UUID | str, expected_version: int, changes: dict
    ) -> bool:
        """Optimistic-locked organizer edit (name/price/quantity/sale window/
        max_per_order). Race-free conditional UPDATE; a mismatch means another
        editor got there first. The no_oversell CHECK still backstops a
        quantity reduction that races a reserve. A phases-only edit passes
        empty `changes` — the version bump alone is what serialises the
        schedule replacement with in-flight reserves."""
        updated = (
            self.get_queryset()
            .filter(pk=ticket_type_id, version=expected_version, deleted_at__isnull=True)
            .update(version=expected_version + 1, updated_at=timezone.now(), **changes)
        )
        return updated == 1
