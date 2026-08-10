"""The HTTP boundary: status codes, authorization, and what leaks."""

from __future__ import annotations

from typing import cast

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.reviews.schemas import display_name

pytestmark = pytest.mark.django_db


def client_for(user=None) -> APIClient:
    client = APIClient()
    if user is not None:
        # `cast` for the same reason booking's conftest does it: simplejwt
        # types `for_user` as the base `Token`, which has no `access_token`.
        token = cast(RefreshToken, RefreshToken.for_user(user)).access_token
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


class TestWriting:
    def test_an_eligible_attendee_gets_201(self, make_event, make_booking, attendee):
        event = make_event()
        make_booking(event=event, user=attendee)
        response = client_for(attendee).post(
            f"/api/v1/events/{event.id}/reviews", {"rating": 5, "body": "Loved it."}, format="json"
        )
        assert response.status_code == 201
        assert response.json()["rating"] == 5

    def test_an_anonymous_write_is_refused(self, make_event):
        event = make_event()
        response = client_for().post(
            f"/api/v1/events/{event.id}/reviews", {"rating": 5}, format="json"
        )
        assert response.status_code in (401, 403)

    def test_a_stranger_is_refused_with_422_not_500(self, make_event, stranger):
        event = make_event()
        response = client_for(stranger).post(
            f"/api/v1/events/{event.id}/reviews", {"rating": 5}, format="json"
        )
        assert response.status_code == 422
        assert "booked" in response.json()["error"]["message"]

    def test_a_duplicate_is_409(self, make_event, make_booking, attendee):
        event = make_event()
        make_booking(event=event, user=attendee)
        client = client_for(attendee)
        client.post(f"/api/v1/events/{event.id}/reviews", {"rating": 4}, format="json")
        again = client.post(f"/api/v1/events/{event.id}/reviews", {"rating": 2}, format="json")
        assert again.status_code == 409

    def test_an_out_of_scale_rating_is_rejected_at_the_boundary(
        self, make_event, make_booking, attendee
    ):
        """400, not 422, and the difference is the codebase's convention.

        A DRF serializer rejection is a MALFORMED REQUEST — 400. 422 is what
        `DomainError` maps to: a well-formed request the business rules refuse,
        like reviewing an event you did not attend. Both arrive in the same
        error envelope; the status is what tells a client whether to fix the
        payload or tell the user something.
        """
        event = make_event()
        make_booking(event=event, user=attendee)
        response = client_for(attendee).post(
            f"/api/v1/events/{event.id}/reviews", {"rating": 7}, format="json"
        )
        assert response.status_code == 400


class TestReading:
    def test_the_list_is_public_and_cacheable(self, make_event, make_booking, attendee):
        event = make_event()
        make_booking(event=event, user=attendee)
        client_for(attendee).post(
            f"/api/v1/events/{event.id}/reviews", {"rating": 5, "body": "Great."}, format="json"
        )
        response = client_for().get(f"/api/v1/events/{event.id}/reviews")
        assert response.status_code == 200
        # Identical for everyone, so a CDN may hold it — the same treatment the
        # public events endpoints get.
        assert "public" in response["Cache-Control"]
        assert response.json()["data"][0]["body"] == "Great."

    def test_a_review_never_carries_an_email_address(self, make_event, make_booking, attendee):
        """The privacy assertion, on the actual response body.

        A reviewer opted into a night out, not into having their address
        published beside their opinion. Asserted on the serialized payload
        rather than the serializer's field list, because that is what ships.
        """
        event = make_event()
        make_booking(event=event, user=attendee)
        client_for(attendee).post(
            f"/api/v1/events/{event.id}/reviews", {"rating": 5}, format="json"
        )
        body = client_for().get(f"/api/v1/events/{event.id}/reviews").content.decode()
        assert attendee.email not in body
        assert "Asha R." in body  # first name, surname initial

    def test_a_hidden_review_is_absent_from_the_public_list(
        self, review_service, make_event, make_booking, attendee
    ):
        from apps.reviews.models import ReviewStatus

        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=1, body="X")
        review_service.set_moderation(review_id=review.id, status=ReviewStatus.HIDDEN)
        response = client_for().get(f"/api/v1/events/{event.id}/reviews")
        assert response.json()["data"] == []

    def test_the_summary_is_public(self, make_event):
        event = make_event()
        response = client_for().get(f"/api/v1/events/{event.id}/reviews/summary")
        assert response.status_code == 200
        assert response.json() == {
            "average": 0.0,
            "count": 0,
            "distribution": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0},
        }

    def test_mine_is_204_when_there_is_nothing(self, make_event, attendee):
        event = make_event()
        response = client_for(attendee).get(f"/api/v1/events/{event.id}/reviews/mine")
        assert response.status_code == 204

    def test_eligibility_and_pending_are_never_shared_caches(
        self, make_event, make_booking, attendee
    ):
        # Both answers depend on WHO is asking; a CDN holding one would serve
        # somebody else's.
        event = make_event()
        make_booking(event=event, user=attendee)
        client = client_for(attendee)
        for url in (
            f"/api/v1/events/{event.id}/reviews/eligibility",
            "/api/v1/me/pending-reviews",
        ):
            response = client.get(url)
            assert response.status_code == 200
            assert response["Cache-Control"] == "private, no-store"

    def test_pending_requires_a_session(self):
        assert client_for().get("/api/v1/me/pending-reviews").status_code in (401, 403)


class TestModerationEndpoint:
    def test_a_normal_user_cannot_moderate(
        self, review_service, make_event, make_booking, attendee, stranger
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=1)
        response = client_for(stranger).post(
            f"/api/v1/admin/reviews/{review.id}/moderation", {"status": "hidden"}, format="json"
        )
        assert response.status_code == 403

    def test_staff_can_hide(self, review_service, make_event, make_booking, attendee, organizer):
        organizer.is_staff = True
        organizer.save(update_fields=["is_staff"])
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=1)
        response = client_for(organizer).post(
            f"/api/v1/admin/reviews/{review.id}/moderation", {"status": "hidden"}, format="json"
        )
        assert response.status_code == 200


class TestDisplayName:
    @pytest.mark.parametrize(
        ("full_name", "expected"),
        [
            ("Hemanth Sure", "Hemanth S."),
            ("Asha", "Asha"),
            ("  ", "Curatix guest"),
            ("Mary Jane Watson", "Mary W."),
        ],
    )
    def test_it_shows_a_first_name_and_an_initial(self, full_name, expected):
        assert display_name(full_name) == expected
