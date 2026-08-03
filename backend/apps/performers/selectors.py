"""Read side of the marketplace (CQRS-lite, like every other module).

CACHING. The public browse and the public profile are cached exactly as
`events` caches its equivalents, and for the same reason: they are identical
for every visitor and will be the hottest reads once the marketplace has
traffic.

  - `performer:{id}`                  — 60s — one profile
  - `performers:list:v{gen}:{hash}`   — 30s — a filtered page

**Generation-based invalidation**, again mirroring `events`: there are
unboundedly many filter hashes, so instead of tracking and deleting each, a
single `performers:list:gen` counter is bumped on every publicly-visible write.
Every prior-generation key is orphaned at once and TTLs out. Profile caches are
keyed by id and deleted directly.

Nothing owner-scoped or customer-scoped is cached at all: a brief, a quote and
a draft profile are per-person and change on the action being taken.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

from core.ports.cache_port import CachePort

from .repositories import PerformerMediaRepository, PerformerRepository, QuoteRepository

PERFORMER_DETAIL_TTL_SECONDS = 60
PERFORMER_LIST_TTL_SECONDS = 30
_LIST_GENERATION_KEY = "performers:list:gen"


def _default_cache() -> CachePort:
    from config.di import cache_port

    return cache_port()


def get_list_generation(cache: CachePort | None = None) -> int:
    cache = cache or _default_cache()
    # Absent means ZERO, not one. Redis `INCR` on a missing key sets it to 1,
    # so defaulting to 1 here would make the very first invalidation a no-op —
    # the exact bug the events module shipped once and now guards against.
    value = cache.get(_LIST_GENERATION_KEY)
    return int(value) if value is not None else 0


def bump_list_generation(cache: CachePort | None = None) -> None:
    cache = cache or _default_cache()
    cache.incr(_LIST_GENERATION_KEY)


def invalidate_performer_caches(performer_id: UUID | str, cache: CachePort | None = None) -> None:
    cache = cache or _default_cache()
    cache.delete(f"performer:{performer_id}")
    bump_list_generation(cache)


def compute_filter_hash(params: dict[str, Any]) -> str:
    """A stable key for a filter set. Sorted, so `?city=X&type=Y` and
    `?type=Y&city=X` share one cache entry rather than two."""
    normalised = {key: value for key, value in sorted(params.items()) if value not in (None, "")}
    return hashlib.sha256(json.dumps(normalised, sort_keys=True).encode()).hexdigest()[:16]


def performers_list_cache_key(generation: int, filter_hash: str) -> str:
    return f"performers:list:v{generation}:{filter_hash}"


def decorate_cards(
    performers: list, *, media: PerformerMediaRepository | None = None
) -> list[dict[str, Any]]:
    """A page of performers, each with its first photo.

    The photo lookup is ONE grouped query for the whole page rather than one
    per card — the N+1 this grid would otherwise have.
    """
    media = media or PerformerMediaRepository()
    ids = [performer.id for performer in performers]
    first_photo = media.media_for_many(ids) if ids else {}

    return [
        {
            "id": str(performer.id),
            "stage_name": performer.stage_name,
            "performer_type": performer.performer_type,
            "tagline": performer.tagline,
            "city": performer.city,
            "travel_radius_km": performer.travel_radius_km,
            "base_price_minor": performer.base_price_minor,
            "genres": performer.genres or [],
            "languages": performer.languages or [],
            "experience_years": performer.experience_years,
            "is_featured": performer.is_featured,
            "organization_id": str(performer.organization_id),
            "organization_name": performer.organization.name,
            "verified_level": performer.organization.verified_level,
            "photo_url": getattr(first_photo.get(performer.id), "url", ""),
            "photo_alt": getattr(first_photo.get(performer.id), "alt_text", ""),
        }
        for performer in performers
    ]


def get_performer_detail_payload(
    performer_id: UUID | str,
    *,
    performers: PerformerRepository | None = None,
    media: PerformerMediaRepository | None = None,
    cache: CachePort | None = None,
) -> dict[str, Any] | None:
    """One public profile, cache-aside.

    Single-flight is deliberately NOT used here, unlike the event detail. A
    performer profile is not a hot key in the way a viral event is — there is
    no on-sale moment when thousands hit one row at once — so the stampede
    protection that costs a blocking lock would be paying for a risk this read
    does not have.
    """
    performers = performers or PerformerRepository()
    media = media or PerformerMediaRepository()
    cache = cache or _default_cache()

    key = f"performer:{performer_id}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    performer = performers.get_published_by_id(performer_id)
    if performer is None:
        return None

    payload = {
        "id": str(performer.id),
        "stage_name": performer.stage_name,
        "performer_type": performer.performer_type,
        "tagline": performer.tagline,
        "bio": performer.bio,
        "city": performer.city,
        "travel_radius_km": performer.travel_radius_km,
        "base_price_minor": performer.base_price_minor,
        "genres": performer.genres or [],
        "languages": performer.languages or [],
        "occasions": performer.occasions or [],
        "experience_years": performer.experience_years,
        "typical_set_minutes": performer.typical_set_minutes,
        "website_url": performer.website_url,
        "instagram_url": performer.instagram_url,
        "youtube_url": performer.youtube_url,
        "is_featured": performer.is_featured,
        "organization_id": str(performer.organization_id),
        "organization_name": performer.organization.name,
        "verified_level": performer.organization.verified_level,
        "created_at": performer.created_at.isoformat(),
        "photos": [
            {
                "id": str(photo.id),
                "url": photo.url,
                "alt_text": photo.alt_text,
                "caption": photo.caption,
                "position": photo.position,
            }
            for photo in media.media_for(performer.id)
        ],
    }
    cache.set(key, payload, timeout_seconds=PERFORMER_DETAIL_TTL_SECONDS)
    return payload


def decorate_requests(
    requests: list, *, quotes: QuoteRepository | None = None
) -> list[dict[str, Any]]:
    """A customer's briefs, each with its quote count.

    The counts come from ONE grouped query for the page, not one per row.
    """
    quotes = quotes or QuoteRepository()
    ids = [request.id for request in requests]
    counts = quotes.count_for_requests(ids) if ids else {}

    return [
        {
            "id": str(request.id),
            "performer_type": request.performer_type,
            "occasion": request.occasion,
            "city": request.city,
            "event_date": request.event_date.isoformat(),
            "budget_min_minor": request.budget_min_minor,
            "budget_max_minor": request.budget_max_minor,
            "guests": request.guests,
            "notes": request.notes,
            "status": request.status,
            "quote_count": counts.get(request.id, 0),
            "booked_performer_id": (
                str(request.booked_performer_id) if request.booked_performer_id else None
            ),
            "booked_performer_name": (
                request.booked_performer.stage_name if request.booked_performer else ""
            ),
            "created_at": request.created_at.isoformat(),
        }
        for request in requests
    ]


def decorate_quotes(quotes: list) -> list[dict[str, Any]]:
    return [
        {
            "id": str(quote.id),
            "request_id": str(quote.request_id),
            "amount_minor": quote.amount_minor,
            "message": quote.message,
            "status": quote.status,
            "created_at": quote.created_at.isoformat(),
            "performer_id": str(quote.performer_id),
            "performer_name": quote.performer.stage_name,
            "performer_type": quote.performer.performer_type,
            "performer_city": quote.performer.city,
            "performer_experience_years": quote.performer.experience_years,
            "organization_name": quote.performer.organization.name,
            "verified_level": quote.performer.organization.verified_level,
        }
        for quote in quotes
    ]


def decorate_performer_quotes(quotes: list) -> list[dict[str, Any]]:
    """The performer's own side: what they bid, and what came of it."""
    return [
        {
            "id": str(quote.id),
            "request_id": str(quote.request_id),
            "amount_minor": quote.amount_minor,
            "message": quote.message,
            "status": quote.status,
            "created_at": quote.created_at.isoformat(),
            "request_city": quote.request.city,
            "request_occasion": quote.request.occasion,
            "request_event_date": quote.request.event_date.isoformat(),
            "request_status": quote.request.status,
        }
        for quote in quotes
    ]


