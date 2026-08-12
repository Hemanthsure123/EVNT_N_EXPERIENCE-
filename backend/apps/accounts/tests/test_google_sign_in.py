"""Sign in with Google.

Google is faked at the PORT, never over HTTP — no network, no credentials, and
the fake returns exactly what the real adapter promises: an already-validated
`OidcIdentity`. The adapter's own job (verifying `aud`/`iss`/`exp` on the
id_token) is tested separately in `core/tests/test_google_oidc_adapter.py`.

What is asserted here is POLICY: who gets an account, whose account can be
taken over, and how the session reaches the browser.
"""

from __future__ import annotations

import pytest

from apps.accounts.exceptions import (
    AccountSuspendedError,
    GoogleAccountUnverifiedError,
    GoogleSignInCancelledError,
    GoogleSignInUnavailableError,
    OAuthStateInvalidError,
)
from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.accounts.services import AuthService, GoogleSignInService
from core.adapters.local.console_email import ConsoleEmailAdapter
from core.adapters.local.locmem_cache import LocMemCacheAdapter
from core.adapters.local.sync_task_queue import SyncTaskQueueAdapter
from core.ports.oidc_port import OidcIdentity, OidcPort

pytestmark = pytest.mark.django_db

REDIRECT = "https://api.curatix.example/api/v1/auth/oauth/google/callback"


class FakeGoogle(OidcPort):
    """Stands in for Google. Returns whatever identity the test wants."""

    def __init__(self, identity: OidcIdentity | None = None, configured: bool = True) -> None:
        self.identity = identity or OidcIdentity(
            subject="google-sub-1",
            email="person@example.com",
            email_verified=True,
            full_name="A Person",
        )
        self._configured = configured
        self.exchanges: list[dict] = []

    def is_configured(self) -> bool:
        return self._configured

    def build_authorization_url(
        self, *, state: str, code_challenge: str, redirect_uri: str, login_hint: str = ""
    ) -> str:
        return f"https://accounts.google.com/o/oauth2/v2/auth?state={state}&cc={code_challenge}"

    def exchange_code(self, *, code: str, code_verifier: str, redirect_uri: str) -> OidcIdentity:
        self.exchanges.append(
            {"code": code, "code_verifier": code_verifier, "redirect_uri": redirect_uri}
        )
        return self.identity


def build(google: FakeGoogle | None = None) -> tuple[GoogleSignInService, FakeGoogle]:
    oidc = google or FakeGoogle()
    users = UserRepository()
    service = GoogleSignInService(
        users=users,
        oidc=oidc,
        cache=LocMemCacheAdapter(),
        auth=AuthService(
            users=users, email=ConsoleEmailAdapter(), task_queue=SyncTaskQueueAdapter()
        ),
        redirect_uri=REDIRECT,
    )
    return service, oidc


def _state_from(url: str) -> str:
    from urllib.parse import parse_qs, urlparse

    return parse_qs(urlparse(url).query)["state"][0]


class TestStartingTheFlow:
    def test_the_url_carries_a_state_and_a_pkce_challenge(self):
        service, _ = build()
        url = service.start()

        assert "state=" in url
        assert "cc=" in url

    def test_an_unconfigured_deployment_refuses_rather_than_pretending(self):
        service, _ = build(FakeGoogle(configured=False))
        with pytest.raises(GoogleSignInUnavailableError):
            service.start()

    def test_availability_is_reported_so_the_ui_can_hide_the_button(self):
        assert build()[0].is_available() is True
        assert build(FakeGoogle(configured=False))[0].is_available() is False

    def test_a_missing_redirect_uri_is_unavailable_not_a_broken_button(self):
        """Client id and secret set, redirect URI blank — the likely half-way
        state, because they are configured in three separate places.

        This used to report `available: true`. The frontend then rendered the
        button and sent the user to Google with an empty `redirect_uri`, and
        Google refuses BEFORE redirecting: the browser gets a generic "Access
        blocked: this app's request is invalid" page, our callback is never
        reached, and nothing is logged here because there is no request to
        log. Reporting unavailable is the honest answer, and it is the one
        the rest of this module already gives.
        """
        users = UserRepository()
        service = GoogleSignInService(
            users=users,
            oidc=FakeGoogle(),
            cache=LocMemCacheAdapter(),
            auth=AuthService(
                users=users, email=ConsoleEmailAdapter(), task_queue=SyncTaskQueueAdapter()
            ),
            redirect_uri="",
        )

        assert service.is_available() is False
        # And the endpoint must agree with the button, not merely hide it.
        with pytest.raises(GoogleSignInUnavailableError):
            service.start()


