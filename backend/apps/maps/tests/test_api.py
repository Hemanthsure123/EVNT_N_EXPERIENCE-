"""The Maps HTTP surface and its cache layer.

The audit named this as the one coverage gap in the Maps work: the ADAPTER
had 38 tests, but the view layer and the cache-aside selector — which decide
the HTTP status, whether the server key can leak, and how much Google is
billed — had none.

Google is never called. Every test substitutes a fake port through the DI
factory the views use.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.maps.selectors import MapsReadService
from core.adapters.local.locmem_cache import LocMemCacheAdapter
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
)


class FakeMaps(MapsPort):
    """A test double, not a shipped fake. Nothing in the app selects it."""

    def __init__(self, *, configured: bool = True, raises: MapsError | None = None) -> None:
        self.configured = configured
        self.raises = raises
        self.calls: list[str] = []

    def _maybe_raise(self, name: str) -> None:
        self.calls.append(name)
        if self.raises:
            raise self.raises

    def is_configured(self) -> bool:
        return self.configured

    def autocomplete(self, query, *, session_token="", country="", origin=None, types=""):
        self._maybe_raise("autocomplete")
        return [
            PlaceSuggestion(
                place_id="p1",
                description="Phoenix Marketcity, Bengaluru",
                main_text="Phoenix Marketcity",
                secondary_text="Bengaluru",
                types=["establishment"],
            )
        ]

    def place_details(self, place_id, *, session_token=""):
        self._maybe_raise("place_details")
        return Place(
            place_id=place_id,
            name="Phoenix Marketcity",
            formatted_address="Whitefield, Bengaluru",
            coordinates=Coordinates(latitude=12.9959, longitude=77.6974),
            city="Bengaluru",
            country="India",
            photos=[
                PlacePhoto(
                    reference="ref-1", width=4032, height=3024, attributions=["<a>Somebody</a>"]
                )
            ],
        )

    def search_text(self, query, *, near=None):
        self._maybe_raise("search_text")
        return [self.place_details("p1")]

    def geocode(self, address, *, country=""):
        self._maybe_raise("geocode")
        return GeocodeResult(
            formatted_address="MG Road, Bengaluru",
            coordinates=Coordinates(latitude=12.9757, longitude=77.6068),
            city="Bengaluru",
            location_type="ROOFTOP",
        )

    def reverse_geocode(self, coordinates):
        self._maybe_raise("reverse_geocode")
        return GeocodeResult(
            formatted_address="MG Road, Bengaluru", coordinates=coordinates, city="Bengaluru"
        )

    def directions(
        self, *, origin, destination, mode="driving", departure_time=None, alternatives=False
    ):
        self._maybe_raise("directions")
        return [
            Route(
                summary="NH 48",
                distance_metres=12000,
                duration_seconds=1800,
                polyline="abcd",
                start_address="A",
                end_address="B",
            )
        ]

    def distance_matrix(self, *, origins, destinations, mode="driving", departure_time=None):
        self._maybe_raise("distance_matrix")
        return [
            [
                DistanceMatrixCell(
                    destination="B",
                    distance_metres=None,
                    duration_seconds=None,
                    status="ZERO_RESULTS",
                )
            ]
        ]

    def fetch_photo(self, reference, *, max_width=800):
        self._maybe_raise("fetch_photo")
        return b"\x89PNG-bytes", "image/png"


@pytest.fixture
def maps():
    return FakeMaps()


@pytest.fixture(autouse=True)
def wire(monkeypatch, maps):
    """Substitute the port through the same factory the views call."""
    service = MapsReadService(maps=maps, cache=LocMemCacheAdapter())
    monkeypatch.setattr("apps.maps.api.build_maps_read_service", lambda: service)
    return service


@pytest.fixture
def client(db):
    from apps.accounts.models import User

    api = APIClient()
    api.force_authenticate(user=User.objects.create_user(email="o@example.com", password="pw"))
    return api


@pytest.mark.django_db
class TestErrorMapping:
    """`MapsError.reason` decides the HTTP status.

    Collapsing these would tell a caller that a nonexistent address is a
    Google outage — one deserves a correction, the other a retry.
    """

    @pytest.mark.parametrize(
        "reason,expected_status,expected_code",
        [
            ("not_found", 404, "maps_not_found"),
            ("invalid_input", 422, "maps_invalid_input"),
            ("quota", 429, "maps_quota_exceeded"),
            ("unavailable", 503, "maps_unavailable"),
            ("not_configured", 503, "maps_not_configured"),
        ],
    )
    def test_each_reason_maps_to_its_own_status(
        self, client, monkeypatch, reason, expected_status, expected_code
    ):
        service = MapsReadService(
            maps=FakeMaps(raises=MapsError(reason, "boom")), cache=LocMemCacheAdapter()
        )
        monkeypatch.setattr("apps.maps.api.build_maps_read_service", lambda: service)

        response = client.get("/api/v1/maps/geocode?address=MG+Road")
        assert response.status_code == expected_status
        assert response.json()["error"]["code"] == expected_code


@pytest.mark.django_db
class TestConfigEndpoint:
    def test_it_reports_availability_without_authentication(self, client):
        assert APIClient().get("/api/v1/maps/config").status_code == 200

    def test_it_is_publicly_cacheable(self, client):
        # Identical for every visitor and changes only on redeploy.
        assert "public" in client.get("/api/v1/maps/config")["Cache-Control"]

    def test_an_unconfigured_deployment_says_so_rather_than_erroring(self, monkeypatch):
        service = MapsReadService(maps=FakeMaps(configured=False), cache=LocMemCacheAdapter())
        monkeypatch.setattr("apps.maps.api.build_maps_read_service", lambda: service)
        assert APIClient().get("/api/v1/maps/config").json() == {"available": False}


@pytest.mark.django_db
class TestAuthorisation:
    """Every billed endpoint requires a login; the two public ones are the
    ones a visitor genuinely needs and both are heavily cached."""

    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/maps/places/autocomplete?q=phoenix",
            "/api/v1/maps/places/search?q=phoenix",
            "/api/v1/maps/places/p1",
            "/api/v1/maps/geocode?address=MG+Road",
        ],
    )
    def test_billed_endpoints_require_authentication(self, path):
        assert APIClient().get(path).status_code == 401

    def test_directions_is_public(self, client):
        # "How do I get there" is asked before deciding to buy.
        assert APIClient().get("/api/v1/maps/directions?origin=A&destination=B").status_code == 200

    def test_the_photo_proxy_is_public(self, client):
        assert APIClient().get("/api/v1/maps/places/photo?reference=ref-1").status_code == 200


@pytest.mark.django_db
class TestPayloads:
    def test_a_place_carries_its_photo_attributions(self, client):
        # Google REQUIRES these displayed wherever the photo is; dropping them
        # breaks the licence, so they must survive the view layer.
        body = client.get("/api/v1/maps/places/p1").json()
        assert body["photos"][0]["attributions"] == ["<a>Somebody</a>"]

    def test_geocode_returns_the_precision_hint(self, client):
        # A caller pinning a venue should refuse APPROXIMATE, which it can
        # only do if the view passes `location_type` through.
        assert (
            client.get("/api/v1/maps/geocode?address=MG+Road").json()["location_type"] == "ROOFTOP"
        )

    def test_geocode_with_neither_address_nor_coordinates_is_a_422(self, client):
        assert client.get("/api/v1/maps/geocode").status_code == 422

    def test_an_impossible_coordinate_is_refused_before_google_is_billed(self, client, maps):
        assert client.get("/api/v1/maps/geocode?lat=999&lng=0").status_code == 422
        assert maps.calls == []  # never reached the port

    def test_a_failed_matrix_cell_is_null_rather_than_zero(self, client):
        body = client.post(
            "/api/v1/maps/distance-matrix",
            {"origins": ["A"], "destinations": ["B"]},
            format="json",
        ).json()
        # A zero would render as "0 min away", which is worse than blank.
        assert body["data"][0][0]["duration_seconds"] is None
        assert body["data"][0][0]["status"] == "ZERO_RESULTS"

    def test_an_unknown_travel_mode_is_refused(self, client, maps):
        assert (
            client.get("/api/v1/maps/directions?origin=A&destination=B&mode=teleport").status_code
            == 422
        )
        assert maps.calls == []

    def test_direction_steps_are_stripped_of_googles_html(self, client, monkeypatch):
        """Google returns `Turn <b>left</b>`. Passed raw it is either a
        third-party string in the DOM or visible tags; stripped here, every
        client gets something correct with no decision to make."""
        from core.ports.maps_port import RouteStep

        class WithSteps(FakeMaps):
            def directions(self, **kwargs):
                return [
                    Route(
                        summary="x",
                        distance_metres=1,
                        duration_seconds=1,
                        polyline="p",
                        start_address="A",
                        end_address="B",
                        steps=[
                            RouteStep(
                                instruction="Turn <b>left</b> onto <b>MG Road</b>",
                                distance_metres=1,
                                duration_seconds=1,
                                travel_mode="DRIVING",
                            )
                        ],
                    )
                ]

        service = MapsReadService(maps=WithSteps(), cache=LocMemCacheAdapter())
        monkeypatch.setattr("apps.maps.api.build_maps_read_service", lambda: service)

        body = APIClient().get("/api/v1/maps/directions?origin=A&destination=B").json()
        assert body["data"][0]["steps"][0]["instruction"] == "Turn left onto MG Road"


@pytest.mark.django_db
class TestKeyLeakage:
    """The server key must never reach a browser. The photo proxy exists
    solely because Google's photo endpoint takes it as a QUERY PARAMETER."""

    def test_the_photo_proxy_returns_bytes_not_a_google_url(self, client, settings):
        settings.GOOGLE_MAPS_API_KEY = "server-side-secret-key"
        response = client.get("/api/v1/maps/places/photo?reference=ref-1")

        assert response["Content-Type"] == "image/png"
        assert response.content == b"\x89PNG-bytes"
        assert b"server-side-secret-key" not in response.content
        assert "googleapis" not in response.get("Location", "")

    def test_no_maps_response_contains_the_api_key(self, client, settings):
        settings.GOOGLE_MAPS_API_KEY = "server-side-secret-key"
        for path in (
            "/api/v1/maps/config",
            "/api/v1/maps/places/p1",
            "/api/v1/maps/geocode?address=MG+Road",
            "/api/v1/maps/directions?origin=A&destination=B",
        ):
            assert b"server-side-secret-key" not in client.get(path).content, path

    def test_the_photo_proxy_is_cacheable_so_google_is_billed_once(self, client):
        # A photo reference is immutable, so the bytes never change. Without a
        # long cache the same venue photo is re-fetched and re-billed on every
        # page view.
        cache_control = client.get("/api/v1/maps/places/photo?reference=ref-1")["Cache-Control"]
        assert "public" in cache_control and "max-age=86400" in cache_control


