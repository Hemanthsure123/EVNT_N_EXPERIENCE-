"""A suspended account is told it is suspended, and revocation is terminal.

── THE PROBLEM THIS FIXES ────────────────────────────────────────────────

Suspension used to be folded into `invalid_credentials`. A suspended person
signing in saw exactly what a typo looks like, went to reset their password,
succeeded at resetting it, and was refused again — because the password was
never the problem and there is no self-service way out of a suspension. They
would then sign up afresh with the same address and be told it was "already
registered", which sent them back round the same loop.

Every screen in that loop was truthful and the whole loop was useless.

── WHY NAMING IT DOES NOT LEAK ───────────────────────────────────────────

The suspension is revealed only AFTER the credential has been proven: the
password checked, or Google having asserted the address. Anybody who gets that
far already knows the account exists. That is the same ordering the
`email_not_verified` check has used since it was written, and the first test
class below pins it — because getting it backwards turns this endpoint into a
free account-enumeration oracle.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User

LOGIN = "/api/v1/auth/login"
REGISTER = "/api/v1/auth/register"
PASSWORD = "s3cur3pass123"


def code(response) -> str:
    return response.data["error"]["code"]


@pytest.fixture
def people(db):
    active = User.objects.create_user(
        email="active@susp.test", password=PASSWORD, email_verified=True
    )
    suspended = User.objects.create_user(
        email="suspended@susp.test", password=PASSWORD, email_verified=True, is_active=False
    )
    return {"active": active, "suspended": suspended}


@pytest.mark.django_db
class TestSigningIn:
    def test_a_suspended_account_is_told_it_is_suspended(self, people):
        response = APIClient().post(
            LOGIN, {"email": "suspended@susp.test", "password": PASSWORD}, format="json"
        )
        assert code(response) == "account_suspended"
        assert "administrator" in response.data["error"]["message"].lower()

    def test_the_WRONG_password_on_a_suspended_account_says_invalid_credentials(self, people):
        """The enumeration guard. If this said `account_suspended`, anybody
        could walk a list of addresses and learn which ones exist — no password
        required. The check has to sit AFTER the password, not before it."""
        response = APIClient().post(
            LOGIN, {"email": "suspended@susp.test", "password": "wrong-password"}, format="json"
        )
        assert code(response) == "invalid_credentials"

    def test_an_address_with_no_account_is_indistinguishable_from_a_wrong_password(self, people):
        nobody = APIClient().post(
            LOGIN, {"email": "ghost@susp.test", "password": PASSWORD}, format="json"
        )
        wrong = APIClient().post(
            LOGIN, {"email": "active@susp.test", "password": "wrong-password"}, format="json"
        )
        assert code(nobody) == code(wrong) == "invalid_credentials"

    def test_an_active_account_still_signs_in(self, people):
        response = APIClient().post(
            LOGIN, {"email": "active@susp.test", "password": PASSWORD}, format="json"
        )
        assert response.status_code == 200
        assert response.data["tokens"]["access"]


@pytest.mark.django_db
class TestSigningUpAgain:
    def test_registering_on_a_suspended_address_names_the_dead_end(self, people):
        """The most likely next move after a refused sign-in. "That email is
        already registered" sends them round the loop once more."""
        response = APIClient().post(
            REGISTER,
            {"email": "suspended@susp.test", "password": PASSWORD, "full_name": "A Person"},
            format="json",
        )
        assert code(response) == "account_suspended"

    def test_registering_on_an_ACTIVE_taken_address_is_unchanged(self, people):
        response = APIClient().post(
            REGISTER,
            {"email": "active@susp.test", "password": PASSWORD, "full_name": "A Person"},
            format="json",
        )
        assert code(response) == "email_already_registered"

    def test_a_fresh_address_still_registers(self, people):
        response = APIClient().post(
            REGISTER,
            {"email": "brand-new@susp.test", "password": PASSWORD, "full_name": "A Person"},
            format="json",
        )
        assert response.status_code == 201

    def test_the_suspended_account_is_NOT_overwritten(self, people):
        """The refusal has to happen before any write. A registration that
        replaced the row would hand a suspended person a clean account and
        detach them from their own bookings."""
        APIClient().post(
            REGISTER,
            {"email": "suspended@susp.test", "password": "different-pass-1", "full_name": "X"},
            format="json",
        )
        people["suspended"].refresh_from_db()
        assert people["suspended"].is_active is False
        assert people["suspended"].check_password(PASSWORD)


