"""Putting booked events into calendars, and keeping them true.

The sync is a convenience layered on a ticket that is already paid for, so
the governing rule is that it must never be able to break the thing beneath
it: a Google outage cannot fail a booking confirmation, and one attendee's
revoked grant cannot stop the other attendees being told an event moved.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.booking.models import Booking, BookingStatus
from apps.events.models import Event, EventStatus
from apps.integrations.exceptions import (
    CalendarNotConnectedError,
    CalendarReconnectRequiredError,
    CalendarSyncFailedError,
)
from apps.integrations.models import CalendarEventLink, ConnectionStatus
from apps.integrations.repositories import (
    CalendarEventLinkRepository,
    GoogleConnectionRepository,
)
from apps.integrations.services import CalendarSyncService, GoogleOAuthService
from apps.organizations.models import Organization
from core.adapters.local.locmem_cache import LocMemCacheAdapter
from core.ports.calendar_port import CalendarAuthError, CalendarError

from .test_oauth import REDIRECT_URI, FakeCalendar


class _Queue:
    def __init__(self):
        self.calls = []

    def enqueue(self, task_name, payload, *, delay_seconds=0):
        self.calls.append((task_name, payload))
        return "task"


@pytest.fixture
def calendar():
    return FakeCalendar()


@pytest.fixture
def queue():
    return _Queue()


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="org@example.com", password="pw")
    buyer = User.objects.create_user(email="fan@example.com", password="pw", full_name="Fan")
    organization = Organization.objects.create(name="Org", owner=owner)
    event = Event.objects.create(
        organization=organization,
        title="Sunburn Goa",
        description="A festival.",
        venue="Vagator Beach",
        city="Goa",
        starts_at=timezone.now() + timedelta(days=30),
        status=EventStatus.LIVE,
    )
    booking = Booking.objects.create(
        user=buyer,
        event=event,
        status=BookingStatus.PAID,
        total_amount_minor=250000,
        platform_fee_minor=1000,
        hold_expires_at=timezone.now() + timedelta(minutes=10),
    )
    return {"owner": owner, "buyer": buyer, "event": event, "booking": booking}


@pytest.fixture
def services(calendar, queue, settings):
    from apps.accounts.repositories import UserRepository
    from apps.booking.repositories import BookingRepository
    from apps.events.repositories import EventRepository

    settings.PUBLIC_SITE_URL = "https://curatix.example"
    oauth = GoogleOAuthService(
        connections=GoogleConnectionRepository(),
        calendar=calendar,
        cache=LocMemCacheAdapter(),
        users=UserRepository(),
        redirect_uri=REDIRECT_URI,
    )
    sync = CalendarSyncService(
        oauth=oauth,
        connections=GoogleConnectionRepository(),
        links=CalendarEventLinkRepository(),
        calendar=calendar,
        bookings=BookingRepository(),
        events=EventRepository(),
        task_queue=queue,
        site_url="https://curatix.example",
    )
    return oauth, sync


def _connect(oauth, user):
    state = oauth.start_authorization(user_id=user.id).state
    return oauth.complete_authorization(state=state, code="good").connection


@pytest.mark.django_db
class TestAddingABooking:
    def test_a_connected_user_gets_a_calendar_entry(self, services, world, calendar):
        oauth, sync = services
        _connect(oauth, world["buyer"])

        event_id = sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        assert calendar.created
        assert CalendarEventLink.objects.filter(booking=world["booking"]).exists()
        assert event_id

    def test_the_entry_carries_the_event_details_and_a_deep_link(self, services, world, calendar):
        oauth, sync = services
        _connect(oauth, world["buyer"])
        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        draft = calendar.created[0]["draft"]
        assert draft.summary == "Sunburn Goa"
        assert draft.location == "Vagator Beach, Goa"
        assert str(world["event"].id) in draft.url

    def test_reminders_are_set_rather_than_left_to_the_calendar_default(
        self, services, world, calendar
    ):
        # A default of "10 minutes before" is useless for an event across a
        # city, which is the whole reason these are explicit.
        oauth, sync = services
        _connect(oauth, world["buyer"])
        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        assert calendar.created[0]["draft"].reminder_minutes == [24 * 60, 120]

    def test_an_assumed_end_time_is_stated_in_the_entry(self, services, world, calendar):
        """`ends_at` is nullable and a calendar entry must have an end.

        Silently writing two hours would put a number in somebody's diary the
        organizer never stated, and they would plan their evening around it.
        """
        oauth, sync = services
        _connect(oauth, world["buyer"])
        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        draft = calendar.created[0]["draft"]
        assert draft.ends_at - draft.starts_at == timedelta(hours=2)
        assert "assumes two hours" in draft.description

    def test_a_stated_end_time_is_used_verbatim(self, services, world, calendar):
        oauth, sync = services
        world["event"].ends_at = world["event"].starts_at + timedelta(hours=6)
        world["event"].save(update_fields=["ends_at"])
        _connect(oauth, world["buyer"])

        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)
        draft = calendar.created[0]["draft"]
        assert draft.ends_at - draft.starts_at == timedelta(hours=6)
        assert "assumes" not in draft.description

    def test_adding_twice_updates_rather_than_duplicating(self, services, world, calendar):
        oauth, sync = services
        _connect(oauth, world["buyer"])

        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)
        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        # One link, and the second call was an UPDATE. The unique constraint
        # on (connection, booking) is what guarantees this under concurrency.
        assert CalendarEventLink.objects.filter(booking=world["booking"]).count() == 1
        assert len(calendar.created) == 1
        assert len(calendar.updated) == 1

    def test_the_idempotency_key_is_derived_from_the_booking(self, services, world, calendar):
        # Google dedupes on the event id within a calendar, so a retried
        # create updates the same entry rather than adding a twin.
        oauth, sync = services
        _connect(oauth, world["buyer"])
        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        key = calendar.created[0]["draft"].idempotency_key
        assert key == f"evt{str(world['booking'].id).replace('-', '')}"
        # Google requires lowercase base32hex.
        assert key.islower() and key.isalnum()

    def test_an_unconnected_user_is_refused_rather_than_told_it_worked(self, services, world):
        _, sync = services
        with pytest.raises(CalendarNotConnectedError):
            sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

    def test_somebody_elses_booking_is_not_addable(self, services, world):
        """Same response as 'does not exist'.

        A distinct 403 would confirm the booking exists to anyone probing ids.
        """
        oauth, sync = services
        _connect(oauth, world["owner"])

        with pytest.raises(CalendarNotConnectedError):
            sync.add_booking(user_id=world["owner"].id, booking_id=world["booking"].id)

    def test_a_revoked_grant_marks_the_connection_and_raises_reconnect(
        self, services, world, calendar
    ):
        oauth, sync = services
        connection = _connect(oauth, world["buyer"])
        calendar.write_dies = CalendarAuthError("revoked")

        with pytest.raises(CalendarReconnectRequiredError):
            sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        connection.refresh_from_db()
        assert connection.status == ConnectionStatus.NEEDS_RECONNECT

    def test_a_transient_google_failure_is_reported_as_retryable(self, services, world, calendar):
        oauth, sync = services
        connection = _connect(oauth, world["buyer"])
        calendar.write_dies = CalendarError("502")

        with pytest.raises(CalendarSyncFailedError):
            sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        connection.refresh_from_db()
        # Still ACTIVE — Google was unwell, the grant is fine.
        assert connection.status == ConnectionStatus.ACTIVE


@pytest.mark.django_db
class TestEventChanges:
    def test_a_moved_event_updates_every_entry(self, services, world, calendar):
        oauth, sync = services
        _connect(oauth, world["buyer"])
        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        world["event"].starts_at = world["event"].starts_at + timedelta(days=1)
        world["event"].save(update_fields=["starts_at"])

        assert sync.sync_event_changes(event_id=world["event"].id) == 1
        assert calendar.updated

    def test_a_cancelled_event_is_removed_from_every_calendar(self, services, world, calendar):
        """The operation that most justifies the link table existing.

        Without it a cancelled event stays in every attendee's diary, and
        people travel across a city to a locked door.
        """
        oauth, sync = services
        _connect(oauth, world["buyer"])
        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        assert sync.cancel_event_everywhere(event_id=world["event"].id) == 1
        assert calendar.deleted
        link = CalendarEventLink.objects.get(booking=world["booking"])
        assert link.deleted_at is not None

    def test_one_dead_grant_does_not_strand_the_other_attendees(
        self, services, world, calendar, db
    ):
        """The isolation that matters at scale.

        A single revoked connection must not stop everyone after it in the
        list from learning the event moved.
        """
        oauth, sync = services
        second_buyer = User.objects.create_user(email="two@example.com", password="pw")
        second_booking = Booking.objects.create(
            user=second_buyer,
            event=world["event"],
            status=BookingStatus.PAID,
            total_amount_minor=250000,
            platform_fee_minor=1000,
            hold_expires_at=timezone.now() + timedelta(minutes=10),
        )

        first = _connect(oauth, world["buyer"])
        _connect(oauth, second_buyer)
        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)
        sync.add_booking(user_id=second_buyer.id, booking_id=second_booking.id)

        # Kill the first attendee's grant.
        GoogleConnectionRepository().mark_needs_reconnect(first, detail="revoked")
        calendar.updated.clear()

        assert sync.sync_event_changes(event_id=world["event"].id) == 1
        assert len(calendar.updated) == 1

    def test_syncing_an_event_nobody_added_is_a_clean_zero(self, services, world):
        _, sync = services
        assert sync.sync_event_changes(event_id=world["event"].id) == 0

    def test_syncing_an_unknown_event_is_a_clean_zero(self, services):
        _, sync = services
        assert sync.sync_event_changes(event_id=uuid.uuid4()) == 0


@pytest.mark.django_db
class TestRemoval:
    def test_a_user_can_take_one_entry_back_out(self, services, world, calendar):
        oauth, sync = services
        _connect(oauth, world["buyer"])
        sync.add_booking(user_id=world["buyer"].id, booking_id=world["booking"].id)

        assert (
            sync.remove_booking(user_id=world["buyer"].id, booking_id=world["booking"].id) is True
        )
        assert calendar.deleted

    def test_removing_something_never_added_is_a_no_op(self, services, world):
        oauth, sync = services
        _connect(oauth, world["buyer"])
        assert (
            sync.remove_booking(user_id=world["buyer"].id, booking_id=world["booking"].id) is False
        )


@pytest.mark.django_db
class TestHandlers:
    """The handlers only ENQUEUE.

    They run inside the outbox drain, which runs inside the transaction that
    confirmed a booking. A network call there would hold a database
    transaction open across the internet, and a Google outage would roll back
    a paid booking.
    """

    def test_a_confirmed_booking_enqueues_rather_than_calling_google(
        self, services, world, queue, calendar, monkeypatch
    ):
        from apps.integrations import handlers

        _, sync = services
        monkeypatch.setattr("config.di.build_calendar_sync_service", lambda: sync)

        handlers.handle_booking_confirmed(
            {"user_id": str(world["buyer"].id), "booking_id": str(world["booking"].id)}
        )

        assert queue.calls[0][0] == "integrations.sync_booking_to_calendar"
        assert calendar.created == []  # nothing synchronous

    def test_an_updated_event_enqueues_a_sync(self, services, world, queue, monkeypatch):
        from apps.integrations import handlers

        _, sync = services
        monkeypatch.setattr("config.di.build_calendar_sync_service", lambda: sync)

        handlers.handle_event_updated({"event_id": str(world["event"].id)})
        assert queue.calls[0][0] == "integrations.sync_event_changes"

    def test_an_archived_event_enqueues_a_cancellation(self, services, world, queue, monkeypatch):
        from apps.integrations import handlers

        _, sync = services
        monkeypatch.setattr("config.di.build_calendar_sync_service", lambda: sync)

        handlers.handle_event_cancelled({"event_id": str(world["event"].id)})
        assert queue.calls[0][0] == "integrations.cancel_event_in_calendars"

    def test_a_malformed_payload_is_ignored_rather_than_raising(self, services, queue, monkeypatch):
        from apps.integrations import handlers

        _, sync = services
        monkeypatch.setattr("config.di.build_calendar_sync_service", lambda: sync)

        handlers.handle_booking_confirmed({})  # must not raise
        assert queue.calls == []


@pytest.mark.django_db
def test_the_sync_task_swallows_the_states_no_retry_can_fix(world, monkeypatch, services):
    """Not connected, needs reconnect and scope-withheld are all states a
    retry cannot change. Letting them propagate would burn the queue's retry
    budget and dead-letter something that was never broken."""
    from apps.integrations import tasks

    _, sync = services
    monkeypatch.setattr("config.di.build_calendar_sync_service", lambda: sync)

    tasks.sync_booking_to_calendar(
        {"user_id": str(world["buyer"].id), "booking_id": str(world["booking"].id)}
    )  # no connection exists — must not raise
