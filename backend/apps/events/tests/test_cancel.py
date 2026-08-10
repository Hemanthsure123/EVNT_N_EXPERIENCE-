"""An organiser calls their own event off.

── WHY THIS IS NEITHER ARCHIVE NOR DELETE ────────────────────────────────

`archive_event` retires an event nobody holds a ticket to — it refuses `live`
for exactly that reason. Deletion is an OPERATOR's tool for a listing that
should not exist. Neither covered the ordinary, awful case: a live event with
real bookings that is not going to happen, called off by the person running it.

The two properties that carry the weight:

1. **Nobody's money is kept.** Every paid booking is refunded and every hold
   released — through the SAME code path the operator's delete uses, because
   two implementations of "return everybody's money" is how one of them ends up
   missing the hold release, on the money path.
2. **The page still resolves.** `cancelled` is a PUBLIC state, not a soft
   delete. Hundreds of people have a link in an email and they will open it; a
   404 there reads as "the platform lost my booking".
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
from apps.ticketing.models import TicketType

REASON = "The headline act has withdrawn and we could not find a replacement."


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="promoter@cancel.test", password="owner12345")
    buyer = User.objects.create_user(email="buyer@cancel.test", password="buyer12345")
    stranger = User.objects.create_user(email="nobody@cancel.test", password="member12345")
    org = Organization.objects.create(owner=owner, name="Cancel Co")
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
        payment_ref="pay_cancel_1",
    )
    payment = Payment.objects.create(
        booking=paid,
        rzp_order_id=f"order_{uuid.uuid4().hex[:10]}",
        rzp_payment_id="pay_cancel_1",
        amount_minor=150_000,
        status=PaymentStatus.PAID,
    )
    return {
        "owner": owner,
        "buyer": buyer,
        "stranger": stranger,
        "event": event,
        "tier": tier,
        "paid": paid,
        "payment": payment,
        "url": f"/api/v1/events/{event.id}/cancel",
    }


def cancel(world, *, user=None, reason: str = REASON):
    return auth(user or world["owner"]).post(world["url"], {"reason": reason}, format="json")


@pytest.mark.django_db
class TestItWorks:
    def test_a_live_event_with_bookings_cancels(self, world, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            response = cancel(world)

        assert response.status_code == 200
        assert response.data["refunds_enqueued"] == 1
        assert response.data["attendees_notified"] == 1
        world["event"].refresh_from_db()
        assert world["event"].status == EventStatus.CANCELLED

    def test_a_paused_event_cancels_too(self, world, django_capture_on_commit_callbacks):
        Event.objects.filter(pk=world["event"].id).update(status=EventStatus.PAUSED)
        with django_capture_on_commit_callbacks(execute=True):
            assert cancel(world).status_code == 200

    @pytest.mark.parametrize(
        "status", [EventStatus.DRAFT, EventStatus.REJECTED, EventStatus.ARCHIVED]
    )
    def test_a_state_with_nobody_to_tell_is_refused(self, world, status):
        """A draft has no ticket holders, so there is nothing to cancel — the
        organiser wants archive, and saying so is more use than doing something
        that looks the same and is not."""
        Event.objects.filter(pk=world["event"].id).update(status=status)
        response = cancel(world)
        # 409, not 422: `InvalidEventStateError` is a `ConflictError` — the
        # request was well-formed and the event is simply in the wrong state.
        assert response.status_code == 409

    def test_cancelling_twice_is_refused(self, world, django_capture_on_commit_callbacks):
        """So a double-click cannot email everybody twice."""
        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)
        assert cancel(world).status_code == 409


@pytest.mark.django_db
class TestNobodysMoneyIsKept:
    def test_a_paid_booking_is_actually_refunded(self, world, django_capture_on_commit_callbacks):
        """End to end: the cancel enqueues the refund, the synchronous dev queue
        runs it, and the money is recorded as returned."""
        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)

        world["payment"].refresh_from_db()
        assert world["payment"].status == PaymentStatus.REFUNDED
        assert world["payment"].refunds.count() == 1

    def test_the_refund_is_enqueued_ON_COMMIT(self, world):
        """Not capturing the callbacks proves it. Enqueuing inline would let
        money be returned for a cancellation that could still roll back."""
        cancel(world)
        world["payment"].refresh_from_db()
        assert world["payment"].status == PaymentStatus.PAID

    def test_a_reserved_hold_is_released_rather_than_left_to_the_sweeper(
        self, world, django_capture_on_commit_callbacks
    ):
        hold = Booking.objects.create(
            user=world["buyer"],
            event=world["event"],
            status=BookingStatus.RESERVED,
            hold_expires_at=timezone.now() + dt.timedelta(minutes=30),
            total_amount_minor=150_000,
            platform_fee_minor=10,
        )

        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)

        hold.refresh_from_db()
        assert hold.status != BookingStatus.RESERVED

    def test_the_financial_record_survives(self, world, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)

        assert Booking.objects.filter(pk=world["paid"].id).exists()
        assert Payment.objects.filter(pk=world["payment"].id).exists()


@pytest.mark.django_db
class TestThePageStillResolves:
    def test_the_public_detail_still_answers(self, world, django_capture_on_commit_callbacks):
        """The whole reason `cancelled` is a state and not a soft delete."""
        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)

        response = APIClient().get(f"/api/v1/events/{world['event'].id}")
        assert response.status_code == 200
        assert response.json()["status"] == "cancelled"

    def test_it_leaves_the_browse_listing(self, world, django_capture_on_commit_callbacks):
        """The list filters on `live`, so this costs discovery nothing — but a
        cached listing page would go on selling it, which is why the caches are
        invalidated on commit."""
        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)

        titles = [row["title"] for row in APIClient().get("/api/v1/events").json()["data"]]
        assert "Rooftop Sundowner" not in titles

    def test_the_organizer_still_sees_it_on_their_own_list(
        self, world, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)

        body = auth(world["owner"]).get("/api/v1/organizer/events").json()
        rows = {row["title"]: row for row in body["data"]}
        assert rows["Rooftop Sundowner"]["status"] == "cancelled"


@pytest.mark.django_db
class TestWhatIsRefused:
    def test_a_reason_is_required(self, world):
        """Everybody who booked is shown it verbatim. "Cancelled" with no
        reason is the message that generates the support tickets this endpoint
        exists to prevent."""
        response = cancel(world, reason="")
        assert response.status_code == 400
        world["event"].refresh_from_db()
        assert world["event"].status == EventStatus.LIVE

    def test_whitespace_is_not_a_reason(self, world):
        assert cancel(world, reason="    ").status_code == 400

    def test_a_stranger_cannot_cancel_somebody_elses_event(self, world):
        response = cancel(world, user=world["stranger"])
        assert response.status_code in (403, 404)
        world["event"].refresh_from_db()
        assert world["event"].status == EventStatus.LIVE

    def test_anonymous_is_refused(self, world):
        assert APIClient().post(world["url"], {"reason": REASON}, format="json").status_code == 401


@pytest.mark.django_db
class TestTheTrail:
    def test_the_attendee_is_told(self, world, django_capture_on_commit_callbacks):
        from apps.notifications.models import NotificationLog, NotificationType

        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)

        log = NotificationLog.objects.get(type=NotificationType.EVENT_CANCELLED_ATTENDEE)
        assert log.recipient == "buyer@cancel.test"
        assert "withdrawn" in log.body

    def test_the_attendee_email_uses_the_BANKS_refund_timing(
        self, world, django_capture_on_commit_callbacks
    ):
        """The same message an operator deletion sends, so the refund timing
        cannot drift between the two paths."""
        from apps.notifications.models import NotificationLog, NotificationType

        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)

        log = NotificationLog.objects.get(type=NotificationType.EVENT_CANCELLED_ATTENDEE)
        assert "5-7 working days" in log.body
        assert "48 hour" not in log.body.lower()

    def test_a_later_operator_deletion_does_not_email_everybody_twice(
        self, world, django_capture_on_commit_callbacks
    ):
        """The two paths share a dedupe key on purpose: to a ticket holder, an
        event cancelled and then removed is ONE event being called off."""
        from apps.notifications.models import NotificationLog

        staff = User.objects.create_user(
            email="ops@cancel.test", password="opsadmin12345", is_staff=True
        )
        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)
        before = NotificationLog.objects.count()

        with django_capture_on_commit_callbacks(execute=True):
            auth(staff).delete(f"/api/v1/admin/events/{world['event'].id}?reason=Cleanup")

        # The organiser's own "removed" mail is new; the attendee's is not.
        assert NotificationLog.objects.filter(type="event_cancelled_attendee").count() == 1
        assert NotificationLog.objects.count() >= before

    def test_it_is_audited_with_its_reason(self, world, django_capture_on_commit_callbacks):
        from core.models import AuditLog

        with django_capture_on_commit_callbacks(execute=True):
            cancel(world)

        entry = AuditLog.objects.get(action="event.cancelled")
        assert entry.actor_id == str(world["owner"].id)
        assert entry.metadata["reason"] == REASON
        assert entry.metadata["refunds_enqueued"] == 1
