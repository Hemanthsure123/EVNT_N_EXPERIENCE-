"""The Google Maps adapter.

Google is mocked HERE and only here — production code never mocks it. What
these assert is the translation layer, because that is where the real bugs
live: Google reports most failures as HTTP 200 with a `status` field, so a
caller that trusts the status code sees success and an empty list.
"""

from __future__ import annotations

import pytest
import requests

from core.adapters.google_maps.adapter import DisabledMapsAdapter, GoogleMapsAdapter
from core.ports.maps_port import Coordinates, MapsError


class _Response:
    def __init__(self, payload=None, *, status_code=200, content=b"", headers=None):
        self._payload = payload
        self.status_code = status_code
        self.content = content
        self.headers = headers or {}

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


@pytest.fixture
def adapter(monkeypatch):
    built = GoogleMapsAdapter(api_key="test-key", region="in")

    def respond(payload=None, **kwargs):
        calls: list[dict] = []

        def _get(url, params=None, timeout=None, **_):
            calls.append({"url": url, "params": params or {}})
            return _Response(payload, **kwargs)

        _get.calls = calls  # type: ignore[attr-defined]
        monkeypatch.setattr(built._session, "get", _get)
        return _get

    built.respond = respond  # type: ignore[attr-defined]
    return built


class TestCoordinateValidation:
    def test_a_latitude_beyond_ninety_is_refused(self):
        with pytest.raises(MapsError) as caught:
            Coordinates(latitude=91.0, longitude=28.6)
        assert caught.value.reason == "invalid_input"

    def test_a_longitude_beyond_one_eighty_is_refused(self):
        with pytest.raises(MapsError) as caught:
            Coordinates(latitude=28.6, longitude=181.0)
        assert caught.value.reason == "invalid_input"

    def test_a_valid_pair_is_accepted(self):
        point = Coordinates(latitude=28.6139, longitude=77.2090)
        assert point.as_param == "28.6139,77.209"

    def test_range_checking_does_NOT_catch_an_indian_swap(self):
        """Documented honestly rather than claimed.

        Delhi is (28.6139, 77.2090). Swapped it is (77.2090, 28.6139) — and
        77.209 is a legal latitude, somewhere in Kazakhstan. No range check
        can catch that, so the real defence is that coordinates come from a
        Places lookup rather than from hand-typed numbers. A test asserting
        otherwise would be a false reassurance.
        """
        assert Coordinates(latitude=77.2090, longitude=28.6139).as_param


class TestStatusHandling:
    """Google returns HTTP 200 with a `status` field for most failures."""

    def test_zero_results_on_geocode_is_a_not_found(self, adapter):
        adapter.respond({"status": "ZERO_RESULTS", "results": []})
        with pytest.raises(MapsError) as caught:
            adapter.geocode("nowhere at all")
        assert caught.value.reason == "not_found"

    def test_zero_results_on_a_SEARCH_is_an_empty_list_not_an_error(self, adapter):
        # A search that matched nothing is a result. Raising would make the
        # venue picker show an error for a half-typed word.
        adapter.respond({"status": "ZERO_RESULTS", "predictions": []})
        assert adapter.autocomplete("zzzz") == []

    def test_over_query_limit_is_a_quota_error(self, adapter):
        adapter.respond({"status": "OVER_QUERY_LIMIT"})
        with pytest.raises(MapsError) as caught:
            adapter.geocode("MG Road")
        assert caught.value.reason == "quota"

    def test_request_denied_is_a_quota_error_not_a_not_found(self, adapter):
        # REQUEST_DENIED means a bad key, an unenabled API, or lapsed billing.
        # Reporting it as "address not found" would send somebody hunting for
        # a typo in an address while the map is switched off at Google.
        adapter.respond({"status": "REQUEST_DENIED", "error_message": "API not enabled"})
        with pytest.raises(MapsError) as caught:
            adapter.geocode("MG Road")
        assert caught.value.reason == "quota"

    def test_invalid_request_is_our_fault_and_not_retryable(self, adapter):
        adapter.respond({"status": "INVALID_REQUEST"})
        with pytest.raises(MapsError) as caught:
            adapter.geocode("MG Road")
        assert caught.value.reason == "invalid_input"

    def test_a_timeout_is_unavailable(self, adapter, monkeypatch):
        def explode(*args, **kwargs):
            raise requests.Timeout()

        monkeypatch.setattr(adapter._session, "get", explode)
        with pytest.raises(MapsError) as caught:
            adapter.geocode("MG Road")
        assert caught.value.reason == "unavailable"


