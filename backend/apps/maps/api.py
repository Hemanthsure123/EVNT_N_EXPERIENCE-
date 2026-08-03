"""Thin views over Google Maps Platform.

── WHY THE BROWSER DOES NOT CALL GOOGLE DIRECTLY FOR THESE ──────────────

The Maps **JavaScript** API is loaded in the browser with
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, restricted by HTTP referrer, because a
map has to render client-side. Everything else — Places, Geocoding,
Directions, Distance Matrix, Photos — goes through here on the SERVER key,
for three reasons:

1. **A referrer-restricted key is not a secure key.** The restriction is a
   header any script can set; it deters casual copying and nothing else.
   Keeping the web-service key server-side means a leak requires a server
   compromise rather than View Source.
2. **Caching.** A per-browser call cannot share a result with the next
   visitor. These endpoints do, which is where nearly all of the cost saving
   comes from (`selectors.py`).
3. **Cost control.** Rate limits live here. A runaway client loop hits our
   throttle rather than the billing account.

── EVERY VIEW MAPS `MapsError.reason` ONTO A STATUS ─────────────────────

`_handle` is the single place that does it, so "this address does not
exist" (404) can never be reported as "Google is down" (503) — a distinction
the frontend needs, because one deserves a retry and the other deserves a
correction.
"""

from __future__ import annotations

import re
from typing import Any

from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.di import build_maps_read_service
from core.errors import DomainError
from core.ports.maps_port import Coordinates, MapsError
from core.throttling import MapsThrottle

# `MapsError.reason` -> (HTTP status, stable error code for the client).
_STATUS_BY_REASON: dict[str, tuple[int, str]] = {
    "not_found": (404, "maps_not_found"),
    "invalid_input": (422, "maps_invalid_input"),
    "quota": (429, "maps_quota_exceeded"),
    "unavailable": (503, "maps_unavailable"),
    "not_configured": (503, "maps_not_configured"),
}


class _MapsDomainError(DomainError):
    """Carries a Maps failure through the platform's normal error envelope,
    so a Maps 404 looks exactly like every other 404 to the client."""

    def __init__(self, error: MapsError) -> None:
        status_code, code = _STATUS_BY_REASON.get(error.reason, (503, "maps_unavailable"))
        self.code = code
        self.status_code = status_code
        super().__init__(str(error))


def _service():
    return build_maps_read_service()


def _guard(callable_, *args, **kwargs) -> Any:
    try:
        return callable_(*args, **kwargs)
    except MapsError as error:
        raise _MapsDomainError(error) from error


def _coordinates(request: Request, lat_param: str = "lat", lng_param: str = "lng"):
    raw_lat = request.query_params.get(lat_param)
    raw_lng = request.query_params.get(lng_param)
    if raw_lat is None or raw_lng is None:
        return None
    try:
        # `Coordinates` range-checks in __post_init__, so a swapped pair or a
        # value from a malfunctioning GPS is rejected here rather than sent to
        # Google and billed for.
        return Coordinates(latitude=float(raw_lat), longitude=float(raw_lng))
    except (TypeError, ValueError) as exc:
        raise _MapsDomainError(MapsError("invalid_input", "lat and lng must be numbers")) from exc
    except MapsError as error:
        raise _MapsDomainError(error) from error


_TAGS = re.compile(r"<[^>]+>")


def _plain(text: str) -> str:
    """Strip Google's HTML from a direction step.

    Google returns `Turn <b>left</b> onto <b>MG Road</b>`. Passing that to a
    client that renders it as HTML is a third-party string in the DOM; passing
    it raw to one that renders text shows the tags. Stripping here means every
    client gets something correct with no decision to make.
    """
    return _TAGS.sub("", text or "").replace("&nbsp;", " ").strip()


class MapsConfigView(APIView):
    """Whether Maps works here. Asked BEFORE anything is rendered.

    Without it the frontend has to assume a key exists, load Google's script,
    and show the grey "this page didn't load Google Maps correctly" box —
    which is worse than showing a plain address and a directions link.
    """

    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request: Request) -> Response:
        response = Response({"available": _service().is_configured})
        # Public and cacheable: identical for every visitor, and it changes
        # only on a redeploy.
        response["Cache-Control"] = "public, max-age=300"
        return response