def decorate_open_requests(
    requests: list, *, quotes: QuoteRepository | None = None
) -> list[dict[str, Any]]:
    """The performer's lead feed. Same shape as the customer's list minus
    anything identifying the customer — a brief is a job, not a contact
    record, and the customer's name is not the performer's to have until they
    are hired."""
    quotes = quotes or QuoteRepository()
    ids = [request.id for request in requests]
    counts = quotes.count_for_requests(ids) if ids else {}
    return [
        {
            "id": str(request.id),
            "performer_type": request.performer_type,
            "occasion": request.occasion,
            "city": request.city,
            "event_date": request.event_date.isoformat(),
            "budget_min_minor": request.budget_min_minor,
            "budget_max_minor": request.budget_max_minor,
            "guests": request.guests,
            "notes": request.notes,
            "quote_count": counts.get(request.id, 0),
            "created_at": request.created_at.isoformat(),
        }
        for request in requests
    ]


def get_marketplace_facets(*, performers: PerformerRepository | None = None) -> dict[str, Any]:
    """What the filter panel can actually offer.

    Derived from LIVE performers rather than hard-coded, so a genre nobody
    performs never appears as a filter that returns nothing. Cities likewise.
    """
    performers = performers or PerformerRepository()
    rows = performers.list_published().values_list("city", "genres", "languages")

    cities: set[str] = set()
    genres: set[str] = set()
    languages: set[str] = set()
    for city, row_genres, row_languages in rows:
        if city:
            cities.add(city)
        for genre in row_genres or []:
            genres.add(genre)
        for language in row_languages or []:
            languages.add(language)

    return {
        "cities": sorted(cities),
        "genres": sorted(genres),
        "languages": sorted(languages),
    }
