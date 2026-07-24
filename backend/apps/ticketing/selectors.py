"""Read-side of ticketing (CQRS-lite). The ONLY thing cached here is the
availability *display* — the tier list an event page shows. It has a short
TTL and is invalidated on every change, and it is NEVER consulted to make a
reservation decision (that always locks the row — see services/strategies).
A few seconds of stale availability on screen is fine; an oversell is not.
"""

from __future__ import annotations

import uuid

from django.db.models import QuerySet

from core.ports.cache_port import CachePort

from .models import TicketType
from .repositories import TicketTypeRepository

# Short: availability moves fast during a sale, and the reserve decision is
# authoritative regardless, so the display can safely lag a few seconds.
TIERS_TTL_SECONDS = 10


def _default_cache() -> CachePort:
    from config.di import cache_port

    return cache_port()


def event_tiers_cache_key(event_id: uuid.UUID | str) -> str:
    return f"event:tiers:{event_id}"


def list_ticket_types(
    event_id: uuid.UUID | str, *, ticket_types: TicketTypeRepository | None = None
) -> QuerySet[TicketType]:
    ticket_types = ticket_types or TicketTypeRepository()
    return ticket_types.list_for_event(event_id)


def get_event_tiers_payload(
    event_id: uuid.UUID | str,
    *,
    ticket_types: TicketTypeRepository | None = None,
    cache: CachePort | None = None,
) -> list[dict]:
    """Cache-aside list of an event's tiers with live availability, for the
    public event page. Plain cache-aside (no single-flight): the rebuild is a
    single tiny indexed query and the TTL is short, so a stampede here is
    cheap — not worth the machinery the event-detail path needs."""
    from .schemas import TicketTypeSerializer

    ticket_types = ticket_types or TicketTypeRepository()
    cache = cache or _default_cache()

    key = event_tiers_cache_key(event_id)
    cached = cache.get(key)
    if cached is not None:
        return cached

    tiers = list(ticket_types.list_for_event(event_id))
    payload = [dict(row) for row in TicketTypeSerializer(tiers, many=True).data]
    cache.set(key, payload, timeout_seconds=TIERS_TTL_SECONDS)
    return payload


def invalidate_event_tiers_cache(
    event_id: uuid.UUID | str, *, cache: CachePort | None = None
) -> None:
    cache = cache or _default_cache()
    cache.delete(event_tiers_cache_key(event_id))
