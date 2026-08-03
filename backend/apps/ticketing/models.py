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

The early-bird columns are the same idea applied to price: they are inputs to
a decision made under that same row lock (see `pricing.py` and
`strategies.py`), never read from a cache to bill anyone.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from django.db import models
from django.db.models import F, Q
from django.utils import timezone

from .pricing import EarlyBirdState, evaluate_early_bird

# Named so the service can tell the two CHECK violations apart when Postgres
# rejects an organizer edit — they mean different things to the operator.
NO_OVERSELL_CONSTRAINT = "ticket_type_no_oversell"
EARLY_BIRD_PRICE_CONSTRAINT = "ticket_type_early_bird_not_above_price"


class TicketType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT mirrors the rest of the tree (events are soft-deleted, never
    # hard-deleted); related_name lets the event surface its tiers.
    event = models.ForeignKey("events.Event", on_delete=models.PROTECT, related_name="ticket_types")
    name = models.CharField(max_length=100)
    price_minor = models.PositiveIntegerField()
    quantity = models.PositiveIntegerField()
    sold = models.PositiveIntegerField(default=0)
    reserved = models.PositiveIntegerField(default=0)
    sale_start = models.DateTimeField(null=True, blank=True)
    sale_end = models.DateTimeField(null=True, blank=True)
    # Early bird: an optional lower price, bounded by a deadline and/or a seat
    # allocation. All three nullable — no early bird is the norm. A null
    # `early_bird_quantity` means unlimited until the deadline; a null
    # `early_bird_ends_at` means it runs until the allocation is gone.
    early_bird_price_minor = models.PositiveIntegerField(null=True, blank=True)
    early_bird_ends_at = models.DateTimeField(null=True, blank=True)
    early_bird_quantity = models.PositiveIntegerField(null=True, blank=True)
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
            # An "early bird" dearer than the face price is a data-entry error
            # that would silently OVERCHARGE every buyer who hits it — the same
            # class of bug as an oversell, so it gets the same treatment: a hard
            # database backstop, not just a serializer check.
            models.CheckConstraint(
                check=Q(early_bird_price_minor__isnull=True)
                | Q(early_bird_price_minor__lte=F("price_minor")),
                name=EARLY_BIRD_PRICE_CONSTRAINT,
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

    def early_bird_state(self, now: datetime | None = None) -> EarlyBirdState:
        """This row's pricing right now, via the pure rule in `pricing.py`.

        Every column it reads is in the reservation path's `.only(...)` set,
        so calling this on a locked row costs no extra query. Callers on the
        write path MUST call it on a row they hold the lock for; callers on
        the read path get a display value that may be a cache TTL stale, which
        is the module's standing trade.
        """
        return evaluate_early_bird(
            price_minor=self.price_minor,
            early_bird_price_minor=self.early_bird_price_minor,
            early_bird_ends_at=self.early_bird_ends_at,
            early_bird_quantity=self.early_bird_quantity,
            sold=self.sold,
            reserved=self.reserved,
            now=now or timezone.now(),
        )
