"""The wider profile: date of birth, gender, and the onboarding mark.

── THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM ─────────────────────────

`date_of_birth` is stored; AGE IS DERIVED. An age column is wrong the day
after it is written, and on this platform that is a correctness problem rather
than an untidiness — `Event.age_restriction` carries "18+", so a stored age
would let somebody who was 17 at sign-up walk an adult gate a year later. The
first test class pins the derivation, including the leap-year case that the
obvious `days // 365` version gets wrong.

── AND THE ONE THAT IS EASY TO GET BACKWARDS ─────────────────────────────

Blank gender means NEVER ANSWERED. `prefer_not_to_say` means asked, and
declined. Conflating them would re-prompt the one person whose answer clearly
meant stop asking.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Gender, User

ME = "/api/v1/auth/me"
ONBOARDING = "/api/v1/auth/me/onboarding"


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def person(db) -> User:
    return User.objects.create_user(
        email="profile@example.com", password="s3cur3pass", email_verified=True
    )


def born(years_ago: int, *, month: int = 6, day: int = 15) -> str:
    today = timezone.localdate()
    return dt.date(today.year - years_ago, month, day).isoformat()


@pytest.mark.django_db
class TestTheDateAndTheAge:
    def test_a_date_of_birth_is_stored_and_the_age_comes_back_derived(self, person):
        response = auth(person).patch(ME, {"date_of_birth": born(30)}, format="json")

        assert response.status_code == 200
        assert response.data["date_of_birth"] == born(30)
        assert response.data["age"] == 30

    def test_the_age_is_a_year_lower_the_day_before_the_birthday(self, person):
        """The whole reason age is not a column. `(today - born).days // 365`
        is the version everybody writes and it drifts by a day per leap year;
        this is the comparison that does not."""
        today = timezone.localdate()
        tomorrow = today + dt.timedelta(days=1)
        # Born tomorrow, 30 years ago: still 29 today.
        birthday = dt.date(today.year - 30, tomorrow.month, tomorrow.day)
        response = auth(person).patch(ME, {"date_of_birth": birthday.isoformat()}, format="json")
        assert response.data["age"] == 29

    def test_a_29_february_birthday_is_handled(self, person):
        """A leap day is a real date somebody has, and the naive arithmetic is
        wrong for exactly these people."""
        response = auth(person).patch(ME, {"date_of_birth": "2000-02-29"}, format="json")
        assert response.status_code == 200
        assert response.data["age"] == timezone.localdate().year - 2000 - (
            (timezone.localdate().month, timezone.localdate().day) < (2, 29)
        )

    def test_age_is_null_when_no_date_was_given(self, person):
        """Never a zero, and never a guess — the frontend omits the row."""
        body = auth(person).get(ME).json()
        assert body["date_of_birth"] is None
        assert body["age"] is None

    def test_a_future_date_is_refused_by_naming_the_problem(self, person):
        response = auth(person).patch(
            ME,
            {"date_of_birth": (timezone.localdate() + dt.timedelta(days=1)).isoformat()},
            format="json",
        )
        assert response.status_code == 400
        assert "future" in str(response.data).lower()

    def test_somebody_under_thirteen_is_refused(self, person):
        """Not a judgement about who may use the site — an admission that the
        guardian-consent flow DPDP requires below 13 does not exist here."""
        response = auth(person).patch(ME, {"date_of_birth": born(11)}, format="json")
        assert response.status_code == 400

    def test_a_mistyped_year_is_caught_rather_than_stored(self, person):
        """The single most common date-picker mistake there is."""
        response = auth(person).patch(ME, {"date_of_birth": "1823-04-02"}, format="json")
        assert response.status_code == 400

    def test_null_REMOVES_it(self, person):
        """Null is a real value here, unlike every other field on this
        endpoint, whose empty value is the empty string."""
        client = auth(person)
        client.patch(ME, {"date_of_birth": born(30)}, format="json")
        response = client.patch(ME, {"date_of_birth": None}, format="json")

        assert response.status_code == 200
        assert response.data["date_of_birth"] is None

    def test_omitting_it_leaves_it_alone(self, person):
        """Partial by omission. A settings screen saving a name must not clear
        a date it never sent."""
        client = auth(person)
        client.patch(ME, {"date_of_birth": born(30)}, format="json")
        response = client.patch(ME, {"full_name": "Asha Rao"}, format="json")

        assert response.data["date_of_birth"] == born(30)
        assert response.data["full_name"] == "Asha Rao"


@pytest.mark.django_db
class TestGender:
    def test_it_is_stored_and_labelled(self, person):
        response = auth(person).patch(ME, {"gender": "non_binary"}, format="json")

        assert response.status_code == 200
        assert response.data["gender"] == "non_binary"
        assert response.data["gender_display"] == "Non-binary"

    def test_self_describing_carries_the_persons_own_words(self, person):
        response = auth(person).patch(
            ME,
            {"gender": "self_described", "gender_self_described": "Genderfluid"},
            format="json",
        )
        assert response.data["gender_display"] == "Genderfluid"

    def test_self_describing_with_nothing_typed_is_refused(self, person):
        """An option with nowhere to type is worse than no option at all, so
        the pair has to arrive together."""
        response = auth(person).patch(
            ME, {"gender": "self_described", "gender_self_described": "  "}, format="json"
        )
        assert response.status_code == 400

    def test_moving_off_self_describe_CLEARS_the_text(self, person):
        """A stale self-description sitting behind a changed answer is a value
        the owner believes they removed — and the client is not trusted to
        remember to send the clear."""
        client = auth(person)
        client.patch(
            ME,
            {"gender": "self_described", "gender_self_described": "Genderfluid"},
            format="json",
        )
        response = client.patch(ME, {"gender": "woman"}, format="json")

        assert response.data["gender_self_described"] == ""
        assert response.data["gender_display"] == "Woman"

    def test_prefer_not_to_say_is_STORED_rather_than_treated_as_blank(self, person):
        """The state that means "asked, and declined". Blank means never
        answered, and re-prompting somebody who declined is nagging."""
        response = auth(person).patch(ME, {"gender": "prefer_not_to_say"}, format="json")

        person.refresh_from_db()
        assert person.gender == Gender.PREFER_NOT_TO_SAY
        assert response.data["gender_display"] == "Prefer not to say"

    def test_blank_clears_it_back_to_never_answered(self, person):
        client = auth(person)
        client.patch(ME, {"gender": "woman"}, format="json")
        response = client.patch(ME, {"gender": ""}, format="json")

        assert response.data["gender"] == ""
        assert response.data["gender_display"] == ""

    def test_a_value_that_is_not_a_choice_is_refused(self, person):
        assert auth(person).patch(ME, {"gender": "yes"}, format="json").status_code == 400

    def test_a_self_description_with_no_answer_behind_it_still_reads_sensibly(self, person):
        """Chose to self-describe, then cleared the text: reads as "prefer to
        self-describe", not as having answered nothing."""
        person.gender = Gender.SELF_DESCRIBED
        person.save(update_fields=["gender"])
        assert auth(person).get(ME).json()["gender_display"] == "Prefer to self-describe"


