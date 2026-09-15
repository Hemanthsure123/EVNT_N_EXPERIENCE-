"""The sections the event analytics page used to list as "Not measured yet".

Every number asserted here can be worked out by hand from the `world` fixture
(conftest.py). On Summer Sessions, the event under test:

    Asha   paid for 2 Gold   (her booking is `world.booking`)
    Bala   paid for 1 Gold
    Bala   also left an expired hold — a cart that never paid
    Asha   bought a Winter Nights ticket too, AFTER her Summer booking

Gold and Silver were written straight to the table, so neither has any pricing
history — both are at `version` 1, the state of every tier that predates the
log.
"""

from __future__ import annotations

import datetime as dt
from typing import cast

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.booking.models import Booking, BookingItem, BookingStatus
from apps.events.models import Event, EventEngagementDay, SavedEvent
from apps.organizer.selectors import PLATFORM_TZ
from apps.reviews.models import EventReview, ReviewStatus
from apps.ticketing.models import PricingChangeKind, SalePhase, TicketPriceChange, TicketType
from config.di import cache_port

from .conftest import World, _paid_booking


def auth(user: User) -> APIClient:
    client = APIClient()
    token = cast(RefreshToken, RefreshToken.for_user(user)).access_token
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


def analytics(world: World, event: Event | None = None) -> dict:
    target = event or world.event
    # The payload is cached for a minute, and several tests change the event
    # and read it again — a second read inside the TTL would be the first
    # one's answer. The cache is dropped so each read describes the rows.
    cache_port.cache_clear()
    response = auth(world.owner).get(f"/api/v1/organizer/events/{target.id}/analytics")
    assert response.status_code == 200, response.content
    return response.json()


def gold(world: World) -> TicketType:
    return world.tier


def silver(world: World) -> TicketType:
    return TicketType.objects.get(event=world.event, name="Silver")


def bala_booking(world: World) -> Booking:
    return Booking.objects.get(
        user=world.other_customer, event=world.event, status=BookingStatus.PAID
    )


def backdate(model, pk, **fields) -> None:
    model.objects.filter(pk=pk).update(**fields)


def today() -> dt.date:
    return timezone.now().astimezone(PLATFORM_TZ).date()


@pytest.mark.django_db
class TestOrders:
    def test_orders_are_split_by_seat_count_and_carts_count_every_hold(self, world: World):
        payload = analytics(world)
        assert payload["orders"] == 2
        assert payload["seats"] == 3
        assert payload["order_split"] == {
            "single": {"orders": 1, "revenue_minor": 250_000},
            "multiple": {"orders": 1, "revenue_minor": 500_000},
        }
        # Two paid bookings and one lapsed hold: a hold is a cart, and the one
        # nobody paid for is exactly what this card exists to show.
        assert payload["add_to_cart"] == 3
        # Revenue held (750,000) over the seats it paid for (3).
        assert payload["avg_per_attendee_minor"] == 250_000

    def test_coupon_use_is_counted_off_the_discount_the_booking_carries(self, world: World):
        backdate(Booking, world.booking.pk, discount_amount_minor=10_000)
        coupons = analytics(world)["coupons"]
        assert coupons == {"orders": 1, "pct_of_orders": 50.0, "discount_minor": 10_000}

    def test_the_tier_table_carries_what_each_tier_actually_billed(self, world: World):
        tiers = {tier["name"]: tier for tier in analytics(world)["tiers"]}
        assert tiers["Gold"]["orders"] == 2
        assert tiers["Gold"]["seats"] == 3
        assert tiers["Gold"]["charged_minor"] == 750_000
        assert tiers["Gold"]["per_person_minor"] == 250_000
        assert tiers["Gold"]["is_past"] is False
        # Nothing sold: a per-person price over no people is null, not zero.
        assert tiers["Silver"]["per_person_minor"] is None
        # The old figure keeps its meaning for the operator console.
        assert tiers["Gold"]["revenue_minor"] == 4 * 250_000

    def test_a_withdrawn_tier_that_sold_is_still_in_the_table_as_past(self, world: World):
        backdate(TicketType, gold(world).pk, deleted_at=timezone.now())
        payload = analytics(world)
        names = {tier["name"]: tier for tier in payload["tiers"]}
        assert names["Gold"]["is_past"] is True
        assert names["Gold"]["is_deleted"] is True
        # Capacity is still over LIVE tiers only — unchanged behaviour.
        assert payload["capacity"] == 200


