"""Date ranges and name search across the operator console's lists.

Every list here is CURSOR-paginated, which is the whole reason these filters
have to be server-side. Narrowing a window in the browser means paging through
the entire platform to find the rows inside it, and it is simply WRONG wherever
a page boundary falls in the middle of the range — the operator sees "no
results for that week" when the week is on page four.

Two rules the tests pin, both inherited from the organizer lists rather than
invented here:

- **A malformed date is treated as ABSENT, not as a 400.** These params come
  from date pickers and from links people hand-edit. Every list is already
  scoped to staff, so the worst a bad value can do is widen the result — and a
  console that 400s because a picker emitted something odd is worse.
- **A reversed range is SWAPPED.** Somebody who picked the dates in the other
  order meant the span between them.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.booking.models import Booking, BookingStatus
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization
from apps.payments.models import Payment, PaymentStatus


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def iso(at: dt.datetime) -> str:
    return at.isoformat()


@pytest.fixture
def world(db):
    staff = User.objects.create_user(
        email="ops@filters.test", password="opsadmin12345", is_staff=True
    )
    owner = User.objects.create_user(email="promoter@filters.test", password="owner12345")
    buyer = User.objects.create_user(email="buyer@filters.test", password="buyer12345")
    org = Organization.objects.create(owner=owner, name="Aurora Live")
    other_org = Organization.objects.create(owner=owner, name="Basement Sessions")

    now = timezone.now()

    def make_event(title: str, *, days: int, organization=org, status=EventStatus.PENDING_REVIEW):
        event = Event.objects.create(
            organization=organization,
            title=title,
            venue="The Cellar",
            city="Bengaluru",
            starts_at=now + dt.timedelta(days=days),
            status=status,
        )
        Event.objects.filter(pk=event.id).update(submitted_at=now)
        return event

    soon = make_event("Jazz At Sunset", days=3)
    later = make_event("Winter Comedy Gala", days=40)
    elsewhere = make_event("Basement Techno", days=5, organization=other_org)

    def make_booking(days_ago: int) -> Booking:
        booking = Booking.objects.create(
            user=buyer,
            event=soon,
            status=BookingStatus.PAID,
            hold_expires_at=now,
            total_amount_minor=150_000,
            platform_fee_minor=10,
            payment_ref=f"pay_{uuid.uuid4().hex[:8]}",
        )
        stamped = now - dt.timedelta(days=days_ago)
        Booking.objects.filter(pk=booking.id).update(created_at=stamped)
        Payment.objects.create(
            booking=booking,
            rzp_order_id=f"order_{uuid.uuid4().hex[:10]}",
            rzp_payment_id=booking.payment_ref,
            amount_minor=150_000,
            status=PaymentStatus.PAID,
        )
        Payment.objects.filter(booking=booking).update(created_at=stamped)
        return booking

    return {
        "staff": staff,
        "owner": owner,
        "buyer": buyer,
        "org": org,
        "now": now,
        "soon": soon,
        "later": later,
        "elsewhere": elsewhere,
        "recent": make_booking(1),
        "old": make_booking(90),
    }


MODERATION = "/api/v1/admin/events/pending"
BOOKINGS = "/api/v1/admin/bookings"
PAYMENTS = "/api/v1/admin/payments"
USERS = "/api/v1/admin/users"
ORGS = "/api/v1/admin/organizations"


def titles(response) -> list[str]:
    return [row["title"] for row in response.data["data"]]


@pytest.mark.django_db
class TestTheAllEventsQueue:
    def test_it_finds_an_event_by_a_fragment_of_its_name(self, world):
        """An operator has been handed a name and is looking for that row —
        usually a fragment of it. That is a substring question, not a discovery
        one, which is why this does not go through `search_vector`."""
        assert titles(auth(world["staff"]).get(f"{MODERATION}?q=comedy")) == ["Winter Comedy Gala"]

    def test_the_full_text_index_would_have_MISSED_a_prefix(self, world):
        """ "Arij" matches nothing in a stemmed tsquery. It is also exactly what
        somebody types into a console search box."""
        assert titles(auth(world["staff"]).get(f"{MODERATION}?q=Winter Com")) == [
            "Winter Comedy Gala"
        ]

    def test_it_finds_an_event_by_its_ORGANISER(self, world):
        """Half of what an operator is asked about arrives as "that promoter's
        show", not as a title they can quote."""
        assert titles(auth(world["staff"]).get(f"{MODERATION}?q=Basement Sess")) == [
            "Basement Techno"
        ]

    def test_it_finds_an_event_by_city(self, world):
        assert len(auth(world["staff"]).get(f"{MODERATION}?q=bengaluru").data["data"]) == 3

    def test_a_date_window_narrows_to_what_runs_that_week(self, world):
        now = world["now"]
        response = auth(world["staff"]).get(
            f"{MODERATION}?starts_after={iso(now)}&starts_before={iso(now + dt.timedelta(days=7))}"
        )
        assert sorted(titles(response)) == ["Basement Techno", "Jazz At Sunset"]

    def test_the_window_is_on_the_EVENTS_date_not_the_drafts(self, world):
        """An operator filtering this list is asking "what is running that
        weekend" — a fact about the event, not about when its draft was typed.
        Every event here was created a moment ago; only their dates differ."""
        now = world["now"]
        response = auth(world["staff"]).get(
            f"{MODERATION}?starts_after={iso(now + dt.timedelta(days=30))}"
        )
        assert titles(response) == ["Winter Comedy Gala"]

    def test_a_reversed_range_is_swapped_rather_than_matching_nothing(self, world):
        now = world["now"]
        response = auth(world["staff"]).get(
            f"{MODERATION}?starts_after={iso(now + dt.timedelta(days=7))}&starts_before={iso(now)}"
        )
        assert sorted(titles(response)) == ["Basement Techno", "Jazz At Sunset"]

    def test_a_malformed_date_is_ignored_rather_than_400ing(self, world):
        response = auth(world["staff"]).get(f"{MODERATION}?starts_after=last%20tuesday")
        assert response.status_code == 200
        assert len(response.data["data"]) == 3

    def test_search_composes_with_the_status_tab(self, world):
        Event.objects.filter(pk=world["later"].id).update(status=EventStatus.LIVE)
        pending = auth(world["staff"]).get(f"{MODERATION}?status=pending_review&q=comedy")
        live = auth(world["staff"]).get(f"{MODERATION}?status=live&q=comedy")

        assert titles(pending) == []
        assert titles(live) == ["Winter Comedy Gala"]

    def test_a_blank_search_does_not_filter_to_the_empty_string(self, world):
        """Clearing the box widens the list. `q=` filtering to rows whose title
        contains "" happens to work, but `q=   ` would not — so both are None."""
        assert len(auth(world["staff"]).get(f"{MODERATION}?q=%20%20").data["data"]) == 3


