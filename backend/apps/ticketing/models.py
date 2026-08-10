"""Ticket tiers and the AUTHORITATIVE availability counters.

This is the first module where a bug costs real money, so correctness is a
first-class concern (see CLAUDE.md, "Ticketing: cache-for-display, decide-
under-lock"). Two counters on each tier are the source of truth:

- `reserved` — held by in-flight orders (a `booking` hold that hasn't paid).
- `sold`     — paid and issued.

Availability is always `quantity - sold - reserved`, computed live under a
row lock at reserve time — never trusted from a cache. The `no_oversell`
CHECK constraint is the hard database backstop: even a buggy code path
physically cannot drive `sold + reserved` past `quantity`.

`price_minor` is money in minor units (paise/cents) as an integer — never a
float. `version` is an optimistic-lock counter for ORGANIZER edits; the
reservation counters are guarded by a pessimistic row lock instead (edits
are rare, reserves are a stampede — different tools for different contention).

`SalePhase` rows are the tier's named pricing schedule ("Early bird",
"Phase 1", …). They are the same idea applied to price: inputs to a decision
made under that same row lock (see `pricing.py` and `strategies.py`), never
read from a cache to bill anyone.
"""

from __future__ import annotations

import uuid

from django.db import models
from django.db.models import F, Q

from .pricing import Phase

# Named so the service can tell the CHECK violation apart when Postgres
# rejects an organizer edit.
NO_OVERSELL_CONSTRAINT = "ticket_type_no_oversell"