@pytest.mark.django_db
class TestCaching:
    """Every Google call is billed, so the cache is a cost control."""

    def test_place_details_hits_google_once(self, client, maps):
        client.get("/api/v1/maps/places/p1")
        client.get("/api/v1/maps/places/p1")
        assert maps.calls.count("place_details") == 1

    def test_geocoding_hits_google_once(self, client, maps):
        client.get("/api/v1/maps/geocode?address=MG+Road")
        client.get("/api/v1/maps/geocode?address=MG+Road")
        assert maps.calls.count("geocode") == 1

    def test_autocomplete_is_deliberately_uncached(self, client, maps):
        """Its key space is unbounded and caching keystrokes would break the
        session-token grouping that makes it cheap."""
        client.get("/api/v1/maps/places/autocomplete?q=phoenix")
        client.get("/api/v1/maps/places/autocomplete?q=phoenix")
        assert maps.calls.count("autocomplete") == 2

    def test_reverse_geocoding_rounds_before_keying(self, client, maps):
        # Raw GPS coordinates never repeat, so an unrounded key would make the
        # cache a write-only store that never returns a hit.
        client.get("/api/v1/maps/geocode?lat=12.97570001&lng=77.60680001")
        client.get("/api/v1/maps/geocode?lat=12.97570009&lng=77.60680009")
        assert maps.calls.count("reverse_geocode") == 1

    def test_a_traffic_aware_route_is_never_cached(self, client, maps):
        """A departure-time route is a point-in-time answer; a cached one is
        a wrong one."""
        client.get("/api/v1/maps/directions?origin=A&destination=B&departure_time=1800000000")
        client.get("/api/v1/maps/directions?origin=A&destination=B&departure_time=1800000000")
        assert maps.calls.count("directions") == 2

    def test_a_timeless_route_is_cached_and_shareable(self, client, maps):
        response = client.get("/api/v1/maps/directions?origin=A&destination=B")
        client.get("/api/v1/maps/directions?origin=A&destination=B")
        assert maps.calls.count("directions") == 1
        assert "public" in response["Cache-Control"]

    def test_a_traffic_aware_route_is_not_shared_cached(self, client):
        response = client.get(
            "/api/v1/maps/directions?origin=A&destination=B&departure_time=1800000000"
        )
        assert response["Cache-Control"] == "private, no-store"
