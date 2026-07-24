"""Events — the public discovery surface and the hottest read path on the
platform, so the model is shaped for fast, index-backed reads first.

Three performance-shaping decisions live in this file (see CLAUDE.md's
Performance checklist for the reasoning):

1. `search_vector` is a Postgres `tsvector`, kept in sync by a DB trigger
   (see the migration), with a GIN index — so free-text search is an index
   lookup, never an `ILIKE '%...%'` sequential scan.
2. The composite btree indexes match the exact WHERE/ORDER BY of the public
   browse queries (upcoming-by-date, and city-filtered upcoming-by-date).
3. `from_price_minor` / `tickets_available` are denormalized columns owned
   by the (later) `ticketing` module — null until it exists. Denormalizing
   the cheapest ticket price onto the event row means an event card never
   has to join or aggregate ticket rows to show "from ₹X".

`version` is an optimistic-lock counter (see repositories.update_if_version_
matches): concurrent edits can't silently overwrite each other.
"""

from __future__ import annotations

import uuid

from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.db import models


class EventStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    LIVE = "live", "Live"
    PAUSED = "paused", "Paused"
    FINISHED = "finished", "Finished"
    ARCHIVED = "archived", "Archived"


class Event(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT: an organization with events can't be deleted out from under
    # them. related_name lets the (later) organizer dashboard reach events.
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.PROTECT, related_name="events"
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    venue = models.CharField(max_length=255)
    city = models.CharField(max_length=120)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=EventStatus.choices, default=EventStatus.DRAFT)
    poster_url = models.CharField(max_length=500, blank=True, default="")

    # Denormalized, owned by the `ticketing` module (not built yet): the
    # cheapest active ticket price and remaining availability, so an event
    # card renders without touching ticket rows. Null until ticketing
    # maintains them — see CLAUDE.md ("cross-module denormalization").
    from_price_minor = models.PositiveIntegerField(null=True, blank=True)
    tickets_available = models.PositiveIntegerField(null=True, blank=True)

    # Optimistic-lock counter; bumped on every content edit. Clients send the
    # version they last read; a mismatch means someone else edited in between.
    version = models.PositiveIntegerField(default=1)

    # Kept in sync by a Postgres trigger (see the initial migration), never
    # written from Python — editable=False keeps it out of forms/serializers.
    search_vector = SearchVectorField(null=True, editable=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "events_event"
        indexes = [
            # Public browse: "upcoming published events, soonest first"
            # (WHERE status=? AND starts_at>=? ORDER BY starts_at) as a single
            # index range scan. Partial on the soft-delete flag so dead rows
            # never enter the index.
            models.Index(
                fields=["status", "starts_at"],
                name="event_status_starts_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # Public browse filtered by city — same shape with city pinned
            # between the status and the date range.
            models.Index(
                fields=["status", "city", "starts_at"],
                name="event_status_city_starts_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # Organizer dashboard + the FK join from an owner's organizations
            # to their events, newest first.
            models.Index(
                fields=["organization", "created_at"],
                name="event_org_created_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # Free-text search over the maintained tsvector.
            GinIndex(fields=["search_vector"], name="event_search_vector_gin"),
        ]

    def __str__(self) -> str:
        return self.title
