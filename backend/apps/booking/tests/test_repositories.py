from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.models import Booking, BookingStatus, Ticket
from apps.booking.repositories import BookingRepository, TicketRepository


@pytest.fixture
def repo() -> BookingRepository:
    return BookingRepository()


def _make_booking(buyer, event, *, status=BookingStatus.RESERVED, hold_minutes=10):
    return Booking.objects.create(
        user_id=buyer.id,
        event_id=event.id,
        status=status,
        hold_expires_at=timezone.now() + timedelta(minutes=hold_minutes),
        total_amount_minor=1000,
        platform_fee_minor=10,
    )


def _keyed(buyer, event, *, key, status=BookingStatus.RESERVED, hold_minutes=10):
    return Booking.objects.create(
        user_id=buyer.id,
        event_id=event.id,
        status=status,
        hold_expires_at=timezone.now() + timedelta(minutes=hold_minutes),
        total_amount_minor=1000,
        platform_fee_minor=10,
        idempotency_key=key,
    )


@pytest.mark.django_db
def test_a_live_hold_replays(repo, buyer, event):
    booking = _keyed(buyer, event, key="key-1")

    assert repo.get_replayable_by_idempotency_key(buyer.id, "key-1").id == booking.id
    assert repo.get_replayable_by_idempotency_key(buyer.id, "missing") is None


@pytest.mark.django_db
def test_a_paid_booking_replays_forever(repo, buyer, event):
    """The tickets exist. Whatever else is true of the deadline, a retry has to
    get the SAME booking back rather than buying a second set."""
    booking = _keyed(buyer, event, key="k", status=BookingStatus.PAID, hold_minutes=-500)

    assert repo.get_replayable_by_idempotency_key(buyer.id, "k").id == booking.id


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("status", "hold_minutes"),
    [
        (BookingStatus.EXPIRED, -1),
        (BookingStatus.CANCELLED, 10),
        # The window between the hold lapsing and the sweeper noticing. The row
        # still says `reserved`; the seats are gone all the same.
        (BookingStatus.RESERVED, -1),
    ],
)
def test_a_dead_booking_does_not_replay(repo, buyer, event, status, hold_minutes):
    """The bug this whole pair of methods exists for: replaying one of these
    returned a booking whose hold had run out before the page opened, and did
    it again on every retry — because retrying was what triggered it."""
    _keyed(buyer, event, key="k", status=status, hold_minutes=hold_minutes)

    assert repo.get_replayable_by_idempotency_key(buyer.id, "k") is None


@pytest.mark.django_db
def test_releasing_frees_the_key_for_a_fresh_booking(repo, buyer, event):
    """`(user, idempotency_key)` is UNIQUE, so declining to replay is only half
    the fix — without this the retry collides with the row it just ignored."""
    dead = _keyed(buyer, event, key="k", status=BookingStatus.EXPIRED, hold_minutes=-1)

    assert repo.release_idempotency_key(buyer.id, "k") == 1
    dead.refresh_from_db()
    assert dead.idempotency_key is None
    # And the key is now insertable again.
    fresh = _keyed(buyer, event, key="k")
    assert repo.get_replayable_by_idempotency_key(buyer.id, "k").id == fresh.id


@pytest.mark.django_db
def test_releasing_never_touches_a_booking_that_can_still_replay(repo, buyer, event):
    live = _keyed(buyer, event, key="k")

    assert repo.release_idempotency_key(buyer.id, "k") == 0
    live.refresh_from_db()
    assert live.idempotency_key == "k"


@pytest.mark.django_db
def test_list_expired_reserved_ids_finds_only_lapsed_reserved(repo, buyer, event):
    live = _make_booking(buyer, event, hold_minutes=10)
    expired = _make_booking(buyer, event, hold_minutes=-5)  # past
    paid = _make_booking(buyer, event, hold_minutes=-5, status=BookingStatus.PAID)

    ids = repo.list_expired_reserved_ids(now=timezone.now())

    assert expired.id in ids
    assert live.id not in ids  # still in its window
    assert paid.id not in ids  # not reserved anymore


@pytest.mark.django_db
def test_get_detail_loads_event_and_items(repo, booking_service, buyer, event, make_tier):
    tier = make_tier(name="Gold", quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    )

    detail = repo.get_detail(result.booking.id)

    assert detail is not None
    assert detail.event.title == "Headline Show"
    items = list(detail.items.all())
    assert len(items) == 1
    assert items[0].ticket_type.name == "Gold"
    # A reserved booking has no tickets yet — prefetched empty, never absent.
    assert list(detail.tickets.all()) == []


@pytest.mark.django_db
def test_list_for_attendee_assignment_is_one_query_with_the_tier_name(
    booking_service, buyer, event, make_tier, django_assert_num_queries
):
    """The tier name goes into the TICKET_ASSIGNED payload, so it must come
    back joined — otherwise a ten-seat booking is ten extra queries inside the
    booking lock."""
    tier = make_tier(name="Gold", quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 3}]
    )
    booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    with django_assert_num_queries(1):
        tickets = TicketRepository().list_for_attendee_assignment(result.booking.id)
        assert [t.ticket_type.name for t in tickets] == ["Gold", "Gold", "Gold"]
        assert all(t.attendee_email == "" for t in tickets)


@pytest.mark.django_db
def test_a_bookings_tickets_come_back_in_a_STABLE_order(booking_service, buyer, event, make_tier):
    """`ORDER BY created_at` alone is a TIE, and this is the test that proves it.

    A booking's tickets are written by ONE `bulk_create`. `auto_now_add` stamps
    every row in that batch with the same `timezone.now()` — identical to the
    microsecond — so ordering by it leaves Postgres free to return the rows in
    whichever order it happens to find them. The delivery email renders that
    list, and the attendee-naming form submits against it POSITIONALLY, which
    is how a name gets written onto the wrong ticket.

    The tie is FORCED here rather than hoped for. `auto_now_add` calls
    `timezone.now()` once per row inside the batch, so on a fast, idle machine
    the four stamps are identical and on a loaded one they are microseconds
    apart — which made asserting "they tie" a test that failed in a full suite
    run and passed on its own. That flake was the test's fault, not the code's:
    whether the clock ticks mid-batch is not the guarantee anybody needs.

    So the rows are stamped identically by hand, which is the WORST case rather
    than a likely one, and the assertions below are then about the fix alone.
    """
    tier = make_tier(name="Gold", quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 4}]
    )
    booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_stable")

    # `update()` bypasses `auto_now_add`, so this is the exact tie the ordering
    # has to survive: four rows Postgres may return in any order it likes.
    Ticket.objects.filter(booking_id=result.booking.id).update(
        created_at=timezone.now().replace(microsecond=0)
    )

    repo = TicketRepository()
    first = [str(t.id) for t in repo.list_for_booking(result.booking.id)]

    assert len({t.created_at for t in repo.list_for_booking(result.booking.id)}) == 1
    assert len(first) == 4
    for _ in range(4):
        assert [str(t.id) for t in repo.list_for_booking(result.booking.id)] == first
    # The naming form reads the other query; it must agree, or a positional
    # submission lands on a different ticket than the one displayed.
    assert [str(t.id) for t in repo.list_for_attendee_assignment(result.booking.id)] == first
