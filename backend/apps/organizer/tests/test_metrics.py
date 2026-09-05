"""Earnings, the per-event funnel, and the automated insights.

Three endpoints, and the same two questions every other test file in this
module asks — plus one that is specific to these three:

1. **Does it leak?** Ownership scoping IS the security model here (see
   `repositories.py`), so every endpoint is asserted against a fixture that
   contains a second organizer with their own events, bookings and payments.
   The insights fixture goes further: the rival's numbers are deliberately
   BIGGER than the owner's, so a leak changes the recommendation rather than
   nudging a total, and fails loudly.

2. **Is a rate `null` rather than 0 when its denominator is zero?** "0%
   conversion" on an event nobody has opened and "no attendees yet" are both
   false statements dressed as neutral ones.

3. **Does the funnel stay a fixed number of queries as events are added?** It
   merges four grouped aggregates onto a page, and the failure mode of getting
   that wrong is invisible until an organizer has enough events to notice.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.booking.models import Booking, BookingStatus, Ticket, TicketStatus
from apps.events.models import Event, EventCategory, EventStatus
from apps.organizations.models import Organization
from apps.organizer import selectors
from apps.payments.models import Payment, PaymentStatus

from .conftest import World

IST = selectors.PLATFORM_TZ

#: Fixed calendar dates with known ISO weekdays, so the weekday assertions read
#: as arithmetic rather than as "whatever today happens to be". Written in IST
#: because that is the timezone the insight buckets are computed in.
SATURDAY_EVENING = dt.datetime(2026, 3, 7, 19, 0, tzinfo=IST)  # ISO weekday 6
TUESDAY_MORNING = dt.datetime(2026, 3, 10, 11, 0, tzinfo=IST)  # ISO weekday 2
MONDAY_EVENING = dt.datetime(2026, 3, 2, 20, 0, tzinfo=IST)  # ISO weekday 1
WEDNESDAY_EVENING = dt.datetime(2026, 3, 11, 18, 0, tzinfo=IST)  # ISO weekday 3
#: 00:30 IST on the same Saturday is 19:00 UTC on the FRIDAY. Used by the
#: timezone test: bucketed in UTC this event is a Friday, and the answer an
#: organizer scheduling a night out needs is the local one.
SATURDAY_AFTER_MIDNIGHT = dt.datetime(2026, 3, 7, 0, 30, tzinfo=IST)


def authed(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def sale(
    user: User, event: Event, amount_minor: int, *, when: dt.datetime | None = None
) -> Booking:
    """A completed purchase: a paid booking AND the captured payment beside it.

    Both rows, because these endpoints read both — the funnel counts BOOKINGS
    and the revenue rankings sum PAYMENTS. A fixture that wrote only one of
    them would let a broken join pass on the other half.

    `when` backdates both. `created_at` is `auto_now_add`, so the ORM discards
    an explicit value on create and a queryset `.update()` after the insert is
    the only way to place a row in a previous month.
    """
    booking = Booking.objects.create(
        user=user,
        event=event,
        status=BookingStatus.PAID,
        hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
        total_amount_minor=amount_minor,
        platform_fee_minor=0,
    )
    payment = Payment.objects.create(
        booking=booking,
        rzp_order_id=f"order_{uuid.uuid4().hex[:12]}",
        rzp_payment_id=f"pay_{uuid.uuid4().hex[:12]}",
        amount_minor=amount_minor,
        status=PaymentStatus.PAID,
    )
    if when is not None:
        Booking.objects.filter(id=booking.id).update(created_at=when)
        Payment.objects.filter(id=payment.id).update(created_at=when)
    return booking


def event_at(
    organization: Organization,
    starts_at: dt.datetime,
    *,
    title: str,
    city: str,
    category: str,
) -> Event:
    return Event.objects.create(
        organization=organization,
        title=title,
        venue="A venue",
        city=city,
        category=category,
        starts_at=starts_at,
        status=EventStatus.LIVE,
    )


# ---------------------------------------------------------------- earnings


@pytest.mark.django_db
class TestEarningsAccess:
    def test_anonymous_is_refused(self) -> None:
        assert APIClient().get("/api/v1/organizer/earnings").status_code == 401

    def test_the_response_is_private_and_uncached(self, world: World) -> None:
        """Lifetime revenue must never sit in a shared or CDN cache."""
        response = authed(world.owner).get("/api/v1/organizer/earnings")
        assert response.status_code == 200
        assert response["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
class TestEarnings:
    def test_lifetime_totals_are_this_organizers_only(self, world: World) -> None:
        payload = authed(world.owner).get("/api/v1/organizer/earnings").json()
        # 500_000 + 250_000 + 250_000. The rival's 999_000 must not be here.
        assert payload["lifetime_revenue_minor"] == 1_000_000
        assert payload["lifetime_tickets"] == 4
        assert payload["lifetime_attendees"] == 2

    def test_the_rival_sees_only_their_own(self, world: World) -> None:
        payload = authed(world.rival).get("/api/v1/organizer/earnings").json()
        assert payload["lifetime_revenue_minor"] == 999_000
        assert payload["lifetime_attendees"] == 1

    def test_average_is_per_attendee_not_per_ticket(self, world: World) -> None:
        """The distinction is the whole point of the field: 1,000,000 over four
        TICKETS is 250,000, over two distinct PAYING PEOPLE it is 500,000. Both
        are real numbers; only the second answers "what is a customer worth"."""
        payload = authed(world.owner).get("/api/v1/organizer/earnings").json()
        assert payload["lifetime_tickets"] == 4
        assert payload["avg_revenue_per_attendee_minor"] == 500_000

    def test_a_repeat_buyer_counts_once(self, world: World) -> None:
        """Asha bought twice. Two bookings, one attendee — otherwise the
        average would fall every time a loyal customer came back."""
        sale(world.customer, world.event, 200_000)
        payload = authed(world.owner).get("/api/v1/organizer/earnings").json()
        assert payload["lifetime_attendees"] == 2
        assert payload["lifetime_revenue_minor"] == 1_200_000
        assert payload["avg_revenue_per_attendee_minor"] == 600_000

    def test_voided_tickets_are_not_counted_as_sold(self, world: World) -> None:
        """A refund voids the booking's tickets. Counting them would report
        lifetime sales that were handed back."""
        ticket = Ticket.objects.filter(booking=world.booking).exclude(status=TicketStatus.USED)[0]
        ticket.status = TicketStatus.VOID
        ticket.save(update_fields=["status"])

        payload = authed(world.owner).get("/api/v1/organizer/earnings").json()
        assert payload["lifetime_tickets"] == 3

    def test_an_organizer_with_no_sales_gets_null_not_zero(self, db) -> None:
        """ "No attendees yet" and "attendees who paid nothing" are different
        facts. A zero average would report the second one."""
        nobody = User.objects.create_user(email="nosales@example.com", password="newpass12345")

        payload = authed(nobody).get("/api/v1/organizer/earnings").json()

        assert payload["lifetime_revenue_minor"] == 0
        assert payload["lifetime_attendees"] == 0
        assert payload["avg_revenue_per_attendee_minor"] is None
        assert payload["month_revenue_minor"] == 0
        assert payload["month_change_pct"] is None

    def test_month_to_date_is_compared_against_the_same_span_of_last_month(
        self, world: World
    ) -> None:
        """The fixture's 1,000,000 is all from today. Half that in the
        comparable window of last month is +100%, and it is only +100% because
        the baseline is a PARTIAL month — measured against a whole one it would
        depend on what day the suite happened to run."""
        _, _, previous_start, _ = selectors.month_to_date_bounds()
        sale(world.customer, world.event, 500_000, when=previous_start)

        payload = authed(world.owner).get("/api/v1/organizer/earnings").json()

        assert payload["month_revenue_minor"] == 1_000_000
        assert payload["lifetime_revenue_minor"] == 1_500_000  # last month included
        assert payload["month_change_pct"] == 100.0

    def test_last_months_money_is_outside_this_months_total(self, world: World) -> None:
        _, _, previous_start, _ = selectors.month_to_date_bounds()
        sale(world.customer, world.event, 700_000, when=previous_start)

        payload = authed(world.owner).get("/api/v1/organizer/earnings").json()

        assert payload["month_revenue_minor"] == 1_000_000

    def test_comparison_days_says_how_much_of_the_month_both_sides_cover(
        self, world: World
    ) -> None:
        payload = authed(world.owner).get("/api/v1/organizer/earnings").json()
        assert payload["comparison_days"] == timezone.now().astimezone(IST).day

    def test_it_is_cached_per_owner_not_globally(self, world: World) -> None:
        """The worst bug a cache can cause on this surface: one organizer's
        lifetime revenue served to another."""
        owner = authed(world.owner).get("/api/v1/organizer/earnings").json()
        rival = authed(world.rival).get("/api/v1/organizer/earnings").json()
        assert owner["lifetime_revenue_minor"] == 1_000_000
        assert rival["lifetime_revenue_minor"] == 999_000

    def test_a_warm_read_costs_no_queries(self, world: World, django_assert_num_queries) -> None:
        client = authed(world.owner)
        client.get("/api/v1/organizer/earnings")  # warm it
        with django_assert_num_queries(0):
            client.get("/api/v1/organizer/earnings")


@pytest.mark.django_db
class TestMonthBounds:
    """`month_to_date_bounds` with a fixed clock, because its failure cases are
    calendar edges nobody hits by running the suite on an ordinary Tuesday."""

    def test_the_baseline_covers_the_same_elapsed_span(self) -> None:
        now = dt.datetime(2026, 6, 12, 15, 0, tzinfo=IST)
        month_start, month_end, previous_start, previous_end = selectors.month_to_date_bounds(now)

        assert month_start.astimezone(IST) == dt.datetime(2026, 6, 1, tzinfo=IST)
        assert month_end == now
        assert previous_start.astimezone(IST) == dt.datetime(2026, 5, 1, tzinfo=IST)
        # Eleven days and fifteen hours into the month, on both sides.
        assert previous_end - previous_start == month_end - month_start

    def test_the_baseline_never_spills_into_this_month(self) -> None:
        """31 March minus a 30-day elapsed span runs past the end of February.
        Left unclamped the baseline would include the first days of March, and
        March would be partly measured against itself."""
        now = dt.datetime(2026, 3, 31, 23, 0, tzinfo=IST)
        month_start, _, previous_start, previous_end = selectors.month_to_date_bounds(now)

        assert previous_start.astimezone(IST) == dt.datetime(2026, 2, 1, tzinfo=IST)
        assert previous_end == month_start
        assert previous_end - previous_start < now - month_start

    def test_january_looks_back_into_december(self) -> None:
        now = dt.datetime(2026, 1, 4, 9, 0, tzinfo=IST)
        _, _, previous_start, _ = selectors.month_to_date_bounds(now)
        assert previous_start.astimezone(IST) == dt.datetime(2025, 12, 1, tzinfo=IST)

    def test_the_month_starts_at_indian_midnight_not_utc(self) -> None:
        """1 June 00:00 IST is 31 May 18:30 UTC. Anchoring the month in UTC
        would push five and a half hours of India's first-of-the-month revenue
        into the previous month."""
        now = dt.datetime(2026, 6, 12, 15, 0, tzinfo=IST)
        month_start, _, _, _ = selectors.month_to_date_bounds(now)
        assert month_start.astimezone(dt.timezone.utc) == dt.datetime(
            2026, 5, 31, 18, 30, tzinfo=dt.timezone.utc
        )


# ------------------------------------------------------------------ funnel


def funnel_rows(user: User) -> dict[str, dict]:
    body = authed(user).get("/api/v1/organizer/funnel").json()
    return {row["title"]: row for row in body["data"]}


@pytest.mark.django_db
class TestFunnelAccess:
    def test_anonymous_is_refused(self) -> None:
        assert APIClient().get("/api/v1/organizer/funnel").status_code == 401

    def test_the_response_is_private_and_uncached(self, world: World) -> None:
        response = authed(world.owner).get("/api/v1/organizer/funnel")
        assert response.status_code == 200
        assert response["Cache-Control"] == "private, no-store"

    def test_an_organizer_with_no_events_gets_an_empty_list(self, db) -> None:
        nobody = User.objects.create_user(email="noevents@example.com", password="newpass12345")
        body = authed(nobody).get("/api/v1/organizer/funnel").json()
        assert body["data"] == []


@pytest.mark.django_db
class TestFunnel:
    def test_lists_only_owned_events(self, world: World) -> None:
        assert set(funnel_rows(world.owner)) == {"Summer Sessions", "Winter Nights"}
        assert set(funnel_rows(world.rival)) == {"Rival Fest"}

    def test_started_counts_the_lapsed_hold_that_paid_counts_does_not(self, world: World) -> None:
        """The abandoned hold IS the abandonment this measures. Excluding it
        would make conversion the ratio of paid to paid — 100%, forever."""
        summer = funnel_rows(world.owner)["Summer Sessions"]
        assert summer["bookings_started"] == 3  # 2 paid + 1 expired hold
        assert summer["bookings_paid"] == 2
        assert summer["conversion_pct"] == 66.7

    def test_quota_and_revenue_come_off_the_real_rows(self, world: World) -> None:
        summer = funnel_rows(world.owner)["Summer Sessions"]
        assert summer["capacity"] == 300  # 100 Gold + 200 Silver
        assert summer["tickets_sold"] == 6  # straight off the tier rows
        assert summer["quota_fill_pct"] == 2.0
        assert summer["revenue_minor"] == 750_000

    def test_repeat_share_is_of_the_people_who_paid_for_this_event(self, world: World) -> None:
        """Two people paid for Summer Sessions; one of them (Asha) also paid for
        Winter Nights. Winter Nights' only buyer is that same repeat customer."""
        rows = funnel_rows(world.owner)
        assert rows["Summer Sessions"]["paying_attendees"] == 2
        assert rows["Summer Sessions"]["repeat_attendee_pct"] == 50.0
        assert rows["Winter Nights"]["paying_attendees"] == 1
        assert rows["Winter Nights"]["repeat_attendee_pct"] == 100.0

    def test_a_purchase_from_another_organizer_is_not_a_repeat_attendee(self, world: World) -> None:
        """ "Also bought" means also bought FROM ME. Counting a customer's
        purchases elsewhere would flatter this number with loyalty the
        organizer did not earn — and the rival's catalogue is not theirs to
        read in the first place."""
        before = funnel_rows(world.owner)["Summer Sessions"]["repeat_attendee_pct"]
        sale(world.other_customer, world.rival_event, 400_000)

        after = funnel_rows(world.owner)["Summer Sessions"]["repeat_attendee_pct"]

        assert before == 50.0
        assert after == 50.0

    def test_rates_are_null_not_zero_when_nothing_has_happened(self, world: World) -> None:
        """An event with no tiers loaded and nobody through the door. 0% quota
        fill would report a sales figure where the truth is a missing tier."""
        event_at(
            world.organization,
            timezone.now() + dt.timedelta(days=90),
            title="Nothing Yet",
            city="Chennai",
            category=EventCategory.WORKSHOPS,
        )

        row = funnel_rows(world.owner)["Nothing Yet"]

        assert row["bookings_started"] == 0
        assert row["bookings_paid"] == 0
        assert row["conversion_pct"] is None
        assert row["capacity"] == 0
        assert row["quota_fill_pct"] is None
        assert row["paying_attendees"] == 0
        assert row["repeat_attendee_pct"] is None
        assert row["revenue_minor"] == 0

    def test_a_page_costs_a_fixed_number_of_queries(
        self, world: World, django_assert_num_queries
    ) -> None:
        """The page of events plus FOUR grouped reads — bookings started/paid,
        capacity/sold, revenue, and distinct payers with the repeat subquery.

        The second half is the one that matters: adding events and sales must
        not move this number. If it ever does, the merge has become an N+1 and
        an organizer with fifty events pays fifty times over.

        (No auth query: `force_authenticate` attaches the user directly, so
        unlike a real JWT request there is no user lookup to pay for.)
        """
        client = authed(world.owner)
        with django_assert_num_queries(5):
            client.get("/api/v1/organizer/funnel")

        third = event_at(
            world.organization,
            timezone.now() + dt.timedelta(days=20),
            title="Third Event",
            city="Delhi",
            category=EventCategory.COMEDY,
        )
        sale(world.customer, third, 100_000)
        sale(world.other_customer, third, 100_000)

        with django_assert_num_queries(5):
            response = client.get("/api/v1/organizer/funnel")
        assert len(response.json()["data"]) == 3


