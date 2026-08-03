"""Cache-aside reads over the Maps port.

Every call to Google costs money. These endpoints sit in front of a venue
picker that fires on keystrokes and an event page that renders for every
visitor, so caching is not an optimisation here — it is the difference
between a bill of tens and a bill of thousands.

── THE TTLs ARE SET BY GOOGLE'S TERMS, NOT BY TASTE ─────────────────────

Google's Maps Platform terms permit temporary caching for performance, with
one hard limit and one exception:

- Place and geocoding CONTENT may be cached for **at most 30 days**. These
  use well under that, because a venue that closes or moves should not be
  wrong for a month.
- A **place id may be cached indefinitely**, and is explicitly called out in
  Google's terms as the thing to store. That is why `Event.place_id` is a
  column and the rest of the place is not.

Nothing here is stored in the database. A cache expires; a table becomes a
stale copy of somebody else's data that outlives its licence.

── WHAT IS NOT CACHED, AND WHY ──────────────────────────────────────────

**Autocomplete.** Its whole purpose is per-keystroke novelty, the key space
is unbounded, and Google bills it per SESSION when a session token groups
the keystrokes with the final Details call — caching individual keystrokes
would break that grouping and cost more than it saved.

**Distance Matrix with a departure time.** Traffic-aware results are a
point-in-time answer; serving a cached one is serving a wrong one.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from core.ports.maps_port import (
    Coordinates,
    GeocodeResult,
    MapsError,
    MapsPort,
    Place,
    Route,
    TravelMode,
)

# Well inside Google's 30-day ceiling, and chosen from how fast the underlying
# fact changes rather than from how much we would like to cache it.
PLACE_DETAIL_TTL_SECONDS = 24 * 60 * 60  # a venue's address is stable
GEOCODE_TTL_SECONDS = 7 * 24 * 60 * 60  # an address's coordinates more so
TEXT_SEARCH_TTL_SECONDS = 60 * 60  # business listings churn
DIRECTIONS_TTL_SECONDS = 15 * 60  # roads change slowly, traffic does not
PHOTO_TTL_SECONDS = 24 * 60 * 60


def _key(kind: str, *parts: Any) -> str:
    """A stable cache key. Hashed because a free-text address can be longer
    than a memcached key and contains characters Redis would rather not see."""
    raw = json.dumps(parts, sort_keys=True, default=str)
    return f"maps:{kind}:{hashlib.sha256(raw.encode()).hexdigest()[:32]}"


class MapsReadService:
    """Cache-aside wrapper. The port stays cache-unaware."""

    def __init__(self, *, maps: MapsPort, cache) -> None:
        self._maps = maps
        self._cache = cache

    @property
    def is_configured(self) -> bool:
        return self._maps.is_configured()

    # --- places ----------------------------------------------------------

    def autocomplete(self, query: str, **kwargs) -> list:
        # Uncached on purpose — see the module docstring.
        return self._maps.autocomplete(query, **kwargs)

    def place_details(self, place_id: str, *, session_token: str = "") -> Place:
        key = _key("place", place_id)
        cached = self._cache.get(key)
        if cached:
            return _place_from_cache(cached)

        place = self._maps.place_details(place_id, session_token=session_token)
        self._cache.set(key, _place_to_cache(place), timeout_seconds=PLACE_DETAIL_TTL_SECONDS)
        return place

    def search_text(self, query: str, *, near: Coordinates | None = None) -> list[Place]:
        key = _key("textsearch", query.strip().lower(), near.as_param if near else "")
        cached = self._cache.get(key)
        if cached is not None:
            return [_place_from_cache(row) for row in cached]

        places = self._maps.search_text(query, near=near)
        self._cache.set(
            key, [_place_to_cache(p) for p in places], timeout_seconds=TEXT_SEARCH_TTL_SECONDS
        )
        return places

    # --- geocoding -------------------------------------------------------

    def geocode(self, address: str, *, country: str = "") -> GeocodeResult:
        key = _key("geocode", address.strip().lower(), country)
        cached = self._cache.get(key)
        if cached:
            return _geocode_from_cache(cached)

        result = self._maps.geocode(address, country=country)
        self._cache.set(key, _geocode_to_cache(result), timeout_seconds=GEOCODE_TTL_SECONDS)
        return result

    def reverse_geocode(self, coordinates: Coordinates) -> GeocodeResult:
        # Rounded to ~11 metres before keying. Raw coordinates from a phone's
        # GPS never repeat, so an unrounded key would make this cache a
        # write-only store that never once returns a hit.
        key = _key("revgeocode", round(coordinates.latitude, 4), round(coordinates.longitude, 4))
        cached = self._cache.get(key)
        if cached:
            return _geocode_from_cache(cached)

        result = self._maps.reverse_geocode(coordinates)
        self._cache.set(key, _geocode_to_cache(result), timeout_seconds=GEOCODE_TTL_SECONDS)
        return result

    # --- routing ---------------------------------------------------------

    def directions(
        self,
        *,
        origin: str | Coordinates,
        destination: str | Coordinates,
        mode: TravelMode = "driving",
        departure_time: int | None = None,
        alternatives: bool = False,
    ) -> list[Route]:
        if departure_time:
            # Time-specific answer; a cached one would be a wrong one.
            return self._maps.directions(
                origin=origin,
                destination=destination,
                mode=mode,
                departure_time=departure_time,
                alternatives=alternatives,
            )

        key = _key(
            "directions",
            str(origin),
            str(destination),
            mode,
            alternatives,
        )
        cached = self._cache.get(key)
        if cached is not None:
            return [_route_from_cache(row) for row in cached]

        routes = self._maps.directions(
            origin=origin, destination=destination, mode=mode, alternatives=alternatives
        )
        self._cache.set(
            key, [_route_to_cache(r) for r in routes], timeout_seconds=DIRECTIONS_TTL_SECONDS
        )
        return routes

    def distance_matrix(self, **kwargs) -> list:
        # Uncached: the key space is combinatorial and the useful cases are
        # traffic-aware, which must not be served stale.
        return self._maps.distance_matrix(**kwargs)

    # --- photos ----------------------------------------------------------

    def fetch_photo(self, reference: str, *, max_width: int = 800) -> tuple[bytes, str]:
        """Cached as base64 in Redis.

        Bytes, not a URL, because Google's photo endpoint takes the API key as
        a query parameter — handing that URL to a browser publishes the key.
        Only images under ~256KB are cached; a larger one would evict a great
        deal of cheaper, hotter data to store one picture, and the browser's
        own cache (see the view's Cache-Control) already absorbs the repeat.
        """
        import base64

        key = _key("photo", reference, max_width)
        cached = self._cache.get(key)
        if cached:
            return base64.b64decode(cached["b"]), cached["t"]

        content, content_type = self._maps.fetch_photo(reference, max_width=max_width)
        if len(content) <= 256 * 1024:
            self._cache.set(
                key,
                {"b": base64.b64encode(content).decode(), "t": content_type},
                timeout_seconds=PHOTO_TTL_SECONDS,
            )
        return content, content_type


# --- (de)serialisation for the cache -------------------------------------
# Plain dicts rather than pickling the dataclasses: a pickled class is a
# deploy-time landmine, because renaming a field makes every cached entry
# raise on read instead of simply missing.


def _place_to_cache(place: Place) -> dict:
    return {
        "place_id": place.place_id,
        "name": place.name,
        "formatted_address": place.formatted_address,
        "lat": place.coordinates.latitude,
        "lng": place.coordinates.longitude,
        "types": place.types,
        "phone_number": place.phone_number,
        "website": place.website,
        "photos": [
            {
                "reference": p.reference,
                "width": p.width,
                "height": p.height,
                "attributions": p.attributions,
            }
            for p in place.photos
        ],
        "city": place.city,
        "country": place.country,
        "postal_code": place.postal_code,
        "business_status": place.business_status,
        "utc_offset_minutes": place.utc_offset_minutes,
    }


def _place_from_cache(row: dict) -> Place:
    from core.ports.maps_port import PlacePhoto

    return Place(
        place_id=row["place_id"],
        name=row["name"],
        formatted_address=row["formatted_address"],
        coordinates=Coordinates(latitude=row["lat"], longitude=row["lng"]),
        types=row.get("types", []),
        phone_number=row.get("phone_number", ""),
        website=row.get("website", ""),
        photos=[PlacePhoto(**p) for p in row.get("photos", [])],
        city=row.get("city", ""),
        country=row.get("country", ""),
        postal_code=row.get("postal_code", ""),
        business_status=row.get("business_status", ""),
        utc_offset_minutes=row.get("utc_offset_minutes"),
    )


def _geocode_to_cache(result: GeocodeResult) -> dict:
    return {
        "formatted_address": result.formatted_address,
        "lat": result.coordinates.latitude,
        "lng": result.coordinates.longitude,
        "place_id": result.place_id,
        "city": result.city,
        "country": result.country,
        "postal_code": result.postal_code,
        "location_type": result.location_type,
    }


def _geocode_from_cache(row: dict) -> GeocodeResult:
    return GeocodeResult(
        formatted_address=row["formatted_address"],
        coordinates=Coordinates(latitude=row["lat"], longitude=row["lng"]),
        place_id=row.get("place_id", ""),
        city=row.get("city", ""),
        country=row.get("country", ""),
        postal_code=row.get("postal_code", ""),
        location_type=row.get("location_type", ""),
    )


def _route_to_cache(route: Route) -> dict:
    return {
        "summary": route.summary,
        "distance_metres": route.distance_metres,
        "duration_seconds": route.duration_seconds,
        "polyline": route.polyline,
        "start_address": route.start_address,
        "end_address": route.end_address,
        "steps": [
            {
                "instruction": s.instruction,
                "distance_metres": s.distance_metres,
                "duration_seconds": s.duration_seconds,
                "travel_mode": s.travel_mode,
            }
            for s in route.steps
        ],
        "fare_minor": route.fare_minor,
        "fare_currency": route.fare_currency,
        "warnings": route.warnings,
    }


def _route_from_cache(row: dict) -> Route:
    from core.ports.maps_port import RouteStep

    return Route(
        summary=row["summary"],
        distance_metres=row["distance_metres"],
        duration_seconds=row["duration_seconds"],
        polyline=row["polyline"],
        start_address=row["start_address"],
        end_address=row["end_address"],
        steps=[RouteStep(**s) for s in row.get("steps", [])],
        fare_minor=row.get("fare_minor"),
        fare_currency=row.get("fare_currency", ""),
        warnings=row.get("warnings", []),
    )


__all__ = ["MapsReadService", "MapsError"]
