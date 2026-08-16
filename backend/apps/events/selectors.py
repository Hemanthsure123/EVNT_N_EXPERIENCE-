"""Read-side of the events module (CQRS-lite) with caching tuned for the
platform's hottest reads. Cache keys/TTLs are documented in CLAUDE.md's
Performance checklist — keep that doc in sync with any change here.

Two caching strategies, each fitting its access pattern:

1. **Event detail** (`event:{id}`) — a by-PK payload, cached with
   *single-flight* stampede protection: when the key expires under load (a
   viral event), exactly one request rebuilds it while the rest wait briefly
   for that rebuild instead of all hitting the DB at once. Invalidated by a
   direct delete on write.

2. **Listing/search** (`events:list:v{gen}:{hash}`) — the first page of each
   distinct filter combination, cached under a *generation* number. Listings
   can't be invalidated by key (there are unboundedly many filter hashes and
   any event's change could affect many of them), so instead a single
   `events:list:gen` counter is bumped on every write; every prior-generation
   key is thereby orphaned at once (and expires by TTL) with one atomic INCR.

Like `organizations`, the detail selector caches the already-serializer-
rendered dict (it IS the response body) — the same narrow, deliberate
coupling to schemas.py, justified the same way.
"""

from __future__ import annotations

import hashlib
import json
import uuid

from django.db.models import QuerySet

from core.ports.cache_port import CachePort

from .models import Event
from .repositories import EventRepository

EVENT_DETAIL_TTL_SECONDS = 60
EVENT_LIST_TTL_SECONDS = 30
#: An hour, far longer than any other read here. This is CRAWLER traffic, not
#: user traffic: nothing on a visitor's path waits on it, a search engine
#: re-fetches a sitemap on its own schedule of hours to days, and rebuilding it
#: scans every live event. The generation counter still orphans it on any write
#: (see `invalidate_event_caches`), so a newly published event does not wait an
#: hour to become listed.
EVENT_SITEMAP_TTL_SECONDS = 3600
_LOCK_TIMEOUT_SECONDS = 5
# How long a request that lost the single-flight race waits for the winner to
# repopulate the cache before falling back to its own DB read. A by-PK rebuild
# takes low-single-digit ms, so this is only ever a ceiling, never the norm.
_SINGLE_FLIGHT_WAIT_SECONDS = 0.5

_LIST_GENERATION_KEY = "events:list:gen"


def _default_cache() -> CachePort:
    from config.di import cache_port

    return cache_port()


# --- cache keys -----------------------------------------------------------


def event_detail_cache_key(event_id: uuid.UUID | str) -> str:
    return f"event:{event_id}"


def events_list_cache_key(generation: int, filter_hash: str) -> str:
    return f"events:list:v{generation}:{filter_hash}"


def events_sitemap_cache_key(generation: int) -> str:
    """Keyed by the SAME generation counter the listing caches use, so the one
    `bump` every publicly-visible write already performs orphans this too. A
    sitemap that keeps advertising a cancelled event for an hour is the failure
    a separate, un-invalidated key would have."""
    return f"events:sitemap:v{generation}"


def compute_filter_hash(filters: dict) -> str:
    """Stable short hash of a normalized filter dict, for the list cache key.
    default=str so datetimes/UUIDs serialize deterministically."""
    normalized = json.dumps(filters, sort_keys=True, default=str)
    return hashlib.sha1(normalized.encode(), usedforsecurity=False).hexdigest()[:16]


def get_events_list_generation(cache: CachePort) -> int:
    gen = cache.get(_LIST_GENERATION_KEY)
    return int(gen) if gen is not None else 0


def bump_events_list_generation(cache: CachePort) -> None:
    cache.incr(_LIST_GENERATION_KEY)


# --- reads ----------------------------------------------------------------


