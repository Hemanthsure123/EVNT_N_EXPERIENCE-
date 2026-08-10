"""The hire desk: a customer's enquiry, and an operator working it.

── WHAT THIS REPLACED ────────────────────────────────────────────────────

`test_marketplace.py` tested a two-sided market: performers listed acts,
quoted on briefs, and accepting a quote booked an act in one transaction. The
platform has no supply side now — somebody sends what they need and an
OPERATOR gets back to them, off-platform — so those routes are unmounted and
this is what took their place.

The property that carries the most weight is the one the marketplace never
had to worry about: **an enquiry nobody can answer is worse than no enquiry
at all.** There is no automatic matching to fall back on, so if the contact
details are empty or the operator alert does not go out, the customer hears
nothing. Three of the classes below exist for that single sentence.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.performers.models import BookingRequest, RequestStatus

ENQUIRIES = "/api/v1/hire/enquiries"
ADMIN = "/api/v1/admin/enquiries"


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def brief(**over) -> dict:
    return {
        "performer_type": "band",
        "occasion": "wedding",
        "city": "Mumbai",
        "event_date": (timezone.localdate() + dt.timedelta(days=60)).isoformat(),
        "budget_min_minor": 5_000_000,
        "budget_max_minor": 8_000_000,
        "guests": 250,
        "notes": "Outdoor, sunset set.",
        **over,
    }


@pytest.fixture
def world(db):
    customer = User.objects.create_user(
        email="asha@hire.test",
        password="cust12345",
        full_name="Asha Rao",
        phone="+91 98765 43210",
        email_verified=True,
    )
    staff = User.objects.create_user(
        email="ops@hire.test", password="opsadmin12345", is_staff=True, email_verified=True
    )
    return {"customer": customer, "staff": staff}


@pytest.mark.django_db
class TestSendingOne:
    def test_a_customer_sends_an_enquiry(self, world):
        response = auth(world["customer"]).post(ENQUIRIES, brief(), format="json")

        assert response.status_code == 201
        assert response.data["city"] == "Mumbai"
        assert response.data["status"] == RequestStatus.NEW

    def test_it_lands_as_NEW_rather_than_open_for_quotes(self, world):
        """`new` is the only state that means somebody is waiting on us, and it
        is the number on the console's attention bar."""
        auth(world["customer"]).post(ENQUIRIES, brief(), format="json")
        assert BookingRequest.objects.get().status == RequestStatus.NEW

    def test_contact_details_fall_back_to_the_ACCOUNT(self, world):
        """An enquiry nobody can answer is one that wastes both people's time.
        There is no automatic matching to fall back on."""
        auth(world["customer"]).post(ENQUIRIES, brief(), format="json")

        enquiry = BookingRequest.objects.get()
        assert enquiry.contact_email == "asha@hire.test"
        assert enquiry.contact_name == "Asha Rao"
        assert enquiry.contact_phone == "+91 98765 43210"

    def test_a_supplied_contact_WINS_over_the_account(self, world):
        """The bride's account, the planner's phone. They are often different
        people, and the form is the one that knows."""
        auth(world["customer"]).post(
            ENQUIRIES,
            brief(
                contact_name="Ravi (planner)",
                contact_phone="+91 90000 11111",
                contact_email="ravi@planners.test",
            ),
            format="json",
        )

        enquiry = BookingRequest.objects.get()
        assert enquiry.contact_name == "Ravi (planner)"
        assert enquiry.contact_email == "ravi@planners.test"

    def test_a_date_in_the_past_is_refused(self, world):
        response = auth(world["customer"]).post(
            ENQUIRIES,
            brief(event_date=(timezone.localdate() - dt.timedelta(days=1)).isoformat()),
            format="json",
        )
        assert response.status_code == 422

    def test_an_inverted_budget_is_refused(self, world):
        response = auth(world["customer"]).post(
            ENQUIRIES, brief(budget_min_minor=900, budget_max_minor=100), format="json"
        )
        assert response.status_code == 400

    def test_anonymous_cannot_send_one(self, world):
        assert APIClient().post(ENQUIRIES, brief(), format="json").status_code == 401

    def test_a_customer_sees_only_their_own(self, world, db):
        other = User.objects.create_user(email="other@hire.test", password="cust12345")
        auth(world["customer"]).post(ENQUIRIES, brief(), format="json")

        assert auth(other).get(ENQUIRIES).json()["data"] == []
        assert len(auth(world["customer"]).get(ENQUIRIES).json()["data"]) == 1


