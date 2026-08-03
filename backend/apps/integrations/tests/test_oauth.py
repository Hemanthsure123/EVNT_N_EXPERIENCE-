"""The Google OAuth flow and calendar sync.

Google is mocked HERE and only here. What these assert is everything that
stands between a stranger and somebody's calendar: state is single-use, PKCE
is real, a dead grant is terminal, and — the one that would be easiest to get
wrong — a callback cannot attach one person's Google account to another
person's Curatix account.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.integrations.exceptions import (
    CalendarReconnectRequiredError,
    InsufficientScopeError,
    OAuthConsentDeniedError,
    OAuthStateInvalidError,
)
from apps.integrations.models import ConnectionStatus, GoogleConnection
from apps.integrations.repositories import GoogleConnectionRepository
from apps.integrations.services import CALENDAR_EVENTS_SCOPE, GoogleOAuthService
from core.adapters.local.locmem_cache import LocMemCacheAdapter
from core.ports.calendar_port import (
    CalendarAuthError,
    CalendarError,
    CalendarEventRef,
    CalendarPort,
    OAuthTokens,
)

REDIRECT_URI = "https://api.curatix.example/api/v1/auth/oauth/google/callback"
FULL_SCOPES = [CALENDAR_EVENTS_SCOPE, "openid", "email"]


class FakeCalendar(CalendarPort):
    """A test double, not a shipped fake. Nothing in the app selects it."""

    def __init__(self, *, configured=True, refresh_dies=False, write_dies=None):
        self.configured = configured
        self.refresh_dies = refresh_dies
        self.write_dies = write_dies
        self.revoked: list[str] = []
        self.created: list[dict] = []
        self.updated: list[dict] = []
        self.deleted: list[str] = []
        self.scopes = list(FULL_SCOPES)
        self.refresh_token_on_exchange = "refresh-1"

    def is_configured(self) -> bool:
        return self.configured

    def build_authorization_url(self, *, state, code_challenge, redirect_uri, login_hint=""):
        return (
            "https://accounts.google.com/o/oauth2/v2/auth"
            f"?state={state}&code_challenge={code_challenge}"
            f"&code_challenge_method=S256&redirect_uri={redirect_uri}"
            "&access_type=offline&prompt=consent"
        )

    def exchange_code(self, *, code, code_verifier, redirect_uri):
        if code == "denied":
            raise CalendarAuthError("bad code")
        self.last_verifier = code_verifier
        return OAuthTokens(
            access_token="access-1",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            refresh_token=self.refresh_token_on_exchange,
            scopes=self.scopes,
            account_email="fan@gmail.com",
        )

    def refresh_access_token(self, refresh_token):
        if self.refresh_dies:
            raise CalendarAuthError("invalid_grant")
        return OAuthTokens(
            access_token="access-2",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            refresh_token="",  # Google omits it on a refresh — normal
            scopes=self.scopes,
        )

    def revoke(self, token):
        self.revoked.append(token)

    def create_event(self, *, access_token, calendar_id, draft):
        if self.write_dies:
            raise self.write_dies
        self.created.append({"draft": draft, "token": access_token})
        return CalendarEventRef(
            event_id=draft.idempotency_key or "gcal-1",
            calendar_id=calendar_id,
            html_link="https://calendar.google.com/e/1",
        )

    def update_event(self, *, access_token, calendar_id, event_id, draft):
        if self.write_dies:
            raise self.write_dies
        self.updated.append({"event_id": event_id, "draft": draft})
        return CalendarEventRef(event_id=event_id, calendar_id=calendar_id)

    def delete_event(self, *, access_token, calendar_id, event_id):
        if self.write_dies:
            raise self.write_dies
        self.deleted.append(event_id)


@pytest.fixture
def cache():
    return LocMemCacheAdapter()


@pytest.fixture
def calendar():
    return FakeCalendar()


@pytest.fixture
def oauth(cache, calendar):
    from apps.accounts.repositories import UserRepository

    return GoogleOAuthService(
        connections=GoogleConnectionRepository(),
        calendar=calendar,
        cache=cache,
        users=UserRepository(),
        redirect_uri=REDIRECT_URI,
    )


@pytest.fixture
def user(db):
    return User.objects.create_user(email="fan@example.com", password="pw", full_name="Fan")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(email="other@example.com", password="pw")


# ------------------------------------------------------------- authorization


@pytest.mark.django_db
class TestStartingTheFlow:
    def test_the_url_carries_state_and_a_pkce_challenge(self, oauth, user):
        result = oauth.start_authorization(user_id=user.id)
        params = parse_qs(urlparse(result.authorization_url).query)

        assert params["state"] == [result.state]
        assert params["code_challenge_method"] == ["S256"]
        assert params["code_challenge"][0]

    def test_offline_access_and_forced_consent_are_requested(self, oauth, user):
        """Both are load-bearing.

        `access_type=offline` is what makes Google issue a refresh token at
        all; without it the connection dies in an hour and cannot renew.
        `prompt=consent` is what makes it issue one on a RECONNECT — Google
        returns a refresh token only on a fresh consent, so without this a
        reconnecting user gets an access token and nothing to renew it with.
        """
        url = oauth.start_authorization(user_id=user.id).authorization_url
        params = parse_qs(urlparse(url).query)
        assert params["access_type"] == ["offline"]
        assert params["prompt"] == ["consent"]

    def test_the_verifier_is_never_in_the_url(self, oauth, user):
        # The whole point of PKCE: the verifier stays on this server, so an
        # attacker who captures the code cannot redeem it.
        result = oauth.start_authorization(user_id=user.id)
        assert "code_verifier" not in result.authorization_url

    def test_an_unconfigured_deployment_refuses_to_start(self, cache, user):
        from apps.accounts.repositories import UserRepository
        from apps.integrations.exceptions import IntegrationNotConfiguredError

        service = GoogleOAuthService(
            connections=GoogleConnectionRepository(),
            calendar=FakeCalendar(configured=False),
            cache=cache,
            users=UserRepository(),
            redirect_uri=REDIRECT_URI,
        )
        with pytest.raises(IntegrationNotConfiguredError):
            service.start_authorization(user_id=user.id)


@pytest.mark.django_db
class TestCompletingTheFlow:
    def test_a_valid_callback_stores_the_connection(self, oauth, user, calendar):
        state = oauth.start_authorization(user_id=user.id).state
        result = oauth.complete_authorization(state=state, code="good")

        assert result.connection.user_id == user.id
        assert result.connection.account_email == "fan@gmail.com"
        assert result.connection.status == ConnectionStatus.ACTIVE
        assert result.reconnected is False

    def test_the_pkce_verifier_reaches_the_exchange(self, oauth, user, calendar):
        state = oauth.start_authorization(user_id=user.id).state
        oauth.complete_authorization(state=state, code="good")
        assert calendar.last_verifier  # the server-held half, never in the URL

    def test_state_is_single_use(self, oauth, user):
        """Replay protection. The second attempt must find nothing."""
        state = oauth.start_authorization(user_id=user.id).state
        oauth.complete_authorization(state=state, code="good")

        with pytest.raises(OAuthStateInvalidError):
            oauth.complete_authorization(state=state, code="good")

    def test_an_unknown_state_is_refused(self, oauth):
        # A forged callback, or one that outlived its TTL.
        with pytest.raises(OAuthStateInvalidError):
            oauth.complete_authorization(state="not-a-real-state", code="good")

    def test_a_missing_state_is_refused(self, oauth):
        with pytest.raises(OAuthStateInvalidError):
            oauth.complete_authorization(state="", code="good")

    def test_the_connection_is_bound_to_the_user_who_STARTED_it(self, oauth, user, other_user):
        """The attack this closes.

        The callback is unauthenticated — the browser returns from Google with
        no token of ours. If the user id came from anywhere but the
        server-side state entry, anyone could attach their own Google account
        to somebody else's Curatix account, and every ticket that person
        bought would land in the attacker's calendar.
        """
        state = oauth.start_authorization(user_id=user.id).state
        result = oauth.complete_authorization(state=state, code="good")

        assert result.connection.user_id == user.id
        assert not GoogleConnection.objects.filter(user_id=other_user.id).exists()

    def test_pressing_cancel_is_reported_as_a_denial_not_a_failure(self, oauth, user):
        state = oauth.start_authorization(user_id=user.id).state
        with pytest.raises(OAuthConsentDeniedError):
            oauth.complete_authorization(state=state, error="access_denied")

    def test_unticking_calendar_access_is_caught_at_the_callback(self, oauth, user, calendar):
        """Not on the first write, weeks later.

        Google's consent screen lets a user untick individual scopes. Catching
        it here means they are told while they still remember what they
        clicked.
        """
        calendar.scopes = ["openid", "email"]
        state = oauth.start_authorization(user_id=user.id).state

        with pytest.raises(InsufficientScopeError):
            oauth.complete_authorization(state=state, code="good")
        assert not GoogleConnection.objects.filter(user_id=user.id).exists()

    def test_reconnecting_replaces_rather_than_duplicates(self, oauth, user):
        """`OneToOneField` makes 'handle duplicate connections' a schema
        guarantee rather than a code path somebody has to remember."""
        for _ in range(2):
            state = oauth.start_authorization(user_id=user.id).state
            result = oauth.complete_authorization(state=state, code="good")

        assert GoogleConnection.objects.filter(user_id=user.id).count() == 1
        assert result.reconnected is True


@pytest.mark.django_db
class TestTokens:
    def _connect(self, oauth, user):
        state = oauth.start_authorization(user_id=user.id).state
        return oauth.complete_authorization(state=state, code="good").connection

    def test_tokens_are_encrypted_at_rest(self, oauth, user):
        connection = self._connect(oauth, user)
        connection.refresh_from_db()

        # A database dump must not be a set of keys to everybody's calendar.
        assert "refresh-1" not in connection.refresh_token_encrypted
        assert "access-1" not in connection.access_token_encrypted
        assert GoogleConnectionRepository().refresh_token(connection) == "refresh-1"

    def test_a_fresh_access_token_is_reused_without_calling_google(self, oauth, user):
        connection = self._connect(oauth, user)
        assert oauth.access_token_for(connection) == "access-1"

    def test_an_expired_token_is_refreshed(self, oauth, user):
        connection = self._connect(oauth, user)
        connection.access_token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        connection.save(update_fields=["access_token_expires_at"])

        assert oauth.access_token_for(connection) == "access-2"

    def test_a_refresh_does_not_erase_the_stored_refresh_token(self, oauth, user):
        """Google returns a refresh token ONLY on a fresh consent.

        Blindly writing the refresh response would blank the one credential
        capable of renewing the connection, and it would fail an hour later
        with no way back.
        """
        connection = self._connect(oauth, user)
        connection.access_token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        connection.save(update_fields=["access_token_expires_at"])

        oauth.access_token_for(connection)
        connection.refresh_from_db()
        assert GoogleConnectionRepository().refresh_token(connection) == "refresh-1"

    def test_a_revoked_grant_is_terminal_and_says_so(self, oauth, user, calendar):
        connection = self._connect(oauth, user)
        connection.access_token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        connection.save(update_fields=["access_token_expires_at"])
        calendar.refresh_dies = True

        with pytest.raises(CalendarReconnectRequiredError):
            oauth.access_token_for(connection)

        connection.refresh_from_db()
        assert connection.status == ConnectionStatus.NEEDS_RECONNECT
        # Tokens cleared: a dead refresh token is all of the liability and
        # none of the value.
        assert connection.refresh_token_encrypted == ""
        assert connection.status_detail  # a sentence the user can act on

    def test_a_dead_connection_is_not_retried(self, oauth, user):
        connection = self._connect(oauth, user)
        GoogleConnectionRepository().mark_needs_reconnect(connection, detail="revoked")

        with pytest.raises(CalendarReconnectRequiredError):
            oauth.access_token_for(connection)


@pytest.mark.django_db
class TestDisconnect:
    def test_it_revokes_at_google_and_deletes_locally(self, oauth, user, calendar):
        state = oauth.start_authorization(user_id=user.id).state
        oauth.complete_authorization(state=state, code="good")

        assert oauth.disconnect(user_id=user.id) is True
        assert calendar.revoked == ["refresh-1"]
        assert not GoogleConnection.objects.filter(user_id=user.id).exists()

    def test_disconnecting_when_not_connected_is_a_no_op(self, oauth, user):
        assert oauth.disconnect(user_id=user.id) is False


# ---------------------------------------------------------------- endpoints


@pytest.mark.django_db
class TestEndpoints:
    @pytest.fixture
    def client(self, user):
        api = APIClient()
        api.force_authenticate(user=user)
        return api

    def test_status_reports_availability_separately_from_connection(self, client):
        body = client.get("/api/v1/me/integrations/google").json()
        # `available` is about the DEPLOYMENT, `connection` about this USER.
        # Conflating them makes an unconfigured deployment look like an
        # unconnected user, and the UI offers a button that can only 503.
        assert set(body) == {"available", "connection"}
        assert body["connection"] is None

    def test_status_is_never_shared_cached(self, client):
        response = client.get("/api/v1/me/integrations/google")
        assert response["Cache-Control"] == "private, no-store"

    def test_anonymous_callers_cannot_read_a_connection(self):
        assert APIClient().get("/api/v1/me/integrations/google").status_code == 401

    def test_connecting_without_credentials_answers_503(self, client, settings):
        from config.di import calendar_port

        settings.GOOGLE_OAUTH_CLIENT_ID = ""
        settings.GOOGLE_OAUTH_CLIENT_SECRET = ""
        calendar_port.cache_clear()
        try:
            response = client.post("/api/v1/me/integrations/google/connect", {}, format="json")
        finally:
            calendar_port.cache_clear()

        # Refused, not a fake authorization URL that would 404 at Google.
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "integration_not_configured"

    def test_the_callback_needs_no_authentication(self):
        # It must not: the browser returns from Google with no token of ours.
        response = APIClient().get("/api/v1/auth/oauth/google/callback?state=bogus")
        assert response.status_code in (302, 301)

    def test_a_failed_callback_redirects_with_a_reason_rather_than_a_stack_trace(self):
        response = APIClient().get("/api/v1/auth/oauth/google/callback?state=bogus")
        assert "calendar=error" in response["Location"]
        assert "reason=oauth_state_invalid" in response["Location"]

    def test_adding_to_calendar_without_a_connection_is_a_404_not_a_fake_success(self, client):
        response = client.post(
            "/api/v1/me/calendar/events",
            {"booking_id": str(uuid.uuid4())},
            format="json",
        )
        # The frontend branches on this code to offer a Connect button.
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "calendar_not_connected"


@pytest.mark.django_db
def test_a_transient_google_failure_is_not_mistaken_for_a_dead_grant(oauth, user, calendar):
    """The distinction the retry policy depends on.

    A 503 from Google is retryable; a revoked grant is not. Collapsing them
    would either dead-letter a sync that was merely rate-limited, or retry a
    dead token until the budget runs out.
    """
    from apps.integrations.exceptions import CalendarSyncFailedError

    state = oauth.start_authorization(user_id=user.id).state
    connection = oauth.complete_authorization(state=state, code="good").connection
    connection.access_token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    connection.save(update_fields=["access_token_expires_at"])

    def transient(_token):
        raise CalendarError("Google is having a moment")

    calendar.refresh_access_token = transient

    with pytest.raises(CalendarSyncFailedError):
        oauth.access_token_for(connection)

    connection.refresh_from_db()
    # Still ACTIVE — Google was unwell, the grant is fine.
    assert connection.status == ConnectionStatus.ACTIVE


@pytest.mark.django_db
def test_encryption_survives_a_secret_key_rotation_as_reconnect_not_a_crash(oauth, user, settings):
    """`decrypt` returns None rather than raising.

    Rotating SECRET_KEY makes stored tokens unreadable. That must degrade to
    "everyone reconnects", not "every calendar sync 500s" — which is the
    whole reason the derived-key trade-off is acceptable here.
    """
    state = oauth.start_authorization(user_id=user.id).state
    connection = oauth.complete_authorization(state=state, code="good").connection

    settings.SECRET_KEY = "a-completely-different-secret-key-value-0000"
    assert GoogleConnectionRepository().refresh_token(connection) is None
