"""Port for Google Maps Platform.

One port, one vendor key, six APIs (Places, Geocoding, Directions, Distance
Matrix, Places Photos, and the JavaScript API the browser loads directly).
They are one port rather than six because they share a key, a quota, a
billing account and a failure mode — splitting them would mean six places to
handle the same 429.

── EVERY RESULT IS A DATACLASS, NOT GOOGLE'S JSON ────────────────────────

Callers never see a raw Google response. That is not tidiness: Google's
Places response shape changed materially between the legacy and "new"
Places APIs, and a view that reads `result["geometry"]["location"]["lat"]`
turns a vendor migration into a frontend rewrite. The adapter owns the
translation; everything above it depends on these dataclasses.

── FAILURES ARE TYPED, BECAUSE THEY MEAN DIFFERENT THINGS ────────────────

`MapsError` carries a `reason`, and the four that matter are distinguished
because each deserves a different HTTP status and a different retry policy:

- `not_found`     the address or place does not exist -> 404, never retry.
- `invalid_input` we sent something malformed -> 422, never retry.
- `quota`         billing or rate limit -> 429, retry later, alert someone.
- `unavailable`   network, timeout, 5xx -> 503, safe to retry.

A single generic exception would collapse "this venue does not exist" into
"Google is down", and the caller would retry the first one forever.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal

TravelMode = Literal["driving", "walking", "transit", "bicycling"]

MapsErrorReason = Literal["not_found", "invalid_input", "quota", "unavailable", "not_configured"]


class MapsError(RuntimeError):
    """A Maps call that could not be completed. `reason` decides the status."""

    def __init__(self, reason: MapsErrorReason, message: str = "") -> None:
        self.reason = reason
        super().__init__(message or reason)


@dataclass(frozen=True)
class Coordinates:
    latitude: float
    longitude: float

    def __post_init__(self) -> None:
        # Validated at construction, not at use — a bad pair fails where it
        # was built rather than three layers later as a marker in the sea.
        #
        # Range checking catches a swapped lat/lng pair ONLY when the
        # longitude exceeds 90, which is most of the world but NOT India:
        # Delhi swapped is (77.209, 28.614), and 77.209 is a perfectly legal
        # latitude in Kazakhstan. Nothing here can detect that, and pretending
        # otherwise would be worse than saying so — which is why the real
        # defence is that coordinates come from a Places lookup rather than
        # from hand-entered numbers.
        if not (-90.0 <= self.latitude <= 90.0):
            raise MapsError("invalid_input", f"latitude {self.latitude} is out of range")
        if not (-180.0 <= self.longitude <= 180.0):
            raise MapsError("invalid_input", f"longitude {self.longitude} is out of range")

    @property
    def as_param(self) -> str:
        return f"{self.latitude},{self.longitude}"


@dataclass(frozen=True)
class PlaceSuggestion:
    """One autocomplete row. `place_id` is the only durable identifier —
    Google's own terms allow caching it indefinitely, unlike the rest."""

    place_id: str
    description: str
    main_text: str
    secondary_text: str
    types: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class PlacePhoto:
    reference: str
    width: int
    height: int
    attributions: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Place:
    place_id: str
    name: str
    formatted_address: str
    coordinates: Coordinates
    types: list[str] = field(default_factory=list)
    phone_number: str = ""
    website: str = ""
    #: Google requires these to be displayed wherever the photo is shown.
    photos: list[PlacePhoto] = field(default_factory=list)
    #: The city, pulled out of address_components so callers do not parse text.
    city: str = ""
    country: str = ""
    postal_code: str = ""
    business_status: str = ""
    utc_offset_minutes: int | None = None


@dataclass(frozen=True)
class GeocodeResult:
    formatted_address: str
    coordinates: Coordinates
    place_id: str = ""
    city: str = ""
    country: str = ""
    postal_code: str = ""
    #: Google's precision hint: ROOFTOP > RANGE_INTERPOLATED > GEOMETRIC_CENTER
    #: > APPROXIMATE. A caller storing a venue pin should refuse APPROXIMATE.
    location_type: str = ""