@pytest.mark.django_db
class TestTheMoneyLists:
    def test_bookings_narrow_to_a_created_window(self, world):
        now = world["now"]
        response = auth(world["staff"]).get(
            f"{BOOKINGS}?created_after={iso(now - dt.timedelta(days=7))}"
        )
        ids = [row["id"] for row in response.data["data"]]
        assert ids == [str(world["recent"].id)]

    def test_bookings_narrow_to_a_closed_window(self, world):
        now = world["now"]
        response = auth(world["staff"]).get(
            f"{BOOKINGS}?created_after={iso(now - dt.timedelta(days=120))}"
            f"&created_before={iso(now - dt.timedelta(days=30))}"
        )
        ids = [row["id"] for row in response.data["data"]]
        assert ids == [str(world["old"].id)]

    def test_the_window_composes_with_the_support_desk_search(self, world):
        now = world["now"]
        response = auth(world["staff"]).get(
            f"{BOOKINGS}?q=buyer@filters.test&created_after={iso(now - dt.timedelta(days=7))}"
        )
        ids = [row["id"] for row in response.data["data"]]
        assert ids == [str(world["recent"].id)]

    def test_payments_narrow_to_a_window(self, world):
        now = world["now"]
        response = auth(world["staff"]).get(
            f"{PAYMENTS}?created_after={iso(now - dt.timedelta(days=7))}"
        )
        assert len(response.data["data"]) == 1

    def test_a_window_that_matches_nothing_returns_an_empty_page_not_an_error(self, world):
        now = world["now"]
        response = auth(world["staff"]).get(
            f"{PAYMENTS}?created_after={iso(now + dt.timedelta(days=365))}"
        )
        assert response.status_code == 200
        assert response.data["data"] == []


@pytest.mark.django_db
class TestPeopleAndOrganisations:
    def test_users_narrow_by_when_they_signed_up(self, world):
        """The window is on `date_joined`, which is what this list ORDERS by —
        a window on a different column than the ordering makes the filter and
        the cursor disagree about which rows a page holds."""
        User.objects.filter(email="buyer@filters.test").update(
            date_joined=world["now"] - dt.timedelta(days=400)
        )
        response = auth(world["staff"]).get(
            f"{USERS}?created_after={iso(world['now'] - dt.timedelta(days=30))}"
        )
        emails = [row["email"] for row in response.data["data"]]
        assert "buyer@filters.test" not in emails
        assert "ops@filters.test" in emails

    def test_the_window_composes_with_the_role_tab(self, world):
        response = auth(world["staff"]).get(
            f"{USERS}?role=staff&created_after={iso(world['now'] - dt.timedelta(days=1))}"
        )
        assert [row["email"] for row in response.data["data"]] == ["ops@filters.test"]

    def test_organisations_are_searchable_by_name(self, world):
        response = auth(world["staff"]).get(f"{ORGS}?q=aurora")
        assert [row["name"] for row in response.data["data"]] == ["Aurora Live"]

    def test_organisations_narrow_by_a_window(self, world):
        Organization.objects.filter(name="Aurora Live").update(
            created_at=world["now"] - dt.timedelta(days=500)
        )
        response = auth(world["staff"]).get(
            f"{ORGS}?created_after={iso(world['now'] - dt.timedelta(days=30))}"
        )
        assert [row["name"] for row in response.data["data"]] == ["Basement Sessions"]


@pytest.mark.django_db
def test_none_of_this_is_reachable_without_staff(world):
    for url in (MODERATION, BOOKINGS, PAYMENTS, USERS, ORGS):
        assert auth(world["owner"]).get(f"{url}?q=anything").status_code == 403
