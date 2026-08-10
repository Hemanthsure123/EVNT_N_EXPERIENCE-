"""POST /admin/events/{id}/delete — an operator removes an event.

Three properties carry the weight, and each is a different way this could go
wrong:

1. **The operator is never blocked.** No state precondition. A draft, a live
   event mid-sale, one that has already started — all delete. A tool that
   refuses in exactly the cases you reach for it is not a tool.
2. **Nobody's money is kept.** Every PAID booking is refunded and every
   RESERVED hold is released. Deleting an event people paid for while keeping
   the money is the one outcome this codebase exists to prevent.
3. **It is a SOFT delete.** `Booking`, `ScanLog` and `TicketType` all PROTECT
   the event, so a real DELETE raises `ProtectedError` for anything with a
   ticket tier — which is every published event. The test below proves the
   event is gone from the reads without the row being destroyed.
"""

from __future__ import annotations

import datetime as dt
import uuid
from urllib.parse import quote

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.booking.models import Booking, BookingStatus
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization
from apps.payments.models import Payment, PaymentStatus
from apps.ticketing.models import TicketType

REASON = "Organiser could not produce a venue licence for this date."


def delete_url(event, reason: str) -> str:
    return f"/api/v1/admin/events/{event.id}?reason={quote(reason)}"


def url(event) -> str:
    """The ONE delete route. A second (`POST .../delete`) was briefly added
    before the existing one was found; two routes for one destructive action is
    how a frontend ends up calling the one nobody updated."""
    return f"/api/v1/admin/events/{event.id}"


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="promoter@del.test", password="owner12345")
    buyer = User.objects.create_user(
        email="buyer@del.test", password="buyer12345", full_name="Anita Rao"
    )
    staff = User.objects.create_user(email="ops@del.test", password="opsadmin12345", is_staff=True)
    member = User.objects.create_user(email="nobody@del.test", password="member12345")
    org = Organization.objects.create(owner=owner, name="Del Co")
    event = Event.objects.create(
        organization=org,
        title="Rooftop Sundowner",
        venue="Aer",
        city="Mumbai",
        starts_at=timezone.now() + dt.timedelta(days=6),
        status=EventStatus.LIVE,
    )
    tier = TicketType.objects.create(
        event=event, name="GA", price_minor=150_000, quantity=100, max_per_order=6
    )
    paid = Booking.objects.create(
        user=buyer,
        event=event,
        status=BookingStatus.PAID,
        hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
        total_amount_minor=150_000,
        platform_fee_minor=10,
        payment_ref="pay_del_1",
    )
    payment = Payment.objects.create(
        booking=paid,
        rzp_order_id=f"order_{uuid.uuid4().hex[:10]}",
        rzp_payment_id="pay_del_1",
        amount_minor=150_000,
        status=PaymentStatus.PAID,
    )
    return {
        "owner": owner,
        "buyer": buyer,
        "staff": staff,
        "member": member,
        "event": event,
        "tier": tier,
        "paid": paid,
        "payment": payment,
    }


@pytest.mark.django_db
class TestItAlwaysWorks:
    def test_a_live_event_mid_sale_deletes(self, world, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["staff"]).delete(delete_url(world["event"], REASON))

        assert resp.status_code == 200
        assert resp.data["refunds_enqueued"] == 1
        assert resp.data["attendees_notified"] == 1

    @pytest.mark.parametrize(
        "status",
        [EventStatus.DRAFT, EventStatus.PENDING_REVIEW, EventStatus.LIVE, EventStatus.ARCHIVED],
    )
    def test_no_state_blocks_it(self, world, status, django_capture_on_commit_callbacks):
        Event.objects.filter(pk=world["event"].id).update(status=status)
        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["staff"]).delete(delete_url(world["event"], REASON))
        assert resp.status_code == 200

    def test_an_event_that_has_already_started_deletes(
        self, world, django_capture_on_commit_callbacks
    ):
        Event.objects.filter(pk=world["event"].id).update(
            starts_at=timezone.now() - dt.timedelta(hours=2)
        )
        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["staff"]).delete(delete_url(world["event"], REASON))
        assert resp.status_code == 200


@pytest.mark.django_db
class TestItIsASoftDelete:
    def test_the_row_survives_but_vanishes_from_every_read(
        self, world, django_capture_on_commit_callbacks
    ):
        """A real DELETE would raise ProtectedError here — the event has a ticket
        tier and a booking. The row stays; the reads stop finding it."""
        from apps.events.repositories import EventRepository

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))

        assert Event.objects.filter(pk=world["event"].id).exists()
        assert EventRepository().get_active_by_id(world["event"].id) is None

    def test_the_financial_record_is_intact(self, world, django_capture_on_commit_callbacks):
        """The booking and its payment must survive — a platform that took money
        for those tickets is obliged to keep the record."""
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))

        assert Booking.objects.filter(pk=world["paid"].id).exists()
        assert Payment.objects.filter(pk=world["payment"].id).exists()

    def test_the_reason_is_recorded_on_the_event(self, world, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))

        world["event"].refresh_from_db()
        assert world["event"].moderation_note == REASON
        assert world["event"].deleted_at is not None