class TestGeocoding:
    def test_a_result_is_translated_into_the_port_shape(self, adapter):
        adapter.respond(
            {
                "status": "OK",
                "results": [
                    {
                        "formatted_address": "MG Road, Bengaluru, Karnataka 560001, India",
                        "place_id": "ChIJbU60yXAWrjsR4E9-UejD3_g",
                        "geometry": {
                            "location": {"lat": 12.9757, "lng": 77.6068},
                            "location_type": "ROOFTOP",
                        },
                        "address_components": [
                            {"long_name": "Bengaluru", "types": ["locality"]},
                            {"long_name": "India", "types": ["country"]},
                            {"long_name": "560001", "types": ["postal_code"]},
                        ],
                    }
                ],
            }
        )
        result = adapter.geocode("MG Road Bengaluru")

        assert result.coordinates.latitude == 12.9757
        assert result.city == "Bengaluru"
        assert result.country == "India"
        assert result.postal_code == "560001"
        assert result.location_type == "ROOFTOP"

    def test_city_falls_back_when_google_omits_locality(self, adapter):
        """Google uses `locality` for most places, `postal_town` in the UK, and
        sometimes only `administrative_area_level_2` in India. Reading
        `locality` alone yields an empty city for entire countries."""
        adapter.respond(
            {
                "status": "OK",
                "results": [
                    {
                        "formatted_address": "Somewhere",
                        "geometry": {"location": {"lat": 1.0, "lng": 2.0}},
                        "address_components": [
                            {"long_name": "Thane", "types": ["administrative_area_level_2"]},
                        ],
                    }
                ],
            }
        )
        assert adapter.geocode("somewhere").city == "Thane"

    def test_a_response_with_no_coordinates_is_an_error_not_a_zero(self, adapter):
        # Defaulting to (0, 0) would put the venue in the Atlantic.
        adapter.respond({"status": "OK", "results": [{"formatted_address": "x", "geometry": {}}]})
        with pytest.raises(MapsError):
            adapter.geocode("x")

    def test_reverse_geocoding_sends_a_latlng(self, adapter):
        capture = adapter.respond(
            {
                "status": "OK",
                "results": [
                    {"formatted_address": "x", "geometry": {"location": {"lat": 1, "lng": 2}}}
                ],
            }
        )
        adapter.reverse_geocode(Coordinates(latitude=12.97, longitude=77.60))
        assert capture.calls[0]["params"]["latlng"] == "12.97,77.6"


