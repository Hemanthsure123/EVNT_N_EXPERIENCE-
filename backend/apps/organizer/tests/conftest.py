"""Shared fixtures for organizer tests.

The cache fixture is the same one `console` needs and for the same reason: the
selectors are cache-aside, and a cache is exactly the state Django's per-test
transaction rollback does NOT undo. Without it the first test to read an
overview serves its numbers to every test after it — the classic "passes alone,
fails in the suite" shape.

It clears the DI cache rather than `django.core.cache`, because `cache_port()`
is an `@lru_cache` singleton wrapping the adapter's own dict, which Django's
cache framework knows nothing about.

`world` builds a complete two-organizer fixture, and the SECOND organizer is
the point of it: almost every test here is really asking "does this number
include somebody else's rows", and that question needs somebody else to exist.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.booking.models import Booking, BookingItem, BookingStatus, Ticket, TicketStatus
from apps.checkin.models import ScanLog, ScanResult
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization
from apps.payments.models import Payment, PaymentStatus, Refund
from apps.ticketing.models import TicketType
from config.di import cache_port


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache_port.cache_clear()
    yield
    cache_port.cache_clear()


@dataclass
class World:
    """One organizer's world, plus a rival's, so leakage is testable."""

    owner: User
    rival: User
    customer: User
    other_customer: User
    organization: Organization
    event: Event
    second_event: Event
    rival_event: Event
    tier: TicketType
    booking: Booking


@pytest.fixture
def world(db) -> World:
    now = timezone.now()

    owner = User.objects.create_user(email="owner@example.com", password="ownerpass12345")
    rival = User.objects.create_user(email="rival@example.com", password="rivalpass12345")
    customer = User.objects.create_user(
        email="asha@example.com", password="custpass12345", full_name="Asha Rao"
    )
    other_customer = User.objects.create_user(
        email="bala@example.com", password="custpass12345", full_name="Bala Iyer"
    )

    organization = Organization.objects.create(owner=owner, name="Owner Events")
    rival_org = Organization.objects.create(owner=rival, name="Rival Events")

    event = Event.objects.create(
        organization=organization,
        title="Summer Sessions",
        venue="Phoenix Arena",
        city="Mumbai",
        starts_at=now + dt.timedelta(days=10),
        status=EventStatus.LIVE,
    )
    second_event = Event.objects.create(
        organization=organization,
        title="Winter Nights",
        venue="Indira Hall",
        city="Pune",
        starts_at=now + dt.timedelta(days=40),
        status=EventStatus.DRAFT,
    )
    rival_event = Event.objects.create(
        organization=rival_org,
        title="Rival Fest",
        venue="Somewhere Else",
        city="Delhi",
        starts_at=now + dt.timedelta(days=15),
        status=EventStatus.LIVE,
    )

    tier = TicketType.objects.create(
        event=event, name="Gold", price_minor=250_000, quantity=100, sold=4
    )
    TicketType.objects.create(event=event, name="Silver", price_minor=100_000, quantity=200, sold=2)
    rival_tier = TicketType.objects.create(
        event=rival_event, name="Rival Gold", price_minor=999_000, quantity=50, sold=10
    )

    booking = _paid_booking(customer, event, tier, quantity=2, amount=500_000)
    _paid_booking(other_customer, event, tier, quantity=1, amount=250_000)
    # A second purchase by the same customer — makes them a REPEAT customer,
    # which the audience number is supposed to notice.
    _paid_booking(customer, second_event, tier, quantity=1, amount=250_000)
    # An abandoned hold: the denominator of every conversion rate here.
    Booking.objects.create(
        user=other_customer,
        event=event,
        status=BookingStatus.EXPIRED,
        hold_expires_at=now - dt.timedelta(minutes=10),
        total_amount_minor=250_000,
        platform_fee_minor=1_000,
    )
    # The rival's money, which must never appear in the owner's totals.
    _paid_booking(rival, rival_event, rival_tier, quantity=1, amount=999_000)

    # One real admission. The ticket is marked USED *and* a scan is logged,
    # because that is what `checkin` does — in one transaction, under the
    # ticket's row lock. A ScanLog(allowed) whose ticket is still active is a
    # state production can never reach, and a fixture that produces it hides
    # exactly the disagreement between the two counts that matters here.
    admitted = Ticket.objects.filter(booking=booking).first()
    assert admitted is not None
    admitted.status = TicketStatus.USED
    admitted.used_at = now
    admitted.gate = "Gate A"
    admitted.save(update_fields=["status", "used_at", "gate"])
    ScanLog.objects.create(
        ticket=admitted,
        event=event,
        scanned_by=owner,
        gate="Gate A",
        result=ScanResult.ALLOWED,
    )

    return World(
        owner=owner,
        rival=rival,
        customer=customer,
        other_customer=other_customer,
        organization=organization,
        event=event,
        second_event=second_event,
        rival_event=rival_event,
        tier=tier,
        booking=booking,
    )


def _paid_booking(
    user: User, event: Event, tier: TicketType, *, quantity: int, amount: int
) -> Booking:
    booking = Booking.objects.create(
        user=user,
        event=event,
        status=BookingStatus.PAID,
        hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
        total_amount_minor=amount,
        platform_fee_minor=1_000,
        payment_ref=f"pay_{uuid.uuid4().hex[:12]}",
    )
    BookingItem.objects.create(
        booking=booking, ticket_type=tier, quantity=quantity, unit_price_minor=tier.price_minor
    )
    for _ in range(quantity):
        Ticket.objects.create(
            booking=booking,
            ticket_type=tier,
            qr_token=f"v1.{uuid.uuid4().hex}",
            status=TicketStatus.ACTIVE,
        )
    Payment.objects.create(
        booking=booking,
        rzp_order_id=f"order_{uuid.uuid4().hex[:12]}",
        rzp_payment_id=f"pay_{uuid.uuid4().hex[:12]}",
        amount_minor=amount,
        status=PaymentStatus.PAID,
    )
    return booking


def refund(booking: Booking, amount: int) -> Refund:
    payment = Payment.objects.filter(booking=booking).first()
    assert payment is not None
    return Refund.objects.create(
        payment=payment, rzp_refund_id=f"rfnd_{uuid.uuid4().hex[:10]}", amount_minor=amount
    )
