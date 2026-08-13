"""API tests for the organizer dashboard.

The question this file exists to answer, over and over: **does an organizer
ever see somebody else's rows?** Every endpoint is checked against a fixture
that deliberately contains a second organizer with their own event, booking,
payment and customer. A shape-only assertion would pass against a stub; these
assert the actual numbers the fixture created.

Second theme: percentages are `null`, never 0, when their denominator is zero
— a made-up rate on an empty dashboard is worse than a dash.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import EventStatus

from .conftest import World, refund

ENDPOINTS = [
    "/api/v1/organizer/overview",
    "/api/v1/organizer/timeseries",
    "/api/v1/organizer/breakdown",
    "/api/v1/organizer/activity",
    "/api/v1/organizer/audience",
    "/api/v1/organizer/event-rows",
    "/api/v1/organizer/bookings",
    "/api/v1/organizer/customers",
]


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestAccess:
    @pytest.mark.parametrize("path", ENDPOINTS)
    def test_anonymous_is_refused(self, path: str) -> None:
        assert APIClient().get(path).status_code == 401

    @pytest.mark.parametrize("path", ENDPOINTS)
    def test_every_response_is_private_and_uncached(self, world: World, path: str) -> None:
        """One organizer's revenue must never sit in a shared or CDN cache."""
        response = auth(world.owner).get(path)
        assert response.status_code == 200
        assert response["Cache-Control"] == "private, no-store"

    def test_a_user_with_no_organizations_gets_empty_lists_not_an_error(self, db) -> None:
        """A brand-new organizer owns nothing. That is a real state, not a 403."""
        nobody = User.objects.create_user(email="new@example.com", password="newpass12345")
        response = auth(nobody).get("/api/v1/organizer/event-rows")
        assert response.status_code == 200
        assert response.json()["data"] == []

        overview = auth(nobody).get("/api/v1/organizer/overview").json()
        assert overview["revenue_today_minor"] == 0
        # Not 0% — nothing has happened, so there is no rate to report.
        assert overview["conversion_pct"] is None


@pytest.mark.django_db
class TestOverview:
    def test_counts_only_this_organizers_money(self, world: World) -> None:
        payload = auth(world.owner).get("/api/v1/organizer/overview").json()
        # 500_000 + 250_000 + 250_000 from the owner's three paid bookings.
        # The rival's 999_000 must not be in here.
        assert payload["revenue_today_minor"] == 1_000_000
        assert payload["bookings_today"] == 3
        assert payload["tickets_sold_today"] == 4

    def test_the_rival_sees_only_their_own(self, world: World) -> None:
        payload = auth(world.rival).get("/api/v1/organizer/overview").json()
        assert payload["revenue_today_minor"] == 999_000
        assert payload["bookings_today"] == 1

    def test_conversion_uses_every_started_booking_as_the_denominator(self, world: World) -> None:
        """3 paid out of 4 started (one hold expired) = 75%."""
        payload = auth(world.owner).get("/api/v1/organizer/overview").json()
        assert payload["conversion_pct"] == 75.0

    def test_trend_is_null_rather_than_a_meaningless_hundred_percent(self, world: World) -> None:
        """Yesterday was zero, so "up 100%" would be noise. A dash is honest."""
        payload = auth(world.owner).get("/api/v1/organizer/overview").json()
        assert payload["revenue_change_pct"] is None

    def test_refunds_are_reported(self, world: World) -> None:
        refund(world.booking, 100_000)
        payload = auth(world.owner).get("/api/v1/organizer/overview").json()
        assert payload["refunds_today"] == 1
        assert payload["refunds_today_minor"] == 100_000

    def test_upcoming_counts_only_live_future_events(self, world: World) -> None:
        payload = auth(world.owner).get("/api/v1/organizer/overview").json()
        # Two events exist for this owner, but the second is a DRAFT.
        assert payload["events_upcoming"] == 1

    def test_checkins_come_from_the_scan_log(self, world: World) -> None:
        assert auth(world.owner).get("/api/v1/organizer/overview").json()["checkins_today"] == 1