@pytest.mark.django_db
class TestItActuallyReachesSomebody:
    def test_the_operator_is_emailed(self, world, django_capture_on_commit_callbacks, settings):
        """THE load-bearing test. There is no marketplace behind this: if the
        alert is not sent, the enquiry reaches nobody and the customer hears
        nothing at all."""
        from apps.notifications.models import NotificationLog, NotificationType

        settings.PLATFORM_ADMIN_EMAILS = ["ops@hire.test"]
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["customer"]).post(ENQUIRIES, brief(), format="json")

        log = NotificationLog.objects.get(type=NotificationType.ADMIN_HIRE_ENQUIRY)
        assert log.recipient == "ops@hire.test"

    def test_the_alert_leads_with_the_CONTACT_details(
        self, world, django_capture_on_commit_callbacks, settings
    ):
        """An operator reading it on a phone needs the number before the budget
        — everything else is in the queue."""
        from apps.notifications.models import NotificationLog, NotificationType

        settings.PLATFORM_ADMIN_EMAILS = ["ops@hire.test"]
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["customer"]).post(ENQUIRIES, brief(), format="json")

        log = NotificationLog.objects.get(type=NotificationType.ADMIN_HIRE_ENQUIRY)
        assert "+91 98765 43210" in log.body
        assert "asha@hire.test" in log.body

    def test_the_customer_is_acknowledged(
        self, world, django_capture_on_commit_callbacks, settings
    ):
        from apps.notifications.models import NotificationLog, NotificationType

        settings.PLATFORM_ADMIN_EMAILS = ["ops@hire.test"]
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["customer"]).post(ENQUIRIES, brief(), format="json")

        log = NotificationLog.objects.get(type=NotificationType.HIRE_ENQUIRY_RECEIVED)
        assert log.recipient == "asha@hire.test"

    def test_the_acknowledgement_promises_NO_timeframe(
        self, world, django_capture_on_commit_callbacks, settings
    ):
        """Nothing here measures or enforces one, so "within 24 hours" would be
        a number with nothing behind it — and the first person it disappoints
        is somebody already waiting."""
        from apps.notifications.models import NotificationLog, NotificationType

        settings.PLATFORM_ADMIN_EMAILS = ["ops@hire.test"]
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["customer"]).post(ENQUIRIES, brief(), format="json")

        body = NotificationLog.objects.get(type=NotificationType.HIRE_ENQUIRY_RECEIVED).body
        assert "24 hour" not in body.lower()
        assert "48 hour" not in body.lower()

    def test_the_customer_is_STILL_acknowledged_with_no_ops_mailbox_set(
        self, world, django_capture_on_commit_callbacks, settings
    ):
        """An unset ops mailbox is an operator's problem. It must not also
        leave the customer wondering whether the form worked."""
        from apps.notifications.models import NotificationLog, NotificationType

        settings.PLATFORM_ADMIN_EMAILS = []
        with django_capture_on_commit_callbacks(execute=True):
            auth(world["customer"]).post(ENQUIRIES, brief(), format="json")

        assert NotificationLog.objects.filter(type=NotificationType.HIRE_ENQUIRY_RECEIVED).exists()