@pytest.mark.django_db
class TestNobodysMoneyIsKept:
    def test_a_paid_booking_is_actually_refunded(self, world, django_capture_on_commit_callbacks):
        """End to end: the delete enqueues the refund, the synchronous dev queue
        runs it, and the money is recorded as returned."""
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))

        world["payment"].refresh_from_db()
        assert world["payment"].status == PaymentStatus.REFUNDED
        assert world["payment"].refunds.count() == 1

    def test_the_refund_is_enqueued_ON_COMMIT(self, world):
        """Not capturing the callbacks proves it: the delete commits, the refund
        does not run. Enqueuing inline would let money be returned for an event
        whose deletion could still roll back."""
        auth(world["staff"]).delete(delete_url(world["event"], REASON))

        world["payment"].refresh_from_db()
        assert world["payment"].status == PaymentStatus.PAID

    def test_a_reserved_hold_is_released_rather_than_left_to_the_sweeper(
        self, world, django_capture_on_commit_callbacks
    ):
        """A deleted event must not go on holding seats."""
        hold = Booking.objects.create(
            user=world["buyer"],
            event=world["event"],
            status=BookingStatus.RESERVED,
            hold_expires_at=timezone.now() + dt.timedelta(minutes=30),
            total_amount_minor=150_000,
            platform_fee_minor=10,
        )

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))

        hold.refresh_from_db()
        assert hold.status != BookingStatus.RESERVED

    def test_an_event_with_no_bookings_refunds_nothing(
        self, world, django_capture_on_commit_callbacks
    ):
        # Payment FIRST: `Payment.booking` is PROTECT, so deleting the booking
        # while its payment exists raises ProtectedError. The same constraint
        # that makes a hard event delete impossible.
        Payment.objects.filter(pk=world["payment"].id).delete()
        Booking.objects.filter(pk=world["paid"].id).delete()

        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["staff"]).delete(delete_url(world["event"], REASON))

        assert resp.data["refunds_enqueued"] == 0
        assert resp.data["attendees_notified"] == 0


@pytest.mark.django_db
class TestNotifications:
    def test_the_attendee_is_told_the_event_is_cancelled(
        self, world, django_capture_on_commit_callbacks
    ):
        from apps.notifications.models import NotificationLog, NotificationType

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))

        log = NotificationLog.objects.get(type=NotificationType.EVENT_CANCELLED_ATTENDEE)
        assert log.recipient == "buyer@del.test"

    def test_the_attendee_email_uses_the_BANKS_timing_not_a_48_hour_promise(
        self, world, django_capture_on_commit_callbacks
    ):
        """The platform issues the refund in seconds; the money lands on the card
        networks' schedule. Promising 48 hours guarantees a support queue on day
        three, from people already annoyed their event was cancelled."""
        from apps.notifications.models import NotificationLog, NotificationType

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))

        log = NotificationLog.objects.get(type=NotificationType.EVENT_CANCELLED_ATTENDEE)
        assert "5-7 working days" in log.body
        assert "1-3" in log.body
        assert "48 hour" not in log.body.lower()

    def test_the_organizer_is_told_WHY(self, world, django_capture_on_commit_callbacks):
        from apps.notifications.models import NotificationLog, NotificationType

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))

        log = NotificationLog.objects.get(type=NotificationType.EVENT_DELETED_ORGANIZER)
        assert log.recipient == "promoter@del.test"
        assert "venue licence" in log.body

    def test_a_second_delete_cannot_email_everyone_twice(
        self, world, django_capture_on_commit_callbacks
    ):
        from apps.notifications.models import NotificationLog

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))
        before = NotificationLog.objects.count()

        with django_capture_on_commit_callbacks(execute=True):
            second = auth(world["staff"]).delete(delete_url(world["event"], REASON))

        assert second.status_code == 404  # already gone
        assert NotificationLog.objects.count() == before


@pytest.mark.django_db
class TestAccess:
    def test_a_non_operator_cannot_delete(self, world):
        resp = auth(world["member"]).delete(delete_url(world["event"], REASON))
        assert resp.status_code == 403

    def test_the_ORGANIZER_cannot_delete_their_own_event_here(self, world):
        """This is the operator's tool. An organizer archives; only staff remove."""
        resp = auth(world["owner"]).delete(delete_url(world["event"], REASON))
        assert resp.status_code == 403

    def test_anonymous_is_refused(self, world):
        assert APIClient().delete(delete_url(world["event"], REASON)).status_code == 401

    def test_a_reason_is_required(self, world):
        resp = auth(world["staff"]).delete(delete_url(world["event"], ""))
        # 422, not 400: `InvalidInputError` is what the service raises and
        # `core.errors` maps it to 422.
        assert resp.status_code == 422
        world["event"].refresh_from_db()
        assert world["event"].deleted_at is None

    def test_the_deletion_is_audited(self, world, django_capture_on_commit_callbacks):
        from core.models import AuditLog

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["staff"]).delete(delete_url(world["event"], REASON))

        entry = AuditLog.objects.get(action="event.deleted_by_operator")
        assert entry.actor_id == str(world["staff"].id)
        assert entry.metadata["refunds_enqueued"] == 1
        assert entry.metadata["reason"] == REASON