@dataclass(frozen=True)
class RouteStep:
    instruction: str
    distance_metres: int
    duration_seconds: int
    travel_mode: str


@dataclass(frozen=True)
class Route:
    summary: str
    distance_metres: int
    duration_seconds: int
    #: Encoded polyline for drawing the route. Google's format, passed through
    #: because every map library decodes it and re-encoding would lose nothing
    #: but cost precision.
    polyline: str
    start_address: str
    end_address: str
    steps: list[RouteStep] = field(default_factory=list)
    #: Transit only, and honest about it: `None` means Google gave no fare,
    #: which is different from a fare of zero.
    fare_minor: int | None = None
    fare_currency: str = ""
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class DistanceMatrixCell:
    destination: str
    distance_metres: int | None
    duration_seconds: int | None
    #: Google reports per-cell status. A cell can fail while the request
    #: succeeds — ZERO_RESULTS for an unreachable island, for instance — so a
    #: caller must be able to tell "no route" from "12 minutes".
    status: str = "OK"


class MapsPort(ABC):
    @abstractmethod
    def is_configured(self) -> bool:
        """Whether a key is present. Callers ask BEFORE offering the feature,
        so an unconfigured deployment hides the map instead of rendering a
        grey box with Google's 'this page did not load correctly' watermark."""

    # --- Places ----------------------------------------------------------

    @abstractmethod
    def autocomplete(
        self,
        query: str,
        *,
        session_token: str = "",
        country: str = "",
        origin: Coordinates | None = None,
        types: str = "",
    ) -> list[PlaceSuggestion]:
        """Address and venue suggestions.

        `session_token` matters commercially, not technically: Google bills
        autocomplete per-session when a token groups the keystrokes with the
        final Place Details call, and per-request when it does not. Passing it
        is the difference between one billed session and one bill per keypress.
        """

    @abstractmethod
    def place_details(self, place_id: str, *, session_token: str = "") -> Place:
        """Full detail for one place. Raises `not_found` for a stale id —
        place ids can be retired when Google merges or removes a listing."""

    @abstractmethod
    def search_text(self, query: str, *, near: Coordinates | None = None) -> list[Place]:
        """Free-text venue/business search, for when the user did not pick a
        suggestion. Distinct from `autocomplete`: this returns full places."""

    # --- Geocoding -------------------------------------------------------

    @abstractmethod
    def geocode(self, address: str, *, country: str = "") -> GeocodeResult:
        """Address -> coordinates. Raises `not_found` when nothing matches."""

    @abstractmethod
    def reverse_geocode(self, coordinates: Coordinates) -> GeocodeResult:
        """Coordinates -> address."""

    # --- Routing ---------------------------------------------------------

    @abstractmethod
    def directions(
        self,
        *,
        origin: str | Coordinates,
        destination: str | Coordinates,
        mode: TravelMode = "driving",
        departure_time: int | None = None,
        alternatives: bool = False,
    ) -> list[Route]:
        """Routes between two points. Empty list means no route exists (an
        island, or transit that does not run) — that is a result, not an error."""

    @abstractmethod
    def distance_matrix(
        self,
        *,
        origins: list[str | Coordinates],
        destinations: list[str | Coordinates],
        mode: TravelMode = "driving",
        departure_time: int | None = None,
    ) -> list[list[DistanceMatrixCell]]:
        """Travel time and distance for every origin/destination pair.

        Returned as rows-by-origin so the shape matches Google's and a caller
        indexing `[origin][destination]` gets what it expects.
        """

    # --- Photos ----------------------------------------------------------

    @abstractmethod
    def fetch_photo(self, reference: str, *, max_width: int = 800) -> tuple[bytes, str]:
        """Return `(image_bytes, content_type)`.

        Bytes rather than a URL, because Google's photo endpoint takes the API
        key as a query parameter. Handing the browser that URL publishes an
        unrestricted server key to every visitor; proxying keeps it server-side.
        """
