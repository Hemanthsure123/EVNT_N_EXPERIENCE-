"""`MediaKind.VIDEO` — a choice that used to be unreachable.

It existed from the start and the ONLY route to it was the media upload
endpoint, which runs `validate_image` and refuses anything that is not a
JPEG/PNG/WebP/AVIF/GIF. So the kind always 422'd, with a message about image
formats, at a caller who was not trying to upload an image.

Hosting the bytes was the wrong fix: a trailer is 50-200 MB, needs transcoding
and a CDN this platform has not configured. What organisers have is a YouTube
or Vimeo link — which is also what every comparable platform embeds.

The security property is the one worth pinning: the stored URL is BUILT from an
extracted id, never the pasted string. An arbitrary URL in an iframe on our own
origin is the same class of problem an SVG upload is, and the answer is the
same — an allow-list plus normalisation, not escaping.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization
from core.errors import InvalidInputError
from core.video_embeds import parse_video_url


#: A real 1920x1080 PNG. A header plus zeroes stopped being an image when
#: `EVENT_IMAGE_SPEC` started parsing the file.
def _png() -> bytes:
    from core.tests.images import image_bytes

    return image_bytes(1920, 1080)


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="vid-owner@example.com", password="owner12345")
    org = Organization.objects.create(owner=owner, name="Video Co")
    event = Event.objects.create(
        organization=org,
        title="Live Session",
        venue="Studio",
        city="Chennai",
        starts_at=timezone.now() + dt.timedelta(days=10),
        status=EventStatus.LIVE,
    )
    return {"owner": owner, "event": event, "url": f"/api/v1/events/{event.id}/media"}


def attach(world, url: str):
    return auth(world["owner"]).post(
        world["url"], {"kind": "video", "url": url, "alt_text": "Trailer"}, format="json"
    )


@pytest.mark.django_db
class TestAttachingAVideo:
    def test_a_youtube_watch_link_is_accepted(self, world):
        response = attach(world, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert response.status_code == 201
        assert response.data["url"] == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"

    def test_the_STORED_url_is_ours_not_theirs(self, world):
        """The security property. A crafted query string cannot survive into an
        iframe on our own origin, because the URL is rebuilt from an extracted
        id rather than sanitised."""
        response = attach(world, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=EVIL&autoplay=1")
        assert response.data["url"] == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"

    def test_a_vimeo_link_is_accepted(self, world):
        response = attach(world, "https://vimeo.com/123456789")
        assert response.status_code == 201
        assert response.data["url"] == "https://player.vimeo.com/video/123456789"

    def test_any_other_host_is_refused(self, world):
        """An arbitrary URL rendered in an iframe on our origin is somebody
        else's document executing beside ours."""
        response = attach(world, "https://evil.example.com/player")
        # 422, not 400: `InvalidInputError` is what the service raises and
        # `core.errors` maps it there. The serializer's own 400s (a missing
        # alt text, below) are the boundary's; this one is the rule's.
        assert response.status_code == 422

    def test_a_javascript_url_is_refused(self, world):
        assert attach(world, "javascript:alert(1)").status_code == 422

    def test_the_video_cap_of_one_still_applies(self, world):
        attach(world, "https://vimeo.com/123456789")
        second = attach(world, "https://vimeo.com/987654321")
        assert second.status_code == 422

    def test_alt_text_is_still_required(self, world):
        response = auth(world["owner"]).post(
            world["url"],
            {"kind": "video", "url": "https://vimeo.com/123456789", "alt_text": ""},
            format="json",
        )
        assert response.status_code == 400

    def test_an_image_kind_is_untouched_by_any_of_this(self, world):
        response = auth(world["owner"]).post(
            world["url"],
            {"kind": "gallery", "url": "https://cdn.example.com/a.jpg", "alt_text": "A photo"},
            format="json",
        )
        assert response.status_code == 201
        assert response.data["url"] == "https://cdn.example.com/a.jpg"


@pytest.mark.django_db
def test_uploading_a_video_FILE_names_the_right_route(world):
    """It used to fail with "upload a JPEG, PNG, WebP, AVIF or GIF" — true, and
    useless to somebody holding an MP4."""
    response = auth(world["owner"]).post(
        f"/api/v1/events/{world['event'].id}/media/upload",
        {
            "file": SimpleUploadedFile("trailer.mp4", b"\x00\x00\x00\x18ftypmp42", "video/mp4"),
            "kind": "video",
            "alt_text": "Trailer",
        },
        format="multipart",
    )
    assert response.status_code == 422
    message = response.data["error"]["message"]
    assert "YouTube" in message or "Vimeo" in message


@pytest.mark.django_db
def test_uploading_an_IMAGE_still_works(world):
    response = auth(world["owner"]).post(
        f"/api/v1/events/{world['event'].id}/media/upload",
        {
            "file": SimpleUploadedFile("poster.png", _png(), "image/png"),
            "kind": "gallery",
            "alt_text": "The poster",
        },
        format="multipart",
    )
    assert response.status_code == 201


class TestTheParser:
    """Every shape a person actually pastes. Telling somebody their link is
    invalid when it is the one the Share button gave them is how a field gets
    abandoned."""

    @pytest.mark.parametrize(
        "link",
        [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "youtu.be/dQw4w9WgXcQ",  # no scheme, as a phone paste gives it
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ",
            "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ",
        ],
    )
    def test_youtube_shapes(self, link):
        assert parse_video_url(link).video_id == "dQw4w9WgXcQ"

    @pytest.mark.parametrize(
        "link",
        [
            "https://vimeo.com/123456789",
            "https://player.vimeo.com/video/123456789",
            "https://vimeo.com/channels/staffpicks/123456789",
        ],
    )
    def test_vimeo_shapes(self, link):
        assert parse_video_url(link).video_id == "123456789"

    @pytest.mark.parametrize(
        "link",
        [
            "",
            "   ",
            "not a link",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "https://evil.example.com/watch?v=dQw4w9WgXcQ",
            # The right host, no id — a channel page, which is the most common
            # honest mistake.
            "https://www.youtube.com/@somechannel",
            "https://vimeo.com/user12345",
            # An id of the wrong shape: 11 chars is YouTube's, and a longer one
            # is somebody probing.
            "https://www.youtube.com/watch?v=dQw4w9WgXcQEXTRA",
        ],
    )
    def test_what_is_refused(self, link):
        with pytest.raises(InvalidInputError):
            parse_video_url(link)

    def test_youtube_uses_the_nocookie_host(self):
        """YouTube's own privacy-enhanced host: it sets no tracking cookie
        until the viewer presses play, which is what makes embedding it
        defensible on a page nobody consented to be tracked on."""
        assert "youtube-nocookie.com" in parse_video_url("https://youtu.be/dQw4w9WgXcQ").embed_url

    def test_it_also_reports_where_to_WATCH_it(self):
        """The embed URL is for the iframe; a link out needs the real one."""
        parsed = parse_video_url("https://youtu.be/dQw4w9WgXcQ")
        assert parsed.watch_url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