# ---------------------------------------------------------------- insights


@dataclass
class InsightWorld:
    """An organizer whose history is big enough to advise on, and a rival whose
    history is BIGGER — so a leak changes the recommendation rather than
    nudging a total."""

    owner: User
    rival: User
    organization: Organization
    saturday_event: Event
    tuesday_event: Event


@pytest.fixture
def insights(db) -> InsightWorld:
    owner = User.objects.create_user(email="insight-owner@example.com", password="ownerpass12345")
    rival = User.objects.create_user(email="insight-rival@example.com", password="rivalpass12345")
    organization = Organization.objects.create(owner=owner, name="Insight Events")
    rival_org = Organization.objects.create(owner=rival, name="Rival Insight Events")

    saturday_event = event_at(
        organization,
        SATURDAY_EVENING,
        title="Saturday Night",
        city="Mumbai",
        category=EventCategory.COMEDY,
    )
    tuesday_event = event_at(
        organization,
        TUESDAY_MORNING,
        title="Tuesday Matinee",
        city="Pune",
        category=EventCategory.CONCERTS,
    )
    buyers = [
        User.objects.create_user(email=f"buyer{index}@example.com", password="buyerpass12345")
        for index in range(5)
    ]
    for index in range(15):
        sale(buyers[index % len(buyers)], saturday_event, 100_000)
    for index in range(8):
        sale(buyers[index % len(buyers)], tuesday_event, 50_000)

    # The rival's Monday event outsells everything the owner has. If any
    # ranking forgets its owner scope, Monday/Delhi/Sports wins and every
    # assertion below fails at once.
    #
    # TWO rival events, because one would be a single bucket and `_best` would
    # correctly refuse to rank it — leaving the rival with no insights at all
    # and the scoping assertions with nothing to compare against.
    rival_event = event_at(
        rival_org,
        MONDAY_EVENING,
        title="Rival Monday",
        city="Delhi",
        category=EventCategory.SPORTS,
    )
    for _ in range(21):
        sale(rival, rival_event, 900_000)
    rival_second = event_at(
        rival_org,
        WEDNESDAY_EVENING,
        title="Rival Wednesday",
        city="Kolkata",
        category=EventCategory.NIGHTLIFE,
    )
    for _ in range(5):
        sale(rival, rival_second, 100_000)

    return InsightWorld(
        owner=owner,
        rival=rival,
        organization=organization,
        saturday_event=saturday_event,
        tuesday_event=tuesday_event,
    )


