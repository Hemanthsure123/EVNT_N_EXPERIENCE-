from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.exceptions import (
    BookingNotAssignableError,
    BookingNotCancellableError,
    EventNotBookableError,
    InvalidAttendeeAssignmentsError,
    InvalidBookingItemsError,
    NotBookingOwnerError,
)
from apps.booking.models import Booking, BookingItem, BookingStatus, Ticket, TicketStatus
from apps.booking.qr import verify_ticket_token
from apps.booking.services import TICKET_ASSIGNED
from apps.booking.tests.conftest import QR_SECRET
from apps.ticketing.exceptions import SoldOutError
from apps.ticketing.repositories import TicketTypeRepository
from core.models import OutboxEvent


def _reserved(tier_id) -> int:
    tt = TicketTypeRepository().get_active_by_id(tier_id)
    assert tt is not None
    return tt.reserved


def _sold(tier_id) -> int:
    tt = TicketTypeRepository().get_active_by_id(tier_id)
    assert tt is not None
    return tt.sold


def _items(booking_id) -> list[BookingItem]:
    return list(BookingItem.objects.filter(booking_id=booking_id).order_by("unit_price_minor"))


# --- CreateBooking ---------------------------------------------------------


@pytest.mark.django_db
def test_create_booking_reserves_and_holds(booking_service, event, buyer, make_tier):
    tier = make_tier(price_minor=50000, quantity=100)

    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 2}],
    )

    booking = result.booking
    assert booking.status == BookingStatus.RESERVED
    # subtotal 2 x 50000, plus the 1% fee the customer now pays on top. It used
    # to be `100000` with a 20-paise fee taken OUT of the organizer's share.
    assert booking.total_amount_minor == 101000
    assert booking.platform_fee_minor == 1000  # 1% of 100000
    assert booking.donation_amount_minor == 0
    assert result.payment_order_id.startswith("fake_order_")
    assert _reserved(tier.id) == 2
    assert OutboxEvent.objects.filter(event_type="booking.booking_created").exists()


@pytest.mark.django_db
def test_line_items_are_billed_at_the_locked_phase_price(booking_service, event, buyer, make_tier):
    """The line items must carry the price the LOCK decided, not the face price
    read a moment before it — the total is what payments' webhook amount-checks,
    and an order whose lines don't add up to it is two different stories about
    the same money."""
    tier = make_tier(
        name="Gold",
        price_minor=50000,
        quantity=100,
        phases=[{"name": "Early bird", "price_minor": 30000, "quantity": 10}],
    )

    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 2}],
    )

    booking = result.booking
    # 2 x the phase price, not the face price — plus 1%.
    assert booking.total_amount_minor == 60600
    (item,) = _items(booking.id)
    assert item.unit_price_minor == 30000
    assert item.phase_name == "Early bird"
    # The point of this test is that the LINE reflects the locked phase price.
    # The fee sits between the line total and the charge, so the identity is
    # lines + fee == total rather than lines == total.
    assert item.quantity * item.unit_price_minor == 60000
    assert booking.platform_fee_minor == 600


@pytest.mark.django_db
def test_a_face_priced_line_records_no_phase(booking_service, event, buyer, make_tier):
    tier = make_tier(price_minor=50000, quantity=100)  # no schedule at all

    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 2}],
    )

    (item,) = _items(result.booking.id)
    assert item.unit_price_minor == 50000
    # NULL means "billed at the face price" — not a phase whose name was lost.
    assert item.phase_name is None


@pytest.mark.django_db
def test_line_items_sum_to_the_billed_total_across_mixed_tiers(
    booking_service, event, buyer, make_tier
):
    phased = make_tier(
        name="Gold",
        price_minor=80000,
        quantity=100,
        phases=[{"name": "Phase 1", "price_minor": 60000, "quantity": 10}],
    )
    face = make_tier(name="Basic", price_minor=20000, quantity=100)

    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[
            {"ticket_type_id": phased.id, "quantity": 2},
            {"ticket_type_id": face.id, "quantity": 3},
        ],
    )

    booking = result.booking
    items = _items(booking.id)
    assert [(i.unit_price_minor, i.phase_name) for i in items] == [
        (20000, None),
        (60000, "Phase 1"),
    ]
    # ── THE INVOICE STILL HAS TO ADD UP TO THE CHARGE ────────────────────
    #
    # It used to read `sum(lines) == total`. A fee is charged on top now, so the
    # identity gained a term — and stating it as `lines + fee == total` is
    # exactly as strong: an invoice whose parts do not reconcile to the amount
    # charged is not a display bug on the money path.
    subtotal = sum(i.quantity * i.unit_price_minor for i in items)
    assert subtotal == 180000  # 2 x 60000 + 3 x 20000
    assert booking.platform_fee_minor == 1800  # 1% of 180000
    assert subtotal + booking.platform_fee_minor == booking.total_amount_minor
    assert booking.total_amount_minor == 181800