@pytest.mark.django_db
class TestTheBookingWindow:
    def test_is_dense_from_creation_to_today(self, world: World):
        backdate(Booking, world.booking.pk, created_at=timezone.now() - dt.timedelta(days=10))
        window = analytics(world)["booking_window"]
        assert len(window) == 11
        assert window[0] == {
            "date": (today() - dt.timedelta(days=10)).isoformat(),
            "orders": 1,
            "seats": 2,
        }
        # The quiet days are there, at zero — a chart that skipped them would
        # draw a climb that never happened.
        assert all(day["orders"] == 0 for day in window[1:-1])
        assert window[-1] == {"date": today().isoformat(), "orders": 1, "seats": 1}

    def test_the_booking_period_is_calendar_days_between_the_first_and_last_sale(
        self, world: World
    ):
        backdate(Booking, world.booking.pk, created_at=timezone.now() - dt.timedelta(days=3))
        insights = analytics(world)["booking_insights"]
        assert insights["period_days"] == 3
        assert insights["first_booking_at"] < insights["last_booking_at"]

    def test_the_late_share_waits_for_the_doors(self, world: World):
        """The final 72 hours have not finished happening before the show."""
        assert analytics(world)["booking_insights"]["late_pct"] is None
        backdate(Event, world.event.pk, starts_at=timezone.now() - dt.timedelta(hours=1))
        insights = analytics(world)["booking_insights"]
        assert insights["late_seats"] == 3
        assert insights["late_pct"] == 100.0

    def test_no_shows_are_only_counted_once_the_event_is_over(self, world: World):
        assert analytics(world)["no_shows"] is None
        backdate(
            Event,
            world.event.pk,
            starts_at=timezone.now() - dt.timedelta(days=2),
            ends_at=timezone.now() - dt.timedelta(days=1),
        )
        payload = analytics(world)
        assert payload["event_ended"] is True
        # Six sold on the tier counters, one admitted.
        assert payload["no_shows"] == 5


@pytest.mark.django_db
class TestEngagement:
    def test_nothing_recorded_is_null_rather_than_zero(self, world: World):
        engagement = analytics(world)["engagement"]
        assert engagement["views"] is None
        assert engagement["impressions"] is None
        assert engagement["view_cvr_pct"] is None
        assert engagement["ctr_pct"] is None
        assert engagement["tracked_since"] is None

    def test_rates_are_taken_over_the_window_that_was_recorded(self, world: World):
        # Asha's 2 seats were sold ten days ago, before anything was recorded;
        # only Bala's 1 seat today falls inside the recorded window.
        backdate(Booking, world.booking.pk, created_at=timezone.now() - dt.timedelta(days=10))
        EventEngagementDay.objects.create(
            event=world.event,
            date=today(),
            impressions=50,
            views=100,
            feed_views=10,
            located_views=20,
            local_views=5,
        )
        engagement = analytics(world)["engagement"]
        assert engagement["views"] == 100
        assert engagement["impressions"] == 50
        assert engagement["tracked_since"] == today().isoformat()
        # 1 seat sold since tracking began, over 100 views — NOT all 3 seats.
        assert engagement["view_cvr_pct"] == 1.0
        assert engagement["ctr_pct"] == 20.0
        assert engagement["local_pct"] == 25.0


