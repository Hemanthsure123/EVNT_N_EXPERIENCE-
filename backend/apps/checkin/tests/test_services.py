"""Behavioural tests for VerifyAndMarkUsed — the gate decision.

The concurrency guarantee (two simultaneous scans, exactly one admitted) is the
module's most important test and lives separately in test_concurrency.py.
"""

from __future__ import annotations

import uuid

import pytest

from apps.booking.models import Ticket, TicketStatus
from apps.booking.qr import sign_ticket
from apps.booking.repositories import TicketRepository
from apps.checkin.exceptions import EventNotFoundForCheckinError, NotEventCheckerError
from apps.checkin.models import ScanLog, ScanResult
from apps.events.models import Event

from .conftest import QR_SECRET


@pytest.mark.django_db
def test_valid_unused_ticket_is_admitted_and_marked_used(
    checkin_service, issued_ticket, event, organizer
):
    result = checkin_service.verify_and_mark_used(
        event_id=event.id, qr_token=issued_ticket.qr_token, gate="North", scanned_by_id=organizer.id
    )

    assert result.allowed is True
    assert result.reason == ScanResult.ALLOWED
    assert result.ticket_id == str(issued_ticket.id)
    assert result.gate == "North"

    issued_ticket.refresh_from_db()
    assert issued_ticket.status == TicketStatus.USED
    assert issued_ticket.used_at is not None
    assert issued_ticket.gate == "North"

    logs = ScanLog.objects.filter(ticket_id=issued_ticket.id)
    assert logs.count() == 1
    log = logs.first()
    assert log is not None
    assert log.result == ScanResult.ALLOWED


@pytest.mark.django_db
def test_rescan_of_admitted_ticket_is_denied_already_used(
    checkin_service, issued_ticket, event, organizer
):
    first = checkin_service.verify_and_mark_used(
        event_id=event.id, qr_token=issued_ticket.qr_token, gate="North", scanned_by_id=organizer.id
    )
    second = checkin_service.verify_and_mark_used(
        event_id=event.id, qr_token=issued_ticket.qr_token, gate="South", scanned_by_id=organizer.id
    )

    assert first.allowed is True
    assert second.allowed is False
    assert second.reason == ScanResult.DENIED_ALREADY_USED

    # Still used exactly once — admitted count unchanged by the re-scan.
    assert TicketRepository().count_used_for_event(event.id) == 1
    # Both scans are audited; the ticket keeps its ORIGINAL gate/used_at.
    assert ScanLog.objects.filter(ticket_id=issued_ticket.id).count() == 2
    issued_ticket.refresh_from_db()
    assert issued_ticket.gate == "North"


@pytest.mark.django_db
def test_forged_token_is_denied_invalid_without_touching_the_db(
    checkin_service, event, organizer, django_assert_num_queries
):
    with django_assert_num_queries(0):
        result = checkin_service.verify_and_mark_used(
            event_id=event.id,
            qr_token="v1.tampered.signature",
            gate="North",
            scanned_by_id=organizer.id,
        )

    assert result.allowed is False
    assert result.reason == ScanResult.DENIED_INVALID
    assert ScanLog.objects.count() == 0  # forged scans are never recorded in the DB


@pytest.mark.django_db
def test_tampered_valid_looking_token_is_denied_invalid(
    checkin_service, issued_ticket, event, organizer
):
    # Flip the last character of a genuine token's signature → invalid HMAC.
    good = issued_ticket.qr_token
    forged = good[:-1] + ("A" if good[-1] != "A" else "B")

    result = checkin_service.verify_and_mark_used(
        event_id=event.id, qr_token=forged, gate="North", scanned_by_id=organizer.id
    )

    assert result.allowed is False
    assert result.reason == ScanResult.DENIED_INVALID
    issued_ticket.refresh_from_db()
    assert issued_ticket.status == TicketStatus.ACTIVE  # untouched


@pytest.mark.django_db
def test_signed_but_unknown_ticket_is_denied_invalid(checkin_service, event, organizer):
    # A signature valid under our key but for a ticket that doesn't exist.
    token = sign_ticket(ticket_id=uuid.uuid4(), event_id=event.id, secret=QR_SECRET)

    result = checkin_service.verify_and_mark_used(
        event_id=event.id, qr_token=token, gate="North", scanned_by_id=organizer.id
    )

    assert result.allowed is False
    assert result.reason == ScanResult.DENIED_INVALID
    assert ScanLog.objects.count() == 0  # no real ticket to attribute an audit row to


