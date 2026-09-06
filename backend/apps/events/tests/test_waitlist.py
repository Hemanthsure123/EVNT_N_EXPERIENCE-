"""The waiting list for a sold-out event.

Three properties carry the weight, and each is a way the feature would be worse
than not shipping it:

1. **Nobody is told twice.** A person is written to about an event exactly
   once, which is what the message itself promises. Two mechanisms enforce it
   independently — `notified_at` on the row and the notification ledger's
   dedupe key — and the tests prove both.
2. **The batch is bounded and the cooldown holds.** Without them, one freed
   seat burns through an entire queue in minutes, telling everybody about a
   ticket that was taken before they finished reading — and telling them once,
   so they are never told again.
3. **One bad row cannot strand the rest.** Every other fan-out in this codebase
   loops without isolation; this one does not, and the test is what keeps it
   that way.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.exceptions import EventNotFoundError
from apps.events.models import Event, EventStatus, EventWaitlist
from apps.events.repositories import EventRepository, EventWaitlistRepository
from apps.events.services import (
    WAITLIST_NOTIFICATION_TYPE,
    WAITLIST_NOTIFY_PER_SEAT,
    WaitlistService,
)

pytestmark = pytest.mark.django_db


class RecordingNotifier:
    """A double for `NotificationService.notify`.

    A recorder rather than the real service, for the reason
    `announcements.Notifier` gives: the template registry is another module's
    contract and another module's test. What this module owns is WHO is told
    and HOW OFTEN, and that is all this records.
    """

    def __init__(self, *, fail_for: set[str] | None = None, skip_for: set[str] | None = None):
        self.sent: list[dict] = []
        #: Recipients whose `notify` raises — the template-error case.
        self.fail_for = fail_for or set()
        #: Recipients `notify` returns None for — the no-channel case.
        self.skip_for = skip_for or set()

    def notify(self, *, notification_type, recipient, context, dedupe_key, delay_seconds=0):
        if recipient in self.fail_for:
            raise KeyError("event_when")
        self.sent.append(
            {
                "type": notification_type,
                "recipient": recipient,
                "context": context,
                "dedupe_key": dedupe_key,
            }
        )
        if recipient in self.skip_for:
            return None
        return object()

    @property
    def recipients(self) -> list[str]:
        return [row["recipient"] for row in self.sent]


@pytest.fixture
def notifier() -> RecordingNotifier:
    return RecordingNotifier()


@pytest.fixture
def waitlist_service(notifier) -> WaitlistService:
    return WaitlistService(
        waitlist=EventWaitlistRepository(),
        events=EventRepository(),
        notifier=notifier,
    )


@pytest.fixture
def make_waiter():
    """People to put on a list, in a known order."""
    from apps.accounts.repositories import UserRepository

    def _make(index: int):
        return UserRepository().create_user(
            email=f"waiter{index}@example.com", password="s3cur3pass"
        )

    return _make


def set_availability(event: Event, available: int | None, *, on_sale: bool = True) -> None:
    """Give the event a REAL tier with this much left, and the matching denormal.

    Both halves are needed and they answer different questions. The denormal is
    what the candidate query filters on; the TIER is what decides whether
    anybody could actually buy — an event whose only tier opens next month has
    a positive denormal and sells nothing, and the sweeper must not write to
    people about seats like that.

    A denormal set without a tier behind it was the original shape of this
    helper, and every sweeper test passed against an event that could not have
    sold a ticket. Faking one side of a two-sided rule tests neither.
    """
    from apps.ticketing.models import TicketType

    TicketType.objects.filter(event_id=event.id).delete()
    if available:
        TicketType.objects.create(
            event_id=event.id,
            name="General",
            price_minor=50_000,
            quantity=available,
            max_per_order=10,
            # `sale_start` in the future is the "counted but unbuyable" case.
            sale_start=None if on_sale else timezone.now() + timedelta(days=30),
        )
    Event.objects.filter(pk=event.id).update(tickets_available=available)
    event.refresh_from_db()


def join_all(users, event) -> None:
    """Put people on the list IN ORDER, a second apart.

    The spacing is deliberate. `auto_now_add` inside a loop stamps several rows
    inside one clock tick, and the queue is `(created_at, id)` — so a test that
    joined them instantaneously would be asserting the UUID tiebreak rather
    than the queue, and would flake. Real joins arrive seconds apart; this
    makes the fixture match that and leaves the tie behaviour to the test that
    is actually about it.
    """
    repository = EventWaitlistRepository()
    base = timezone.now() - timedelta(hours=1)
    for index, user in enumerate(users):
        repository.join(user_id=user.id, event_id=event.id)
        EventWaitlist.objects.filter(user_id=user.id, event_id=event.id).update(
            created_at=base + timedelta(seconds=index)
        )


# ── joining and leaving ─────────────────────────────────────────────────────


class TestJoining:
    def test_joining_puts_somebody_on_the_list(self, waitlist_service, make_event, other_user):
        event = make_event()
        assert waitlist_service.join(user_id=other_user.id, event_id=event.id) is True
        assert EventWaitlist.objects.filter(event_id=event.id, user_id=other_user.id).exists()

    def test_joining_twice_is_ONE_row_and_one_place_in_the_queue(
        self, waitlist_service, make_event, other_user
    ):
        """The control double-fires on a slow connection. The second press must
        be a no-op rather than a second row — and, more importantly, a second
        email."""
        event = make_event()
        assert waitlist_service.join(user_id=other_user.id, event_id=event.id) is True
        assert waitlist_service.join(user_id=other_user.id, event_id=event.id) is False
        assert EventWaitlist.objects.filter(event_id=event.id).count() == 1

    def test_rejoining_after_being_notified_does_NOT_reset_the_turn(
        self, waitlist_service, make_event, other_user
    ):
        """Somebody told and not buying has been served. Pressing the button
        again must not put them back at the head of the queue, or the button is
        a way to skip it."""
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        stamped = timezone.now()
        EventWaitlist.objects.filter(event_id=event.id).update(notified_at=stamped)

        waitlist_service.join(user_id=other_user.id, event_id=event.id)

        row = EventWaitlist.objects.get(event_id=event.id)
        assert row.notified_at is not None

    @pytest.mark.parametrize(
        "status", [EventStatus.DRAFT, EventStatus.CANCELLED, EventStatus.ARCHIVED]
    )
    def test_an_event_nobody_can_book_is_refused(
        self, waitlist_service, make_event, other_user, status
    ):
        """Collecting an intention to attend something that cannot be attended
        is a promise with nothing behind it."""
        event = make_event(status=status)
        with pytest.raises(EventNotFoundError):
            waitlist_service.join(user_id=other_user.id, event_id=event.id)

    def test_joining_is_allowed_while_tickets_ARE_available(
        self, waitlist_service, make_event, other_user
    ):
        """THE TEST FOR A DELIBERATE NON-RULE.

        `tickets_available` is a cached DISPLAY denormal, and refusing on it
        would be deciding from a cache. Availability also moves between the
        page rendering and the press — the last seat routinely goes in that
        gap — so a refusal would fail for exactly the people this list is for.
        """
        event = make_event()
        set_availability(event, 12)
        assert waitlist_service.join(user_id=other_user.id, event_id=event.id) is True

    def test_leaving_removes_the_row(self, waitlist_service, make_event, other_user):
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        assert waitlist_service.leave(user_id=other_user.id, event_id=event.id) is True
        assert not EventWaitlist.objects.filter(event_id=event.id).exists()

    def test_leaving_a_list_you_are_not_on_is_a_no_op(
        self, waitlist_service, make_event, other_user
    ):
        event = make_event()
        assert waitlist_service.leave(user_id=other_user.id, event_id=event.id) is False


# ── the sweeper ─────────────────────────────────────────────────────────────


class TestTheSweeper:
    def test_it_tells_somebody_when_seats_come_back(
        self, waitlist_service, notifier, make_event, other_user
    ):
        event = make_event()
        set_availability(event, 0)
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, 3)

        assert waitlist_service.notify_available() == 1
        assert notifier.recipients == [other_user.email]
        assert notifier.sent[0]["type"] == WAITLIST_NOTIFICATION_TYPE

    def test_it_says_nothing_while_the_event_is_still_sold_out(
        self, waitlist_service, notifier, make_event, other_user
    ):
        event = make_event()
        set_availability(event, 0)
        waitlist_service.join(user_id=other_user.id, event_id=event.id)

        assert waitlist_service.notify_available() == 0
        assert notifier.sent == []

    def test_an_UNSET_availability_is_not_a_positive_one(
        self, waitlist_service, notifier, make_event, other_user
    ):
        """Null means ticketing has never written the denormal — the event has
        no tiers at all. It is "unknown", not "seats available", and the
        difference is a message about a ticket that does not exist."""
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, None)

        assert waitlist_service.notify_available() == 0

    def test_nobody_is_told_twice(self, waitlist_service, notifier, make_event, other_user):
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, 5)

        assert waitlist_service.notify_available() == 1
        # Cooldown zero, so a second sweep is free to run — and still finds
        # nobody, because the row is marked.
        assert waitlist_service.notify_available(cooldown_minutes=0) == 0
        assert len(notifier.sent) == 1

    def test_the_row_records_when_it_was_told(self, waitlist_service, make_event, other_user):
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, 5)
        waitlist_service.notify_available()

        assert EventWaitlist.objects.get(event_id=event.id).notified_at is not None

    def test_it_tells_people_in_the_order_they_joined(
        self, waitlist_service, notifier, make_event, make_waiter
    ):
        """`created_at` IS the queue position. Telling somebody who joined this
        morning before somebody who joined last week is the one thing a waiting
        list must not do."""
        event = make_event()
        waiters = [make_waiter(i) for i in range(3)]
        join_all(waiters, event)
        set_availability(event, 1)  # 1 seat -> 3 told

        waitlist_service.notify_available()

        assert notifier.recipients == [w.email for w in waiters]

    def test_the_queue_order_is_STABLE_when_timestamps_tie(
        self, waitlist_service, notifier, make_event, make_waiter
    ):
        """`created_at` is not unique — an on-sale puts several joins inside one
        clock tick — and Postgres may return tied rows in a different arbitrary
        order on every query. A queue whose order changes between reads is not
        a queue: one sweep would take a person the previous sweep had already
        counted as further down.

        The tiebreak makes it deterministic. This asserts the SAME answer
        twice, not a particular answer — which of two people joining in the
        same microsecond goes first is genuinely arbitrary; changing its mind
        is not.
        """
        event = make_event()
        waiters = [make_waiter(i) for i in range(6)]
        stamped = timezone.now()
        repository = EventWaitlistRepository()
        for user in waiters:
            repository.join(user_id=user.id, event_id=event.id)
        EventWaitlist.objects.filter(event_id=event.id).update(created_at=stamped)

        first = [row.id for row in repository.pending_for_event(event_id=event.id, limit=6)]
        second = [row.id for row in repository.pending_for_event(event_id=event.id, limit=6)]
        head = [row.id for row in repository.pending_for_event(event_id=event.id, limit=3)]

        assert first == second
        # And a shorter page is a PREFIX of the longer one, which is the
        # property batching actually depends on.
        assert head == first[:3]

    def test_the_batch_is_proportional_to_the_seats(
        self, waitlist_service, notifier, make_event, make_waiter
    ):
        """One person per seat leaves the seat unsold while its single
        candidate is asleep; everybody per seat is a mailshot. The factor is
        the whole design."""
        event = make_event()
        join_all([make_waiter(i) for i in range(10)], event)
        set_availability(event, 2)

        told = waitlist_service.notify_available()

        assert told == 2 * WAITLIST_NOTIFY_PER_SEAT
        assert len(notifier.sent) == told

    def test_the_batch_never_exceeds_the_queue(
        self, waitlist_service, notifier, make_event, make_waiter
    ):
        event = make_event()
        join_all([make_waiter(i) for i in range(2)], event)
        set_availability(event, 50)

        assert waitlist_service.notify_available() == 2

    def test_THE_COOLDOWN_holds_the_next_batch_back(
        self, waitlist_service, notifier, make_event, make_waiter
    ):
        """THE TEST THIS FILE EXISTS FOR.

        Without it, one freed seat notifies three people every two minutes and
        an hour-long queue is gone in half an hour — everybody told about a
        ticket that was taken before they read the message, and none of them
        ever told again, because a person is notified once.
        """
        event = make_event()
        join_all([make_waiter(i) for i in range(12)], event)
        set_availability(event, 1)

        first = waitlist_service.notify_available()
        second = waitlist_service.notify_available()

        assert first == WAITLIST_NOTIFY_PER_SEAT
        assert second == 0, "the second sweep must be held back by the cooldown"

    def test_the_next_batch_goes_once_the_cooldown_lapses(
        self, waitlist_service, notifier, make_event, make_waiter
    ):
        event = make_event()
        waiters = [make_waiter(i) for i in range(12)]
        join_all(waiters, event)
        set_availability(event, 1)
        waitlist_service.notify_available()

        # The clock moved on. Nobody bought, so the seat is still there.
        EventWaitlist.objects.filter(notified_at__isnull=False).update(
            notified_at=timezone.now() - timedelta(hours=2)
        )
        assert waitlist_service.notify_available() == WAITLIST_NOTIFY_PER_SEAT
        assert notifier.recipients == [w.email for w in waiters[: WAITLIST_NOTIFY_PER_SEAT * 2]]

    @pytest.mark.parametrize("status", [EventStatus.CANCELLED, EventStatus.PAUSED])
    def test_an_event_that_stopped_selling_tells_nobody(
        self, waitlist_service, notifier, make_event, other_user, status
    ):
        """A cancelled event's tiers still sum to a positive number. Telling
        somebody tickets are available for a show that is not happening is the
        worst message on this list."""
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, 5)
        Event.objects.filter(pk=event.id).update(status=status)

        assert waitlist_service.notify_available() == 0

    def test_an_event_that_has_already_started_tells_nobody(
        self, waitlist_service, notifier, make_event, other_user
    ):
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, 5)
        Event.objects.filter(pk=event.id).update(starts_at=timezone.now() - timedelta(hours=1))

        assert waitlist_service.notify_available() == 0

    def test_a_tier_that_has_NOT_OPENED_YET_tells_nobody(
        self, waitlist_service, notifier, make_event, other_user
    ):
        """`Event.tickets_available` sums every tier and knows nothing about a
        sale window, so an event whose only remaining tier opens next month
        reports a positive number and sells nothing. `reserve` refuses it under
        the lock — correctly, and one screen too late.

        This message is nothing but a call to action. Sending it about seats
        nobody can buy is worse than sending nothing.
        """
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, 5, on_sale=False)

        assert waitlist_service.notify_available() == 0
        assert notifier.sent == []

    def test_a_tier_whose_sale_has_CLOSED_tells_nobody(
        self, waitlist_service, notifier, make_event, other_user
    ):
        from apps.ticketing.models import TicketType

        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, 5)
        TicketType.objects.filter(event_id=event.id).update(
            sale_end=timezone.now() - timedelta(hours=1)
        )

        assert waitlist_service.notify_available() == 0

    def test_the_message_carries_what_the_reader_needs(
        self, waitlist_service, notifier, make_event, other_user
    ):
        event = make_event(title="Jazz Night", venue="Phoenix Arena", city="Mumbai")
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, 4)
        waitlist_service.notify_available()

        context = notifier.sent[0]["context"]
        assert context["event_title"] == "Jazz Night"
        assert context["event_where"] == "Phoenix Arena, Mumbai"
        # The count is a real figure off the row, not an urgency device — it is
        # what tells somebody whether to open it now or finish their coffee.
        assert context["tickets_available"] == 4

    def test_the_dedupe_key_is_bounded_and_per_person(
        self, waitlist_service, notifier, make_event, other_user
    ):
        """`NotificationLog.dedupe_key` is UNIQUE and 255 characters. An email
        address may be 254 on its own, so a key built from one overflows for
        the one person whose address is long — after the batch is half sent."""
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)
        set_availability(event, 5)
        waitlist_service.notify_available()

        key = notifier.sent[0]["dedupe_key"]
        assert key == f"waitlist:{event.id}:{other_user.id}"
        assert len(key) < 255


class TestOneBadRowDoesNotStrandTheBatch:
    def test_a_failing_send_leaves_the_others_alone(
        self, make_event, make_waiter, waitlist_service
    ):
        """Every other fan-out in this codebase loops without isolation, so a
        template raising on one row silently costs every recipient after it.
        This test is what keeps that from being true here."""
        event = make_event()
        waiters = [make_waiter(i) for i in range(3)]
        join_all(waiters, event)
        set_availability(event, 1)

        notifier = RecordingNotifier(fail_for={waiters[0].email})
        service = WaitlistService(
            waitlist=EventWaitlistRepository(), events=EventRepository(), notifier=notifier
        )

        told = service.notify_available()

        assert told == 2
        assert notifier.recipients == [waiters[1].email, waiters[2].email]

    def test_the_failed_row_stays_PENDING_and_is_retried(
        self, make_event, make_waiter, waitlist_service
    ):
        """Marked-but-not-sent is a message nobody ever receives and no trace
        that it did not go. Left pending, it is visibly un-notified and the
        next sweep tries again."""
        event = make_event()
        waiters = [make_waiter(i) for i in range(2)]
        join_all(waiters, event)
        set_availability(event, 1)

        failing = RecordingNotifier(fail_for={waiters[0].email})
        WaitlistService(
            waitlist=EventWaitlistRepository(), events=EventRepository(), notifier=failing
        ).notify_available()

        stranded = EventWaitlist.objects.get(user_id=waiters[0].id)
        assert stranded.notified_at is None

        working = RecordingNotifier()
        WaitlistService(
            waitlist=EventWaitlistRepository(), events=EventRepository(), notifier=working
        ).notify_available(cooldown_minutes=0)

        assert working.recipients == [waiters[0].email]

    def test_a_send_that_was_SKIPPED_is_not_marked_either(self, make_event, make_waiter):
        """`notify` returns None when a channel is switched off in this
        deployment. Nothing went, so nothing is marked."""
        event = make_event()
        waiter = make_waiter(0)
        join_all([waiter], event)
        set_availability(event, 1)

        notifier = RecordingNotifier(skip_for={waiter.email})
        told = WaitlistService(
            waitlist=EventWaitlistRepository(), events=EventRepository(), notifier=notifier
        ).notify_available()

        assert told == 0
        assert EventWaitlist.objects.get(user_id=waiter.id).notified_at is None


class TestBuyingTakesYouOff:
    def test_a_confirmed_booking_removes_the_row(self, waitlist_service, make_event, other_user):
        """Somebody who joined and then bought stays on the list un-notified,
        and is later emailed "tickets are available" for an event they already
        hold a ticket to."""
        event = make_event()
        waitlist_service.join(user_id=other_user.id, event_id=event.id)

        assert waitlist_service.forget_for_booking(user_id=other_user.id, event_id=event.id) is True
        assert not EventWaitlist.objects.filter(event_id=event.id).exists()

    def test_the_observer_is_subscribed_to_the_real_event(self):
        """The bus subscribes by STRING and swallows nothing it was never
        handed — an unsubscribed event fails with no exception and no failing
        test. This is that test."""
        from apps.events import handlers

        assert callable(handlers.handle_booking_confirmed)

    def test_a_payload_missing_its_ids_is_ignored_rather_than_raising(self):
        from apps.events import handlers

        handlers.handle_booking_confirmed({})  # must not raise


class TestTheCrossModuleContract:
    """The literals `events` and `notifications` must agree on.

    `WAITLIST_NOTIFICATION_TYPE` is declared in `events` because that module is
    what asks for it; the enum member, the channel and the template live in
    `notifications`. A change on either side has to fail somewhere, and this is
    where.
    """

    def test_the_type_matches_the_enum_member(self):
        from apps.notifications.models import NotificationType

        assert WAITLIST_NOTIFICATION_TYPE == NotificationType.WAITLIST_AVAILABLE

    def test_the_type_is_routed_to_a_channel(self):
        from apps.notifications.templates import channel_for_type

        assert channel_for_type(WAITLIST_NOTIFICATION_TYPE)

    def test_the_type_has_a_template_that_renders(self):
        from apps.notifications.models import NotificationChannel
        from apps.notifications.templates import TemplateService

        rendered = TemplateService().render(
            notification_type=WAITLIST_NOTIFICATION_TYPE,
            channel=NotificationChannel.EMAIL,
            context={
                "name": "Asha Rao",
                "event_title": "Jazz Night",
                "event_when": "Sat 23 Aug 2026, 20:10 IST",
                "event_where": "Phoenix Arena, Mumbai",
                "url": "https://curatix.test/events/abc",
                "tickets_available": 2,
            },
        )
        assert "Jazz Night" in rendered.subject
        # The one line that keeps the message honest.
        assert "first come" in rendered.body
        assert "2 tickets" in rendered.body

    def test_the_template_survives_a_context_without_a_count(self):
        """The count comes off a nullable denormal. A template that assumed an
        integer would raise inside the fan-out — which is exactly the
        unisolated failure the batch loop now guards against, and this stops it
        needing to."""
        from apps.notifications.models import NotificationChannel
        from apps.notifications.templates import TemplateService

        rendered = TemplateService().render(
            notification_type=WAITLIST_NOTIFICATION_TYPE,
            channel=NotificationChannel.EMAIL,
            context={
                "event_title": "Jazz Night",
                "event_when": "Sat 23 Aug 2026, 20:10 IST",
                "event_where": "Phoenix Arena, Mumbai",
            },
        )
        assert "Tickets just became available" in rendered.body

    def test_the_scheduled_job_exists_and_names_a_registered_task(self):
        from core.scheduling import SCHEDULE
        from core.tasks import _registry  # noqa: PLC2701 — the registry IS the contract

        job = next(j for j in SCHEDULE if j.task_name == "events.waitlist_notify")
        assert job.interval_seconds == 120
        assert job.task_name in _registry


class TestTheEndpoints:
    """`POST`/`DELETE /events/{id}/waitlist` and `GET /me/waitlist`.

    Side effects are proved above; what is asserted here is the shape a client
    sees, and the two rules a per-user surface has to hold: it requires an
    account, and it must never be cached.
    """

    def url(self, event) -> str:
        return f"/api/v1/events/{event.id}/waitlist"

    @pytest.fixture
    def client_for(self, api_client, token_for):
        def _for(user):
            api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(user)}")
            return api_client

        return _for

    def test_joining_requires_an_account(self, api_client, make_event):
        """A waitlist join is a promise to CONTACT somebody, and an anonymous
        visitor has no address. The frontend keeps the affordance ungated and
        opens the sign-in sheet on the press; the API is simply authenticated."""
        assert api_client.post(self.url(make_event()), {}, format="json").status_code == 401

    def test_joining_returns_the_whole_set(self, client_for, other_user, make_event):
        """The client REPLACES its local set from this rather than reconciling,
        so a join, a leave and a page load all settle to one shape."""
        event = make_event()
        response = client_for(other_user).post(self.url(event), {}, format="json")

        assert response.status_code == 200
        assert response.json()["joined"] is True
        assert response.json()["event_ids"] == [str(event.id)]

    def test_it_is_never_cached(self, client_for, other_user, make_event):
        response = client_for(other_user).post(self.url(make_event()), {}, format="json")
        assert response["Cache-Control"] == "private, no-store"

    def test_joining_twice_is_still_one_row(self, client_for, other_user, make_event):
        event = make_event()
        client = client_for(other_user)
        client.post(self.url(event), {}, format="json")
        response = client.post(self.url(event), {}, format="json")

        assert response.json()["event_ids"] == [str(event.id)]
        assert EventWaitlist.objects.filter(event_id=event.id).count() == 1

    def test_leaving_answers_200_with_the_new_set(self, client_for, other_user, make_event):
        event = make_event()
        client = client_for(other_user)
        client.post(self.url(event), {}, format="json")

        response = client.delete(self.url(event))

        assert response.status_code == 200
        assert response.json() == {"joined": False, "event_ids": []}

    def test_leaving_a_list_you_are_not_on_is_still_200(self, client_for, other_user, make_event):
        """The caller's intent is "I should not be on this list", which is true
        either way."""
        assert client_for(other_user).delete(self.url(make_event())).status_code == 200

    def test_a_draft_event_cannot_be_joined(self, client_for, other_user, make_event):
        draft = make_event(status=EventStatus.DRAFT)
        assert client_for(other_user).post(self.url(draft), {}, format="json").status_code == 404

    def test_my_waitlist_lists_what_i_am_waiting_for(self, client_for, other_user, make_event):
        event = make_event(title="Jazz Night")
        client = client_for(other_user)
        client.post(self.url(event), {}, format="json")

        body = client.get("/api/v1/me/waitlist").json()

        assert [row["title"] for row in body["data"]] == ["Jazz Night"]
        assert body["event_ids"] == [str(event.id)]
        assert body["data"][0]["notified_at"] is None
        assert body["data"][0]["is_available"] is True

    def test_a_cancelled_event_STAYS_on_my_list_and_says_so(
        self, client_for, other_user, make_event
    ):
        """Hiding it would look like the join was lost, and a called-off show is
        precisely the thing somebody waiting needs to be told about."""
        event = make_event()
        client = client_for(other_user)
        client.post(self.url(event), {}, format="json")
        Event.objects.filter(pk=event.id).update(status=EventStatus.CANCELLED)

        row = client.get("/api/v1/me/waitlist").json()["data"][0]

        assert row["is_available"] is False

    def test_my_waitlist_requires_an_account(self, api_client):
        assert api_client.get("/api/v1/me/waitlist").status_code == 401

    def test_my_waitlist_is_never_cached(self, client_for, other_user):
        response = client_for(other_user).get("/api/v1/me/waitlist")
        assert response["Cache-Control"] == "private, no-store"

    def test_one_persons_list_is_not_anothers(self, client_for, other_user, owner, make_event):
        event = make_event()
        client_for(other_user).post(self.url(event), {}, format="json")

        assert client_for(owner).get("/api/v1/me/waitlist").json()["event_ids"] == []