@pytest.mark.django_db
def test_an_order_straddling_a_phase_threshold_records_what_it_paid(
    booking_service, event, buyer, make_tier
):
    """The phase's cumulative threshold leaves room for one seat, so an order of
    two falls through to the face price for the WHOLE order (ticketing's
    straddle rule). The invoice must say that, phase name and all."""
    tier = make_tier(
        price_minor=50000,
        quantity=100,
        phases=[{"name": "Early bird", "price_minor": 30000, "quantity": 1}],
    )

    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 2}],
    )

    booking = result.booking
    (item,) = _items(booking.id)
    assert item.unit_price_minor == 50000
    assert item.phase_name is None
    assert booking.total_amount_minor == 101000
    assert (
        item.quantity * item.unit_price_minor + booking.platform_fee_minor
        == booking.total_amount_minor
    )


@pytest.mark.django_db
def test_create_booking_is_all_or_nothing_across_tiers(booking_service, event, buyer, make_tier):
    plenty = make_tier(name="Basic", quantity=100)
    scarce = make_tier(name="VIP", quantity=1)  # only 1 left

    # Ask for 1 Basic (ok) + 2 VIP (impossible) → the whole booking must fail
    # and NOTHING may stay reserved.
    with pytest.raises(SoldOutError):
        booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[
                {"ticket_type_id": plenty.id, "quantity": 1},
                {"ticket_type_id": scarce.id, "quantity": 2},
            ],
        )

    assert _reserved(plenty.id) == 0  # the successful reserve was rolled back
    assert _reserved(scarce.id) == 0
    assert Booking.objects.count() == 0


@pytest.mark.django_db
def test_create_booking_is_idempotent_on_the_idempotency_key(
    booking_service, event, buyer, make_tier
):
    tier = make_tier(quantity=100)
    items = [{"ticket_type_id": tier.id, "quantity": 3}]

    first = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=items, idempotency_key="abc-123"
    )
    second = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=items, idempotency_key="abc-123"
    )

    assert first.booking.id == second.booking.id  # same booking, not a new one
    assert Booking.objects.count() == 1
    assert _reserved(tier.id) == 3  # reserved once, not twice


@pytest.mark.django_db
def test_create_booking_rejects_tier_from_another_event(booking_service, event, buyer, make_tier):
    from apps.events.models import Event, EventStatus
    from apps.events.repositories import EventRepository

    other = EventRepository().create(
        organization_id=event.organization_id,
        title="Other",
        venue="X",
        city="Y",
        starts_at=timezone.now() + timedelta(days=10),
    )
    Event.objects.filter(pk=other.id).update(status=EventStatus.LIVE)
    foreign_tier = make_tier(ev=other)

    with pytest.raises(InvalidBookingItemsError):
        booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": foreign_tier.id, "quantity": 1}],
        )


@pytest.mark.django_db
def test_create_booking_rejects_a_draft_event(booking_service, buyer, make_tier):
    from apps.events.models import Event, EventStatus
    from apps.events.repositories import EventRepository

    draft = EventRepository().create(
        organization_id=make_tier().event.organization_id,
        title="Draft",
        venue="X",
        city="Y",
        starts_at=timezone.now() + timedelta(days=10),
    )
    Event.objects.filter(pk=draft.id).update(status=EventStatus.DRAFT)
    tier = make_tier(ev=draft)

    with pytest.raises(EventNotBookableError):
        booking_service.create_booking(
            user_id=buyer.id, event_id=draft.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
        )


# --- CancelBooking ---------------------------------------------------------


@pytest.mark.django_db
def test_cancel_releases_inventory_and_marks_cancelled(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 4}]
    )
    assert _reserved(tier.id) == 4

    booking = booking_service.cancel_booking(booking_id=result.booking.id, actor_id=buyer.id)

    assert booking.status == BookingStatus.CANCELLED
    assert _reserved(tier.id) == 0  # inventory freed


