"""The operations surfaces: refunds, the unified feed, and date ranges.

Every test here asks one of two questions, because they are the two ways these
endpoints can be wrong:

1. **Does it leak?** Ownership scoping IS the security model in this module
   (see `repositories.py`), so a rival's refund, a rival's payout and a rival's
   admission each get their own "must not appear" test.
2. **Does it tell the truth about time?** The feed merges five sources and
   re-sorts them; the date filters exist because a cursor-paginated list cannot
   be windowed correctly on the client.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.events.models import EventStatus
from apps.organizer import selectors
from apps.organizer.repositories import OrganizerRepository
from apps.settlements.models import PayoutAttempt, PayoutAttemptStatus, Settlement

from .conftest import refund


def authed(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def stamp(moment: dt.datetime) -> str:
    """UTC with a `Z` suffix — exactly what the browser's `toISOString()`
    emits, and deliberately NOT `isoformat()`'s `+00:00`: an unencoded `+` in a
    query string means SPACE, so a raw `isoformat()` here would test a value no
    real client sends and would pass only because of the API's tolerance for
    that slip."""
    return moment.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# --------------------------------------------------------------------- refunds


@pytest.mark.django_db
class TestRefunds:
    def test_lists_this_organizers_refunds(self, world):
        refund(world.booking, 120_000)

        body = authed(world.owner).get("/api/v1/organizer/refunds").json()

        assert len(body["data"]) == 1
        row = body["data"][0]
        assert row["amount_minor"] == 120_000
        assert row["event_title"] == world.event.title

    def test_a_rivals_refund_never_appears(self, world):
        rival_booking = world.rival_event.bookings.first()
        assert rival_booking is not None
        refund(rival_booking, 500_000)
        refund(world.booking, 10_000)

        body = authed(world.owner).get("/api/v1/organizer/refunds").json()

        assert [row["amount_minor"] for row in body["data"]] == [10_000]

    def test_partial_is_computed_from_the_pair_not_stored(self, world):
        """A 5,000 refund is partial against a 500,000 payment and full against
        a 5,000 one. Storing the flag would let it disagree with the amounts."""
        refund(world.booking, world.booking.total_amount_minor)

        row = authed(world.owner).get("/api/v1/organizer/refunds").json()["data"][0]

        assert row["is_partial"] is False

    def test_a_smaller_amount_is_reported_partial(self, world):
        refund(world.booking, world.booking.total_amount_minor - 1)

        row = authed(world.owner).get("/api/v1/organizer/refunds").json()["data"][0]

        assert row["is_partial"] is True

    def test_filters_to_one_event(self, world):
        refund(world.booking, 10_000)

        body = (
            authed(world.owner)
            .get(f"/api/v1/organizer/refunds?event_id={world.second_event.id}")
            .json()
        )

        assert body["data"] == []

    def test_a_malformed_event_filter_is_ignored_rather_than_a_500(self, world):
        refund(world.booking, 10_000)

        response = authed(world.owner).get("/api/v1/organizer/refunds?event_id=not-a-uuid")

        # Already scoped to the caller, so ignoring the filter can only widen
        # to "all of mine" — never to somebody else's.
        assert response.status_code == 200
        assert len(response.json()["data"]) == 1

    def test_the_response_is_never_cacheable(self, world):
        response = authed(world.owner).get("/api/v1/organizer/refunds")
        assert response["Cache-Control"] == "private, no-store"

    def test_anonymous_is_refused(self, world):
        assert APIClient().get("/api/v1/organizer/refunds").status_code == 401


# ---------------------------------------------------------------- unified feed


@pytest.mark.django_db
class TestUnifiedFeed:
    def test_merges_every_source_into_one_ordered_timeline(self, world):
        refund(world.booking, 50_000)
        settlement = Settlement.objects.create(event=world.event, gross=100, net=90)
        PayoutAttempt.objects.create(
            settlement=settlement, amount_minor=90, status=PayoutAttemptStatus.SUCCESS
        )

        body = authed(world.owner).get("/api/v1/organizer/feed?limit=40").json()
        kinds = {row["kind"] for row in body["data"]}

        # The fixture has bookings and one real admission; the two above add
        # the rest.
        assert {"booking", "refund", "checkin", "payout"} <= kinds

    def test_entries_are_newest_first_across_sources(self, world):
        refund(world.booking, 50_000)

        rows = authed(world.owner).get("/api/v1/organizer/feed?limit=40").json()["data"]
        stamps = [row["at"] for row in rows]

        assert stamps == sorted(stamps, reverse=True)

    def test_a_failed_payout_is_critical_not_just_another_row(self, world):
        """The whole reason `severity` is on the wire: a feed where a failed
        payout renders like a ticket sale buries the one entry needing a
        human."""
        settlement = Settlement.objects.create(event=world.event, gross=100, net=90)
        PayoutAttempt.objects.create(
            settlement=settlement,
            amount_minor=90,
            status=PayoutAttemptStatus.FAILED,
            error="Vendor rejected the transfer",
        )

        rows = authed(world.owner).get("/api/v1/organizer/feed?limit=40").json()["data"]
        payout = next(row for row in rows if row["kind"] == "payout")

        assert payout["severity"] == "critical"
        assert payout["detail"] == "Vendor rejected the transfer"

    def test_a_rejection_carries_the_operators_note(self, world):
        world.second_event.status = EventStatus.REJECTED
        world.second_event.moderated_at = timezone.now()
        world.second_event.moderation_note = "The poster is a stock photo."
        world.second_event.save(update_fields=["status", "moderated_at", "moderation_note"])

        rows = authed(world.owner).get("/api/v1/organizer/feed?limit=40").json()["data"]
        publishing = next(row for row in rows if row["kind"] == "publishing")

        assert publishing["severity"] == "critical"
        assert publishing["detail"] == "The poster is a stock photo."

    def test_a_rivals_activity_never_appears(self, world):
        rival_booking = world.rival_event.bookings.first()
        assert rival_booking is not None
        refund(rival_booking, 500_000)
        rival_settlement = Settlement.objects.create(event=world.rival_event, gross=1, net=1)
        PayoutAttempt.objects.create(
            settlement=rival_settlement, amount_minor=1, status=PayoutAttemptStatus.SUCCESS
        )

        rows = authed(world.owner).get("/api/v1/organizer/feed?limit=50").json()["data"]

        assert all(row["event_title"] != world.rival_event.title for row in rows)

    def test_the_limit_is_honoured_after_merging(self, world):
        rows = authed(world.owner).get("/api/v1/organizer/feed?limit=2").json()["data"]
        assert len(rows) == 2

    def test_the_limit_is_capped(self, world):
        """A caller asking for a million rows gets the cap, not a table scan."""
        result = selectors.get_unified_activity(world.owner.id, 10_000)
        assert len(result) <= selectors.MAX_ACTIVITY_ITEMS

    def test_ids_are_unique_across_sources(self, world):
        """A booking and a scan can share a primary key value; the feed
        namespaces each id by its source so React keys never collide."""
        refund(world.booking, 50_000)

        rows = authed(world.owner).get("/api/v1/organizer/feed?limit=50").json()["data"]
        ids = [row["id"] for row in rows]

        assert len(ids) == len(set(ids))

    def test_a_denied_scan_is_not_news(self, world):
        """Denials are an audit trail. A feed that surfaces every mis-scan at a
        busy gate is a feed nobody reads."""
        from apps.checkin.models import ScanLog, ScanResult

        ticket = world.booking.tickets.first()
        assert ticket is not None
        ScanLog.objects.create(
            ticket=ticket,
            event=world.event,
            scanned_by=world.owner,
            gate="Gate B",
            result=ScanResult.DENIED_ALREADY_USED,
        )

        rows = authed(world.owner).get("/api/v1/organizer/feed?limit=50").json()["data"]

        assert all(row["detail"] != "Gate B" for row in rows if row["kind"] == "checkin")


# ----------------------------------------------------------------- date ranges


@pytest.mark.django_db
class TestDateRanges:
    def test_events_can_be_windowed_by_start_date(self, world):
        """`event` starts in 10 days, `second_event` in 40."""
        now = timezone.now()
        client = authed(world.owner)

        body = client.get(
            f"/api/v1/organizer/event-rows?starts_before={stamp(now + dt.timedelta(days=20))}"
        ).json()

        assert [row["title"] for row in body["data"]] == [world.event.title]

    def test_the_far_side_of_the_window_is_exclusive(self, world):
        """`starts_before` is `<`, so an event starting exactly on the boundary
        is out — which is what makes two adjacent windows partition cleanly
        instead of double-counting the edge."""
        body = (
            authed(world.owner)
            .get(f"/api/v1/organizer/event-rows?starts_before={stamp(world.event.starts_at)}")
            .json()
        )

        assert all(row["title"] != world.event.title for row in body["data"])

    def test_bookings_can_be_windowed_by_creation(self, world):
        now = timezone.now()

        body = (
            authed(world.owner)
            .get(f"/api/v1/organizer/bookings?created_after={stamp(now + dt.timedelta(days=1))}")
            .json()
        )

        assert body["data"] == []

    def test_a_malformed_date_is_an_absent_filter_not_a_400(self, world):
        """A dashboard that 400s because a date picker emitted something
        unexpected is worse than one showing more rows than asked for — and the
        list is already scoped to the caller, so it can only widen to
        'all of mine'."""
        response = authed(world.owner).get("/api/v1/organizer/bookings?created_after=yesterday")

        assert response.status_code == 200
        assert len(response.json()["data"]) > 0

    def test_the_window_still_cannot_reach_another_organizer(self, world):
        """The filter narrows; it never widens past the ownership scope."""
        body = (
            authed(world.owner)
            .get("/api/v1/organizer/event-rows?starts_after=2000-01-01T00:00:00Z")
            .json()
        )

        assert all(row["title"] != world.rival_event.title for row in body["data"])


@pytest.mark.django_db
def test_the_refund_page_costs_a_fixed_number_of_queries(world, django_assert_num_queries):
    """`select_related` down to the event, so a page of refunds is one query
    regardless of length — the N+1 this table would otherwise have is a join
    per row across payment -> booking -> event."""
    for _ in range(5):
        refund(world.booking, 1_000)

    repository = OrganizerRepository()
    with django_assert_num_queries(1):
        rows = list(repository.refunds(world.owner.id)[:5])
        selectors.decorate_refunds(rows)
