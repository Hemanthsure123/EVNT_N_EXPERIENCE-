"""PATCH /auth/me — the display name and the phone number.

`/auth/me` was GET-only and `phone` was on no serializer at all, which left two
real holes:

- A ticket is issued in the NAME on the account, and there was no way to fix a
  typo in it before issuance.
- `notifications` has been sending SMS since it shipped — the booking
  confirmation, the refund confirmation, routed through India DLT templates —
  to a column **nothing could ever populate**. The delivery half was built and
  the destination was unreachable.

The load-bearing behaviour here is PARTIALNESS: an omitted field is left alone,
an empty string CLEARS. Conflating them would make removing a phone number
impossible, and removing it is how somebody opts out of SMS.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User

ME = "/api/v1/auth/me"


@pytest.fixture
def user(db) -> User:
    return User.objects.create_user(
        email="holder@example.com", password="holder12345", full_name="Ravi Menon"
    )


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestReading:
    def test_the_profile_now_carries_phone(self, user):
        """It has to be READABLE, not just writable — a settings screen cannot
        offer to change a number it is never told."""
        user.phone = "+91 98765 43210"
        user.save(update_fields=["phone"])

        body = auth(user).get(ME).json()

        assert body["phone"] == "+91 98765 43210"

    def test_no_number_is_an_empty_string_not_a_missing_key(self, user):
        """Blank is a real, supported state meaning "skip SMS" — the client
        renders an empty field rather than crashing on an absent key."""
        assert auth(user).get(ME).json()["phone"] == ""


@pytest.mark.django_db
class TestWriting:
    def test_the_name_can_be_corrected(self, user):
        resp = auth(user).patch(ME, {"full_name": "Ravi Menon Jr"}, format="json")

        assert resp.status_code == 200
        assert resp.data["full_name"] == "Ravi Menon Jr"
        user.refresh_from_db()
        assert user.full_name == "Ravi Menon Jr"

    def test_a_phone_can_be_added(self, user):
        resp = auth(user).patch(ME, {"phone": "+91 90000 11111"}, format="json")

        assert resp.status_code == 200
        user.refresh_from_db()
        assert user.phone == "+91 90000 11111"

    def test_an_OMITTED_field_is_left_alone(self, user):
        """The half of PATCH that makes it a PATCH."""
        user.phone = "+91 90000 11111"
        user.save(update_fields=["phone"])

        auth(user).patch(ME, {"full_name": "Only The Name"}, format="json")

        user.refresh_from_db()
        assert user.full_name == "Only The Name"
        assert user.phone == "+91 90000 11111"  # untouched

    def test_an_EMPTY_STRING_clears(self, user):
        """Distinct from omission, and it has to be: clearing the number is how
        somebody opts out of SMS. Treating blank as absent would make that
        impossible."""
        user.phone = "+91 90000 11111"
        user.save(update_fields=["phone"])

        resp = auth(user).patch(ME, {"phone": ""}, format="json")

        assert resp.status_code == 200
        user.refresh_from_db()
        assert user.phone == ""

    def test_an_empty_body_changes_nothing_and_still_returns_the_profile(self, user):
        resp = auth(user).patch(ME, {}, format="json")

        assert resp.status_code == 200
        assert resp.data["full_name"] == "Ravi Menon"

    def test_it_answers_with_the_FULL_profile(self, user):
        """Matching `MeAvatarView`, and for the same reason: the caller is a
        settings screen holding a cached user object, and the same shape
        `/auth/me` returns lets it replace that object outright."""
        resp = auth(user).patch(ME, {"full_name": "Whoever"}, format="json")

        for key in ("id", "email", "full_name", "phone", "avatar_url", "is_staff"):
            assert key in resp.data

    def test_surrounding_whitespace_is_trimmed(self, user):
        auth(user).patch(ME, {"full_name": "  Padded Name  "}, format="json")
        user.refresh_from_db()
        assert user.full_name == "Padded Name"


@pytest.mark.django_db
class TestWhatItRefuses:
    def test_the_email_address_cannot_be_changed_here(self, user):
        """The address is the sign-in identity AND the ticket destination, so
        changing it is a re-verification flow rather than a profile field.
        Accepting it here would let an account be moved to an address the
        holder does not control — the exact thing `EmailVerification` prevents.

        The serializer has no `email` field, so one sent is IGNORED rather than
        rejected. Either would be safe; this asserts the address is unchanged,
        which is the property that actually matters.
        """
        auth(user).patch(ME, {"email": "attacker@example.com"}, format="json")

        user.refresh_from_db()
        assert user.email == "holder@example.com"

    def test_the_verified_flag_cannot_be_flipped(self, user):
        """A targeted UPDATE of only the supplied columns is what guarantees
        this — a `save()` on the JWT-deserialized instance would write every
        field back."""
        assert user.email_verified is False

        auth(user).patch(ME, {"full_name": "Whoever", "email_verified": True}, format="json")

        user.refresh_from_db()
        assert user.email_verified is False

    def test_staff_cannot_be_granted(self, user):
        auth(user).patch(ME, {"full_name": "Whoever", "is_staff": True}, format="json")
        user.refresh_from_db()
        assert user.is_staff is False

    def test_anonymous_is_rejected(self, user):
        assert APIClient().patch(ME, {"full_name": "Nope"}, format="json").status_code == 401

    def test_a_name_over_the_column_length_is_refused(self, user):
        resp = auth(user).patch(ME, {"full_name": "x" * 200}, format="json")
        assert resp.status_code == 400

    def test_there_is_no_user_id_parameter_to_point_at_somebody_else(self, user):
        """`ProfileService` takes the acting user's own id and has no
        `user_id` argument a caller could supply, so changing another account's
        profile is not a capability this class has — it cannot be reached by
        forgetting a check."""
        other = User.objects.create_user(email="other@example.com", password="other12345")

        auth(user).patch(ME, {"full_name": "Changed"}, format="json")

        other.refresh_from_db()
        assert other.full_name == ""
        user.refresh_from_db()
        assert user.full_name == "Changed"


@pytest.mark.django_db
def test_the_change_is_audited(user):
    """An operator investigating "my ticket has the wrong name" needs to see
    that the holder changed it themselves."""
    from core.models import AuditLog

    auth(user).patch(ME, {"full_name": "New Name", "phone": "+91 1"}, format="json")

    entry = AuditLog.objects.get(action="user.profile_updated")
    assert entry.actor_id == str(user.id)
    assert entry.metadata["fields"] == ["full_name", "phone"]