@pytest.mark.django_db
def test_cancel_by_non_owner_is_rejected(booking_service, event, buyer, other_user, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )

    with pytest.raises(NotBookingOwnerError):
        booking_service.cancel_booking(booking_id=result.booking.id, actor_id=other_user.id)


@pytest.mark.django_db
def test_cancel_a_paid_booking_is_rejected(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )
    booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    with pytest.raises(BookingNotCancellableError):
        booking_service.cancel_booking(booking_id=result.booking.id, actor_id=buyer.id)


# --- ReleaseExpired (sweeper) ----------------------------------------------


@pytest.mark.django_db
def test_sweeper_auto_releases_expired_holds(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 5}]
    )
    assert _reserved(tier.id) == 5

    # Force the hold into the past.
    Booking.objects.filter(pk=result.booking.id).update(
        hold_expires_at=timezone.now() - timedelta(minutes=1)
    )

    released = booking_service.release_expired_bookings()

    assert released == 1
    assert _reserved(tier.id) == 0  # inventory restored
    result.booking.refresh_from_db()
    assert result.booking.status == BookingStatus.EXPIRED


@pytest.mark.django_db
def test_sweeper_leaves_live_holds_untouched(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    )

    released = booking_service.release_expired_bookings()

    assert released == 0
    assert _reserved(tier.id) == 2  # still held


# --- ConfirmBooking (Stage 2) ----------------------------------------------


@pytest.mark.django_db
def test_confirm_issues_signed_tickets_and_converts_reserved_to_sold(
    booking_service, event, buyer, make_tier
):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 3}]
    )

    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    assert outcome.issued is True
    assert len(outcome.tickets) == 3
    assert _sold(tier.id) == 3
    assert _reserved(tier.id) == 0
    # Every issued ticket has a valid, verifiable token.
    for ticket in outcome.tickets:
        payload = verify_ticket_token(ticket.qr_token, secret=QR_SECRET)
        assert payload is not None
        assert payload.ticket_id == str(ticket.id)
        assert payload.event_id == str(event.id)
    assert OutboxEvent.objects.filter(event_type="booking.booking_confirmed").exists()
    assert OutboxEvent.objects.filter(event_type="booking.ticket_issued").exists()


@pytest.mark.django_db
def test_confirm_is_idempotent_never_issues_duplicate_tickets(
    booking_service, event, buyer, make_tier
):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    )

    first = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")
    second = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    assert first.issued is True
    assert second.issued is False
    assert second.reason == "already_confirmed"
    assert {t.id for t in first.tickets} == {t.id for t in second.tickets}
    # Exactly one set of tickets exists — no duplicates from the second call.
    assert Ticket.objects.filter(booking_id=result.booking.id).count() == 2
    assert _sold(tier.id) == 2  # not 4


@pytest.mark.django_db
def test_confirm_after_expiry_issues_no_tickets(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    )
    Booking.objects.filter(pk=result.booking.id).update(
        hold_expires_at=timezone.now() - timedelta(minutes=1)
    )

    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_late")

    assert outcome.issued is False
    assert outcome.reason == "hold_expired"
    assert outcome.tickets == []
    assert Ticket.objects.filter(booking_id=result.booking.id).count() == 0
    assert _sold(tier.id) == 0  # nothing sold


@pytest.mark.django_db
def test_confirm_a_cancelled_booking_issues_nothing(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )
    booking_service.cancel_booking(booking_id=result.booking.id, actor_id=buyer.id)

    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_x")

    assert outcome.issued is False
    assert outcome.reason == "hold_expired"
    assert Ticket.objects.filter(booking_id=result.booking.id).count() == 0


# --- AssignAttendees (who each ticket is for) ------------------------------


def _paid_booking(booking_service, event, buyer, make_tier, quantity=3):
    """A paid booking with `quantity` issued tickets — the only state in which
    attendees can be named."""
    tier = make_tier(name="Gold", quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": quantity}],
    )
    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")
    return result.booking, outcome.tickets


def _assigned_events() -> list[dict]:
    return list(
        OutboxEvent.objects.filter(event_type=TICKET_ASSIGNED)
        .order_by("created_at")
        .values_list("payload", flat=True)
    )