class TicketType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT mirrors the rest of the tree (events are soft-deleted, never
    # hard-deleted); related_name lets the event surface its tiers.
    event = models.ForeignKey("events.Event", on_delete=models.PROTECT, related_name="ticket_types")
    #: Which SESSION of the event this tier sells, when the event has sessions.
    #:
    #: NULL for every simple event and for every tier that predates slots — the
    #: platform's original behaviour, untouched.
    #:
    #: This FK is what gives a slot its own inventory. A slot-scoped tier is
    #: just another row with its own `quantity`/`sold`/`reserved`, so the
    #: per-row lock and the no-oversell CHECK constraint below already make an
    #: evening session incapable of eating a night session's stock. No counting
    #: logic changed to support slots, which is exactly what should happen when
    #: a feature is modelled as rows rather than as a special case.
    #:
    #: `PROTECT`, like the event FK above and for the same reason: a slot whose
    #: tiers have sold tickets must not be deletable.
    slot = models.ForeignKey(
        "events.EventSlot",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ticket_types",
    )
    name = models.CharField(max_length=100)
    #: What this tier actually IS, in the organiser's words. "Standing, front
    #: of the barrier" — the sentence that stops somebody buying the wrong
    #: ticket, which is the most expensive mistake a buyer can make on this
    #: platform because a ticket is not exchangeable.
    #:
    #: Blank is the norm, not a gap to fill: most tiers are self-describing
    #: ("General Admission"), and the panel omits the line rather than
    #: rendering an empty paragraph.
    description = models.CharField(max_length=280, blank=True, default="")
    #: What is INCLUDED — a JSON list of short strings, rendered as ticks.
    #:
    #: A list rather than more prose because that is how a buyer reads it: they
    #: are comparing two tiers and want the difference, not two paragraphs to
    #: diff by eye. And a JSON column rather than a table for the same reason
    #: `Event.policies` is one — written whole, read whole, never queried
    #: across rows, and a join on the tier read would land on the availability
    #: query, which is deliberately uncached.
    #:
    #: The default is the `list` CALLABLE. A mutable `[]` would be shared by
    #: every instance that does not set it, so one tier appending a perk would
    #: append it to the next.
    perks = models.JSONField(default=list, blank=True)
    #: The organiser's own order for the ticket panel.
    #:
    #: Tiers used to be listed by price alone, which is the right DEFAULT and
    #: the wrong rule: an organiser running a festival wants their weekend pass
    #: above the day tickets whatever it costs, and merchandising the list is
    #: the one thing a price sort cannot express. Ties fall back to price, so
    #: an organiser who never touches this sees exactly the old behaviour.
    position = models.PositiveIntegerField(default=0)
    price_minor = models.PositiveIntegerField()
    quantity = models.PositiveIntegerField()
    sold = models.PositiveIntegerField(default=0)
    reserved = models.PositiveIntegerField(default=0)
    sale_start = models.DateTimeField(null=True, blank=True)
    sale_end = models.DateTimeField(null=True, blank=True)
    max_per_order = models.PositiveIntegerField(default=10)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ticketing_ticket_type"
        constraints = [
            # The hard DB backstop against overselling — independent of any
            # application logic. sold/reserved are already non-negative
            # (PositiveIntegerField), but assert it explicitly too so the whole
            # invariant lives in one named constraint.
            models.CheckConstraint(
                check=Q(sold__gte=0)
                & Q(reserved__gte=0)
                & Q(quantity__gte=F("sold") + F("reserved")),
                name=NO_OVERSELL_CONSTRAINT,
            ),
        ]
        indexes = [
            # Lists a single event's tiers cheapest-first (the public tier list
            # + the organizer view) and backs the Min(price)/Sum(available)
            # aggregates that feed the event's denormalized fields — as one
            # index range scan. Partial on the soft-delete flag.
            models.Index(
                fields=["event", "price_minor"],
                name="tickettype_event_price_idx",
                condition=Q(deleted_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.event_id})"

    @property
    def available(self) -> int:
        return self.quantity - self.sold - self.reserved

    def pricing_phases(self) -> list[Phase]:
        """This tier's schedule as the pure rule's input, ascending position
        (SalePhase's Meta ordering). Reads `self.phases`, so it costs no query
        when the phases were prefetched (the display read path) and ONE lazy
        child query otherwise. The LOCKED reserve path never calls this — it
        loads phases through `TicketTypeRepository.phases_for_pricing`, the
        one extra statement its critical section allows (see strategies.py).
        """
        return [p.as_phase() for p in self.phases.all()]


class SalePhase(models.Model):
    """One named step of a tier's pricing schedule.

    `quantity` is a CUMULATIVE threshold against the tier's `sold + reserved`
    — "this phase's price applies to the first k seats of the tier" — not a
    per-phase allocation (see `pricing.Phase`). `position` is the schedule
    order; array order on the write payload becomes position. Phases are
    replaced wholesale on edit (max 5 rows) inside the same transaction as
    the tier's version-bump UPDATE, so a schedule edit serialises with
    in-flight reserves (see services.py).

    CASCADE, not PROTECT: a phase means nothing without its tier, and unlike
    a booking it is not a financial record anyone must keep — the price a
    buyer was actually billed lives on the booking item.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket_type = models.ForeignKey(TicketType, on_delete=models.CASCADE, related_name="phases")
    name = models.CharField(max_length=40)
    price_minor = models.PositiveIntegerField()
    ends_at = models.DateTimeField(null=True, blank=True)
    quantity = models.PositiveIntegerField(null=True, blank=True)
    position = models.PositiveSmallIntegerField()

    class Meta:
        db_table = "ticketing_sale_phase"
        # Every read of a schedule wants it in schedule order; ordering here
        # means the prefetched display read and the admin agree without each
        # restating it.
        ordering = ["position"]
        constraints = [
            # Two phases can't share a slot in the schedule. Its backing
            # (ticket_type, position) index is ALSO the index the reserve-path
            # read needs (WHERE ticket_type_id = … ORDER BY position), on top
            # of the FK's own index.
            models.UniqueConstraint(
                fields=["ticket_type", "position"], name="sale_phase_position_uniq"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} (pos {self.position}, {self.ticket_type_id})"

    def as_phase(self) -> Phase:
        return Phase(
            name=self.name,
            price_minor=self.price_minor,
            ends_at=self.ends_at,
            quantity=self.quantity,
            position=self.position,
        )