class PlaceAutocompleteView(APIView):
    """Venue and address suggestions.

    Authenticated: this fires per keystroke and each one is billed. An
    anonymous version would be a free, unmetered proxy to somebody's Places
    quota. The only surface that needs it is the organizer's venue picker,
    which is behind a login anyway.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [MapsThrottle]

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, required=True),
            OpenApiParameter("session_token", str, description="Groups keystrokes for billing"),
            OpenApiParameter("country", str, description="ISO 3166-1 alpha-2, e.g. `in`"),
            OpenApiParameter("types", str, description="e.g. `establishment` or `geocode`"),
        ],
        responses={200: None},
    )
    def get(self, request: Request) -> Response:
        suggestions = _guard(
            _service().autocomplete,
            request.query_params.get("q", ""),
            session_token=request.query_params.get("session_token", ""),
            country=request.query_params.get("country", ""),
            origin=_coordinates(request),
            types=request.query_params.get("types", ""),
        )
        return Response(
            {
                "data": [
                    {
                        "place_id": s.place_id,
                        "description": s.description,
                        "main_text": s.main_text,
                        "secondary_text": s.secondary_text,
                        "types": s.types,
                    }
                    for s in suggestions
                ]
            }
        )


def _place_payload(place) -> dict:
    return {
        "place_id": place.place_id,
        "name": place.name,
        "formatted_address": place.formatted_address,
        "latitude": place.coordinates.latitude,
        "longitude": place.coordinates.longitude,
        "city": place.city,
        "country": place.country,
        "postal_code": place.postal_code,
        "types": place.types,
        "phone_number": place.phone_number,
        "website": place.website,
        "business_status": place.business_status,
        "photos": [
            {
                "reference": photo.reference,
                "width": photo.width,
                "height": photo.height,
                # Passed through because Google REQUIRES them displayed
                # wherever the photo is. Dropping them breaks the licence.
                "attributions": photo.attributions,
            }
            for photo in place.photos
        ],
    }


class PlaceDetailView(APIView):
    """One place, in full. Cached for a day (Google's terms allow 30)."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [MapsThrottle]

    @extend_schema(responses={200: None})
    def get(self, request: Request, place_id: str) -> Response:
        place = _guard(
            _service().place_details,
            place_id,
            session_token=request.query_params.get("session_token", ""),
        )
        return Response(_place_payload(place))


class PlaceSearchView(APIView):
    """Free-text venue/business lookup, for when nobody picked a suggestion."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [MapsThrottle]

    @extend_schema(parameters=[OpenApiParameter("q", str, required=True)], responses={200: None})
    def get(self, request: Request) -> Response:
        places = _guard(
            _service().search_text,
            request.query_params.get("q", ""),
            near=_coordinates(request),
        )
        return Response({"data": [_place_payload(p) for p in places]})


class GeocodeView(APIView):
    """Address -> coordinates, and coordinates -> address on the same route.

    One view because they are one operation in both Google's API and the
    caller's mind; which direction runs is decided by which parameters
    arrive, and supplying neither is a 422 rather than a guess.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [MapsThrottle]

    @extend_schema(
        parameters=[
            OpenApiParameter("address", str, description="Forward geocoding"),
            OpenApiParameter("lat", float, description="Reverse geocoding"),
            OpenApiParameter("lng", float, description="Reverse geocoding"),
            OpenApiParameter("country", str),
        ],
        responses={200: None},
    )
    def get(self, request: Request) -> Response:
        address = request.query_params.get("address", "").strip()
        coordinates = _coordinates(request)

        if coordinates is not None:
            result = _guard(_service().reverse_geocode, coordinates)
        elif address:
            result = _guard(
                _service().geocode, address, country=request.query_params.get("country", "")
            )
        else:
            raise _MapsDomainError(
                MapsError("invalid_input", "Provide either `address`, or `lat` and `lng`.")
            )

        return Response(
            {
                "formatted_address": result.formatted_address,
                "latitude": result.coordinates.latitude,
                "longitude": result.coordinates.longitude,
                "place_id": result.place_id,
                "city": result.city,
                "country": result.country,
                "postal_code": result.postal_code,
                # Google's precision hint. A caller pinning a venue should
                # refuse APPROXIMATE — it can be the centre of a whole city.
                "location_type": result.location_type,
            }
        )


_MODES = ("driving", "walking", "transit", "bicycling")


class DirectionsView(APIView):
    """Routes between two points, in any of Google's four travel modes.

    Public: "how do I get to this event" is a question an anonymous visitor
    asks on the event page before deciding to buy. Rate-limited and cached
    to keep that affordable.
    """

    permission_classes = [AllowAny]
    throttle_classes = [MapsThrottle]

    @extend_schema(
        parameters=[
            OpenApiParameter("origin", str, required=True, description="Address or `lat,lng`"),
            OpenApiParameter("destination", str, required=True),
            OpenApiParameter("mode", str, description="driving | walking | transit | bicycling"),
            OpenApiParameter(
                "departure_time", int, description="Unix seconds; required for transit"
            ),
            OpenApiParameter("alternatives", bool),
        ],
        responses={200: None},
    )
    def get(self, request: Request) -> Response:
        mode = request.query_params.get("mode", "driving")
        if mode not in _MODES:
            raise _MapsDomainError(
                MapsError("invalid_input", f"mode must be one of {', '.join(_MODES)}")
            )

        departure_raw = request.query_params.get("departure_time")
        try:
            departure_time = int(departure_raw) if departure_raw else None
        except ValueError as exc:
            raise _MapsDomainError(
                MapsError("invalid_input", "departure_time must be unix seconds")
            ) from exc

        routes = _guard(
            _service().directions,
            origin=request.query_params.get("origin", ""),
            destination=request.query_params.get("destination", ""),
            mode=mode,
            departure_time=departure_time,
            alternatives=request.query_params.get("alternatives") == "true",
        )

        response = Response(
            {
                "data": [
                    {
                        "summary": route.summary,
                        "distance_metres": route.distance_metres,
                        "duration_seconds": route.duration_seconds,
                        "polyline": route.polyline,
                        "start_address": route.start_address,
                        "end_address": route.end_address,
                        "fare_minor": route.fare_minor,
                        "fare_currency": route.fare_currency,
                        "warnings": route.warnings,
                        "steps": [
                            {
                                "instruction": _plain(step.instruction),
                                "distance_metres": step.distance_metres,
                                "duration_seconds": step.duration_seconds,
                                "travel_mode": step.travel_mode,
                            }
                            for step in route.steps
                        ],
                    }
                    for route in routes
                ]
            }
        )
        # Only the timeless variant may be shared. A traffic-aware route is a
        # point-in-time answer and must not sit in a CDN.
        response["Cache-Control"] = "private, no-store" if departure_time else "public, max-age=300"
        return response


class DistanceMatrixView(APIView):
    """Travel time and distance for many destinations at once.

    POST, not GET: the input is two lists, and a GET would put a hundred
    addresses in a query string that proxies truncate. Authenticated because
    Google bills per origin x destination ELEMENT — one careless call is a
    hundred billed units.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [MapsThrottle]

    @extend_schema(request=None, responses={200: None})
    def post(self, request: Request) -> Response:
        origins = request.data.get("origins") or []
        destinations = request.data.get("destinations") or []
        if not isinstance(origins, list) or not isinstance(destinations, list):
            raise _MapsDomainError(
                MapsError("invalid_input", "origins and destinations must be lists")
            )

        mode = request.data.get("mode", "driving")
        if mode not in _MODES:
            raise _MapsDomainError(
                MapsError("invalid_input", f"mode must be one of {', '.join(_MODES)}")
            )

        matrix = _guard(
            _service().distance_matrix,
            origins=origins,
            destinations=destinations,
            mode=mode,
            departure_time=request.data.get("departure_time"),
        )
        response = Response(
            {
                "data": [
                    [
                        {
                            "destination": cell.destination,
                            # `null`, not 0, when the cell failed. A zero would
                            # render as "0 min away", which is worse than blank.
                            "distance_metres": cell.distance_metres,
                            "duration_seconds": cell.duration_seconds,
                            "status": cell.status,
                        }
                        for cell in row
                    ]
                    for row in matrix
                ]
            }
        )
        response["Cache-Control"] = "private, no-store"
        return response


class PlacePhotoView(APIView):
    """Proxy a Places photo.

    A proxy is not optional here: Google's photo endpoint takes the API key
    as a query parameter, so handing the browser that URL publishes an
    unrestricted server key to every visitor. The bytes come through us and
    the key never leaves the server.

    Public, because it renders inside a public event page.
    """

    permission_classes = [AllowAny]
    throttle_classes = [MapsThrottle]

    @extend_schema(
        parameters=[
            OpenApiParameter("reference", str, required=True),
            OpenApiParameter("max_width", int),
        ],
        responses={200: None},
    )
    def get(self, request: Request) -> HttpResponse:
        reference = request.query_params.get("reference", "")
        try:
            max_width = int(request.query_params.get("max_width", 800))
        except ValueError:
            max_width = 800

        content, content_type = _guard(_service().fetch_photo, reference, max_width=max_width)

        response = HttpResponse(content, content_type=content_type)
        # A photo reference is immutable, so the bytes for one never change.
        # A long browser/CDN cache here is what stops the same venue photo
        # being re-fetched and re-billed on every page view.
        response["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=86400"
        return response
