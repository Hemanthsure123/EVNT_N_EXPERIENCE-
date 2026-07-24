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
"""

from __future__ import annotations

import uuid

from django.db import models
from django.db.models import F, Q


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
                name="ticket_type_no_oversell",
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