def insight_by_kind(user: User) -> dict[str, dict]:
    body = authed(user).get("/api/v1/organizer/insights").json()
    return {row["kind"]: row for row in body["data"]}


@pytest.mark.django_db
class TestInsightsAccess:
    def test_anonymous_is_refused(self) -> None:
        assert APIClient().get("/api/v1/organizer/insights").status_code == 401

    def test_the_response_is_private_and_uncached(self, insights: InsightWorld) -> None:
        response = authed(insights.owner).get("/api/v1/organizer/insights")
        assert response.status_code == 200
        assert response["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
class TestInsights:
    def test_the_best_weekday_and_hour_come_from_the_event_not_the_booking(
        self, insights: InsightWorld
    ) -> None:
        """Every booking in the fixture was created today, at whatever hour the
        suite runs. The recommendation is Saturday at 19:00 because that is
        when the EVENT starts — the question is when to schedule the next one,
        not when the phone comes out."""
        rows = insight_by_kind(insights.owner)

        assert rows["best_weekday"]["key"] == "6"
        assert rows["best_weekday"]["label"] == "Saturday"
        assert rows["best_weekday"]["metric"] == "paid_bookings"
        assert rows["best_weekday"]["value"] == 15
        assert rows["best_hour"]["key"] == "19"
        assert rows["best_hour"]["label"] == "19:00"
        assert rows["best_hour"]["value"] == 15

    def test_every_insight_carries_the_sample_it_was_computed_from(
        self, insights: InsightWorld
    ) -> None:
        """23 paid bookings, and 23 captured payments behind the money
        rankings. A recommendation without its sample size is indistinguishable
        from a guess."""
        rows = insight_by_kind(insights.owner)
        assert {row["sample_size"] for row in rows.values()} == {23}

    def test_the_best_category_and_city_are_ranked_by_revenue(self, insights: InsightWorld) -> None:
        rows = insight_by_kind(insights.owner)

        assert rows["best_category"]["key"] == "comedy"
        # The display name comes off the model's own choices, so the dashboard
        # cannot call `food-drink` something the browse page does not.
        assert rows["best_category"]["label"] == "Comedy"
        assert rows["best_category"]["metric"] == "revenue_minor"
        assert rows["best_category"]["value"] == 1_500_000
        assert rows["best_city"]["key"] == "Mumbai"
        assert rows["best_city"]["value"] == 1_500_000

    def test_a_rivals_bigger_history_never_reaches_this_organizer(
        self, insights: InsightWorld
    ) -> None:
        """The rival sells more, on a Monday, in Delhi, in a different
        category. Every one of those would win if a scope were missing."""
        owner_rows = insight_by_kind(insights.owner)
        rival_rows = insight_by_kind(insights.rival)

        assert owner_rows["best_weekday"]["label"] == "Saturday"
        assert owner_rows["best_city"]["key"] == "Mumbai"
        assert rival_rows["best_weekday"]["label"] == "Monday"
        assert rival_rows["best_city"]["key"] == "Delhi"

    def test_the_weekday_is_the_local_one_not_utc(self, insights: InsightWorld) -> None:
        """A show starting 00:30 IST on Saturday is 19:00 UTC on FRIDAY.
        Bucketed in the storage timezone the advice would be "run it on a
        Friday, at seven" — a day and five and a half hours wrong, for every
        late-night event on the platform."""
        after_midnight = event_at(
            insights.organization,
            SATURDAY_AFTER_MIDNIGHT,
            title="After Midnight",
            city="Mumbai",
            category=EventCategory.NIGHTLIFE,
        )
        buyer = User.objects.create_user(email="nightowl@example.com", password="buyerpass12345")
        for _ in range(30):
            sale(buyer, after_midnight, 10_000)

        rows = insight_by_kind(insights.owner)

        # 30 late-night bookings + 15 evening ones, both on a Saturday.
        assert rows["best_weekday"]["key"] == "6"
        assert rows["best_weekday"]["value"] == 45
        # And the hour is the local 00, not UTC's 19.
        assert rows["best_hour"]["key"] == "0"
        assert rows["best_hour"]["label"] == "00:00"
        assert rows["best_hour"]["value"] == 30

    def test_too_little_data_returns_nothing_rather_than_a_guess(self, db) -> None:
        """Four bookings cannot tell you which weekday to run on. An empty list
        is the honest answer; a confident recommendation drawn from four rows
        is the thing this endpoint exists not to do."""
        owner = User.objects.create_user(email="thin@example.com", password="ownerpass12345")
        organization = Organization.objects.create(owner=owner, name="Thin Events")
        buyer = User.objects.create_user(email="thin-buyer@example.com", password="buyerpass12345")
        saturday = event_at(
            organization,
            SATURDAY_EVENING,
            title="Small Saturday",
            city="Mumbai",
            category=EventCategory.COMEDY,
        )
        tuesday = event_at(
            organization,
            TUESDAY_MORNING,
            title="Small Tuesday",
            city="Pune",
            category=EventCategory.CONCERTS,
        )
        for _ in range(3):
            sale(buyer, saturday, 100_000)
        sale(buyer, tuesday, 50_000)

        assert authed(owner).get("/api/v1/organizer/insights").json()["data"] == []

    def test_one_bucket_is_a_description_of_the_past_not_a_recommendation(self, db) -> None:
        """Thirty bookings, all on Saturdays at 19:00, all comedy, all in
        Mumbai. "Your best weekday is Saturday" when Saturday is the only day
        you have ever run tells an organizer nothing — and it is the advice
        they would act on by never trying anything else."""
        owner = User.objects.create_user(email="onenote@example.com", password="ownerpass12345")
        organization = Organization.objects.create(owner=owner, name="One Note Events")
        buyer = User.objects.create_user(
            email="onenote-buyer@example.com", password="buyerpass1234"
        )
        saturday = event_at(
            organization,
            SATURDAY_EVENING,
            title="Only Ever Saturdays",
            city="Mumbai",
            category=EventCategory.COMEDY,
        )
        for _ in range(30):
            sale(buyer, saturday, 100_000)

        assert authed(owner).get("/api/v1/organizer/insights").json()["data"] == []

    def test_an_uncategorised_event_is_left_out_rather_than_ranked_as_blank(
        self, insights: InsightWorld
    ) -> None:
        """A blank category means "not filled in yet", so a ranking that
        included it would recommend running more events of no category — a
        report on unfinished drafts wearing the clothes of advice."""
        uncategorised = event_at(
            insights.organization,
            SATURDAY_EVENING,
            title="Uncategorised",
            city="Mumbai",
            category="",
        )
        buyer = User.objects.create_user(email="blankcat@example.com", password="buyerpass12345")
        for _ in range(40):
            sale(buyer, uncategorised, 500_000)

        rows = insight_by_kind(insights.owner)

        # The uncategorised event outsells everything, and still does not win.
        assert rows["best_category"]["key"] == "comedy"
        assert rows["best_category"]["value"] == 1_500_000
        # Its money is real, though, so the city ranking (a column that is
        # filled in) does count it.
        assert rows["best_city"]["key"] == "Mumbai"

    def test_an_organizer_with_nothing_gets_an_empty_list(self, db) -> None:
        nobody = User.objects.create_user(email="noinsight@example.com", password="newpass12345")
        assert authed(nobody).get("/api/v1/organizer/insights").json()["data"] == []

    def test_it_is_cached_per_owner_not_globally(self, insights: InsightWorld) -> None:
        owner = insight_by_kind(insights.owner)
        rival = insight_by_kind(insights.rival)
        assert owner["best_city"]["key"] == "Mumbai"
        assert rival["best_city"]["key"] == "Delhi"