@pytest.mark.django_db
class TestTheOperatorsQueue:
    def enquiry(self, world) -> BookingRequest:
        auth(world["customer"]).post(ENQUIRIES, brief(), format="json")
        return BookingRequest.objects.get()

    def test_an_operator_sees_it_with_the_contact_details(self, world):
        """Withheld from the marketplace version of this payload on purpose —
        a performer seeing a lead was shown the job and not the person. The
        only reader now is somebody whose whole job is to reply."""
        self.enquiry(world)
        row = auth(world["staff"]).get(ADMIN).json()["data"][0]

        assert row["contact_phone"] == "+91 98765 43210"
        assert row["customer_email"] == "asha@hire.test"
        assert row["performer_type_display"] == "Band"

    def test_the_queue_is_FIFO(self, world):
        """An operator working top-down should be clearing the longest wait."""
        first = self.enquiry(world)
        BookingRequest.objects.filter(pk=first.id).update(
            created_at=timezone.now() - dt.timedelta(days=2)
        )
        auth(world["customer"]).post(ENQUIRIES, brief(city="Pune"), format="json")

        cities = [row["city"] for row in auth(world["staff"]).get(ADMIN).json()["data"]]
        assert cities == ["Mumbai", "Pune"]

    def test_it_filters_by_status(self, world):
        enquiry = self.enquiry(world)
        auth(world["staff"]).patch(
            f"{ADMIN}/{enquiry.id}", {"status": "in_progress"}, format="json"
        )

        assert auth(world["staff"]).get(f"{ADMIN}?status=new").json()["data"] == []
        assert len(auth(world["staff"]).get(f"{ADMIN}?status=in_progress").json()["data"]) == 1

    def test_it_searches_across_the_contact_and_the_notes(self, world):
        self.enquiry(world)
        found = auth(world["staff"]).get(f"{ADMIN}?q=sunset").json()["data"]
        assert len(found) == 1

    def test_a_non_operator_is_refused(self, world):
        assert auth(world["customer"]).get(ADMIN).status_code == 403

    def test_it_is_never_edge_cacheable(self, world):
        """Contact details for real people, on a per-operator screen."""
        assert auth(world["staff"]).get(ADMIN)["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
class TestWorkingOne:
    def enquiry(self, world) -> BookingRequest:
        auth(world["customer"]).post(ENQUIRIES, brief(), format="json")
        return BookingRequest.objects.get()

    def test_picking_it_up_records_WHO(self, world):
        """Distinct from `new` precisely so two operators do not both phone the
        same customer."""
        enquiry = self.enquiry(world)
        response = auth(world["staff"]).patch(
            f"{ADMIN}/{enquiry.id}",
            {"status": "in_progress", "admin_note": "Called, left a message."},
            format="json",
        )

        assert response.status_code == 200
        assert response.data["handled_by_email"] == "ops@hire.test"
        assert response.data["admin_note"] == "Called, left a message."

    def test_won_and_lost_are_separate_states(self, world):
        """The only two numbers worth having from this queue. A single `closed`
        throws both away."""
        enquiry = self.enquiry(world)
        auth(world["staff"]).patch(f"{ADMIN}/{enquiry.id}", {"status": "closed_won"}, format="json")

        enquiry.refresh_from_db()
        assert enquiry.status == RequestStatus.CLOSED_WON

    def test_an_operator_cannot_mark_it_WITHDRAWN(self, world):
        """`cancelled` is the customer's word for their own request. An
        operator marking somebody's enquiry withdrawn on their behalf is a
        different act from closing it as lost."""
        enquiry = self.enquiry(world)
        response = auth(world["staff"]).patch(
            f"{ADMIN}/{enquiry.id}", {"status": "cancelled"}, format="json"
        )
        assert response.status_code == 422

    def test_a_withdrawn_enquiry_cannot_be_closed_as_won(self, world):
        """It would record a booking against a request that no longer exists."""
        enquiry = self.enquiry(world)
        auth(world["customer"]).delete(f"{ENQUIRIES}/{enquiry.id}")

        response = auth(world["staff"]).patch(
            f"{ADMIN}/{enquiry.id}", {"status": "closed_won"}, format="json"
        )
        assert response.status_code == 409

    def test_the_customer_can_withdraw_after_an_operator_picked_it_up(self, world):
        """Somebody whose plans changed should not have to phone in to say so."""
        enquiry = self.enquiry(world)
        auth(world["staff"]).patch(
            f"{ADMIN}/{enquiry.id}", {"status": "in_progress"}, format="json"
        )

        response = auth(world["customer"]).delete(f"{ENQUIRIES}/{enquiry.id}")
        assert response.status_code == 200
        enquiry.refresh_from_db()
        assert enquiry.status == RequestStatus.CANCELLED

    def test_the_admin_note_is_NEVER_on_the_customers_payload(self, world):
        """It is written for the next operator. An internal judgement rendered
        to the person it is about is a judgement published — the same rule the
        event moderation note follows."""
        enquiry = self.enquiry(world)
        auth(world["staff"]).patch(
            f"{ADMIN}/{enquiry.id}",
            {"status": "closed_lost", "admin_note": "Budget nowhere near realistic."},
            format="json",
        )

        row = auth(world["customer"]).get(ENQUIRIES).json()["data"][0]
        assert "admin_note" not in row
        assert "realistic" not in str(row)

    def test_the_decision_is_audited(self, world):
        from core.models import AuditLog

        enquiry = self.enquiry(world)
        auth(world["staff"]).patch(f"{ADMIN}/{enquiry.id}", {"status": "closed_won"}, format="json")

        entry = AuditLog.objects.get(action="enquiry.decided")
        assert entry.actor_id == str(world["staff"].id)
        assert entry.metadata["status"] == "closed_won"

    def test_a_customer_cannot_move_their_own_through_the_queue(self, world):
        enquiry = self.enquiry(world)
        response = auth(world["customer"]).patch(
            f"{ADMIN}/{enquiry.id}", {"status": "closed_won"}, format="json"
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestBothFlowsCoexist:
    """The marketplace and the enquiry share one table and one pair of views.

    This class replaces `TestTheMarketplaceIsGone`, which asserted the
    marketplace routes returned 404. That was true of the enquiry-only
    rewrite; the product decision has since been reversed and BOTH flows are
    supported, so the assertion is INVERTED rather than deleted — the routes
    being reachable is now the thing worth protecting, and a change that
    silently unmounts them should fail here.
    """

    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/performers",
            "/api/v1/performers/facets",
            "/api/v1/me/performers",
            "/api/v1/hire/requests",
            "/api/v1/hire/enquiries",
        ],
    )
    def test_the_routes_for_both_flows_are_mounted(self, world, path):
        """Not 404. The views lived in `api.py` the whole time; it was the
        routing table that removed the capability, and that is the failure
        mode this guards."""
        assert auth(world["customer"]).get(path).status_code != 404

    def test_an_enquiry_never_appears_in_the_marketplace_list(self, world):
        """The whole point of the `kind` discriminator.

        Both flows write to `BookingRequest`. Before `kind`, the customer's
        list returned every row regardless of flow, so an operator-handled
        enquiry would appear on the marketplace briefs screen carrying a
        status that screen has no label for.
        """
        client = auth(world["customer"])
        created = client.post(
            "/api/v1/hire/enquiries",
            {
                "performer_type": "band",
                "occasion": "wedding",
                "city": "Mumbai",
                "event_date": str((timezone.now() + dt.timedelta(days=45)).date()),
                "budget_min_minor": 500000,
                "budget_max_minor": 1500000,
            },
            format="json",
        )
        assert created.status_code == 201

        enquiries = client.get("/api/v1/hire/enquiries").json()["data"]
        briefs = client.get("/api/v1/hire/requests").json()["data"]

        assert len(enquiries) >= 1, "the enquiry belongs in the enquiry list"
        assert briefs == [], "an enquiry must not leak into the marketplace list"

    def test_the_two_flows_open_in_their_own_states(self, world):
        """A brief opens `open` (waiting for quotes); an enquiry opens `new`
        (waiting for an operator). One shared default would file every brief
        into the operator's queue."""
        client = auth(world["customer"])
        body = {
            "performer_type": "band",
            "occasion": "wedding",
            "city": "Mumbai",
            "event_date": str((timezone.now() + dt.timedelta(days=45)).date()),
            "budget_min_minor": 500000,
            "budget_max_minor": 1500000,
        }
        client.post("/api/v1/hire/enquiries", body, format="json")
        client.post("/api/v1/hire/requests", body, format="json")

        rows = {r.kind: r.status for r in BookingRequest.objects.all()}
        assert rows["enquiry"] == RequestStatus.NEW
        assert rows["marketplace"] == RequestStatus.OPEN