@pytest.mark.django_db
def test_ticket_for_another_event_is_denied_wrong_event(
    checkin_service, booking_service, issued_ticket, organization, organizer, event
):
    # A second event under the SAME organizer (so authorization passes) — the
    # ticket belongs to `event`, but it's presented at `other_event`'s gate.
    from datetime import timedelta

    from django.utils import timezone

    from apps.events.models import EventStatus
    from apps.events.repositories import EventRepository

    other = EventRepository().create(
        organization_id=organization.id,
        title="Other Show",
        venue="Hall B",
        city="Mumbai",
        starts_at=timezone.now() - timedelta(hours=1),
        ends_at=timezone.now() + timedelta(hours=3),
    )
    Event.objects.filter(pk=other.id).update(status=EventStatus.LIVE)

    result = checkin_service.verify_and_mark_used(
        event_id=other.id, qr_token=issued_ticket.qr_token, gate="North", scanned_by_id=organizer.id
    )

    assert result.allowed is False
    assert result.reason == ScanResult.DENIED_WRONG_EVENT
    issued_ticket.refresh_from_db()
    assert issued_ticket.status == TicketStatus.ACTIVE  # not admitted
    # The denial is recorded against the GATE's event.
    log = ScanLog.objects.get(ticket_id=issued_ticket.id)
    assert log.result == ScanResult.DENIED_WRONG_EVENT
    assert str(log.event_id) == str(other.id)


@pytest.mark.django_db
def test_void_ticket_is_denied_not_active(checkin_service, issued_ticket, event, organizer):
    # A refund voids tickets (see the refund path); a void ticket can't enter.
    Ticket.objects.filter(pk=issued_ticket.id).update(status=TicketStatus.VOID)

    result = checkin_service.verify_and_mark_used(
        event_id=event.id, qr_token=issued_ticket.qr_token, gate="North", scanned_by_id=organizer.id
    )

    assert result.allowed is False
    assert result.reason == ScanResult.DENIED_NOT_ACTIVE


@pytest.mark.django_db
def test_refunded_booking_tickets_are_voided_and_denied(
    checkin_service, booking_service, issued_ticket, event, organizer
):
    # Booking's void step (what payments calls on refund) makes the ticket dead.
    voided = booking_service.void_tickets_for_booking(booking_id=issued_ticket.booking_id)
    assert voided == 1

    result = checkin_service.verify_and_mark_used(
        event_id=event.id, qr_token=issued_ticket.qr_token, gate="North", scanned_by_id=organizer.id
    )
    assert result.reason == ScanResult.DENIED_NOT_ACTIVE


@pytest.mark.django_db
def test_scan_well_outside_the_window_is_denied(
    checkin_service, booking_service, future_event, make_tier, buyer, organizer
):
    from .conftest import issue_one_ticket

    tier = make_tier(future_event)
    ticket = issue_one_ticket(booking_service, buyer=buyer, event=future_event, tier=tier)

    result = checkin_service.verify_and_mark_used(
        event_id=future_event.id, qr_token=ticket.qr_token, gate="North", scanned_by_id=organizer.id
    )

    assert result.allowed is False
    assert result.reason == ScanResult.DENIED_OUT_OF_WINDOW


@pytest.mark.django_db
def test_non_organizer_is_refused(checkin_service, issued_ticket, event, other_user):
    with pytest.raises(NotEventCheckerError):
        checkin_service.verify_and_mark_used(
            event_id=event.id,
            qr_token=issued_ticket.qr_token,
            gate="North",
            scanned_by_id=other_user.id,
        )
    # Nothing was admitted or recorded.
    issued_ticket.refresh_from_db()
    assert issued_ticket.status == TicketStatus.ACTIVE
    assert ScanLog.objects.count() == 0


@pytest.mark.django_db
def test_admin_may_check_in_any_event(checkin_service, issued_ticket, event, other_user):
    result = checkin_service.verify_and_mark_used(
        event_id=event.id,
        qr_token=issued_ticket.qr_token,
        gate="VIP",
        scanned_by_id=other_user.id,
        is_admin=True,
    )
    assert result.allowed is True


@pytest.mark.django_db
def test_unknown_event_raises_not_found(checkin_service, issued_ticket, organizer):
    with pytest.raises(EventNotFoundForCheckinError):
        checkin_service.verify_and_mark_used(
            event_id=uuid.uuid4(),
            qr_token=issued_ticket.qr_token,
            gate="North",
            scanned_by_id=organizer.id,
        )
