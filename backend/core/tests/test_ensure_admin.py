"""`manage.py ensure_admin` — creating or promoting a platform operator.

It is run from a runbook and re-run whenever somebody is unsure whether it was
run, so IDEMPOTENCE is the property that matters most. The second most
important is that it does not invent a password: a default on an admin account
is worse than no password on one.
"""

from __future__ import annotations

import io

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import User
from core.models import AuditLog

EMAIL = "hemanthsure40400@gmail.com"


def run(**kwargs) -> str:
    out = io.StringIO()
    call_command("ensure_admin", stdout=out, **kwargs)
    return out.getvalue()


@pytest.mark.django_db
class TestCreating:
    def test_it_creates_an_operator(self):
        output = run(email=EMAIL)

        user = User.objects.get(email=EMAIL)
        assert user.is_staff is True
        assert user.is_active is True
        assert "Created operator account" in output

    def test_the_address_is_marked_verified(self):
        """Registration withholds a session until the address is proven, so a
        seeded operator who never received a code could not sign in at all."""
        run(email=EMAIL)
        assert User.objects.get(email=EMAIL).email_verified is True

    def test_with_no_password_the_account_has_an_UNUSABLE_one(self):
        """Not blank, and not a default. A guessable password on an admin
        account is worse than no password on one — the operator signs in with
        Google, or sets one deliberately later."""
        run(email=EMAIL)

        user = User.objects.get(email=EMAIL)
        assert user.check_password("") is False
        assert user.check_password("admin") is False
        assert user.check_password("password") is False

    def test_a_supplied_password_works(self):
        run(email=EMAIL, password="s3cure-operator-pass")
        assert User.objects.get(email=EMAIL).check_password("s3cure-operator-pass") is True

    def test_superuser_is_NOT_granted_by_default(self):
        """Console access is `is_staff`; Django-admin superuser is a far
        broader grant and has to be asked for."""
        run(email=EMAIL)
        assert User.objects.get(email=EMAIL).is_superuser is False

    def test_superuser_is_granted_when_asked_for(self):
        run(email=EMAIL, superuser=True)
        assert User.objects.get(email=EMAIL).is_superuser is True

    def test_organizer_is_optional_too(self):
        run(email=EMAIL, organizer=True)
        assert User.objects.get(email=EMAIL).is_organizer is True

    def test_the_email_is_normalised_to_lowercase(self):
        run(email="Hemanth.Sure@Example.COM")
        assert User.objects.filter(email="hemanth.sure@example.com").exists()

    def test_a_malformed_address_is_refused(self):
        with pytest.raises(CommandError):
            run(email="not-an-email")


@pytest.mark.django_db
class TestPromoting:
    def test_it_promotes_an_existing_account_without_replacing_it(self):
        """THE case for a Google operator: the account may already exist from
        an ordinary sign-up, and promoting must keep its id — bookings and
        tickets hang off it."""
        existing = User.objects.create_user(email=EMAIL, password="original-pass")

        run(email=EMAIL)

        existing.refresh_from_db()
        assert existing.is_staff is True
        assert User.objects.filter(email=EMAIL).count() == 1

    def test_promoting_does_not_change_an_existing_password(self):
        """Somebody's working password must survive being made an operator."""
        User.objects.create_user(email=EMAIL, password="original-pass")

        run(email=EMAIL)

        assert User.objects.get(email=EMAIL).check_password("original-pass") is True

    def test_it_reinstates_a_suspended_account(self):
        """`is_active=False` is what `AuthService.authenticate` refuses on, so
        a suspended account granted `is_staff` still could not sign in."""
        user = User.objects.create_user(email=EMAIL, password="p")
        user.is_active = False
        user.save(update_fields=["is_active"])

        run(email=EMAIL)

        assert User.objects.get(email=EMAIL).is_active is True


@pytest.mark.django_db
class TestIdempotence:
    def test_running_twice_is_a_no_op_the_second_time(self):
        run(email=EMAIL)
        output = run(email=EMAIL)

        assert "already an operator" in output
        assert User.objects.filter(email=EMAIL).count() == 1

    def test_the_second_run_writes_no_second_audit_row(self):
        """A re-run must not claim a second promotion happened."""
        run(email=EMAIL)
        before = AuditLog.objects.filter(target_type="user").count()

        run(email=EMAIL)

        assert AuditLog.objects.filter(target_type="user").count() == before

    def test_the_grant_is_audited(self):
        run(email=EMAIL)

        entry = AuditLog.objects.get(action="user.admin_created")
        assert entry.metadata["email"] == EMAIL
        assert "is_staff" in entry.metadata["changed"]


@pytest.mark.django_db
def test_a_google_sign_in_with_that_address_lands_in_THIS_account():
    """The property the whole command exists to produce.

    `GoogleSignInService._find_or_create` matches on EMAIL, so a seeded
    operator signing in with Google resolves to the account seeded here rather
    than creating a second, non-staff one beside it. Asserted directly against
    the real lookup rather than trusted.
    """
    run(email=EMAIL, name="Hemanth")
    seeded = User.objects.get(email=EMAIL)

    from apps.accounts.repositories import UserRepository

    found = UserRepository().get_by_email(EMAIL)

    assert found is not None
    assert found.id == seeded.id
    assert found.is_staff is True
    # ...and already verified, so the Google path's `mark_email_verified_by_google`
    # is a no-op rather than a required extra step.
    assert found.email_verified is True