@pytest.mark.django_db
class TestAudience:
    def test_everybody_is_first_time_when_nobody_bought_elsewhere_first(self, world: World):
        audience = analytics(world)["audience"]
        # Asha's Winter Nights ticket came AFTER this one, so she is not a
        # returning member here.
        assert (audience["attendees"], audience["first_time"], audience["repeat"]) == (2, 2, 0)
        assert audience["first_time_pct"] == 100.0

    def test_an_earlier_booking_for_another_event_makes_a_returning_member(self, world: World):
        earlier = _paid_booking(
            world.other_customer, world.second_event, gold(world), quantity=1, amount=250_000
        )
        backdate(Booking, earlier.pk, created_at=timezone.now() - dt.timedelta(days=30))
        audience = analytics(world)["audience"]
        assert (audience["first_time"], audience["repeat"]) == (1, 1)
        assert audience["repeat_pct"] == 50.0

    def test_interest_conversion_counts_a_save_that_came_before_the_booking(self, world: World):
        converted = SavedEvent.objects.create(user=world.customer, event=world.event)
        backdate(SavedEvent, converted.pk, created_at=timezone.now() - dt.timedelta(days=20))
        backdate(Booking, world.booking.pk, created_at=timezone.now() - dt.timedelta(days=5))
        # Saved and never booked.
        SavedEvent.objects.create(user=world.rival, event=world.event)
        # Booked first, saved afterwards — already in, not converted by interest.
        SavedEvent.objects.create(user=world.other_customer, event=world.event)
        audience = analytics(world)["audience"]
        assert audience["savers"] == 3
        assert audience["saved_then_booked"] == 1
        assert audience["interest_conversion_pct"] == 33.3

    def test_nobody_saved_is_a_null_rate(self, world: World):
        assert analytics(world)["audience"]["interest_conversion_pct"] is None


@pytest.mark.django_db
class TestFeedback:
    def test_the_average_is_over_every_published_review_and_all_five_buckets_show(
        self, world: World
    ):
        EventReview.objects.create(
            event=world.event,
            user=world.customer,
            booking=world.booking,
            rating=5,
            status=ReviewStatus.PUBLISHED,
        )
        EventReview.objects.create(
            event=world.event,
            user=world.other_customer,
            booking=bala_booking(world),
            rating=1,
            status=ReviewStatus.HIDDEN,
        )
        feedback = analytics(world)["feedback"]
        # The hidden review is a moderation outcome, not an opinion.
        assert feedback["count"] == 1
        assert feedback["average"] == 5.0
        assert [bucket["rating"] for bucket in feedback["breakdown"]] == [5, 4, 3, 2, 1]
        assert feedback["breakdown"][0]["count"] == 1
        assert sum(bucket["count"] for bucket in feedback["breakdown"]) == 1

    def test_no_reviews_is_a_null_average(self, world: World):
        assert analytics(world)["feedback"]["average"] is None


