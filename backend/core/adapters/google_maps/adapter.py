"""Real MapsPort adapter — Google Maps Platform web services.

One `GOOGLE_MAPS_API_KEY` powers every service here. That is Google's own
model: a key is enabled per-API in the Cloud console, and one key with six
APIs enabled is one billing line and one quota to watch. Splitting it into
six keys would multiply the rotation work by six and buy nothing, because
the blast radius of a leak is identical — the key is the credential either
way, and restriction is done by IP/referrer, not by having more of them.

── TRANSPORT ────────────────────────────────────────────────────────────

`requests.Session` with an `HTTPAdapter` retry policy, built once:

- **Connection pooling.** Autocomplete fires per keystroke. A new TLS
  handshake per keypress would add ~100ms to every one of them.
- **Retries on 429/500/502/503/504 only**, with backoff. Never on a 4xx that
  is our fault — retrying a malformed request just spends quota to get the
  same answer.
- **`allowed_methods={"GET"}`.** Every Maps web service is a GET, and
  restricting it means a future POST cannot be silently replayed.
- **Separate connect and read timeouts.** A hung read is the dangerous one:
  without a read timeout a stalled Google response holds a worker until the
  gunicorn timeout kills it, which during a ticket rush is how a slow
  dependency becomes an outage.

── STATUS HANDLING ──────────────────────────────────────────────────────

Google returns HTTP 200 with a `status` field for most failures. A caller
checking only the HTTP code sees success and then reads an empty `results`
list, so `_check_status` is where the real error handling lives — and it
maps each Google status onto the port's four reasons, because `OVER_QUERY_LIMIT`
(retry later, alert) and `ZERO_RESULTS` (the address does not exist) are
opposite outcomes that Google reports through the same channel.
"""

from __future__ import annotations

import logging
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from core.ports.maps_port import (
    Coordinates,
    DistanceMatrixCell,
    GeocodeResult,
    MapsError,
    MapsPort,
    Place,
    PlacePhoto,
    PlaceSuggestion,
    Route,
    RouteStep,
    TravelMode,
)

logger = logging.getLogger(__name__)

_BASE = "https://maps.googleapis.com/maps/api"

# Google's `status` values, mapped to what the caller should DO about them.
_STATUS_REASONS: dict[str, str] = {
    "OK": "",
    "ZERO_RESULTS": "not_found",
    "NOT_FOUND": "not_found",
    "INVALID_REQUEST": "invalid_input",
    "MAX_WAYPOINTS_EXCEEDED": "invalid_input",
    "MAX_ROUTE_LENGTH_EXCEEDED": "invalid_input",
    "OVER_QUERY_LIMIT": "quota",
    "OVER_DAILY_LIMIT": "quota",
    "REQUEST_DENIED": "quota",  # bad key, unenabled API, or billing disabled
    "UNKNOWN_ERROR": "unavailable",
}

# Distance Matrix reports per-cell status; these are cell-level, not fatal.
_CELL_OK = "OK"


