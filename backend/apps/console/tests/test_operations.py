"""The admin operations surfaces: moderation history, payments, refunds,
suspension and the signups series.

Two questions run through every test here, because they are the two ways an
admin endpoint goes wrong:

1. **Can a non-operator reach it?** Every route gets a 403 test, because these
   read and write across the whole platform.
2. **Does it refuse what it should?** Suspension in particular has two rules
   that exist to stop an operator locking themselves — or everyone — out, and
   both are asserted directly.
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
from apps.payments.models import Payment, PaymentStatus, Refund
from core.models import AuditLog


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_user(
        email="ops@example.com", password="opsadmin12345", is_staff=True
    )


@pytest.fixture
def member(db) -> User:
    return User.objects.create_user(email="member@example.com", password="member12345")


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="owner@example.com", password="owner12345")
    customer = User.objects.create_user(
        email="asha@example.com", password="cust12345", full_name="Asha Rao"
    )
    org = Organization.objects.create(owner=owner, name="Acme Live")
    event = Event.objects.create(
        organization=org,
        title="Summer Sessions",
        venue="Phoenix Arena",
        city="Mumbai",
        starts_at=timezone.now() + dt.timedelta(days=10),
        status=EventStatus.LIVE,
    )
    booking = Booking.objects.create(
        user=customer,
        event=event,
        status=BookingStatus.PAID,
        hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
        total_amount_minor=500_000,
        platform_fee_minor=1_000,
    )
    payment = Payment.objects.create(
        booking=booking,
        rzp_order_id=f"order_{uuid.uuid4().hex[:10]}",
        rzp_payment_id=f"pay_{uuid.uuid4().hex[:10]}",
        amount_minor=500_000,
        status=PaymentStatus.PAID,
    )
    return {
        "owner": owner,
        "customer": customer,
        "org": org,
        "event": event,
        "booking": booking,
        "payment": payment,
    }


# ------------------------------------------------------------------ payments


@pytest.mark.django_db
class TestPayments:
    def test_lists_every_payment_with_customer_and_event(self, staff, world):
        row = auth(staff).get("/api/v1/admin/payments").json()["data"][0]

        assert row["amount_minor"] == 500_000
        assert row["customer_email"] == "asha@example.com"
        assert row["event_title"] == "Summer Sessions"
        assert row["provider_payment_id"] == world["payment"].rzp_payment_id

    def test_filters_by_status(self, staff, world):
        body = auth(staff).get("/api/v1/admin/payments?status=failed").json()
        assert body["data"] == []

    def test_searches_by_provider_reference(self, staff, world):
        reference = world["payment"].rzp_payment_id
        body = auth(staff).get(f"/api/v1/admin/payments?q={reference}").json()
        assert len(body["data"]) == 1

    def test_searches_by_customer_email(self, staff, world):
        body = auth(staff).get("/api/v1/admin/payments?q=asha@").json()
        assert len(body["data"]) == 1

    def test_a_page_costs_a_fixed_number_of_queries(self, staff, world, django_assert_num_queries):
        """`select_related` down to the event, so a page is one query regardless
        of length — without it each row joins payment → booking → user/event."""
        from apps.console.repositories import ConsoleRepository
        from apps.console.selectors import decorate_payments

        for _ in range(4):
            booking = Booking.objects.create(
                user=world["customer"],
                event=world["event"],
                status=BookingStatus.PAID,
                hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
                total_amount_minor=100,
                platform_fee_minor=1,
            )
            Payment.objects.create(
                booking=booking,
                rzp_order_id=f"order_{uuid.uuid4().hex[:10]}",
                rzp_payment_id=f"pay_{uuid.uuid4().hex[:10]}",
                amount_minor=100,
                status=PaymentStatus.PAID,
            )

        with django_assert_num_queries(1):
            decorate_payments(list(ConsoleRepository().list_payments(status=None, search=None)[:5]))

    def test_a_non_operator_is_refused(self, member):
        assert auth(member).get("/api/v1/admin/payments").status_code == 403

    def test_never_edge_cacheable(self, staff):
        response = auth(staff).get("/api/v1/admin/payments")
        assert response["Cache-Control"] == "private, no-store"


# ------------------------------------------------------------------- refunds


@pytest.mark.django_db
class TestRefunds:
    def test_partial_is_computed_from_the_pair(self, staff, world):
        Refund.objects.create(
            payment=world["payment"], rzp_refund_id="rfnd_1", amount_minor=100_000
        )
        row = auth(staff).get("/api/v1/admin/refunds").json()["data"][0]
        assert row["is_partial"] is True

    def test_a_full_amount_is_not_partial(self, staff, world):
        Refund.objects.create(
            payment=world["payment"], rzp_refund_id="rfnd_2", amount_minor=500_000
        )
        row = auth(staff).get("/api/v1/admin/refunds").json()["data"][0]
        assert row["is_partial"] is False

    def test_carries_the_customer_and_event(self, staff, world):
        Refund.objects.create(payment=world["payment"], rzp_refund_id="rfnd_3", amount_minor=1)
        row = auth(staff).get("/api/v1/admin/refunds").json()["data"][0]
        assert row["customer_email"] == "asha@example.com"
        assert row["event_title"] == "Summer Sessions"

    def test_a_non_operator_is_refused(self, member):
        assert auth(member).get("/api/v1/admin/refunds").status_code == 403


# ---------------------------------------------------------------- suspension


@pytest.mark.django_db
class TestSuspension:
    def path(self, user: User) -> str:
        return f"/api/v1/admin/users/{user.id}/suspension"

    def test_suspending_deactivates_the_account(self, staff, member):
        response = auth(staff).post(self.path(member), {"suspended": True}, format="json")

        assert response.status_code == 200
        assert response.json()["is_active"] is False
        member.refresh_from_db()
        assert member.is_active is False

    def test_a_suspended_account_cannot_authenticate(self, staff, member):
        """The whole point — `is_active` is an access decision, not a label.

        It raises `AccountSuspendedError`, not `InvalidCredentialsError`: the
        password was RIGHT, and disguising the refusal as a bad credential sent
        suspended people to reset a password that was never wrong. Naming it is
        safe because this line is only reached after the password verified —
        see `apps/accounts/tests/test_suspension.py`.
        """
        from apps.accounts.exceptions import AccountSuspendedError
        from apps.accounts.repositories import UserRepository
        from apps.accounts.services import AuthService
        from core.adapters.local.console_email import ConsoleEmailAdapter
        from core.adapters.local.sync_task_queue import SyncTaskQueueAdapter

        auth(staff).post(self.path(member), {"suspended": True}, format="json")
        service = AuthService(
            users=UserRepository(), email=ConsoleEmailAdapter(), task_queue=SyncTaskQueueAdapter()
        )

        with pytest.raises(AccountSuspendedError):
            service.authenticate(email="member@example.com", password="member12345")

    def test_reinstating_restores_access(self, staff, member):
        auth(staff).post(self.path(member), {"suspended": True}, format="json")
        response = auth(staff).post(self.path(member), {"suspended": False}, format="json")

        assert response.json()["is_active"] is True

    def test_an_operator_cannot_suspend_themselves(self, staff):
        """They would be locked out of the console that fixes it on the very
        next request."""
        response = auth(staff).post(self.path(staff), {"suspended": True}, format="json")

        assert response.status_code == 409
        assert "your own account" in response.json()["error"]["message"]
        staff.refresh_from_db()
        assert staff.is_active is True

    def test_staff_cannot_be_suspended(self, staff, db):
        """Otherwise operators can suspend each other until nobody can sign in."""
        colleague = User.objects.create_user(
            email="ops2@example.com", password="opsadmin12345", is_staff=True
        )

        response = auth(staff).post(self.path(colleague), {"suspended": True}, format="json")

        assert response.status_code == 409
        colleague.refresh_from_db()
        assert colleague.is_active is True

    def test_suspending_twice_is_refused_rather_than_silently_repeated(self, staff, member):
        """A double-click must not write a second audit row claiming a second
        suspension."""
        auth(staff).post(self.path(member), {"suspended": True}, format="json")
        response = auth(staff).post(self.path(member), {"suspended": True}, format="json")

        assert response.status_code == 409
        assert (
            AuditLog.objects.filter(action="user.suspended", target_id=str(member.id)).count() == 1
        )

    def test_the_reason_reaches_the_audit_trail(self, staff, member):
        auth(staff).post(
            self.path(member),
            {"suspended": True, "reason": "Chargeback fraud, ticket #412"},
            format="json",
        )

        entry = AuditLog.objects.get(action="user.suspended", target_id=str(member.id))
        assert entry.metadata["reason"] == "Chargeback fraud, ticket #412"
        assert entry.actor_id == str(staff.id)

    def test_an_unknown_account_is_a_404(self, staff):
        response = auth(staff).post(
            f"/api/v1/admin/users/{uuid.uuid4()}/suspension", {"suspended": True}, format="json"
        )
        assert response.status_code == 404

    def test_a_non_operator_cannot_suspend_anyone(self, member, db):
        victim = User.objects.create_user(email="victim@example.com", password="victim12345")

        response = auth(member).post(self.path(victim), {"suspended": True}, format="json")

        assert response.status_code == 403
        victim.refresh_from_db()
        assert victim.is_active is True


# -------------------------------------------------------- user role filtering


@pytest.mark.django_db
class TestUserFilters:
    def test_filters_to_suspended_accounts(self, staff, member):
        auth(staff).post(
            f"/api/v1/admin/users/{member.id}/suspension", {"suspended": True}, format="json"
        )

        body = auth(staff).get("/api/v1/admin/users?role=suspended").json()

        assert [row["email"] for row in body["data"]] == ["member@example.com"]

    def test_filters_to_staff(self, staff, member):
        body = auth(staff).get("/api/v1/admin/users?role=staff").json()
        assert [row["email"] for row in body["data"]] == ["ops@example.com"]

    def test_an_unknown_role_is_ignored_rather_than_returning_nothing(self, staff, member):
        body = auth(staff).get("/api/v1/admin/users?role=wizard").json()
        assert len(body["data"]) == 2

    def test_is_active_is_on_the_payload(self, staff):
        """Without it the console cannot tell a suspended account from an
        active one, and a suspension list is impossible to render."""
        row = auth(staff).get("/api/v1/admin/users").json()["data"][0]
        assert "is_active" in row


# --------------------------------------------------------- moderation history


@pytest.mark.django_db
class TestModerationHistory:
    def test_defaults_to_the_pending_queue(self, staff, world):
        world["event"].status = EventStatus.PENDING_REVIEW
        world["event"].submitted_at = timezone.now()
        world["event"].save(update_fields=["status", "submitted_at"])

        body = auth(staff).get("/api/v1/admin/events/pending").json()

        assert [row["title"] for row in body["data"]] == ["Summer Sessions"]

    def test_can_read_past_decisions(self, staff, world):
        world["event"].moderation_note = "Poster is a stock photo."
        world["event"].status = EventStatus.REJECTED
        world["event"].moderated_at = timezone.now()
        world["event"].save(update_fields=["status", "moderation_note", "moderated_at"])

        body = auth(staff).get("/api/v1/admin/events/pending?status=rejected").json()
        row = body["data"][0]

        assert row["status"] == "rejected"
        assert row["moderation_note"] == "Poster is a stock photo."
        assert row["moderated_at"] is not None

    def test_a_draft_can_never_be_reached_by_guessing_a_status(self, staff, world):
        """An organizer's unsubmitted draft is their private workspace. The
        repository's allow-list is what stops `?status=draft` browsing it."""
        world["event"].status = EventStatus.DRAFT
        world["event"].save(update_fields=["status"])

        body = auth(staff).get("/api/v1/admin/events/pending?status=draft").json()

        # Falls back to the pending queue, which this event is not in.
        assert body["data"] == []

    def test_a_non_operator_is_refused(self, member):
        assert auth(member).get("/api/v1/admin/events/pending").status_code == 403


# ---------------------------------------------------------------- signups


@pytest.mark.django_db
class TestSignups:
    def test_counts_real_accounts_per_day(self, staff, member):
        body = auth(staff).get("/api/v1/admin/timeseries?metric=signups&days=7").json()

        assert body["metric"] == "signups"
        # staff + member, both created today.
        assert sum(point["value"] for point in body["points"]) == 2

    def test_the_series_is_dense(self, staff):
        """Every day in the window, zeros included — handing a chart only the
        days that have rows draws a line that skips quiet days."""
        body = auth(staff).get("/api/v1/admin/timeseries?metric=signups&days=7").json()
        assert len(body["points"]) == 7
