"""Read-side of check-in (CQRS-lite): the live attendance display.

The rule (see CLAUDE.md): **cache the count, trust the DB.** The fast path is a
Redis counter incremented on each admit; the SOURCE OF TRUTH is the database
(count of used tickets). The cache is periodically reconciled from the DB and
can therefore never drift into being authoritative — a missed increment or a
lost key self-heals on the next reconcile.

Cache keys / TTLs (keep CLAUDE.md's Performance checklist in sync with these):
- ``checkin:admitted:{event_id}``      — the live admitted counter (INCR fast path).
- ``checkin:capacity:{event_id}``      — the event's total capacity (stable).
- ``checkin:attend:fresh:{event_id}``  — short-lived "reconciled recently" marker.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from apps.booking.repositories import TicketRepository
from apps.ticketing.repositories import TicketTypeRepository
from core.ports.cache_port import CachePort

# How long a DB reconcile is trusted before the next read recomputes from the
# authoritative used-ticket count. Short, because attendance changes fast at
# the door — but long enough that the count read is served from Redis, not the
# DB, for the vast majority of dashboard polls.
ATTENDANCE_FRESH_TTL_SECONDS = 5
# The counter/capacity keys outlive the fresh marker so increments between
# reconciles accumulate on top of the last authoritative value.
ATTENDANCE_VALUE_TTL_SECONDS = 300


@dataclass(frozen=True)
class AttendancePayload:
    event_id: str
    admitted: int
    capacity: int


def attendance_counter_key(event_id: uuid.UUID | str) -> str:
    return f"checkin:admitted:{event_id}"


def attendance_capacity_key(event_id: uuid.UUID | str) -> str:
    return f"checkin:capacity:{event_id}"


def attendance_fresh_key(event_id: uuid.UUID | str) -> str:
    return f"checkin:attend:fresh:{event_id}"


def _default_cache() -> CachePort:
    from config.di import cache_port

    return cache_port()


def bump_attendance(event_id: uuid.UUID | str, *, cache: CachePort | None = None) -> None:
    """Best-effort live-count increment, called after an admit commits. Purely
    a display accelerator: if it's ever missed, the next reconcile corrects it
    from the DB (the counter is never the source of truth)."""
    cache = cache or _default_cache()
    cache.incr(attendance_counter_key(event_id))


def get_attendance(
    event_id: uuid.UUID | str,
    *,
    tickets: TicketRepository | None = None,
    ticket_types: TicketTypeRepository | None = None,
    cache: CachePort | None = None,
) -> AttendancePayload:
    """Live attendance for an event: admitted vs capacity.

    Fast path: if the counter was reconciled from the DB within the last
    ``ATTENDANCE_FRESH_TTL_SECONDS``, serve it straight from Redis (no DB).
    Otherwise recompute the admitted count from the authoritative used-ticket
    rows, reset the cached counter to that true value (correcting any drift),
    refresh the capacity, and re-arm the freshness marker.
    """
    tickets = tickets or TicketRepository()
    ticket_types = ticket_types or TicketTypeRepository()
    cache = cache or _default_cache()

    counter_key = attendance_counter_key(event_id)
    capacity_key = attendance_capacity_key(event_id)
    fresh_key = attendance_fresh_key(event_id)

    if cache.get(fresh_key) is not None:
        admitted = cache.get(counter_key)
        capacity = cache.get(capacity_key)
        if admitted is not None and capacity is not None:
            return AttendancePayload(str(event_id), int(admitted), int(capacity))

    # Reconcile from the DB — the source of truth the cache can never override.
    admitted = tickets.count_used_for_event(event_id)
    capacity = ticket_types.total_quantity_for_event(event_id)
    cache.set(counter_key, admitted, timeout_seconds=ATTENDANCE_VALUE_TTL_SECONDS)
    cache.set(capacity_key, capacity, timeout_seconds=ATTENDANCE_VALUE_TTL_SECONDS)
    cache.set(fresh_key, 1, timeout_seconds=ATTENDANCE_FRESH_TTL_SECONDS)
    return AttendancePayload(str(event_id), admitted, capacity)