@pytest.mark.django_db
class TestOnboarding:
    def test_a_new_account_has_not_answered_it(self, person):
        assert auth(person).get(ME).json()["onboarding_completed_at"] is None

    def test_finishing_it_records_WHEN(self, person):
        response = auth(person).post(ONBOARDING)

        assert response.status_code == 200
        assert response.data["onboarding_completed_at"] is not None

    def test_SKIPPING_counts_as_answering(self, person):
        """The flow is never a wall. Somebody who declined has answered, and
        re-prompting them on the way to a ticket is how a product loses the
        people who only ever wanted a ticket."""
        auth(person).post(ONBOARDING)  # nothing filled in
        person.refresh_from_db()
        assert person.onboarding_completed_at is not None

    def test_it_keeps_the_FIRST_timestamp(self, person):
        """A second call is a double-submit or a redelivery. Rewriting the mark
        would make "finished in July" quietly become today, losing the one
        thing a timestamp has over a boolean."""
        first = auth(person).post(ONBOARDING).data["onboarding_completed_at"]
        second = auth(person).post(ONBOARDING).data["onboarding_completed_at"]
        assert first == second

    def test_it_is_audited(self, person):
        from core.models import AuditLog

        auth(person).post(ONBOARDING)
        assert AuditLog.objects.filter(action="user.onboarding_completed").count() == 1

    def test_anonymous_cannot_mark_anybody_onboarded(self, person):
        assert APIClient().post(ONBOARDING).status_code == 401


@pytest.mark.django_db
class TestItIsStillTheirOwnProfileOnly:
    def test_there_is_no_user_id_parameter_to_point_elsewhere(self, person, db):
        """`ProfileService` takes the acting user's own id and has no
        `user_id` a caller could redirect — changing another account's details
        is not a capability the class has, so it cannot be reached by
        forgetting a check."""
        other = User.objects.create_user(email="other@example.com", password="s3cur3pass")

        auth(person).patch(ME, {"full_name": "Mine", "id": str(other.id)}, format="json")

        other.refresh_from_db()
        person.refresh_from_db()
        assert person.full_name == "Mine"
        assert other.full_name == ""

    def test_an_edit_cannot_flip_email_verified(self, person):
        """A targeted UPDATE, not a `save()` on a deserialized row."""
        auth(person).patch(ME, {"full_name": "Asha", "email_verified": False}, format="json")
        person.refresh_from_db()
        assert person.email_verified is True