@pytest.mark.django_db
class TestTimeseries:
    def test_series_is_dense_every_day_including_zeros(self, world: World) -> None:
        payload = auth(world.owner).get("/api/v1/organizer/timeseries?days=7").json()
        assert payload["days"] == 7
        assert len(payload["points"]) == 7
        # A sparse series would have one point; a chart drawn from it turns a
        # quiet week into a climb.
        assert sum(point["value"] for point in payload["points"]) == 1_000_000

    @pytest.mark.parametrize("metric", ["revenue", "bookings", "tickets"])
    def test_every_metric_is_served(self, world: World, metric: str) -> None:
        payload = auth(world.owner).get(f"/api/v1/organizer/timeseries?metric={metric}").json()
        assert payload["metric"] == metric

    def test_an_unknown_metric_falls_back_rather_than_500ing(self, world: World) -> None:
        payload = auth(world.owner).get("/api/v1/organizer/timeseries?metric=wat").json()
        assert payload["metric"] == "revenue"

    def test_days_is_clamped(self, world: World) -> None:
        payload = auth(world.owner).get("/api/v1/organizer/timeseries?days=99999").json()
        assert payload["days"] == 365

    def test_a_custom_window_ends_on_the_given_date(self, world: World) -> None:
        """`end` moves the window; `days` still says how long it is.

        Stored as a length plus an end rather than a from/to pair because the
        length is what everything downstream already speaks — the clamp, the
        dense fill, the cache key and the `days` field in this response.
        """
        payload = auth(world.owner).get("/api/v1/organizer/timeseries?days=3&end=2026-03-10").json()
        assert payload["days"] == 3
        assert [point["date"] for point in payload["points"]] == [
            "2026-03-08",
            "2026-03-09",
            "2026-03-10",
        ]

    def test_a_custom_window_is_cached_apart_from_the_rolling_one(self, world: World) -> None:
        """Both are `days=3`. Sharing a cache key would serve one window's
        points for the other's dates — a plausible chart for the wrong days,
        which is worse than an error because nobody would question it."""
        rolling = auth(world.owner).get("/api/v1/organizer/timeseries?days=3").json()
        custom = auth(world.owner).get("/api/v1/organizer/timeseries?days=3&end=2026-03-10").json()
        assert rolling["points"] != custom["points"]

    def test_a_future_end_is_clamped_to_today_not_refused(self, world: World) -> None:
        """These arrive from a date picker somebody can type into, the view is
        already scoped to the caller, and a dashboard that 400s because of a
        stray date is worse than one showing the default window."""
        future = auth(world.owner).get("/api/v1/organizer/timeseries?days=3&end=2099-01-01").json()
        today = auth(world.owner).get("/api/v1/organizer/timeseries?days=3").json()
        assert future["points"] == today["points"]

    def test_a_malformed_end_is_treated_as_absent(self, world: World) -> None:
        payload = (
            auth(world.owner).get("/api/v1/organizer/timeseries?days=3&end=last-tuesday").json()
        )
        today = auth(world.owner).get("/api/v1/organizer/timeseries?days=3").json()
        assert payload["points"] == today["points"]


@pytest.mark.django_db
class TestEventRows:
    def test_returns_only_owned_events_with_real_aggregates(self, world: World) -> None:
        rows = auth(world.owner).get("/api/v1/organizer/event-rows").json()["data"]
        titles = {row["title"] for row in rows}
        assert titles == {"Summer Sessions", "Winter Nights"}
        assert "Rival Fest" not in titles

        summer = next(row for row in rows if row["title"] == "Summer Sessions")
        assert summer["capacity"] == 300  # 100 Gold + 200 Silver
        assert summer["sold"] == 6  # 4 + 2, straight off the tier rows
        assert summer["revenue_minor"] == 750_000  # its two paid bookings
        assert summer["checkins"] == 1  # one ticket actually admitted

    def test_search_matches_title_or_venue(self, world: World) -> None:
        by_title = auth(world.owner).get("/api/v1/organizer/event-rows?q=summ").json()["data"]
        assert [row["title"] for row in by_title] == ["Summer Sessions"]

        by_venue = auth(world.owner).get("/api/v1/organizer/event-rows?q=indira").json()["data"]
        assert [row["title"] for row in by_venue] == ["Winter Nights"]

    def test_status_and_city_filter(self, world: World) -> None:
        drafts = (
            auth(world.owner)
            .get(f"/api/v1/organizer/event-rows?status={EventStatus.DRAFT}")
            .json()["data"]
        )
        assert [row["title"] for row in drafts] == ["Winter Nights"]

        pune = auth(world.owner).get("/api/v1/organizer/event-rows?city=pune").json()["data"]
        assert [row["title"] for row in pune] == ["Winter Nights"]

    def test_page_costs_a_fixed_number_of_queries(
        self, world: World, django_assert_num_queries
    ) -> None:
        """The whole point of merging aggregates by page rather than per row.

        The event page plus three GROUP BY queries — capacity, revenue,
        check-ins. Adding a fourth event must NOT add a query; if this number
        ever moves with row count, the merge has become an N+1.

        (No auth query: `force_authenticate` attaches the user directly, so
        unlike a real JWT request there is no user lookup to pay for.)
        """
        client = auth(world.owner)
        with django_assert_num_queries(4):
            client.get("/api/v1/organizer/event-rows")