@pytest.mark.django_db
def test_assign_attendees_names_tickets_and_publishes_one_event_each(
    booking_service, event, buyer, make_tier
):
    booking, tickets = _paid_booking(booking_service, event, buyer, make_tier, quantity=3)

    updated = booking_service.assign_attendees(
        booking_id=booking.id,
        actor_id=buyer.id,
        assignments=[
            {"ticket_id": tickets[0].id, "name": "Asha Rao", "email": "asha@example.com"},
            {"ticket_id": tickets[1].id, "name": "Dev Patel", "email": "dev@example.com"},
        ],
    )

    by_id = {str(t.id): t for t in updated}
    assert by_id[str(tickets[0].id)].attendee_name == "Asha Rao"
    assert by_id[str(tickets[0].id)].attendee_email == "asha@example.com"
    # The third ticket is untouched: blank means the buyer is going.
    assert by_id[str(tickets[2].id)].attendee_email == ""

    payloads = _assigned_events()
    assert len(payloads) == 2
    first = payloads[0]
    assert first["ticket_id"] == str(tickets[0].id)
    assert first["booking_id"] == str(booking.id)
    assert first["event_id"] == str(event.id)
    assert first["attendee_name"] == "Asha Rao"
    assert first["attendee_email"] == "asha@example.com"
    assert first["ticket_type_name"] == "Gold"


@pytest.mark.django_db
def test_assign_attendees_by_non_owner_is_rejected(
    booking_service, event, buyer, other_user, make_tier
):
    booking, tickets = _paid_booking(booking_service, event, buyer, make_tier, quantity=1)

    with pytest.raises(NotBookingOwnerError):
        booking_service.assign_attendees(
            booking_id=booking.id,
            actor_id=other_user.id,
            assignments=[{"ticket_id": tickets[0].id, "name": "Thief", "email": "t@example.com"}],
        )

    tickets[0].refresh_from_db()
    assert tickets[0].attendee_email == ""
    assert _assigned_events() == []


@pytest.mark.django_db
def test_assign_attendees_rejects_a_ticket_from_another_booking(
    booking_service, event, buyer, other_user, make_tier
):
    """The check that matters: the ticket ids are the only thing the caller
    supplies, so without this somebody could re-address another person's ticket
    to their own inbox."""
    booking, _mine = _paid_booking(booking_service, event, buyer, make_tier, quantity=1)
    tier = make_tier(name="Silver", quantity=100)
    theirs = booking_service.create_booking(
        user_id=other_user.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )
    stolen = booking_service.confirm_booking(
        booking_id=theirs.booking.id, payment_ref="pay_theirs"
    ).tickets[0]

    with pytest.raises(InvalidAttendeeAssignmentsError):
        booking_service.assign_attendees(
            booking_id=booking.id,
            actor_id=buyer.id,
            assignments=[{"ticket_id": stolen.id, "name": "Thief", "email": "thief@example.com"}],
        )

    stolen.refresh_from_db()
    assert stolen.attendee_email == ""
    assert _assigned_events() == []


@pytest.mark.django_db
def test_assign_attendees_on_an_unpaid_booking_is_rejected(
    booking_service, event, buyer, make_tier
):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    )

    with pytest.raises(BookingNotAssignableError):
        booking_service.assign_attendees(
            booking_id=result.booking.id,
            actor_id=buyer.id,
            assignments=[
                # A reserved booking has no tickets at all, so any id is wrong —
                # the booking's own state is what refuses first.
                {"ticket_id": result.booking.id, "name": "Asha", "email": "asha@example.com"}
            ],
        )

    assert _assigned_events() == []


@pytest.mark.django_db
def test_reassigning_the_same_address_publishes_nothing(booking_service, event, buyer, make_tier):
    """Re-submitting the form must not email the same person the same ticket
    again — the address is what decides, and it hasn't changed."""
    booking, tickets = _paid_booking(booking_service, event, buyer, make_tier, quantity=2)
    assignment = [{"ticket_id": tickets[0].id, "name": "Asha Rao", "email": "asha@example.com"}]

    booking_service.assign_attendees(
        booking_id=booking.id, actor_id=buyer.id, assignments=assignment
    )
    booking_service.assign_attendees(
        booking_id=booking.id, actor_id=buyer.id, assignments=assignment
    )
    # Same person, differently cased address and a corrected name: still the
    # same mailbox, so still no second copy.
    booking_service.assign_attendees(
        booking_id=booking.id,
        actor_id=buyer.id,
        assignments=[
            {"ticket_id": tickets[0].id, "name": "Asha Rao-Iyer", "email": "Asha@Example.com"}
        ],
    )

    assert len(_assigned_events()) == 1
    tickets[0].refresh_from_db()
    assert tickets[0].attendee_name == "Asha Rao-Iyer"  # the correction landed


