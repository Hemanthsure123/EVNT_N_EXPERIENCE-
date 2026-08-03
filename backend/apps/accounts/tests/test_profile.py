"""The profile picture: setting it, clearing it, and everything refused.

An avatar is the most widely RENDERED user-supplied image on the platform —
it appears next to a name on pages the user does not control — so the upload
path is a security boundary first and a feature second. Most of what follows
is hostile input, and the two that matter most are the two `core/uploads.py`
exists for: an SVG is refused (it is an XML document that can carry script,
and serving one from our own origin is stored XSS), and a file whose bytes
disagree with its declared type is refused (the declared type is
attacker-controlled; the leading bytes are not).

The service tests construct `ProfileService` directly with a local storage
adapter rooted at `tmp_path`, per the repo's convention — never through
`config.di`, which would make them depend on settings' backend selection.
"""

from __future__ import annotations

from typing import cast

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.accounts.repositories import UserRepository
from apps.accounts.services import ProfileService
from core.adapters.local.local_storage import LocalStorageAdapter
from core.errors import InvalidInputError
from core.models import AuditLog
from core.uploads import MAX_IMAGE_BYTES

# Real magic numbers, padded. `validate_image` reads only the first 16 bytes,
# but a file that is nothing BUT a signature is not a file anyone would send.
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
JPEG = b"\xff\xd8\xff" + b"0" * 64
WEBP = b"RIFF" + b"0" * 64
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def _upload(content: bytes, name: str = "me.png", content_type: str = "image/png"):
    return SimpleUploadedFile(name, content, content_type=content_type)


@pytest.fixture
def user():
    return UserRepository().create_user(email="avatar@example.com", password="s3cur3pass")


@pytest.fixture
def storage(tmp_path) -> LocalStorageAdapter:
    return LocalStorageAdapter(root=tmp_path, base_url="/media/")


@pytest.fixture
def profiles(storage) -> ProfileService:
    return ProfileService(users=UserRepository(), storage=storage)


# ── THE SERVICE ───────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSetAvatar:
    def test_a_png_is_accepted_and_the_url_lands_on_the_row(self, profiles, user):
        updated = profiles.set_avatar(user_id=user.id, upload=_upload(PNG))

        assert updated.avatar_url.startswith("/media/avatars/")
        user.refresh_from_db()
        assert user.avatar_url == updated.avatar_url

    def test_a_jpeg_is_accepted(self, profiles, user):
        updated = profiles.set_avatar(user_id=user.id, upload=_upload(JPEG, "me.jpg", "image/jpeg"))
        assert updated.avatar_url.endswith(".jpg")

    def test_a_webp_is_accepted(self, profiles, user):
        """The format a browser's own canvas export produces by default."""
        updated = profiles.set_avatar(
            user_id=user.id, upload=_upload(WEBP, "me.webp", "image/webp")
        )
        assert updated.avatar_url.endswith(".webp")

    def test_the_bytes_that_were_sent_are_the_bytes_that_were_stored(
        self, profiles, user, tmp_path
    ):
        """Validation sniffs the header. If it consumed the stream instead of
        seeking back, this would store a zero-byte object and nothing else in
        the flow would notice — the row would still hold a plausible URL."""
        profiles.set_avatar(user_id=user.id, upload=_upload(PNG))

        stored = list(tmp_path.glob("avatars/**/*.png"))
        assert len(stored) == 1
        assert stored[0].read_bytes() == PNG

    def test_the_original_filename_never_becomes_the_stored_path(self, profiles, user):
        """The filename is attacker-controlled: `core.uploads.storage_path`
        keeps only an alphanumeric extension and names the object a UUID."""
        updated = profiles.set_avatar(
            user_id=user.id, upload=_upload(PNG, "../../../etc/passwd.png")
        )

        assert ".." not in updated.avatar_url
        assert "passwd" not in updated.avatar_url

    def test_replacing_an_avatar_repoints_the_row(self, profiles, user):
        first = profiles.set_avatar(user_id=user.id, upload=_upload(PNG)).avatar_url
        second = profiles.set_avatar(user_id=user.id, upload=_upload(PNG)).avatar_url

        assert first != second
        user.refresh_from_db()
        assert user.avatar_url == second

    def test_the_change_is_audited(self, profiles, user):
        profiles.set_avatar(user_id=user.id, upload=_upload(PNG))

        assert AuditLog.objects.filter(
            actor_id=str(user.id), action="user.avatar_updated", target_id=str(user.id)
        ).exists()


@pytest.mark.django_db
class TestRefused:
    def test_an_svg_is_refused(self, profiles, user):
        """The single most important assertion in this file. An SVG is an XML
        document that can carry script, and an avatar is served from our own
        origin on pages the uploader does not control — which is stored XSS."""
        with pytest.raises(InvalidInputError) as caught:
            profiles.set_avatar(user_id=user.id, upload=_upload(SVG, "me.svg", "image/svg+xml"))

        assert "not supported" in str(caught.value)
        user.refresh_from_db()
        assert user.avatar_url == ""

    def test_bytes_that_disagree_with_the_declared_type_are_refused(self, profiles, user):
        with pytest.raises(InvalidInputError) as caught:
            profiles.set_avatar(
                user_id=user.id,
                upload=_upload(b"<html><script>alert(1)</script>", "me.png", "image/png"),
            )

        assert "does not look like" in str(caught.value)

    def test_an_svg_renamed_and_relabelled_as_a_png_is_still_refused(self, profiles, user):
        """The obvious way around the allow-list, and why the byte check
        exists as well as the type check rather than instead of it."""
        with pytest.raises(InvalidInputError):
            profiles.set_avatar(user_id=user.id, upload=_upload(SVG, "me.png", "image/png"))

    def test_an_oversized_file_is_refused(self, profiles, user):
        with pytest.raises(InvalidInputError) as caught:
            profiles.set_avatar(user_id=user.id, upload=_upload(PNG + b"0" * (MAX_IMAGE_BYTES + 1)))

        # Actionable, not "invalid upload" — the user has to know what to fix.
        assert "the limit is 10 MB" in str(caught.value)

    def test_nothing_reaches_storage_when_validation_fails(self, profiles, user, tmp_path):
        """Validation runs BEFORE the storage write, so a refused upload
        leaves no orphaned object behind to pay for or to reap."""
        with pytest.raises(InvalidInputError):
            profiles.set_avatar(user_id=user.id, upload=_upload(SVG, "me.svg", "image/svg+xml"))

        assert list(tmp_path.rglob("*")) == []