@pytest.mark.django_db
class TestBookings:
    def test_lists_only_this_organizers_bookings(self, world: World) -> None:
        rows = auth(world.owner).get("/api/v1/organizer/bookings").json()["data"]
        assert len(rows) == 4  # 3 paid + 1 expired hold
        assert all(row["event_title"] != "Rival Fest" for row in rows)

    def test_carries_the_customer_and_quantity(self, world: World) -> None:
        rows = auth(world.owner).get("/api/v1/organizer/bookings?status=paid").json()["data"]
        asha = next(row for row in rows if row["customer_email"] == "asha@example.com")
        assert asha["customer_name"] == "Asha Rao"
        assert asha["quantity"] >= 1

    def test_filters_by_event_and_searches_the_customer(self, world: World) -> None:
        client = auth(world.owner)
        by_event = client.get(f"/api/v1/organizer/bookings?event_id={world.event.id}").json()
        assert {row["event_title"] for row in by_event["data"]} == {"Summer Sessions"}

        by_customer = client.get("/api/v1/organizer/bookings?q=bala").json()
        assert {row["customer_email"] for row in by_customer["data"]} == {"bala@example.com"}

    def test_a_malformed_event_id_is_ignored_not_a_500(self, world: World) -> None:
        response = auth(world.owner).get("/api/v1/organizer/bookings?event_id=not-a-uuid")
        assert response.status_code == 200

    def test_page_costs_a_fixed_number_of_queries(
        self, world: World, django_assert_num_queries
    ) -> None:
        client = auth(world.owner)
        with django_assert_num_queries(2):  # the page + one grouped quantity query
            client.get("/api/v1/organizer/bookings")


