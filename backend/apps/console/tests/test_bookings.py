"""GET /admin/bookings — the support desk's lookup.

"The customer says they paid but has no ticket" is the single most common
support question a ticketing platform gets, and until these two endpoints it
could not be answered from the product at all: `GET /bookings/{id}` is scoped
to the booking's own owner, so an operator could not open one even holding the
id, and the only route was the Django admin.

The payment search partly covered it and structurally could not cover it fully
— a booking that never reached payment has no `Payment` row to be found by, and
that abandoned checkout is precisely what people phone about. The test for that
case is the one that matters most here.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.booking.models import Booking, BookingItem, BookingStatus, Ticket, TicketStatus
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization
from apps.ticketing.models import TicketType

LIST_URL = "/api/v1/admin/bookings"


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_user(
        email="desk@example.com", password="opsadmin12345", is_staff=True
    )


@pytest.fixture
def member(db) -> User:
    return User.objects.create_user(email="nobody@example.com", password="member12345")


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def desk(db):
    """A paid booking with two issued tickets, and a separate reserved booking
    whose hold has already lapsed — the two rows an operator most often has to
    tell apart."""
    owner = User.objects.create_user(email="promoter@example.com", password="owner12345")
    customer = User.objects.create_user(
        email="ravi@example.com", password="cust12345", full_name="Ravi Menon"
    )
    org = Organization.objects.create(owner=owner, name="Nightshift")
    event = Event.objects.create(
        organization=org,
        title="Bass Cathedral",
        venue="Antisocial",
        city="Mumbai",
        starts_at=timezone.now() + dt.timedelta(days=5),
        status=EventStatus.LIVE,
    )
    tier = TicketType.objects.create(
        event=event, name="Phase 1", price_minor=150_000, quantity=200, max_per_order=6
    )

    paid = Booking.objects.create(
        user=customer,
        event=event,
        status=BookingStatus.PAID,
        hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
        total_amount_minor=300_000,
        platform_fee_minor=20,
        payment_ref="pay_LiveOne99",
        payment_order_id="order_LiveOne99",
    )
    BookingItem.objects.create(booking=paid, ticket_type=tier, quantity=2, unit_price_minor=150_000)
    used = Ticket.objects.create(
        booking=paid,
        ticket_type=tier,
        qr_token=f"v1.{uuid.uuid4().hex}.sig",
        status=TicketStatus.USED,
        used_at=timezone.now(),
        gate="North",
    )
    active = Ticket.objects.create(
        booking=paid, ticket_type=tier, qr_token=f"v1.{uuid.uuid4().hex}.sig"
    )

    # The one the payment search can never find: reserved, never paid, hold
    # already lapsed. No Payment row exists for it.
    abandoned = Booking.objects.create(
        user=customer,
        event=event,
        status=BookingStatus.RESERVED,
        hold_expires_at=timezone.now() - dt.timedelta(minutes=3),
        total_amount_minor=150_000,
        platform_fee_minor=10,
        payment_order_id="order_Abandoned7",
    )

    return {
        "customer": customer,
        "event": event,
        "tier": tier,
        "paid": paid,
        "abandoned": abandoned,
        "used_ticket": used,
        "active_ticket": active,
    }


def _detail_url(booking) -> str:
    return f"{LIST_URL}/{booking.id}"


# ── Access ───────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestAccess:
    def test_a_non_operator_is_refused(self, member, desk):
        assert auth(member).get(LIST_URL).status_code == 403

    def test_anonymous_is_refused(self, desk):
        assert APIClient().get(LIST_URL).status_code == 401

    def test_a_non_operator_cannot_open_a_booking(self, member, desk):
        assert auth(member).get(_detail_url(desk["paid"])).status_code == 403

    def test_the_response_is_never_shared_cached(self, staff, desk):
        resp = auth(staff).get(LIST_URL)
        assert resp["Cache-Control"] == "private, no-store"


# ── Search: the four things an operator might be holding ─────────────────────


@pytest.mark.django_db
class TestSearch:
    def test_finds_by_customer_email(self, staff, desk):
        body = auth(staff).get(f"{LIST_URL}?q=ravi@example.com").json()
        assert len(body["data"]) == 2

    def test_finds_by_payment_reference(self, staff, desk):
        """The string a customer is most likely to have, off a bank statement."""
        body = auth(staff).get(f"{LIST_URL}?q=pay_LiveOne99").json()
        assert len(body["data"]) == 1
        assert body["data"][0]["id"] == str(desk["paid"].id)

    def test_finds_by_event_title(self, staff, desk):
        body = auth(staff).get(f"{LIST_URL}?q=Bass").json()
        assert len(body["data"]) == 2

    def test_finds_by_a_PARTIAL_booking_id(self, staff, desk):
        """People read out the first block of a uuid, not all 36 characters.

        This is also why the id is cast to text before matching: `icontains`
        cannot be applied to a Postgres `uuid` column at all — the ORM raises
        rather than coercing, so a naive implementation 500s on every search.
        """
        prefix = str(desk["paid"].id)[:8]
        body = auth(staff).get(f"{LIST_URL}?q={prefix}").json()
        assert [row["id"] for row in body["data"]] == [str(desk["paid"].id)]

    def test_finds_the_abandoned_checkout_that_has_no_payment_row(self, staff, desk):
        """THE case the payment search structurally cannot cover.

        A booking that never reached payment has no `Payment` to be found by,
        and it is exactly the booking somebody phones about.
        """
        body = auth(staff).get(f"{LIST_URL}?q=order_Abandoned7").json()
        assert len(body["data"]) == 1
        assert body["data"][0]["id"] == str(desk["abandoned"].id)
        assert body["data"][0]["status"] == BookingStatus.RESERVED

    def test_a_search_matching_nothing_is_an_empty_list_not_an_error(self, staff, desk):
        body = auth(staff).get(f"{LIST_URL}?q=nothing-matches-this").json()
        assert body["data"] == []

    def test_filters_by_status(self, staff, desk):
        body = auth(staff).get(f"{LIST_URL}?status=reserved").json()
        assert [row["id"] for row in body["data"]] == [str(desk["abandoned"].id)]


# ── The row an operator reads ────────────────────────────────────────────────


@pytest.mark.django_db
class TestRow:
    def test_carries_the_customer_and_the_event(self, staff, desk):
        row = next(
            r for r in auth(staff).get(LIST_URL).json()["data"] if r["id"] == str(desk["paid"].id)
        )
        assert row["customer_email"] == "ravi@example.com"
        assert row["customer_name"] == "Ravi Menon"
        assert row["event_title"] == "Bass Cathedral"
        assert row["total_amount_minor"] == 300_000

    def test_an_expired_hold_is_flagged_as_such(self, staff, desk):
        """`reserved` alone does not tell an operator whether to wait or act.
        Computed from the pair, never stored — the sweeper may not have run."""
        rows = {r["id"]: r for r in auth(staff).get(LIST_URL).json()["data"]}
        assert rows[str(desk["abandoned"].id)]["is_expired_hold"] is True
        assert rows[str(desk["paid"].id)]["is_expired_hold"] is False

    def test_a_live_reserved_hold_is_not_flagged(self, staff, desk):
        Booking.objects.filter(pk=desk["abandoned"].id).update(
            hold_expires_at=timezone.now() + dt.timedelta(minutes=5)
        )
        rows = {r["id"]: r for r in auth(staff).get(LIST_URL).json()["data"]}
        assert rows[str(desk["abandoned"].id)]["is_expired_hold"] is False


# ── The detail an operator opens during the call ─────────────────────────────


@pytest.mark.django_db
class TestDetail:
    def test_answers_whether_tickets_were_issued(self, staff, desk):
        body = auth(staff).get(_detail_url(desk["paid"])).json()
        assert body["tickets_issued"] == 2
        assert len(body["tickets"]) == 2

    def test_shows_which_tickets_have_already_been_used(self, staff, desk):
        body = auth(staff).get(_detail_url(desk["paid"])).json()
        used = next(t for t in body["tickets"] if t["status"] == TicketStatus.USED)
        assert used["gate"] == "North"
        assert used["used_at"] is not None

    def test_NEVER_exposes_a_qr_token(self, staff, desk):
        """The token is the credential that admits somebody.

        An operator needs to know tickets EXIST and whether they have been
        used; they never need the code. Including it would make every operator
        session a set of usable tickets. `POST /checkin/lookup` verifies a token
        the holder presents rather than handing one out.
        """
        raw = auth(staff).get(_detail_url(desk["paid"])).content.decode()
        assert desk["active_ticket"].qr_token not in raw
        assert "qr_token" not in raw

    def test_carries_the_line_items(self, staff, desk):
        body = auth(staff).get(_detail_url(desk["paid"])).json()
        assert body["items"] == [
            {
                "ticket_type_id": str(desk["tier"].id),
                "ticket_type_name": "Phase 1",
                "quantity": 2,
                "unit_price_minor": 150_000,
            }
        ]

    def test_an_abandoned_booking_shows_zero_tickets(self, staff, desk):
        """The literal answer to "I paid but got nothing" when they did not."""
        body = auth(staff).get(_detail_url(desk["abandoned"])).json()
        assert body["tickets_issued"] == 0
        assert body["tickets"] == []
        assert body["is_expired_hold"] is True

    def test_carries_server_time_so_the_client_does_not_use_the_operators_clock(self, staff, desk):
        body = auth(staff).get(_detail_url(desk["paid"])).json()
        assert body["server_time"]

    def test_an_unknown_booking_is_a_clean_404(self, staff, desk):
        resp = auth(staff).get(f"{LIST_URL}/{uuid.uuid4()}")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "not_found"

    def test_the_detail_does_not_n_plus_1_on_tickets(self, staff, desk, django_assert_num_queries):
        """Six tickets must cost the same as two. This is the screen an
        operator opens most, and the prefetch is what keeps it flat."""
        for _ in range(4):
            Ticket.objects.create(
                booking=desk["paid"],
                ticket_type=desk["tier"],
                qr_token=f"v1.{uuid.uuid4().hex}.sig",
            )
        client = auth(staff)
        # booking+user+event (1), items (1), item tiers (1), tickets (1),
        # ticket tiers (1). Flat regardless of how many tickets there are.
        with django_assert_num_queries(5):
            body = client.get(_detail_url(desk["paid"])).json()
        assert body["tickets_issued"] == 6


# ── The list must not N+1 either ─────────────────────────────────────────────


@pytest.mark.django_db
def test_the_list_does_not_n_plus_1_on_customer_or_event(staff, desk, django_assert_num_queries):
    """A page of 25 bookings without `select_related` is 50 extra queries — on
    the surface a support agent refreshes constantly."""
    for index in range(10):
        Booking.objects.create(
            user=desk["customer"],
            event=desk["event"],
            status=BookingStatus.PAID,
            hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
            total_amount_minor=150_000,
            platform_fee_minor=10,
            payment_ref=f"pay_bulk{index}",
        )
    client = auth(staff)
    # The page itself (1). Cursor pagination issues no COUNT(*).
    with django_assert_num_queries(1):
        body = client.get(LIST_URL).json()
    assert len(body["data"]) == 12
