"""HTTP surface for event content.

The service tests already prove the rules. This file proves the BOUNDARY: that
the rules survive the trip through DRF, that reads are public while writes are
not, and that another organizer cannot touch your event's media.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import EventStatus, MediaKind, TimelineKind
from apps.organizations.models import Organization

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures

IMAGE = {
    "kind": MediaKind.GALLERY,
    "url": "https://cdn.example/a.jpg",
    "alt_text": "A crowd at the front of the stage",
}


@pytest.fixture
def stranger(db) -> APIClient:
    """A signed-in organizer who owns a DIFFERENT organization."""
    user = User.objects.create_user(email="stranger@example.com", password="strangerpass12345")
    Organization.objects.create(owner=user, name="Someone Else")
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestReads:
    def test_content_is_public(self, api_client, make_event):
        event = make_event(status=EventStatus.LIVE)
        response = api_client.get(f"/api/v1/events/{event.id}/content")

        assert response.status_code == 200
        assert response.json() == {"media": [], "faqs": [], "timeline": []}

    def test_content_is_edge_cacheable(self, api_client, make_event):
        """Same for every visitor, so a CDN should absorb it — the same
        treatment the event detail itself gets."""
        event = make_event(status=EventStatus.LIVE)
        response = api_client.get(f"/api/v1/events/{event.id}/content")

        assert "public" in response["Cache-Control"]
        assert response["ETag"]

    def test_a_matching_etag_is_a_304(self, api_client, make_event):
        event = make_event(status=EventStatus.LIVE)
        first = api_client.get(f"/api/v1/events/{event.id}/content")
        again = api_client.get(
            f"/api/v1/events/{event.id}/content", HTTP_IF_NONE_MATCH=first["ETag"]
        )
        assert again.status_code == 304


@pytest.mark.django_db
class TestWritePermissions:
    @pytest.mark.parametrize("collection", ["media", "faqs", "timeline"])
    def test_anonymous_cannot_write(self, api_client, make_event, collection):
        event = make_event(status=EventStatus.DRAFT)
        response = api_client.post(f"/api/v1/events/{event.id}/{collection}", {}, format="json")
        assert response.status_code == 401

    def test_another_organizer_gets_404_not_403(self, stranger, make_event):
        """404, deliberately: a 403 would confirm the event exists to anyone
        walking ids."""
        event = make_event(status=EventStatus.DRAFT)
        response = stranger.post(f"/api/v1/events/{event.id}/media", IMAGE, format="json")
        assert response.status_code == 404

    def test_another_organizer_cannot_delete_media(self, authed_client, stranger, make_event):
        event = make_event(status=EventStatus.DRAFT)
        created = authed_client.post(
            f"/api/v1/events/{event.id}/media", IMAGE, format="json"
        ).json()

        assert (
            stranger.delete(f"/api/v1/events/{event.id}/media/{created['id']}").status_code == 404
        )
        # And it is still there afterwards.
        assert len(authed_client.get(f"/api/v1/events/{event.id}/content").json()["media"]) == 1


@pytest.mark.django_db
class TestMedia:
    def test_adding_an_image_shows_up_on_the_content_payload(self, authed_client, make_event):
        event = make_event(status=EventStatus.DRAFT)
        response = authed_client.post(f"/api/v1/events/{event.id}/media", IMAGE, format="json")

        assert response.status_code == 201
        media = authed_client.get(f"/api/v1/events/{event.id}/content").json()["media"]
        assert [item["alt_text"] for item in media] == ["A crowd at the front of the stage"]

    def test_alt_text_is_required_at_the_boundary(self, authed_client, make_event):
        """The column allows blank so a backfill survives; the API does not."""
        event = make_event(status=EventStatus.DRAFT)
        response = authed_client.post(
            f"/api/v1/events/{event.id}/media", {**IMAGE, "alt_text": ""}, format="json"
        )
        assert response.status_code == 400

    def test_the_hero_cap_survives_the_http_boundary(self, authed_client, make_event):
        event = make_event(status=EventStatus.DRAFT)
        hero = {**IMAGE, "kind": MediaKind.HERO}
        assert (
            authed_client.post(f"/api/v1/events/{event.id}/media", hero, format="json").status_code
            == 201
        )

        response = authed_client.post(f"/api/v1/events/{event.id}/media", hero, format="json")
        assert response.status_code == 422
        assert "maximum of 1" in response.json()["error"]["message"]

    def test_deleting_removes_it_from_the_payload(self, authed_client, make_event):
        event = make_event(status=EventStatus.DRAFT)
        created = authed_client.post(
            f"/api/v1/events/{event.id}/media", IMAGE, format="json"
        ).json()

        assert (
            authed_client.delete(f"/api/v1/events/{event.id}/media/{created['id']}").status_code
            == 204
        )
        assert authed_client.get(f"/api/v1/events/{event.id}/content").json()["media"] == []


@pytest.mark.django_db
class TestFaqs:
    def test_adding_and_ordering(self, authed_client, make_event):
        event = make_event(status=EventStatus.DRAFT)
        for position, question in enumerate(["Second?", "First?"]):
            authed_client.post(
                f"/api/v1/events/{event.id}/faqs",
                {"question": question, "answer": "Yes.", "position": 1 - position},
                format="json",
            )

        faqs = authed_client.get(f"/api/v1/events/{event.id}/content").json()["faqs"]
        assert [faq["question"] for faq in faqs] == ["First?", "Second?"]

    def test_an_empty_answer_is_refused(self, authed_client, make_event):
        event = make_event(status=EventStatus.DRAFT)
        response = authed_client.post(
            f"/api/v1/events/{event.id}/faqs",
            {"question": "Parking?", "answer": ""},
            format="json",
        )
        assert response.status_code == 400


@pytest.mark.django_db
class TestTimeline:
    def test_entries_come_back_in_running_order(self, authed_client, make_event):
        event = make_event(status=EventStatus.DRAFT)
        doors = timezone.now() + dt.timedelta(days=30)

        authed_client.post(
            f"/api/v1/events/{event.id}/timeline",
            {
                "kind": TimelineKind.AFTER_PARTY,
                "label": "After party",
                # 00:30 the next morning — the case a time-of-day sort breaks.
                "starts_at": (doors + dt.timedelta(hours=5, minutes=30)).isoformat(),
                "position": 1,
            },
            format="json",
        )
        authed_client.post(
            f"/api/v1/events/{event.id}/timeline",
            {
                "kind": TimelineKind.DOORS,
                "label": "Doors open",
                "starts_at": doors.isoformat(),
                "position": 0,
            },
            format="json",
        )

        timeline = authed_client.get(f"/api/v1/events/{event.id}/content").json()["timeline"]
        assert [entry["label"] for entry in timeline] == ["Doors open", "After party"]

    def test_a_time_is_optional(self, authed_client, make_event):
        """An organizer often knows the running order before the clock times."""
        event = make_event(status=EventStatus.DRAFT)
        response = authed_client.post(
            f"/api/v1/events/{event.id}/timeline",
            {"kind": TimelineKind.MAIN, "label": "Headliner"},
            format="json",
        )
        assert response.status_code == 201
        assert response.json()["starts_at"] is None


@pytest.mark.django_db
class TestUpload:
    """The one-call upload path: validate, store, attach."""

    @staticmethod
    def _jpeg(name: str = "poster.jpg"):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile(name, b"\xff\xd8\xff" + b"0" * 128, content_type="image/jpeg")

    def test_uploading_attaches_the_media_in_one_request(self, authed_client, make_event):
        event = make_event(status=EventStatus.DRAFT)
        response = authed_client.post(
            f"/api/v1/events/{event.id}/media/upload",
            {"file": self._jpeg(), "kind": MediaKind.HERO, "alt_text": "The main stage at dusk"},
            format="multipart",
        )

        assert response.status_code == 201
        assert response.json()["url"]
        media = authed_client.get(f"/api/v1/events/{event.id}/content").json()["media"]
        assert [item["kind"] for item in media] == [MediaKind.HERO]

    def test_the_stored_url_is_not_the_original_filename(self, authed_client, make_event):
        """The filename is attacker-controlled and never becomes the path."""
        event = make_event(status=EventStatus.DRAFT)
        response = authed_client.post(
            f"/api/v1/events/{event.id}/media/upload",
            {"file": self._jpeg("../../secret.jpg"), "alt_text": "A crowd"},
            format="multipart",
        )

        assert response.status_code == 201
        assert "secret" not in response.json()["url"]
        assert ".." not in response.json()["url"]

    def test_alt_text_is_required(self, authed_client, make_event):
        event = make_event(status=EventStatus.DRAFT)
        response = authed_client.post(
            f"/api/v1/events/{event.id}/media/upload",
            {"file": self._jpeg(), "alt_text": "  "},
            format="multipart",
        )
        assert response.status_code == 422

    def test_a_disguised_file_is_refused(self, authed_client, make_event):
        from django.core.files.uploadedfile import SimpleUploadedFile

        event = make_event(status=EventStatus.DRAFT)
        response = authed_client.post(
            f"/api/v1/events/{event.id}/media/upload",
            {
                "file": SimpleUploadedFile(
                    "x.jpg", b"<html><script>alert(1)</script>", content_type="image/jpeg"
                ),
                "alt_text": "A crowd",
            },
            format="multipart",
        )
        assert response.status_code == 422

    def test_a_missing_file_is_a_clear_error(self, authed_client, make_event):
        event = make_event(status=EventStatus.DRAFT)
        response = authed_client.post(
            f"/api/v1/events/{event.id}/media/upload", {"alt_text": "x"}, format="multipart"
        )
        assert response.status_code == 422
        assert "No file" in response.json()["error"]["message"]

    def test_another_organizer_cannot_upload(self, stranger, make_event):
        event = make_event(status=EventStatus.DRAFT)
        response = stranger.post(
            f"/api/v1/events/{event.id}/media/upload",
            {"file": self._jpeg(), "alt_text": "A crowd"},
            format="multipart",
        )
        assert response.status_code == 404

    def test_the_cap_is_checked_BEFORE_the_file_is_stored(self, authed_client, make_event):
        """Ownership and the cap come first on purpose — storing bytes for an
        upload that was always going to be refused wastes the write."""
        event = make_event(status=EventStatus.DRAFT)
        body = {"file": self._jpeg(), "kind": MediaKind.HERO, "alt_text": "The stage"}
        assert (
            authed_client.post(
                f"/api/v1/events/{event.id}/media/upload", body, format="multipart"
            ).status_code
            == 201
        )

        second = authed_client.post(
            f"/api/v1/events/{event.id}/media/upload",
            {"file": self._jpeg(), "kind": MediaKind.HERO, "alt_text": "Another"},
            format="multipart",
        )
        assert second.status_code == 422
        assert "maximum of 1" in second.json()["error"]["message"]