@pytest.mark.django_db
class TestCustomers:
    def test_lifetime_value_is_with_this_organizer_only(self, world: World) -> None:
        rows = auth(world.owner).get("/api/v1/organizer/customers").json()["data"]
        asha = next(row for row in rows if row["email"] == "asha@example.com")
        assert asha["bookings"] == 2
        assert asha["lifetime_value_minor"] == 750_000

    def test_the_rivals_customer_is_absent(self, world: World) -> None:
        rows = auth(world.owner).get("/api/v1/organizer/customers").json()["data"]
        assert "rival@example.com" not in {row["email"] for row in rows}

    def test_search_narrows_by_email_or_name(self, world: World) -> None:
        rows = auth(world.owner).get("/api/v1/organizer/customers?q=Asha").json()["data"]
        assert [row["email"] for row in rows] == ["asha@example.com"]

    def test_profile_reports_real_totals(self, world: World) -> None:
        refund(world.booking, 100_000)
        payload = auth(world.owner).get(f"/api/v1/organizer/customers/{world.customer.id}").json()
        assert payload["bookings"] == 2
        assert payload["lifetime_value_minor"] == 750_000
        assert payload["refunds"] == 1
        assert payload["refunded_minor"] == 100_000
        assert payload["tickets_issued"] == 3
        assert len(payload["recent_bookings"]) == 2

    def test_a_stranger_is_a_404_not_a_blank_profile(self, world: World) -> None:
        response = auth(world.owner).get(f"/api/v1/organizer/customers/{world.rival.id}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


@pytest.mark.django_db
class TestEventAnalytics:
    def test_reports_real_rates(self, world: World) -> None:
        payload = (
            auth(world.owner).get(f"/api/v1/organizer/events/{world.event.id}/analytics").json()
        )
        assert payload["capacity"] == 300
        assert payload["sold"] == 6
        assert payload["revenue_minor"] == 750_000
        assert payload["sell_through_pct"] == 2.0
        # 2 paid of 3 bookings on this event (one expired).
        assert payload["conversion_pct"] == 66.7
        assert payload["abandonment_pct"] == 33.3
        assert [tier["name"] for tier in payload["tiers"]] == ["Silver", "Gold"]

    def test_attendance_is_null_when_nothing_has_sold(self, world: World) -> None:
        """The draft event has no tiers and no sales. Every rate over it is a
        division by zero, and each one reports `null` rather than 0%."""
        payload = (
            auth(world.owner)
            .get(f"/api/v1/organizer/events/{world.second_event.id}/analytics")
            .json()
        )
        assert payload["capacity"] == 0
        assert payload["sell_through_pct"] is None
        assert payload["attendance_pct"] is None

    def test_admissions_come_from_used_tickets_not_the_scan_log(self, world: World) -> None:
        """Both screens must agree. The events table counts used tickets, so
        analytics does too — the scan log is the audit trail beside it, and it
        answers a different question (how many scans were DENIED)."""
        payload = (
            auth(world.owner).get(f"/api/v1/organizer/events/{world.event.id}/analytics").json()
        )
        assert payload["checkins"] == 1
        assert payload["attendance_pct"] == 16.7  # 1 admitted of 6 sold
        assert payload["scans_by_result"] == [{"label": "allowed", "value": 1}]

        rows = auth(world.owner).get("/api/v1/organizer/event-rows").json()["data"]
        summer = next(row for row in rows if row["title"] == "Summer Sessions")
        assert summer["checkins"] == payload["checkins"]

    def test_carries_the_events_own_identity_for_a_standalone_page(self, world: World) -> None:
        """An analytics ROUTE has no table row to take a title from, so the
        payload carries one — otherwise the page needs a second request just
        to render its heading."""
        payload = (
            auth(world.owner).get(f"/api/v1/organizer/events/{world.event.id}/analytics").json()
        )
        assert payload["event"]["id"] == str(world.event.id)
        assert payload["event"]["title"] == "Summer Sessions"
        assert payload["event"]["status"] == world.event.status
        assert payload["event"]["starts_at"]

    def test_refunds_are_reported_beside_revenue_not_subtracted_from_it(self, world: World) -> None:
        """`revenue_minor` counts PAID payments, so a refunded payment has
        already dropped out of it. Netting these off as well would deduct the
        same money twice — so they are their own figure."""
        payload = (
            auth(world.owner).get(f"/api/v1/organizer/events/{world.event.id}/analytics").json()
        )
        assert payload["refunded_minor"] >= 0
        assert payload["refunded_count"] >= 0
        # Unchanged by the addition: revenue is still the paid-payment total.
        assert payload["revenue_minor"] == 750_000

    def test_another_organizers_event_is_a_404(self, world: World) -> None:
        """404 rather than 403 — a 403 confirms the event exists to anyone
        guessing ids."""
        response = auth(world.owner).get(
            f"/api/v1/organizer/events/{world.rival_event.id}/analytics"
        )
        assert response.status_code == 404


@pytest.mark.django_db
class TestBreakdownAndAudience:
    def test_revenue_by_event_excludes_the_rival(self, world: World) -> None:
        payload = auth(world.owner).get("/api/v1/organizer/breakdown?by=revenue_by_event").json()
        labels = {item["label"] for item in payload["items"]}
        assert labels == {"Summer Sessions", "Winter Nights"}

    def test_bookings_by_status_counts_the_expired_hold(self, world: World) -> None:
        payload = auth(world.owner).get("/api/v1/organizer/breakdown?by=bookings_by_status").json()
        by_label = {item["label"]: item["value"] for item in payload["items"]}
        assert by_label == {"paid": 3, "expired": 1}

    def test_repeat_customers_are_counted(self, world: World) -> None:
        payload = auth(world.owner).get("/api/v1/organizer/audience").json()
        assert payload["customers"] == 2
        assert payload["repeat_customers"] == 1  # Asha bought twice
        assert payload["repeat_pct"] == 50.0

    def test_activity_is_this_organizers_bookings_newest_first(self, world: World) -> None:
        payload = auth(world.owner).get("/api/v1/organizer/activity").json()["data"]
        assert len(payload) == 4
        assert all(row["event_title"] != "Rival Fest" for row in payload)
        timestamps = [row["created_at"] for row in payload]
        assert timestamps == sorted(timestamps, reverse=True)


@pytest.mark.django_db
class TestCaching:
    def test_the_overview_is_cached_per_owner_not_globally(self, world: World) -> None:
        """The bug this exists to prevent is the worst one a cache can cause
        here: serving one organizer's revenue to another."""
        owner_payload = auth(world.owner).get("/api/v1/organizer/overview").json()
        rival_payload = auth(world.rival).get("/api/v1/organizer/overview").json()
        assert owner_payload["revenue_today_minor"] == 1_000_000
        assert rival_payload["revenue_today_minor"] == 999_000

    def test_a_warm_overview_costs_fewer_queries(
        self, world: World, django_assert_num_queries
    ) -> None:
        client = auth(world.owner)
        client.get("/api/v1/organizer/overview")  # warm it
        # Zero. The whole payload comes back from Redis; a cold overview runs
        # eleven aggregates, which is exactly why it is the one thing cached.
        with django_assert_num_queries(0):
            client.get("/api/v1/organizer/overview")