class TestPlaces:
    def test_a_one_character_query_is_not_sent_to_google(self, adapter):
        capture = adapter.respond({"status": "OK", "predictions": []})
        assert adapter.autocomplete("a") == []
        # Google bills a one-character query the same as a useful one and
        # returns noise for it.
        assert capture.calls == []

    def test_the_session_token_is_forwarded(self, adapter):
        capture = adapter.respond({"status": "OK", "predictions": []})
        adapter.autocomplete("phoenix mall", session_token="abc-123")
        # Billing depends on it: per-session with a token, per-request without.
        assert capture.calls[0]["params"]["sessiontoken"] == "abc-123"

    def test_place_details_requests_an_explicit_field_mask(self, adapter):
        capture = adapter.respond(
            {
                "status": "OK",
                "result": {
                    "place_id": "abc",
                    "name": "Phoenix Marketcity",
                    "formatted_address": "Whitefield, Bengaluru",
                    "geometry": {"location": {"lat": 12.99, "lng": 77.69}},
                },
            }
        )
        place = adapter.place_details("abc")
        # Places Details is billed by field TIER — asking for everything costs
        # several times a basic request.
        assert "fields" in capture.calls[0]["params"]
        assert place.name == "Phoenix Marketcity"

    def test_photo_attributions_travel_with_the_photo(self, adapter):
        adapter.respond(
            {
                "status": "OK",
                "result": {
                    "place_id": "abc",
                    "name": "V",
                    "formatted_address": "A",
                    "geometry": {"location": {"lat": 1, "lng": 2}},
                    "photos": [
                        {
                            "photo_reference": "ref-1",
                            "width": 4032,
                            "height": 3024,
                            "html_attributions": ["<a>Someone</a>"],
                        }
                    ],
                },
            }
        )
        place = adapter.place_details("abc")
        # Google REQUIRES these displayed wherever the photo is. Dropping them
        # is a licence violation, so they cannot be fetched separately.
        assert place.photos[0].attributions == ["<a>Someone</a>"]

    def test_one_malformed_row_does_not_lose_the_whole_search(self, adapter):
        adapter.respond(
            {
                "status": "OK",
                "results": [
                    {"place_id": "bad", "geometry": {}},
                    {
                        "place_id": "good",
                        "name": "Good",
                        "formatted_address": "A",
                        "geometry": {"location": {"lat": 1, "lng": 2}},
                    },
                ],
            }
        )
        places = adapter.search_text("venue")
        assert [p.place_id for p in places] == ["good"]