@pytest.mark.django_db
class TestClearAvatar:
    def test_clearing_empties_the_column(self, profiles, user):
        profiles.set_avatar(user_id=user.id, upload=_upload(PNG))

        cleared = profiles.clear_avatar(user_id=user.id)

        assert cleared.avatar_url == ""
        user.refresh_from_db()
        assert user.avatar_url == ""

    def test_clearing_an_account_that_has_no_avatar_is_a_no_op(self, profiles, user):
        """Not an error: the frontend's Remove control does not know or care
        whether a picture was ever set, and a 404 there would be noise."""
        assert profiles.clear_avatar(user_id=user.id).avatar_url == ""


# ── THE ENDPOINTS ─────────────────────────────────────────────────────────


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def authed_client(user) -> APIClient:
    """A REAL bearer token, not `force_authenticate`.

    `force_authenticate` pins one Python `User` object for the life of the
    client, so every request sees the state that object had when the fixture
    ran. That is precisely wrong for this file: the assertion that matters is
    that a request AFTER the upload sees the new URL, and a pinned stale
    object reports the old one — a failure that looks exactly like the write
    never landing. Under a real token the auth backend re-loads the row per
    request, which is what production does.
    """
    from rest_framework_simplejwt.tokens import RefreshToken

    # The same `cast` AuthService.issue_tokens carries, and for the same
    # reason: simplejwt annotates `for_user` as returning the base `Token`,
    # which has no `access_token`, while its body returns a RefreshToken.
    refresh = cast(RefreshToken, RefreshToken.for_user(user))

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
    return client


@pytest.mark.django_db
class TestAvatarApi:
    def test_uploading_is_rejected_without_a_token(self, api_client):
        response = api_client.post(
            "/api/v1/auth/me/avatar", {"file": _upload(PNG)}, format="multipart"
        )
        assert response.status_code == 401

    def test_clearing_is_rejected_without_a_token(self, api_client):
        assert api_client.delete("/api/v1/auth/me/avatar").status_code == 401

    def test_the_url_comes_back_on_auth_me(self, authed_client):
        upload = authed_client.post(
            "/api/v1/auth/me/avatar", {"file": _upload(PNG)}, format="multipart"
        )
        assert upload.status_code == 200
        assert upload.json()["avatar_url"].startswith("/media/avatars/")

        # The point of the whole slice: the picture is on the profile the app
        # already fetches, not behind a second request.
        me = authed_client.get("/api/v1/auth/me")
        assert me.json()["avatar_url"] == upload.json()["avatar_url"]

    def test_deleting_clears_it_and_auth_me_agrees(self, authed_client):
        authed_client.post("/api/v1/auth/me/avatar", {"file": _upload(PNG)}, format="multipart")

        response = authed_client.delete("/api/v1/auth/me/avatar")

        assert response.status_code == 200
        assert response.json()["avatar_url"] == ""
        assert authed_client.get("/api/v1/auth/me").json()["avatar_url"] == ""

    def test_an_svg_is_refused_over_http(self, authed_client):
        response = authed_client.post(
            "/api/v1/auth/me/avatar",
            {"file": _upload(SVG, "me.svg", "image/svg+xml")},
            format="multipart",
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_input"

    def test_a_disguised_file_is_refused_over_http(self, authed_client):
        response = authed_client.post(
            "/api/v1/auth/me/avatar",
            {"file": _upload(b"<html><script>alert(1)</script>", "me.png", "image/png")},
            format="multipart",
        )
        assert response.status_code == 422

    def test_an_oversized_file_is_refused_over_http(self, authed_client):
        response = authed_client.post(
            "/api/v1/auth/me/avatar",
            {"file": _upload(PNG + b"0" * (MAX_IMAGE_BYTES + 1))},
            format="multipart",
        )
        assert response.status_code == 422
        assert "the limit is 10 MB" in response.json()["error"]["message"]

    def test_a_missing_file_is_a_clear_error(self, authed_client):
        response = authed_client.post("/api/v1/auth/me/avatar", {}, format="multipart")

        assert response.status_code == 422
        assert "No file" in response.json()["error"]["message"]

    def test_one_user_cannot_touch_another_users_picture(self, authed_client, user):
        """There is no `user_id` on this endpoint to point somewhere else —
        the acting user's own id is the only one the view can pass. Asserted
        rather than assumed, because the absence of a parameter is exactly the
        kind of protection a later 'admin can set it too' change removes."""
        other = UserRepository().create_user(email="other@example.com", password="s3cur3pass")

        authed_client.post("/api/v1/auth/me/avatar", {"file": _upload(PNG)}, format="multipart")

        other.refresh_from_db()
        assert other.avatar_url == ""
        assert user.id != other.id