@pytest.mark.django_db
def test_reassigning_to_a_new_address_publishes_once(booking_service, event, buyer, make_tier):
    """People mistype addresses. The corrected one gets its own copy, and
    exactly one."""
    booking, tickets = _paid_booking(booking_service, event, buyer, make_tier, quantity=2)

    booking_service.assign_attendees(
        booking_id=booking.id,
        actor_id=buyer.id,
        assignments=[{"ticket_id": tickets[0].id, "name": "Asha", "email": "asha@exmaple.com"}],
    )
    booking_service.assign_attendees(
        booking_id=booking.id,
        actor_id=buyer.id,
        assignments=[{"ticket_id": tickets[0].id, "name": "Asha", "email": "asha@example.com"}],
    )

    payloads = _assigned_events()
    assert len(payloads) == 2
    assert [p["attendee_email"] for p in payloads] == ["asha@exmaple.com", "asha@example.com"]


@pytest.mark.django_db
def test_clearing_an_assignment_is_allowed_and_publishes_nothing(
    booking_service, event, buyer, make_tier
):
    booking, tickets = _paid_booking(booking_service, event, buyer, make_tier, quantity=1)
    booking_service.assign_attendees(
        booking_id=booking.id,
        actor_id=buyer.id,
        assignments=[{"ticket_id": tickets[0].id, "name": "Asha", "email": "asha@example.com"}],
    )

    booking_service.assign_attendees(
        booking_id=booking.id,
        actor_id=buyer.id,
        assignments=[{"ticket_id": tickets[0].id, "name": "", "email": ""}],
    )

    tickets[0].refresh_from_db()
    assert tickets[0].attendee_name == ""
    assert tickets[0].attendee_email == ""
    assert len(_assigned_events()) == 1  # the clear sends nobody anything


@pytest.mark.django_db
def test_assign_attendees_rejects_more_attendees_than_tickets(
    booking_service, event, buyer, make_tier
):
    booking, tickets = _paid_booking(booking_service, event, buyer, make_tier, quantity=2)

    with pytest.raises(InvalidAttendeeAssignmentsError):
        booking_service.assign_attendees(
            booking_id=booking.id,
            actor_id=buyer.id,
            assignments=[
                {"ticket_id": tickets[0].id, "name": "A", "email": "a@example.com"},
                {"ticket_id": tickets[1].id, "name": "B", "email": "b@example.com"},
                {"ticket_id": tickets[0].id, "name": "C", "email": "c@example.com"},
            ],
        )

    assert _assigned_events() == []


@pytest.mark.django_db
def test_assign_attendees_rejects_the_same_ticket_twice(booking_service, event, buyer, make_tier):
    booking, tickets = _paid_booking(booking_service, event, buyer, make_tier, quantity=2)

    with pytest.raises(InvalidAttendeeAssignmentsError):
        booking_service.assign_attendees(
            booking_id=booking.id,
            actor_id=buyer.id,
            assignments=[
                {"ticket_id": tickets[0].id, "name": "A", "email": "a@example.com"},
                {"ticket_id": tickets[0].id, "name": "B", "email": "b@example.com"},
            ],
        )

    assert _assigned_events() == []


@pytest.mark.django_db
def test_assign_attendees_requires_both_a_name_and_an_email(
    booking_service, event, buyer, make_tier
):
    booking, tickets = _paid_booking(booking_service, event, buyer, make_tier, quantity=1)

    with pytest.raises(InvalidAttendeeAssignmentsError):
        booking_service.assign_attendees(
            booking_id=booking.id,
            actor_id=buyer.id,
            assignments=[{"ticket_id": tickets[0].id, "name": "Asha", "email": ""}],
        )


@pytest.mark.django_db
def test_assign_attendees_refuses_a_voided_ticket(booking_service, event, buyer, make_tier):
    """A refunded ticket admits nobody; mailing it to somebody is a promise the
    gate will refuse."""
    booking, tickets = _paid_booking(booking_service, event, buyer, make_tier, quantity=1)
    booking_service.void_tickets_for_booking(booking_id=booking.id)

    with pytest.raises(InvalidAttendeeAssignmentsError):
        booking_service.assign_attendees(
            booking_id=booking.id,
            actor_id=buyer.id,
            assignments=[{"ticket_id": tickets[0].id, "name": "Asha", "email": "asha@example.com"}],
        )

    assert _assigned_events() == []


@pytest.mark.django_db
def test_ticket_status_defaults_to_active(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )
    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    assert outcome.tickets[0].status == TicketStatus.ACTIVE