class TestDirections:
    def test_no_route_is_an_empty_list_not_an_error(self, adapter):
        # An island, or transit that does not run. A legitimate answer.
        adapter.respond({"status": "ZERO_RESULTS", "routes": []})
        assert adapter.directions(origin="A", destination="B") == []

    def test_a_route_is_translated_with_its_steps(self, adapter):
        adapter.respond(
            {
                "status": "OK",
                "routes": [
                    {
                        "summary": "NH 48",
                        "overview_polyline": {"points": "abcd"},
                        "warnings": ["Walking directions are in beta"],
                        "legs": [
                            {
                                "distance": {"value": 12000},
                                "duration": {"value": 1800},
                                "start_address": "A",
                                "end_address": "B",
                                "steps": [
                                    {
                                        "html_instructions": "Turn <b>left</b>",
                                        "distance": {"value": 100},
                                        "duration": {"value": 60},
                                        "travel_mode": "DRIVING",
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }
        )
        routes = adapter.directions(origin="A", destination="B")
        assert routes[0].distance_metres == 12000
        assert routes[0].polyline == "abcd"
        assert routes[0].steps[0].instruction == "Turn <b>left</b>"

    def test_a_transit_fare_is_converted_to_minor_units(self, adapter):
        adapter.respond(
            {
                "status": "OK",
                "routes": [
                    {
                        "summary": "Metro",
                        "overview_polyline": {"points": "x"},
                        "fare": {"currency": "INR", "value": 60.0},
                        "legs": [
                            {
                                "distance": {"value": 1},
                                "duration": {"value": 1},
                                "start_address": "A",
                                "end_address": "B",
                                "steps": [],
                            }
                        ],
                    }
                ],
            }
        )
        route = adapter.directions(origin="A", destination="B", mode="transit")[0]
        # Money as an integer, like every other amount in this codebase.
        assert route.fare_minor == 6000
        assert route.fare_currency == "INR"

    def test_a_departure_time_is_forwarded_for_transit(self, adapter):
        capture = adapter.respond({"status": "OK", "routes": []})
        adapter.directions(origin="A", destination="B", mode="transit", departure_time=1800000000)
        # Without one Google assumes "now", which for an event three weeks out
        # returns a timetable nobody can use.
        assert capture.calls[0]["params"]["departure_time"] == 1800000000


class TestDistanceMatrix:
    def test_more_than_a_hundred_pairs_is_refused_before_billing(self, adapter):
        with pytest.raises(MapsError) as caught:
            adapter.distance_matrix(origins=["a"] * 11, destinations=["b"] * 11)
        assert caught.value.reason == "invalid_input"

    def test_a_failed_cell_is_null_rather_than_zero(self, adapter):
        adapter.respond(
            {
                "status": "OK",
                "destination_addresses": ["A", "B"],
                "rows": [
                    {
                        "elements": [
                            {
                                "status": "OK",
                                "distance": {"value": 500},
                                "duration": {"value": 120},
                            },
                            {"status": "ZERO_RESULTS"},
                        ]
                    }
                ],
            }
        )
        row = adapter.distance_matrix(origins=["x"], destinations=["A", "B"])[0]
        assert row[0].duration_seconds == 120
        # A zero would render as "0 min away", which is worse than "unknown".
        assert row[1].duration_seconds is None
        assert row[1].status == "ZERO_RESULTS"


class TestPhotos:
    def test_an_html_error_page_is_not_served_as_an_image(self, adapter):
        # Google answers an invalid reference with an HTML page and a 200.
        # Passing it through would put a Google error page where a venue photo
        # should be.
        adapter.respond(None, content=b"<html>", headers={"Content-Type": "text/html"})
        with pytest.raises(MapsError) as caught:
            adapter.fetch_photo("stale-ref")
        assert caught.value.reason == "not_found"

    def test_the_width_is_clamped(self, adapter):
        capture = adapter.respond(None, content=b"\x89PNG", headers={"Content-Type": "image/png"})
        adapter.fetch_photo("ref", max_width=99999)
        # A caller asking for 16000px moves megabytes through the proxy for a
        # thumbnail, and Google charges the same either way.
        assert capture.calls[0]["params"]["maxwidth"] == 1600

    def test_bytes_and_content_type_come_back(self, adapter):
        adapter.respond(None, content=b"\x89PNG", headers={"Content-Type": "image/png"})
        content, content_type = adapter.fetch_photo("ref")
        assert content == b"\x89PNG"
        assert content_type == "image/png"


class TestDisabledAdapter:
    """The default with no key. Not a fake — it refuses and says why."""

    def test_it_reports_itself_unconfigured(self):
        assert DisabledMapsAdapter().is_configured() is False

    @pytest.mark.parametrize(
        "call",
        [
            lambda a: a.autocomplete("x"),
            lambda a: a.place_details("x"),
            lambda a: a.geocode("x"),
            lambda a: a.reverse_geocode(Coordinates(latitude=1, longitude=2)),
            lambda a: a.directions(origin="a", destination="b"),
            lambda a: a.distance_matrix(origins=["a"], destinations=["b"]),
            lambda a: a.fetch_photo("ref"),
        ],
    )
    def test_every_call_refuses_rather_than_inventing_a_result(self, call):
        with pytest.raises(MapsError) as caught:
            call(DisabledMapsAdapter())
        assert caught.value.reason == "not_configured"


def test_di_returns_the_disabled_adapter_without_a_key(settings):
    from config.di import maps_port

    settings.GOOGLE_MAPS_API_KEY = ""
    maps_port.cache_clear()
    try:
        assert maps_port().is_configured() is False
    finally:
        maps_port.cache_clear()


def test_di_builds_the_real_adapter_with_a_key(settings):
    from config.di import maps_port

    settings.GOOGLE_MAPS_API_KEY = "a-real-looking-key"
    maps_port.cache_clear()
    try:
        assert isinstance(maps_port(), GoogleMapsAdapter)
    finally:
        maps_port.cache_clear()
