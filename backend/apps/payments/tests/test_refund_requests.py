"""The refund REQUEST lifecycle: ask -> decide -> (refund | refusal).

`Refund` records money that has ALREADY moved — `execute_refund` writes one only
after the vendor call succeeded. So there was no object anywhere representing
"somebody has asked and nobody has decided", and no way for a customer to raise
one: refunds were organizer-initiated only, and asking meant an email thread
nothing tracked.

Three things here carry the weight, and each is a distinct failure mode:

1. **One open request per booking**, enforced by a partial unique index rather
   than by the pre-check — because the pre-check loses a race and the index
   does not.
2. **A decision happens exactly once**, under the request row's lock, so two
   people working the same queue cannot both decide and cannot enqueue two
   refunds.
3. **Approving does not refund inline** — it enqueues, on commit. Enqueuing
   inside the transaction would let the refund run and succeed while the
   decision authorising it rolled back.
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
from apps.payments.models import (
    Payment,
    PaymentStatus,
    RefundRequest,
    RefundRequestStatus,
)

DECIDE = "/api/v1/refund-requests/{}/decide"
MINE = "/api/v1/me/refund-requests"
ORGANIZER = "/api/v1/organizer/refund-requests"
ADMIN = "/api/v1/admin/refund-requests"

GOOD_REASON = "The headline act was replaced and I only bought for them."


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _request_url(booking) -> str:
    return f"/api/v1/bookings/{booking.id}/refund-requests"


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="owner@rr.test", password="owner12345")
    customer = User.objects.create_user(
        email="cust@rr.test", password="cust12345", full_name="Priya Nair"
    )
    stranger = User.objects.create_user(email="other@rr.test", password="other12345")
    staff = User.objects.create_user(email="ops@rr.test", password="opsadmin12345", is_staff=True)
    org = Organization.objects.create(owner=owner, name="Rainmaker")
    event = Event.objects.create(
        organization=org,
        title="Monsoon Sessions",
        venue="The Quarry",
        city="Pune",
        starts_at=timezone.now() + dt.timedelta(days=9),
        status=EventStatus.LIVE,
    )
    booking = Booking.objects.create(
        user=customer,
        event=event,
        status=BookingStatus.PAID,
        hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
        total_amount_minor=250_000,
        platform_fee_minor=20,
        payment_ref="pay_rr_001",
    )
    payment = Payment.objects.create(
        booking=booking,
        rzp_order_id=f"order_{uuid.uuid4().hex[:10]}",
        rzp_payment_id="pay_rr_001",
        amount_minor=250_000,
        status=PaymentStatus.PAID,
    )
    return {
        "owner": owner,
        "customer": customer,
        "stranger": stranger,
        "staff": staff,
        "event": event,
        "booking": booking,
        "payment": payment,
    }


def _open_request(world) -> RefundRequest:
    return RefundRequest.objects.create(
        booking=world["booking"], requested_by=world["customer"], reason=GOOD_REASON
    )


# ── Asking ───────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestAsking:
    def test_a_customer_can_ask_for_a_refund_on_their_paid_booking(self, world):
        resp = auth(world["customer"]).post(
            _request_url(world["booking"]), {"reason": GOOD_REASON}, format="json"
        )

        assert resp.status_code == 201
        assert resp.data["status"] == RefundRequestStatus.PENDING
        assert resp.data["reason"] == GOOD_REASON
        # The amount shown is what would ACTUALLY move — read from the booking,
        # never a number carried on the request.
        assert resp.data["booking_total_minor"] == 250_000
        assert resp.data["event_title"] == "Monsoon Sessions"

    def test_the_response_is_never_shared_cached(self, world):
        resp = auth(world["customer"]).post(
            _request_url(world["booking"]), {"reason": GOOD_REASON}, format="json"
        )
        assert resp["Cache-Control"] == "private, no-store"

    def test_a_second_open_request_is_refused(self, world):
        client = auth(world["customer"])
        client.post(_request_url(world["booking"]), {"reason": GOOD_REASON}, format="json")

        resp = client.post(_request_url(world["booking"]), {"reason": GOOD_REASON}, format="json")

        assert resp.status_code == 409
        assert resp.data["error"]["code"] == "refund_request_already_open"
        assert RefundRequest.objects.count() == 1

    def test_a_REJECTED_request_does_not_block_a_new_one(self, world):
        """Circumstances change. Somebody refused before the line-up changed
        must be able to ask again — which is why the unique index is PARTIAL,
        on `status = pending`, rather than on the booking outright."""
        old = _open_request(world)
        old.status = RefundRequestStatus.REJECTED
        old.decided_at = timezone.now()
        old.save(update_fields=["status", "decided_at"])

        resp = auth(world["customer"]).post(
            _request_url(world["booking"]), {"reason": GOOD_REASON}, format="json"
        )

        assert resp.status_code == 201
        assert RefundRequest.objects.count() == 2

    def test_the_database_refuses_a_second_open_request_even_without_the_pre_check(self, world):
        """The pre-check loses a race; the partial unique index does not.

        Two taps on a slow connection both pass `has_open_request` and both
        reach the insert. This asserts the CONSTRAINT is what actually holds,
        by going around the service entirely.
        """
        from django.db import IntegrityError, transaction

        _open_request(world)
        with pytest.raises(IntegrityError), transaction.atomic():
            _open_request(world)

    def test_a_reason_shorter_than_a_sentence_is_refused(self, world):
        resp = auth(world["customer"]).post(
            _request_url(world["booking"]), {"reason": "refund"}, format="json"
        )
        assert resp.status_code == 400

    def test_you_cannot_ask_about_somebody_elses_booking(self, world):
        """And the answer is the SAME as for a booking that does not exist —
        otherwise this endpoint enumerates other people's bookings by id, one
        403 at a time."""
        resp = auth(world["stranger"]).post(
            _request_url(world["booking"]), {"reason": GOOD_REASON}, format="json"
        )
        assert resp.status_code == 404
        assert resp.data["error"]["code"] == "refund_request_not_found"

    def test_a_booking_that_was_never_paid_has_nothing_to_refund(self, world):
        Booking.objects.filter(pk=world["booking"].id).update(status=BookingStatus.EXPIRED)

        resp = auth(world["customer"]).post(
            _request_url(world["booking"]), {"reason": GOOD_REASON}, format="json"
        )

        assert resp.status_code == 409
        assert resp.data["error"]["code"] == "booking_not_refundable"

    def test_anonymous_cannot_ask(self, world):
        assert (
            APIClient()
            .post(_request_url(world["booking"]), {"reason": GOOD_REASON}, format="json")
            .status_code
            == 401
        )


# ── Deciding ─────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestDeciding:
    def test_the_organizer_can_approve(self, world, django_capture_on_commit_callbacks):
        request = _open_request(world)

        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["owner"]).post(
                DECIDE.format(request.id), {"approve": True}, format="json"
            )

        assert resp.status_code == 200
        assert resp.data["status"] == RefundRequestStatus.APPROVED
        assert resp.data["decided_by_email"] == "owner@rr.test"
        assert resp.data["decided_at"] is not None

    def test_approving_actually_refunds_the_payment(
        self, world, django_capture_on_commit_callbacks
    ):
        """End to end: the decision enqueues `payments.process_refund`, the
        synchronous dev queue runs it, and the money is recorded as returned."""
        request = _open_request(world)

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["owner"]).post(DECIDE.format(request.id), {"approve": True}, format="json")

        world["payment"].refresh_from_db()
        assert world["payment"].status == PaymentStatus.REFUNDED
        assert world["payment"].refunds.count() == 1

    def test_the_enqueue_happens_ON_COMMIT_not_inside_the_transaction(self, world):
        """Without `on_commit`, the synchronous task adapter would run the
        refund INSIDE the decision's transaction — so a rollback afterwards
        would leave money returned against a request still reading `pending`.

        Not capturing the callbacks is what proves it: the decision commits,
        the refund does not run, and the payment is untouched.
        """
        request = _open_request(world)

        resp = auth(world["owner"]).post(
            DECIDE.format(request.id), {"approve": True}, format="json"
        )

        assert resp.data["status"] == RefundRequestStatus.APPROVED
        world["payment"].refresh_from_db()
        assert world["payment"].status == PaymentStatus.PAID  # not yet refunded

    def test_rejecting_requires_a_reason(self, world):
        request = _open_request(world)

        resp = auth(world["owner"]).post(
            DECIDE.format(request.id), {"approve": False, "note": "   "}, format="json"
        )

        # 422 rather than 400: `InvalidInputError` carries status_code 422
        # in `core.errors`, which is the envelope every domain error here
        # flows through.
        assert resp.status_code == 422
        assert resp.data["error"]["code"] == "refund_decision_note_required"
        request.refresh_from_db()
        assert request.status == RefundRequestStatus.PENDING

    def test_rejecting_with_a_reason_records_it_for_the_customer(self, world):
        request = _open_request(world)

        resp = auth(world["owner"]).post(
            DECIDE.format(request.id),
            {"approve": False, "note": "The line-up did not change; the support act did."},
            format="json",
        )

        assert resp.status_code == 200
        assert resp.data["status"] == RefundRequestStatus.REJECTED
        assert "support act" in resp.data["decision_note"]
        world["payment"].refresh_from_db()
        assert world["payment"].status == PaymentStatus.PAID  # nothing refunded

    def test_a_second_decision_is_a_409_not_a_silent_overwrite(
        self, world, django_capture_on_commit_callbacks
    ):
        """Two people working the same queue. The loser is TOLD, rather than
        believing they rejected something already approved and refunded."""
        request = _open_request(world)
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["owner"]).post(DECIDE.format(request.id), {"approve": True}, format="json")

        resp = auth(world["staff"]).post(
            DECIDE.format(request.id),
            {"approve": False, "note": "Changed my mind."},
            format="json",
        )

        assert resp.status_code == 409
        assert resp.data["error"]["code"] == "refund_request_already_decided"
        request.refresh_from_db()
        assert request.status == RefundRequestStatus.APPROVED

    def test_a_double_approve_cannot_enqueue_two_refunds(
        self, world, django_capture_on_commit_callbacks
    ):
        request = _open_request(world)
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["owner"]).post(DECIDE.format(request.id), {"approve": True}, format="json")
        with django_capture_on_commit_callbacks(execute=True):
            second = auth(world["owner"]).post(
                DECIDE.format(request.id), {"approve": True}, format="json"
            )

        assert second.status_code == 409
        world["payment"].refresh_from_db()
        assert world["payment"].refunds.count() == 1

    def test_a_stranger_cannot_decide(self, world):
        request = _open_request(world)
        resp = auth(world["stranger"]).post(
            DECIDE.format(request.id), {"approve": True}, format="json"
        )
        assert resp.status_code == 403
        assert resp.data["error"]["code"] == "not_allowed_to_decide_refund"

    def test_the_CUSTOMER_cannot_decide_their_own_request(self, world):
        """The most important authorization case on this endpoint."""
        request = _open_request(world)
        resp = auth(world["customer"]).post(
            DECIDE.format(request.id), {"approve": True}, format="json"
        )
        assert resp.status_code == 403

    def test_an_operator_can_decide_any_request(self, world, django_capture_on_commit_callbacks):
        request = _open_request(world)
        with django_capture_on_commit_callbacks(execute=True):
            resp = auth(world["staff"]).post(
                DECIDE.format(request.id), {"approve": True}, format="json"
            )
        assert resp.status_code == 200

    def test_approving_with_no_captured_payment_is_refused(self, world):
        """Otherwise the request reads `approved` forever while nothing was
        sent — the state the whole model exists to make impossible."""
        Payment.objects.filter(pk=world["payment"].id).update(status=PaymentStatus.FAILED)
        request = _open_request(world)

        resp = auth(world["owner"]).post(
            DECIDE.format(request.id), {"approve": True}, format="json"
        )

        assert resp.status_code == 409
        assert resp.data["error"]["code"] == "payment_not_refundable"
        request.refresh_from_db()
        assert request.status == RefundRequestStatus.PENDING

    def test_an_unknown_request_is_404(self, world):
        resp = auth(world["owner"]).post(
            DECIDE.format(uuid.uuid4()), {"approve": True}, format="json"
        )
        assert resp.status_code == 404


# ── Reading: three surfaces, one shape ───────────────────────────────────────


@pytest.mark.django_db
class TestReading:
    def test_a_customer_sees_their_own_requests(self, world):
        _open_request(world)
        body = auth(world["customer"]).get(MINE).json()
        assert len(body["data"]) == 1
        assert body["data"][0]["status"] == RefundRequestStatus.PENDING

    def test_a_customer_never_sees_somebody_elses(self, world):
        _open_request(world)
        assert auth(world["stranger"]).get(MINE).json()["data"] == []

    def test_the_organizer_sees_requests_against_their_events(self, world):
        _open_request(world)
        body = auth(world["owner"]).get(ORGANIZER).json()
        assert len(body["data"]) == 1
        assert body["data"][0]["requested_by_email"] == "cust@rr.test"

    def test_an_unrelated_organizer_sees_nothing(self, world):
        _open_request(world)
        assert auth(world["stranger"]).get(ORGANIZER).json()["data"] == []

    def test_the_pending_queue_is_FIFO(self, world):
        """Oldest first, so nobody is stranded at the bottom of a list that
        only grows from the top. The paginator's `ordering` must match, or
        cursor pagination silently returns wrong pages."""
        first = _open_request(world)
        first.status = RefundRequestStatus.REJECTED
        first.decision_note = "n/a"
        first.save(update_fields=["status", "decision_note"])
        second = RefundRequest.objects.create(
            booking=world["booking"], requested_by=world["customer"], reason=GOOD_REASON
        )

        body = auth(world["owner"]).get(f"{ORGANIZER}?status=pending").json()

        assert [row["id"] for row in body["data"]] == [str(second.id)]

    def test_the_console_sees_every_request_on_the_platform(self, world):
        _open_request(world)
        body = auth(world["staff"]).get(ADMIN).json()
        assert len(body["data"]) == 1

    def test_a_non_operator_cannot_reach_the_console_list(self, world):
        assert auth(world["owner"]).get(ADMIN).status_code == 403

    def test_the_lists_do_not_n_plus_1(self, world, django_assert_num_queries):
        """A queue of ten must cost the same as a queue of one. Every row shows
        the customer, the event and the booking, so without the joins this is
        four extra queries per row on the screen an organizer lives in."""
        for index in range(9):
            booking = Booking.objects.create(
                user=world["customer"],
                event=world["event"],
                status=BookingStatus.PAID,
                hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
                total_amount_minor=100_000,
                platform_fee_minor=10,
                payment_ref=f"pay_bulk_{index}",
            )
            RefundRequest.objects.create(
                booking=booking, requested_by=world["customer"], reason=GOOD_REASON
            )
        _open_request(world)

        client = auth(world["owner"])
        # ONE query: the page. `force_authenticate` attaches the user
        # directly, so there is no JWT user lookup to pay for here — and
        # cursor pagination issues no COUNT(*).
        with django_assert_num_queries(1):
            body = client.get(ORGANIZER).json()
        assert len(body["data"]) == 10


# ── Notifications ────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestNotifications:
    def test_asking_emails_the_ORGANIZER(self, world, django_capture_on_commit_callbacks):
        """Without this the request lands in a queue nobody knows to open —
        the same failure the model was added to fix, one step later."""
        from apps.notifications.models import NotificationLog, NotificationType

        with django_capture_on_commit_callbacks(execute=True):
            auth(world["customer"]).post(
                _request_url(world["booking"]), {"reason": GOOD_REASON}, format="json"
            )

        log = NotificationLog.objects.get(type=NotificationType.REFUND_REQUEST_RECEIVED)
        assert log.recipient == "owner@rr.test"

    def test_rejecting_emails_the_CUSTOMER_with_the_reason(
        self, world, django_capture_on_commit_callbacks
    ):
        from apps.notifications.models import NotificationLog, NotificationType

        request = _open_request(world)
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["owner"]).post(
                DECIDE.format(request.id),
                {"approve": False, "note": "Tickets were non-refundable for this show."},
                format="json",
            )

        log = NotificationLog.objects.get(type=NotificationType.REFUND_REQUEST_REJECTED)
        assert log.recipient == "cust@rr.test"
        assert "non-refundable" in log.body

    def test_approving_does_not_claim_the_money_has_already_moved(
        self, world, django_capture_on_commit_callbacks
    ):
        """Approval enqueues the vendor call; `REFUND_CONFIRMATION` is the
        message that fires once money actually left. Saying "refunded" here is
        how a support queue fills with people asking where their money is."""
        from apps.notifications.models import NotificationLog, NotificationType

        request = _open_request(world)
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["owner"]).post(DECIDE.format(request.id), {"approve": True}, format="json")

        approved = NotificationLog.objects.get(type=NotificationType.REFUND_REQUEST_APPROVED)
        assert "being processed" in approved.body
        # ...and the separate, factual one did fire, because the sync queue ran
        # the refund and PAYMENT_REFUNDED followed.
        assert NotificationLog.objects.filter(type=NotificationType.REFUND_CONFIRMATION).exists()