@pytest.mark.django_db
class TestPricingHistory:
    def test_a_never_edited_tier_has_one_period_derived_from_its_row(self, world: World):
        timeline = analytics(world)["price_timeline"]
        gold_rows = [row for row in timeline if row["tier_name"] == "Gold"]
        assert len(gold_rows) == 1
        row = gold_rows[0]
        assert row["price_minor"] == 250_000
        assert row["started_at"] == gold(world).created_at.isoformat()
        assert row["ended_at"] is None
        assert (row["seats"], row["revenue_minor"]) == (3, 750_000)
        assert row["status"] == "active"
        assert analytics(world)["untracked_sales"] == []

    def test_sales_are_split_at_a_price_change(self, world: World):
        now = timezone.now()
        backdate(TicketType, gold(world).pk, created_at=now - dt.timedelta(days=10))
        backdate(Booking, world.booking.pk, created_at=now - dt.timedelta(days=5))
        TicketPriceChange.objects.create(
            ticket_type=gold(world),
            price_minor=250_000,
            changed_at=now - dt.timedelta(days=10),
            kind=PricingChangeKind.CREATED,
        )
        TicketPriceChange.objects.create(
            ticket_type=gold(world),
            price_minor=300_000,
            changed_at=now - dt.timedelta(days=2),
            kind=PricingChangeKind.EDITED,
        )
        gold_rows = [
            row for row in analytics(world)["price_timeline"] if row["tier_name"] == "Gold"
        ]
        assert [(row["price_minor"], row["seats"], row["status"]) for row in gold_rows] == [
            (250_000, 2, "ended"),
            (300_000, 1, "active"),
        ]
        # Revenue is what the lines were BILLED, not seats x the period's price.
        assert gold_rows[1]["revenue_minor"] == 250_000

    def test_sales_before_history_began_are_reported_not_attributed(self, world: World):
        backdate(TicketType, gold(world).pk, version=3)
        payload = analytics(world)
        assert [row["tier_name"] for row in payload["price_timeline"]] == ["Silver"]
        assert payload["untracked_sales"] == [
            {
                "tier_id": str(gold(world).id),
                "tier_name": "Gold",
                "until": None,
                "seats": 3,
                "revenue_minor": 750_000,
            }
        ]

    def test_the_feature_log_counts_only_the_seats_the_feature_priced(self, world: World):
        SalePhase.objects.create(
            ticket_type=gold(world), name="Early bird", price_minor=200_000, quantity=10, position=0
        )
        BookingItem.objects.filter(booking=world.booking).update(phase_name="Early bird")
        log = analytics(world)["feature_log"]
        assert len(log) == 1
        entry = log[0]
        assert (entry["tier_name"], entry["feature"], entry["status"]) == (
            "Gold",
            "early_bird",
            "enabled",
        )
        # Never edited, so it has been on since the tier was created.
        assert entry["enabled_at"] == gold(world).created_at.isoformat()
        # Asha's 2 early-bird seats — not Bala's full-price one.
        assert entry["seats"] == 2

    def test_group_offers_are_attributed_by_the_band_that_priced_the_line(self, world: World):
        backdate(
            TicketType, gold(world).pk, group_bands=[{"min_quantity": 2, "price_minor": 200_000}]
        )
        BookingItem.objects.filter(booking=world.booking).update(group_min_quantity=2)
        offers = analytics(world)["group_offers"]
        assert offers["enabled"] is True
        assert (offers["orders"], offers["seats"], offers["revenue_minor"]) == (1, 2, 500_000)
        assert offers["bands"] == [
            {"min_quantity": 2, "orders": 1, "seats": 2, "revenue_minor": 500_000}
        ]


@pytest.mark.django_db
class TestTheContract:
    OLD_KEYS = {
        "event_id",
        "event",
        "revenue_minor",
        "refunded_minor",
        "refunded_count",
        "capacity",
        "sold",
        "checkins",
        "sell_through_pct",
        "conversion_pct",
        "abandonment_pct",
        "attendance_pct",
        "bookings_by_status",
        "scans_by_result",
        "tiers",
        "sales_timeline",
    }

    def test_every_key_the_operator_console_reads_is_still_there(self, world: World):
        """Additive, so the console — which renders this same payload — is
        untouched by the redesign."""
        payload = analytics(world)
        assert set(payload) >= self.OLD_KEYS
        assert payload["event"]["created_at"]
        assert payload["generated_at"]

    def test_a_cold_read_is_a_fixed_number_of_queries(
        self, world: World, django_assert_num_queries
    ):
        client = auth(world.owner)
        url = f"/api/v1/organizer/events/{world.event.id}/analytics"
        with django_assert_num_queries(COLD_QUERIES):
            assert client.get(url).status_code == 200
        with django_assert_num_queries(WARM_QUERIES):
            assert client.get(url).status_code == 200


@pytest.mark.django_db
class TestTheAttendeeCount:
    def test_the_list_says_how_many_there_are(self, world: World):
        client = auth(world.owner)
        url = f"/api/v1/organizer/events/{world.event.id}/attendees"
        assert client.get(url).json()["meta"]["count"] == 3
        # The FILTERED count, like every other `count` on this API.
        assert client.get(f"{url}?state=checked_in").json()["meta"]["count"] == 1


#: The analytics read, pinned. Cold: the token's user, the ownership check, the
#: original eight aggregates and the eleven the insights added. Warm: the same
#: two lookups — the payload itself comes back from the cache.
COLD_QUERIES = 21
WARM_QUERIES = 2