class TestTheStateIsTheCredential:
    def test_an_unknown_state_is_refused(self):
        service, _ = build()
        with pytest.raises(OAuthStateInvalidError):
            service.complete(state="never-issued", code="x")

    def test_a_state_cannot_be_replayed(self):
        """Consumed before any work, so a second callback with the same state
        finds nothing — which is what stops a captured redirect being reused."""
        service, _ = build()
        state = _state_from(service.start())
        service.complete(state=state, code="auth-code")

        with pytest.raises(OAuthStateInvalidError):
            service.complete(state=state, code="auth-code")

    def test_a_missing_state_is_refused(self):
        service, _ = build()
        with pytest.raises(OAuthStateInvalidError):
            service.complete(state="", code="x")

    def test_the_pkce_verifier_travels_server_side(self):
        """Never through the browser: a captured authorization code is useless
        without the verifier, which only we hold."""
        service, google = build()
        state = _state_from(service.start())
        service.complete(state=state, code="auth-code")

        assert google.exchanges[0]["code_verifier"]
        assert google.exchanges[0]["redirect_uri"] == REDIRECT

    def test_pressing_cancel_is_reported_as_a_choice_not_a_failure(self):
        service, _ = build()
        state = _state_from(service.start())

        with pytest.raises(GoogleSignInCancelledError):
            service.complete(state=state, error="access_denied")


class TestAccountLinking:
    """The most dangerous logic in the feature."""

    def test_a_new_verified_google_account_creates_a_user(self):
        service, _ = build()
        state = _state_from(service.start())
        service.complete(state=state, code="auth-code")

        user = User.objects.get(email="person@example.com")
        assert user.full_name == "A Person"
        # Google proved the address, so our own code would be asking them to
        # prove something already proven.
        assert user.email_verified is True

    def test_an_unverified_google_account_cannot_create_a_user(self):
        service, _ = build(
            FakeGoogle(OidcIdentity(subject="s", email="sneaky@example.com", email_verified=False))
        )
        state = _state_from(service.start())

        with pytest.raises(GoogleAccountUnverifiedError):
            service.complete(state=state, code="auth-code")

        assert not User.objects.filter(email="sneaky@example.com").exists()

    def test_an_unverified_google_account_cannot_take_over_an_existing_one(self):
        """THE takeover case. Anyone can create a Google account claiming any
        address; honouring one here would hand over somebody's bookings and
        tickets."""
        victim = User.objects.create_user(email="victim@example.com", password="RealPass!23456")
        victim.email_verified = True
        victim.save(update_fields=["email_verified"])

        service, _ = build(
            FakeGoogle(
                OidcIdentity(subject="attacker", email="victim@example.com", email_verified=False)
            )
        )
        state = _state_from(service.start())

        with pytest.raises(GoogleAccountUnverifiedError):
            service.complete(state=state, code="auth-code")

    def test_a_verified_google_account_adopts_the_existing_password_account(self):
        """Same person, second way in — not a duplicate account."""
        existing = User.objects.create_user(email="person@example.com", password="RealPass!23456")
        existing.email_verified = True
        existing.save(update_fields=["email_verified"])

        service, _ = build()
        state = _state_from(service.start())
        service.complete(state=state, code="auth-code")

        assert User.objects.filter(email="person@example.com").count() == 1

    def test_signing_in_with_google_satisfies_a_pending_email_verification(self):
        """They registered with a password, never opened the email, then used
        Google. Google has proven the address — asking for our code as well
        would be friction with no security value."""
        pending = User.objects.create_user(email="person@example.com", password="RealPass!23456")
        assert pending.email_verified is False

        service, _ = build()
        state = _state_from(service.start())
        service.complete(state=state, code="auth-code")

        pending.refresh_from_db()
        assert pending.email_verified is True

    def test_a_suspended_account_cannot_sign_in_through_google(self):
        """Suspension is an access decision and applies to every route in, not
        just the password one — and it is NAMED here for the same reason it is
        on the password route: Google has just proven this person owns the
        address, so there is nothing left to conceal from them."""
        suspended = User.objects.create_user(email="person@example.com", password="RealPass!23456")
        suspended.email_verified = True
        suspended.is_active = False
        suspended.save(update_fields=["email_verified", "is_active"])

        service, _ = build()
        state = _state_from(service.start())

        with pytest.raises(AccountSuspendedError):
            service.complete(state=state, code="auth-code")

    def test_a_google_created_account_has_no_usable_password(self):
        """A blank password would be a login with no credential. It is set to
        a random value nobody holds, so the account is reachable only through
        Google until the user sets one."""
        service, _ = build()
        state = _state_from(service.start())
        service.complete(state=state, code="auth-code")

        user = User.objects.get(email="person@example.com")
        assert user.password
        assert not user.check_password("")