def get_event_detail_payload(
    event_id: uuid.UUID | str,
    *,
    events: EventRepository | None = None,
    cache: CachePort | None = None,
) -> dict | None:
    """Cache-aside read for the public GET /events/{id}. Returns None if the
    event doesn't exist or isn't published (draft/paused/deleted), so the view
    can raise EventNotFoundError itself.

    Single-flight: on a miss, one request acquires the lock and rebuilds; a
    concurrent miss blocks up to `_SINGLE_FLIGHT_WAIT_SECONDS` for that rebuild
    and then serves the freshly-cached value. Only if the winner is somehow
    slower than that ceiling does a loser fall back to its own DB read — so a
    viral event never turns a cache expiry into a DB stampede.
    """
    from .schemas import EventDetailSerializer

    events = events or EventRepository()
    cache = cache or _default_cache()

    key = event_detail_cache_key(event_id)
    cached = cache.get(key)
    if cached is not None:
        return cached

    with cache.lock(
        key,
        timeout_seconds=_LOCK_TIMEOUT_SECONDS,
        blocking_timeout_seconds=_SINGLE_FLIGHT_WAIT_SECONDS,
    ) as acquired:
        # Winner: still a miss. Loser that just got in: the winner has since
        # populated it, so this returns without touching the DB.
        cached = cache.get(key)
        if cached is not None:
            return cached

        event = events.get_published_by_id(event_id)
        if event is None:
            # A CANCELLED event still has a page. Hundreds of people hold a
            # link in an email and they will open it — a 404 there reads as
            # "the platform lost my booking", where the page saying it was
            # cancelled and the refund is on its way is the difference between
            # a support queue and none.
            #
            # It is a second query only on a path that would otherwise have
            # returned nothing, so the hot read is unchanged; and it is a
            # separate repository method rather than a widened
            # `get_published_by_id`, because every other caller of that one
            # means "sellable" and quietly handing them a cancelled event is
            # how a ticket gets sold for a show that is not happening.
            event = events.get_cancelled_by_id(event_id)
        if event is None:
            return None

        payload = dict(EventDetailSerializer(event).data)
        # Only the lock winner writes the cache; a timed-out loser still
        # returns correct data but doesn't double-write.
        if acquired:
            cache.set(key, payload, timeout_seconds=EVENT_DETAIL_TTL_SECONDS)
        return payload


def list_published_events(
    filters: dict, *, events: EventRepository | None = None
) -> QuerySet[Event]:
    """Queryset for the public browse/search list. The view paginates it (and
    caches the rendered first page); keeping the queryset lazy here means
    deeper pages stream straight from the index without this selector
    materialising anything."""
    events = events or EventRepository()
    return events.list_published(**filters)


def get_events_sitemap_payload(
    *, events: EventRepository | None = None, cache: CachePort | None = None
) -> list[dict]:
    """Every publicly-reachable event as `{id, slug, updated_at}`, for
    `/sitemap.xml`.

    Cached whole rather than paginated: a sitemap is consumed in one piece by
    one kind of client, and cursor-paginating it would make the frontend issue
    N requests at build time to assemble a document it then writes out in full.

    No single-flight lock, unlike the detail read. Two crawlers arriving inside
    the same expiry window is not a stampede, and the query is a single index
    scan over one partial index — the protection would cost more than the race.
    """
    from .schemas import EventSitemapEntrySerializer

    events = events or EventRepository()
    cache = cache or _default_cache()

    key = events_sitemap_cache_key(get_events_list_generation(cache))
    cached = cache.get(key)
    if cached is not None:
        return cached

    rows = list(EventSitemapEntrySerializer(events.list_for_sitemap(), many=True).data)
    cache.set(key, rows, timeout_seconds=EVENT_SITEMAP_TTL_SECONDS)
    return rows


def list_owner_events(
    owner_id: uuid.UUID | str, *, events: EventRepository | None = None
) -> QuerySet[Event]:
    events = events or EventRepository()
    return events.list_by_owner(owner_id)


def invalidate_event_caches(event_id: uuid.UUID | str, *, cache: CachePort | None = None) -> None:
    """Drop the event's detail entry and orphan every cached listing page in
    one shot. Call inside transaction.on_commit so a concurrent reader can't
    repopulate stale data in the pre-commit window."""
    cache = cache or _default_cache()
    cache.delete(event_detail_cache_key(event_id))
    bump_events_list_generation(cache)
