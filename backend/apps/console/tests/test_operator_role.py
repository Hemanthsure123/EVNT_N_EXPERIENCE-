"""Granting and removing the operator role.

── WHY THIS ENDPOINT HAD TO EXIST ────────────────────────────────────────

`AccountAdminService.set_suspended` has always refused to suspend a staff
member, telling the operator to "remove their operator role first". Until now
that instruction named an endpoint that did not exist — the only way to make
somebody an operator, or stop them being one, was a Django shell.

── THE ONE REFUSAL THAT MATTERS ──────────────────────────────────────────

An operator cannot remove their OWN role. The console is the only place this
lives, so somebody who demoted themselves would lose the screen that could put
it back — and if they were the last operator, nobody could restore it without
a database shell.

There is deliberately no "last operator" guard beyond that. Counting operators
to refuse the second-to-last demotion sounds prudent and is not: it is a race
(two operators demoting each other concurrently both pass the count), and the
self-check already prevents the only version of this the product cannot undo.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def url(user: User) -> str:
    return f"/api/v1/admin/users/{user.id}/role"


@pytest.fixture
def world(db):
    return {
        "staff": User.objects.create_user(
            email="ops@role.test", password="opsadmin12345", is_staff=True, email_verified=True
        ),
        "member": User.objects.create_user(
            email="member@role.test", password="member12345", email_verified=True
        ),
    }


@pytest.mark.django_db
class TestPromoting:
    def test_an_operator_promotes_a_verified_member(self, world):
        response = auth(world["staff"]).post(
            url(world["member"]), {"is_staff": True, "reason": "Joining ops"}, format="json"
        )

        assert response.status_code == 200
        assert response.data["is_staff"] is True
        world["member"].refresh_from_db()
        assert world["member"].is_staff is True

    def test_the_new_operator_can_actually_reach_the_console(self, world):
        """The whole point — `is_staff` is a capability, not a label."""
        assert auth(world["member"]).get("/api/v1/admin/overview").status_code == 403

        auth(world["staff"]).post(url(world["member"]), {"is_staff": True}, format="json")
        world["member"].refresh_from_db()

        assert auth(world["member"]).get("/api/v1/admin/overview").status_code == 200

    def test_an_UNVERIFIED_address_cannot_be_promoted(self, world, db):
        """An operator can suspend accounts, release payouts and delete events.
        Handing that to an address nobody proved belongs to its holder is the
        one thing the verification flow exists to prevent."""
        unproven = User.objects.create_user(email="unproven@role.test", password="member12345")

        response = auth(world["staff"]).post(url(unproven), {"is_staff": True}, format="json")

        assert response.status_code == 409
        unproven.refresh_from_db()
        assert unproven.is_staff is False

    def test_a_SUSPENDED_account_cannot_be_promoted(self, world, db):
        suspended = User.objects.create_user(
            email="suspended@role.test",
            password="member12345",
            email_verified=True,
            is_active=False,
        )

        response = auth(world["staff"]).post(url(suspended), {"is_staff": True}, format="json")
        assert response.status_code == 409

    def test_promoting_twice_is_a_conflict_rather_than_a_silent_success(self, world):
        """So a double-click cannot write a second audit row claiming a second
        grant — the same rule suspension follows."""
        auth(world["staff"]).post(url(world["member"]), {"is_staff": True}, format="json")
        second = auth(world["staff"]).post(url(world["member"]), {"is_staff": True}, format="json")
        assert second.status_code == 409

    def test_it_is_audited_with_its_reason(self, world):
        from core.models import AuditLog

        auth(world["staff"]).post(
            url(world["member"]), {"is_staff": True, "reason": "Joining ops"}, format="json"
        )

        entry = AuditLog.objects.get(action="user.operator_granted")
        assert entry.actor_id == str(world["staff"].id)
        assert entry.metadata["reason"] == "Joining ops"


@pytest.mark.django_db
class TestDemoting:
    def test_an_operator_can_demote_a_COLLEAGUE(self, world, db):
        """The action `set_suspended` already points at when it refuses to
        suspend a staff member and says "remove their operator role first"."""
        colleague = User.objects.create_user(
            email="ops2@role.test", password="opsadmin12345", is_staff=True, email_verified=True
        )

        response = auth(world["staff"]).post(url(colleague), {"is_staff": False}, format="json")

        assert response.status_code == 200
        colleague.refresh_from_db()
        assert colleague.is_staff is False

    def test_demoting_then_suspending_now_WORKS_end_to_end(self, world, db):
        """The sequence that instruction describes, which was previously
        impossible: suspension refuses a staff member, and nothing could stop
        somebody being one."""
        colleague = User.objects.create_user(
            email="ops3@role.test", password="opsadmin12345", is_staff=True, email_verified=True
        )
        client = auth(world["staff"])

        assert (
            client.post(
                f"/api/v1/admin/users/{colleague.id}/suspension",
                {"suspended": True},
                format="json",
            ).status_code
            == 409
        )

        client.post(url(colleague), {"is_staff": False}, format="json")
        response = client.post(
            f"/api/v1/admin/users/{colleague.id}/suspension", {"suspended": True}, format="json"
        )

        assert response.status_code == 200
        colleague.refresh_from_db()
        assert colleague.is_active is False

    def test_an_operator_cannot_demote_THEMSELVES(self, world):
        """They would lose the console that could put it back — and if they
        were the last operator, nobody could restore it without a shell."""
        response = auth(world["staff"]).post(
            url(world["staff"]), {"is_staff": False}, format="json"
        )

        assert response.status_code == 409
        world["staff"].refresh_from_db()
        assert world["staff"].is_staff is True

    def test_demoting_a_non_operator_is_a_conflict(self, world):
        response = auth(world["staff"]).post(
            url(world["member"]), {"is_staff": False}, format="json"
        )
        assert response.status_code == 409


@pytest.mark.django_db
class TestThePrimaryAccountIsUntouchable:
    """The rule that protects the platform's way back in.

    The self-demotion guard stops you locking YOURSELF out. It does not stop
    the case that loses a whole platform: a newly promoted operator demoting
    the founding account, by mistake or otherwise. `is_superuser` is set by
    `manage.py ensure_admin` or a shell, so restoring it after that needs
    exactly the shell access the console exists to avoid.

    So the rule is a property of the ACCOUNT, not of who is asking.
    """

    @pytest.fixture
    def primary(self, db) -> User:
        return User.objects.create_user(
            email="primary@role.test",
            password="opsadmin12345",
            is_staff=True,
            is_superuser=True,
            email_verified=True,
        )

    def test_ANOTHER_operator_cannot_demote_it(self, world, primary):
        """The reported bug: the control was enabled on the primary account's
        row for every other operator."""
        response = auth(world["staff"]).post(url(primary), {"is_staff": False}, format="json")

        assert response.status_code == 409
        primary.refresh_from_db()
        assert primary.is_staff is True

    def test_it_cannot_demote_ITSELF_either(self, primary):
        response = auth(primary).post(url(primary), {"is_staff": False}, format="json")

        assert response.status_code == 409
        primary.refresh_from_db()
        assert primary.is_staff is True

    def test_the_refusal_explains_the_rule_rather_than_scolding(self, world, primary):
        response = auth(world["staff"]).post(url(primary), {"is_staff": False}, format="json")
        assert "primary" in response.data["error"]["message"].lower()

    def test_it_can_still_be_SUSPENDED_by_nobody_either(self, world, primary):
        """Unchanged, and worth pinning beside the above: suspension already
        refuses any staff account, so the two guards do not leave a gap where
        the primary can be disabled by the other route."""
        response = auth(world["staff"]).post(
            f"/api/v1/admin/users/{primary.id}/suspension", {"suspended": True}, format="json"
        )
        assert response.status_code == 409

    def test_the_console_is_TOLD_which_row_it_is(self, world, primary):
        """Without `is_superuser` on the payload the console cannot leave the
        control out, and would render a button whose only outcome is a 409."""
        rows = auth(world["staff"]).get("/api/v1/admin/users").json()["data"]
        primary_row = next(row for row in rows if row["email"] == "primary@role.test")
        assert primary_row["is_superuser"] is True

    def test_an_ordinary_operator_is_not_marked_primary(self, world):
        rows = auth(world["staff"]).get("/api/v1/admin/users").json()["data"]
        row = next(entry for entry in rows if entry["email"] == "ops@role.test")
        assert row["is_superuser"] is False


@pytest.mark.django_db
class TestAccess:
    def test_a_member_cannot_promote_themselves(self, world):
        """The obvious attack, and the reason this endpoint is `IsAdminUser`."""
        response = auth(world["member"]).post(
            url(world["member"]), {"is_staff": True}, format="json"
        )

        assert response.status_code == 403
        world["member"].refresh_from_db()
        assert world["member"].is_staff is False

    def test_anonymous_is_refused(self, world):
        assert APIClient().post(url(world["member"]), {"is_staff": True}).status_code == 401

    def test_an_unknown_account_is_a_404(self, world):
        import uuid

        response = auth(world["staff"]).post(
            f"/api/v1/admin/users/{uuid.uuid4()}/role", {"is_staff": True}, format="json"
        )
        assert response.status_code == 404