@pytest.mark.django_db
class TestRevokingVerification:
    def url(self, user) -> str:
        return f"/api/v1/admin/users/{user.id}/verification"

    @pytest.fixture
    def staff(self, db) -> User:
        return User.objects.create_user(
            email="ops@susp.test", password="opsadmin12345", is_staff=True, email_verified=True
        )

    def auth(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_it_untrusts_the_address_AND_takes_the_account_out_of_service(self, people, staff):
        """Clearing the flag alone would be an invitation, not a decision: the
        verify endpoint would issue a fresh code to the same inbox and the
        account would be back inside a minute, having re-proven exactly what
        the operator just decided was not good enough."""
        response = self.auth(staff).delete(
            self.url(people["active"]), {"reason": "Chargeback fraud"}, format="json"
        )

        assert response.status_code == 200
        people["active"].refresh_from_db()
        assert people["active"].email_verified is False
        assert people["active"].is_active is False

    def test_the_revoked_person_cannot_sign_in(self, people, staff):
        self.auth(staff).delete(self.url(people["active"]), {"reason": "x"}, format="json")
        response = APIClient().post(
            LOGIN, {"email": "active@susp.test", "password": PASSWORD}, format="json"
        )
        assert code(response) == "account_suspended"

    def test_the_revoked_person_cannot_sign_up_again_on_the_same_address(self, people, staff):
        self.auth(staff).delete(self.url(people["active"]), {"reason": "x"}, format="json")
        response = APIClient().post(
            REGISTER,
            {"email": "active@susp.test", "password": PASSWORD, "full_name": "A Person"},
            format="json",
        )
        assert code(response) == "account_suspended"

    def test_it_is_recorded_with_its_reason(self, people, staff):
        from core.models import AuditLog

        self.auth(staff).delete(
            self.url(people["active"]), {"reason": "Chargeback fraud"}, format="json"
        )
        entry = AuditLog.objects.get(action="user.verification_revoked")
        assert entry.actor_id == str(staff.id)
        assert entry.metadata["reason"] == "Chargeback fraud"

    def test_an_operator_cannot_revoke_their_own(self, staff):
        """They would 401 on the very next request, locked out of the console
        that fixes it."""
        response = self.auth(staff).delete(self.url(staff), {}, format="json")
        assert response.status_code == 409
        staff.refresh_from_db()
        assert staff.is_active is True

    def test_an_operator_cannot_revoke_another_operator(self, staff, db):
        colleague = User.objects.create_user(
            email="ops2@susp.test", password="opsadmin12345", is_staff=True, email_verified=True
        )
        response = self.auth(staff).delete(self.url(colleague), {}, format="json")
        assert response.status_code == 409
        colleague.refresh_from_db()
        assert colleague.is_active is True

    def test_revoking_twice_is_a_conflict_rather_than_a_silent_success(self, people, staff):
        """So a double-click cannot write a second audit row claiming a second
        decision — the same rule suspension follows."""
        self.auth(staff).delete(self.url(people["active"]), {}, format="json")
        second = self.auth(staff).delete(self.url(people["active"]), {}, format="json")
        assert second.status_code == 409

    def test_a_non_operator_cannot_revoke_anybody(self, people):
        response = self.auth(people["active"]).delete(self.url(people["suspended"]), {})
        assert response.status_code == 403

    def test_anonymous_cannot_revoke_anybody(self, people):
        assert APIClient().delete(self.url(people["active"]), {}).status_code == 401

    def test_reinstating_does_NOT_silently_re_assert_the_address(self, people, staff):
        """The two flags stay separate columns on purpose. Reinstatement is an
        access decision; it must not claim an address was proven when the
        operator's whole point was that it was not."""
        self.auth(staff).delete(self.url(people["active"]), {}, format="json")
        self.auth(staff).post(
            f"/api/v1/admin/users/{people['active'].id}/suspension",
            {"suspended": False},
            format="json",
        )

        people["active"].refresh_from_db()
        assert people["active"].is_active is True
        assert people["active"].email_verified is False

        # ...so they are asked to prove it, rather than let straight in.
        response = APIClient().post(
            LOGIN, {"email": "active@susp.test", "password": PASSWORD}, format="json"
        )
        assert code(response) == "email_not_verified"