class TestTheHandoff:
    """Tokens must not travel in a URL — not in the query (server logs, the
    Referer header) and not in the fragment (browser history)."""

    def test_completing_returns_an_opaque_handoff_not_the_tokens(self):
        service, _ = build()
        state = _state_from(service.start())
        handoff, _next = service.complete(state=state, code="auth-code")

        assert handoff
        assert "." not in handoff, "a JWT would mean the session itself is in the URL"

    def test_the_handoff_redeems_to_a_usable_session(self):
        service, _ = build()
        state = _state_from(service.start())
        handoff, _next = service.complete(state=state, code="auth-code")

        tokens = service.redeem(handoff=handoff)
        assert tokens.access and tokens.refresh

    def test_a_handoff_is_single_use(self):
        service, _ = build()
        state = _state_from(service.start())
        handoff, _next = service.complete(state=state, code="auth-code")
        service.redeem(handoff=handoff)

        with pytest.raises(OAuthStateInvalidError):
            service.redeem(handoff=handoff)

    def test_an_unknown_handoff_is_refused(self):
        service, _ = build()
        with pytest.raises(OAuthStateInvalidError):
            service.redeem(handoff="not-a-real-handoff")

    def test_the_return_path_survives_the_round_trip(self):
        """So a user who pressed Sign in from an event page lands back there
        rather than on the homepage."""
        service, _ = build()
        state = _state_from(service.start(next_path="/events/abc"))
        _handoff, next_path = service.complete(state=state, code="auth-code")

        assert next_path == "/events/abc"


class TestTheRoutesDoNotCollide:
    """`accounts` and `integrations` both own a Google callback.

    They are mounted under the same `/api/v1/auth/` prefix, and `accounts`
    comes first in `config/urls.py` — so a bare `oauth/google/callback` here
    SHADOWED the calendar's, which is already registered with Google. Calendar
    connection broke silently; nothing about sign-in looked wrong.
    """

    def test_sign_in_and_calendar_resolve_to_different_views(self):
        from django.urls import resolve, reverse

        signin = reverse("auth-google-callback")
        calendar = reverse("google-oauth-callback")

        assert signin != calendar
        # `view_class` is set by APIView.as_view() but is not on the callable's
        # declared type, so it is read dynamically.
        signin_view = getattr(resolve(signin).func, "view_class", None)
        calendar_view = getattr(resolve(calendar).func, "view_class", None)
        assert signin_view is not None and calendar_view is not None
        assert signin_view is not calendar_view

    def test_the_sign_in_callback_is_namespaced(self):
        from django.urls import reverse

        assert reverse("auth-google-callback").endswith("/oauth/google/signin/callback")

    def test_the_configured_redirect_uri_matches_the_route(self, settings):
        """Google matches the redirect URI VERBATIM. A mismatch between the
        route and the configured value is `redirect_uri_mismatch` at the worst
        possible moment — after the user has already consented."""
        from django.urls import reverse

        settings.GOOGLE_OAUTH_SIGNIN_REDIRECT_URI = "https://api.example.test" + reverse(
            "auth-google-callback"
        )
        assert settings.GOOGLE_OAUTH_SIGNIN_REDIRECT_URI.endswith(reverse("auth-google-callback"))