class GoogleMapsAdapter(MapsPort):
    def __init__(
        self,
        *,
        api_key: str,
        connect_timeout: float = 3.0,
        read_timeout: float = 8.0,
        max_retries: int = 2,
        region: str = "",
        language: str = "en",
    ) -> None:
        if not api_key:
            raise ValueError("GOOGLE_MAPS_API_KEY is required; use DisabledMapsAdapter.")
        self._api_key = api_key
        self._timeout = (connect_timeout, read_timeout)
        self._region = region
        self._language = language

        self._session = requests.Session()
        retry = Retry(
            total=max_retries,
            backoff_factor=0.4,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=16)
        self._session.mount("https://", adapter)

    def is_configured(self) -> bool:
        return True

    # ------------------------------------------------------------ transport

    def _get(self, path: str, params: dict[str, Any]) -> dict:
        # `dict[str, Any]`: requests accepts str/int/bool/None per key, and a
        # narrower annotation would be a lie about the call it makes.
        params = {k: v for k, v in params.items() if v not in (None, "", [])}
        params["key"] = self._api_key
        params.setdefault("language", self._language)
        if self._region:
            params.setdefault("region", self._region)

        try:
            response = self._session.get(f"{_BASE}/{path}", params=params, timeout=self._timeout)
        except requests.Timeout as exc:
            # Deliberately its own branch: a timeout is retryable and a DNS
            # failure is retryable, but a timeout also means we may have spent
            # quota on a request whose answer we threw away.
            raise MapsError("unavailable", "Google Maps timed out") from exc
        except requests.RequestException as exc:
            raise MapsError("unavailable", "Could not reach Google Maps") from exc

        if response.status_code == 429:
            raise MapsError("quota", "Google Maps rate limit exceeded")
        if response.status_code >= 500:
            raise MapsError("unavailable", f"Google Maps returned {response.status_code}")
        if response.status_code >= 400:
            raise MapsError(
                "invalid_input", f"Google Maps rejected the request " f"({response.status_code})"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise MapsError("unavailable", "Google Maps returned a non-JSON body") from exc
        if not isinstance(payload, dict):
            raise MapsError("unavailable", "Google Maps returned an unexpected body")
        return payload

    @staticmethod
    def _check_status(payload: dict, *, api: str) -> None:
        """Google returns HTTP 200 with a `status` field for most failures.

        A caller that checks only the HTTP code sees success and an empty
        result list, which is how a billing-disabled key looks exactly like a
        venue that does not exist.
        """
        status = str(payload.get("status", "UNKNOWN_ERROR"))
        reason = _STATUS_REASONS.get(status, "unavailable")
        if not reason:
            return

        message = str(payload.get("error_message", "")) or status
        if reason == "quota":
            # Worth a log line at error: REQUEST_DENIED usually means the API
            # is not enabled on the key or billing lapsed, and both are silent
            # from the user's side — the map simply never appears.
            # NOT `extra={"message": ...}` — `message` is a reserved
            # LogRecord attribute and logging RAISES on a collision. This
            # branch fires when billing lapses or the API is not enabled, so
            # the crash would land exactly where the diagnostic was needed.
            logger.error(
                "google_maps.request_denied_or_quota",
                extra={"api": api, "status": status, "detail": message},
            )
        elif reason == "unavailable":
            logger.warning("google_maps.unavailable", extra={"api": api, "status": status})

        raise MapsError(reason, f"{api}: {message}")  # type: ignore[arg-type]

    @staticmethod
    def _coordinates(node: dict) -> Coordinates:
        """Pull lat/lng out of a Google node, validating as we go.

        `Coordinates.__post_init__` range-checks, so a malformed or partial
        response becomes an `invalid_input` MapsError here rather than a
        marker in the Arabian Sea three layers up.
        """
        location = (node or {}).get("location") or {}
        try:
            return Coordinates(latitude=float(location["lat"]), longitude=float(location["lng"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise MapsError(
                "unavailable", "Google Maps returned a place without coordinates"
            ) from exc

    @staticmethod
    def _address_parts(components: list[dict]) -> dict[str, str]:
        """Flatten `address_components` so callers never parse address text.

        City is deliberately a fallback chain: Google uses `locality` for most
        places but `postal_town` in the UK and, for some Indian addresses,
        only `administrative_area_level_2`. Reading `locality` alone silently
        yields an empty city for entire countries.
        """
        by_type: dict[str, str] = {}
        for component in components or []:
            name = component.get("long_name", "")
            for kind in component.get("types", []):
                by_type.setdefault(kind, name)

        city = (
            by_type.get("locality")
            or by_type.get("postal_town")
            or by_type.get("administrative_area_level_2")
            or by_type.get("administrative_area_level_1")
            or ""
        )
        return {
            "city": city,
            "country": by_type.get("country", ""),
            "postal_code": by_type.get("postal_code", ""),
        }

    # -------------------------------------------------------------- places

    def autocomplete(
        self,
        query: str,
        *,
        session_token: str = "",
        country: str = "",
        origin: Coordinates | None = None,
        types: str = "",
    ) -> list[PlaceSuggestion]:
        query = (query or "").strip()
        if len(query) < 2:
            # Refused rather than sent. Google bills a one-character query the
            # same as a useful one and returns noise for it.
            return []

        payload = self._get(
            "place/autocomplete/json",
            {
                "input": query,
                "sessiontoken": session_token,
                "components": f"country:{country}" if country else "",
                "origin": origin.as_param if origin else "",
                "types": types,
            },
        )
        try:
            self._check_status(payload, api="places/autocomplete")
        except MapsError as error:
            if error.reason == "not_found":
                return []  # ZERO_RESULTS on a search is an empty list, not a 404
            raise

        suggestions = []
        for row in payload.get("predictions", []):
            formatting = row.get("structured_formatting") or {}
            suggestions.append(
                PlaceSuggestion(
                    place_id=row.get("place_id", ""),
                    description=row.get("description", ""),
                    main_text=formatting.get("main_text", ""),
                    secondary_text=formatting.get("secondary_text", ""),
                    types=list(row.get("types") or []),
                )
            )
        return [s for s in suggestions if s.place_id]

    def place_details(self, place_id: str, *, session_token: str = "") -> Place:
        if not place_id:
            raise MapsError("invalid_input", "place_id is required")

        payload = self._get(
            "place/details/json",
            {
                "place_id": place_id,
                "sessiontoken": session_token,
                # An explicit field mask. Places Details is billed by field
                # TIER — asking for everything costs several times the basic
                # request, so this list is exactly what the venue picker and
                # the event page render, and nothing more.
                "fields": ",".join(
                    (
                        "place_id",
                        "name",
                        "formatted_address",
                        "geometry/location",
                        "address_component",
                        "type",
                        "formatted_phone_number",
                        "website",
                        "photo",
                        "business_status",
                        "utc_offset",
                    )
                ),
            },
        )
        self._check_status(payload, api="places/details")

        result = payload.get("result") or {}
        parts = self._address_parts(result.get("address_components", []))
        return Place(
            place_id=result.get("place_id", place_id),
            name=result.get("name", ""),
            formatted_address=result.get("formatted_address", ""),
            coordinates=self._coordinates(result.get("geometry") or {}),
            types=list(result.get("types") or []),
            phone_number=result.get("formatted_phone_number", ""),
            website=result.get("website", ""),
            photos=self._photos(result.get("photos") or []),
            business_status=result.get("business_status", ""),
            utc_offset_minutes=result.get("utc_offset"),
            city=parts["city"],
            country=parts["country"],
            postal_code=parts["postal_code"],
        )

    def search_text(self, query: str, *, near: Coordinates | None = None) -> list[Place]:
        query = (query or "").strip()
        if not query:
            return []

        payload = self._get(
            "place/textsearch/json",
            {
                "query": query,
                "location": near.as_param if near else "",
                "radius": 50000 if near else "",
            },
        )
        try:
            self._check_status(payload, api="places/textsearch")
        except MapsError as error:
            if error.reason == "not_found":
                return []
            raise

        places: list[Place] = []
        for result in payload.get("results", []):
            try:
                coordinates = self._coordinates(result.get("geometry") or {})
            except MapsError:
                # One malformed row must not lose the whole result set.
                continue
            parts = self._address_parts(result.get("address_components", []))
            places.append(
                Place(
                    place_id=result.get("place_id", ""),
                    name=result.get("name", ""),
                    formatted_address=result.get("formatted_address", ""),
                    coordinates=coordinates,
                    types=list(result.get("types") or []),
                    photos=self._photos(result.get("photos") or []),
                    business_status=result.get("business_status", ""),
                    city=parts["city"],
                    country=parts["country"],
                    postal_code=parts["postal_code"],
                )
            )
        return places

    @staticmethod
    def _photos(nodes: list[dict]) -> list[PlacePhoto]:
        return [
            PlacePhoto(
                reference=node.get("photo_reference", ""),
                width=int(node.get("width", 0) or 0),
                height=int(node.get("height", 0) or 0),
                # Google REQUIRES these to be shown wherever the photo is.
                # Dropping them is a licence violation, so they travel with
                # the photo rather than being fetched separately.
                attributions=list(node.get("html_attributions") or []),
            )
            for node in nodes
            if node.get("photo_reference")
        ]

    # ----------------------------------------------------------- geocoding

    def geocode(self, address: str, *, country: str = "") -> GeocodeResult:
        address = (address or "").strip()
        if not address:
            raise MapsError("invalid_input", "address is required")

        payload = self._get(
            "geocode/json",
            {"address": address, "components": f"country:{country}" if country else ""},
        )
        self._check_status(payload, api="geocode")

        results = payload.get("results") or []
        if not results:
            raise MapsError("not_found", f"No location found for {address!r}")
        return self._geocode_result(results[0])

    def reverse_geocode(self, coordinates: Coordinates) -> GeocodeResult:
        payload = self._get("geocode/json", {"latlng": coordinates.as_param})
        self._check_status(payload, api="geocode/reverse")

        results = payload.get("results") or []
        if not results:
            raise MapsError("not_found", "No address found for those coordinates")
        return self._geocode_result(results[0])

    def _geocode_result(self, result: dict) -> GeocodeResult:
        geometry = result.get("geometry") or {}
        parts = self._address_parts(result.get("address_components", []))
        return GeocodeResult(
            formatted_address=result.get("formatted_address", ""),
            coordinates=self._coordinates(geometry),
            place_id=result.get("place_id", ""),
            location_type=geometry.get("location_type", ""),
            city=parts["city"],
            country=parts["country"],
            postal_code=parts["postal_code"],
        )

    # ------------------------------------------------------------- routing

    @staticmethod
    def _waypoint(value: str | Coordinates) -> str:
        return value.as_param if isinstance(value, Coordinates) else str(value).strip()

    def directions(
        self,
        *,
        origin: str | Coordinates,
        destination: str | Coordinates,
        mode: TravelMode = "driving",
        departure_time: int | None = None,
        alternatives: bool = False,
    ) -> list[Route]:
        start, end = self._waypoint(origin), self._waypoint(destination)
        if not start or not end:
            raise MapsError("invalid_input", "origin and destination are required")

        payload = self._get(
            "directions/json",
            {
                "origin": start,
                "destination": end,
                "mode": mode,
                # Transit needs a departure time to pick a timetable. Without
                # one Google assumes "now", which for an event three weeks out
                # returns a route nobody can take.
                "departure_time": departure_time,
                "alternatives": "true" if alternatives else "false",
            },
        )
        try:
            self._check_status(payload, api="directions")
        except MapsError as error:
            if error.reason == "not_found":
                return []  # no route is a legitimate answer, not a failure
            raise

        routes: list[Route] = []
        for route in payload.get("routes", []):
            legs = route.get("legs") or []
            if not legs:
                continue
            leg = legs[0]
            fare = route.get("fare") or {}
            routes.append(
                Route(
                    summary=route.get("summary", ""),
                    distance_metres=int((leg.get("distance") or {}).get("value", 0)),
                    duration_seconds=int((leg.get("duration") or {}).get("value", 0)),
                    polyline=(route.get("overview_polyline") or {}).get("points", ""),
                    start_address=leg.get("start_address", ""),
                    end_address=leg.get("end_address", ""),
                    steps=[
                        RouteStep(
                            # Google returns HTML here. It is passed through
                            # unchanged and the frontend renders it as TEXT —
                            # see the API layer, which strips tags. Sanitising
                            # in the adapter would silently lose the road
                            # names Google bolds.
                            instruction=step.get("html_instructions", ""),
                            distance_metres=int((step.get("distance") or {}).get("value", 0)),
                            duration_seconds=int((step.get("duration") or {}).get("value", 0)),
                            travel_mode=step.get("travel_mode", mode),
                        )
                        for step in (leg.get("steps") or [])
                    ],
                    fare_minor=int(round(float(fare["value"]) * 100))
                    if fare.get("value")
                    else None,
                    fare_currency=fare.get("currency", ""),
                    warnings=list(route.get("warnings") or []),
                )
            )
        return routes

    def distance_matrix(
        self,
        *,
        origins: list[str | Coordinates],
        destinations: list[str | Coordinates],
        mode: TravelMode = "driving",
        departure_time: int | None = None,
    ) -> list[list[DistanceMatrixCell]]:
        if not origins or not destinations:
            raise MapsError("invalid_input", "origins and destinations are required")
        # Google bills per ELEMENT (origins x destinations) and caps a single
        # request at 100. Refusing here turns a silent truncation into a clear
        # error, and stops one call quietly costing a hundred.
        if len(origins) * len(destinations) > 100:
            raise MapsError(
                "invalid_input",
                "a distance matrix request is limited to 100 origin/destination pairs",
            )

        payload = self._get(
            "distancematrix/json",
            {
                "origins": "|".join(self._waypoint(o) for o in origins),
                "destinations": "|".join(self._waypoint(d) for d in destinations),
                "mode": mode,
                "departure_time": departure_time,
            },
        )
        self._check_status(payload, api="distancematrix")

        address_labels = payload.get("destination_addresses") or []
        matrix: list[list[DistanceMatrixCell]] = []
        for row in payload.get("rows", []):
            cells: list[DistanceMatrixCell] = []
            for index, element in enumerate(row.get("elements", [])):
                status = element.get("status", "UNKNOWN_ERROR")
                ok = status == _CELL_OK
                cells.append(
                    DistanceMatrixCell(
                        destination=(address_labels[index] if index < len(address_labels) else ""),
                        # None rather than 0 when the cell failed: a zero would
                        # render as "0 min away", which is worse than "unknown".
                        distance_metres=(
                            int((element.get("distance") or {}).get("value", 0)) if ok else None
                        ),
                        duration_seconds=(
                            int((element.get("duration") or {}).get("value", 0)) if ok else None
                        ),
                        status=status,
                    )
                )
            matrix.append(cells)
        return matrix

    # -------------------------------------------------------------- photos

    def fetch_photo(self, reference: str, *, max_width: int = 800) -> tuple[bytes, str]:
        if not reference:
            raise MapsError("invalid_input", "photo reference is required")
        # Clamped: Google charges the same for any width but a caller asking
        # for 16000px moves megabytes through our proxy for a thumbnail.
        max_width = max(64, min(int(max_width), 1600))

        try:
            response = self._session.get(
                f"{_BASE}/place/photo",
                params={
                    "photo_reference": reference,
                    "maxwidth": max_width,
                    "key": self._api_key,
                },  # type: ignore[arg-type]
                timeout=self._timeout,
                # Google 302s to a googleusercontent URL. Following it is the
                # whole point — that redirect is where the bytes live.
                allow_redirects=True,
            )
        except requests.Timeout as exc:
            raise MapsError("unavailable", "Google Maps photo request timed out") from exc
        except requests.RequestException as exc:
            raise MapsError("unavailable", "Could not reach Google Maps") from exc

        if response.status_code == 429:
            raise MapsError("quota", "Google Maps rate limit exceeded")
        if response.status_code == 400:
            # A stale or malformed reference. Not retryable.
            raise MapsError("not_found", "That photo reference is no longer valid")
        if response.status_code >= 400:
            raise MapsError("unavailable", f"Google Maps returned {response.status_code}")

        content_type = response.headers.get("Content-Type", "")
        if not content_type.startswith("image/"):
            # Google answers an invalid reference with an HTML error page and a
            # 200. Serving that through the proxy would put a Google error page
            # where a venue photo should be.
            raise MapsError("not_found", "That photo reference did not resolve to an image")
        return response.content, content_type


class DisabledMapsAdapter(MapsPort):
    """What runs with no API key — which is the default.

    Not a fake: it returns nothing and says why. `is_configured()` is False,
    so the API layer answers 503 and the frontend renders a plain directions
    link instead of an empty map frame. A stub that returned made-up
    coordinates would put a marker on a building nobody is performing in.
    """

    def is_configured(self) -> bool:
        return False

    def _refuse(self) -> MapsError:
        return MapsError("not_configured", "Google Maps is not configured on this deployment.")

    def autocomplete(self, query, *, session_token="", country="", origin=None, types="") -> list:
        raise self._refuse()

    def place_details(self, place_id, *, session_token="") -> Place:
        raise self._refuse()

    def search_text(self, query, *, near=None) -> list:
        raise self._refuse()

    def geocode(self, address, *, country="") -> GeocodeResult:
        raise self._refuse()

    def reverse_geocode(self, coordinates) -> GeocodeResult:
        raise self._refuse()

    def directions(
        self,
        *,
        origin,
        destination,
        mode="driving",
        departure_time=None,
        alternatives=False,
    ) -> list:
        raise self._refuse()

    def distance_matrix(
        self, *, origins, destinations, mode="driving", departure_time=None
    ) -> list:
        raise self._refuse()

    def fetch_photo(self, reference, *, max_width=800) -> tuple[bytes, str]:
        raise self._refuse()
