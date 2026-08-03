"""Rate limits.

There were none, which made `POST /auth/login` an unmetered password oracle.
These assert the limit exists, that it is keyed on the right identity, and —
the part that is easy to get wrong — that the limiter being unavailable does
not itself become the outage.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from core.throttling import (
    AnonWriteThrottle,
    AuthThrottle,
    CheckinThrottle,
    OtpThrottle,
    UploadThrottle,
    WebhookThrottle,
    WriteThrottle,
)


def _auth_limit() -> int:
    """The shipped `auth` rate, read the way DRF resolves it.

    Deliberately not overridden in tests: DRF folds DEFAULT_THROTTLE_RATES into
    `api_settings` at import, so a test that appeared to pass against an
    override would be testing a rate that does not ship.
    """
    # `num_requests` is set by SimpleRateThrottle.__init__ from the resolved
    # rate, so django-stubs does not see it as a declared attribute.
    return int(AuthThrottle().num_requests)  # type: ignore[attr-defined]


@pytest.fixture(autouse=True)
def _clean_throttle_cache():
    # Throttle counters live in Django's cache. Without this, the first test to
    # exhaust a limit leaves the next one already throttled.
    cache.clear()
    yield
    cache.clear()


class TestScopes:
    def test_every_scope_resolves_to_a_configured_rate(self, settings):
        """A misspelled scope is silently no rate limit at all — DRF's
        `ScopedRateThrottle` just returns None and allows everything."""
        rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        for throttle in (
            AuthThrottle,
            OtpThrottle,
            WebhookThrottle,
            CheckinThrottle,
            UploadThrottle,
            WriteThrottle,
            AnonWriteThrottle,
        ):
            assert throttle.scope in rates, throttle.__name__
            assert rates[throttle.scope]

    def test_the_scope_is_fixed_on_the_class_not_read_off_the_view(self):
        """`throttle_classes = [AuthThrottle]` must be complete on its own.

        These subclass `SimpleRateThrottle`, NOT `ScopedRateThrottle` — the
        latter reads `view.throttle_scope` and RETURNS TRUE when it is absent,
        so a throttle attached only via `throttle_classes` silently permits
        everything. The first version of this module made that mistake.
        """
        from rest_framework.throttling import ScopedRateThrottle

        throttle = AuthThrottle()
        assert throttle.scope == "auth"
        assert not isinstance(throttle, ScopedRateThrottle)
        # `__init__` resolves the rate from the scope, with no view involved.
        assert _auth_limit() > 0

    def test_otp_is_tighter_than_general_auth(self, settings):
        # Every OTP request sends an SMS that costs real money, so this is a
        # spend limit as much as a security control.
        rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        assert rates["otp"].endswith("/hour")
        assert rates["auth"].endswith("/min")

    def test_the_webhook_ceiling_is_far_above_a_vendor_retry_schedule(self, settings):
        # Throttling a genuine Razorpay retry delays a ticket already paid for.
        rate = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["webhook"]
        count = int(rate.split("/")[0])
        assert count >= 300

    def test_checkin_is_the_most_permissive_scope(self, settings):
        # Denying a real scan means a queue at a door. A fake scan is already
        # harmless — the per-ticket row lock decides, not this.
        rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        assert int(rates["checkin"].split("/")[0]) >= int(rates["webhook"].split("/")[0])


class TestKeying:
    def test_auth_is_keyed_on_ip_because_the_caller_has_no_identity_yet(self, rf):
        request = rf.post("/api/v1/auth/login", REMOTE_ADDR="203.0.113.9")
        request.user = None
        key = AuthThrottle().get_cache_key(request, view=None)
        assert "203.0.113.9" in str(key)

    def test_uploads_are_keyed_on_the_user_who_pays_for_them(self, rf, db):
        from apps.accounts.models import User

        user = User.objects.create_user(email="up@example.com", password="pw")
        request = rf.post("/upload")
        request.user = user
        key = UploadThrottle().get_cache_key(request, view=None)
        assert str(user.pk) in str(key)

    def test_an_anonymous_upload_is_not_throttled_by_the_user_scope(self, rf):
        # It returns None, which DRF reads as "do not throttle" — correct here
        # only because uploading requires an account and `anon` covers the
        # attempt. This is the exact trap AnonWriteThrottle exists to avoid.
        from django.contrib.auth.models import AnonymousUser

        request = rf.post("/upload")
        request.user = AnonymousUser()
        assert UploadThrottle().get_cache_key(request, view=None) is None

    def test_the_anonymous_write_throttle_keys_on_ip_so_it_actually_applies(self, rf):
        from django.contrib.auth.models import AnonymousUser

        request = rf.post("/api/v1/push/rotate", REMOTE_ADDR="198.51.100.4")
        request.user = AnonymousUser()
        key = AnonWriteThrottle().get_cache_key(request, view=None)
        assert key is not None
        assert "198.51.100.4" in str(key)


class TestFailOpen:
    def test_a_broken_cache_allows_the_request_rather_than_500ing(self, rf, monkeypatch):
        """Redis being down must not take out sign-in, checkout and the gate.

        A brief window of unmetered requests is survivable; a shut door at a
        venue is not. The paths that must stay correct regardless — webhook
        signature verification, the per-ticket row lock — do not depend on this.
        """

        def explode(*args, **kwargs):
            raise ConnectionError("redis is gone")

        monkeypatch.setattr("rest_framework.throttling.SimpleRateThrottle.allow_request", explode)

        request = rf.post("/api/v1/auth/login", REMOTE_ADDR="203.0.113.1")
        request.user = None
        assert AuthThrottle().allow_request(request, view=None) is True


@pytest.mark.django_db
class TestLoginIsActuallyLimited:
    """The end-to-end version. Everything above could pass while the throttle
    was never attached to a view."""

    def test_repeated_failed_logins_are_eventually_refused(self):
        """Fired at the REAL shipped rate, not an overridden one.

        DRF resolves `DEFAULT_THROTTLE_RATES` into `api_settings` at import,
        so overriding `settings.REST_FRAMEWORK` in a test changes nothing —
        and a test that appeared to pass against an override would be testing
        a rate that does not ship.
        """
        limit = _auth_limit()
        client = APIClient()
        payload = {"email": "nobody@example.com", "password": "wrong-guess"}

        statuses = [
            client.post("/api/v1/auth/login", payload, format="json").status_code
            for _ in range(limit + 2)
        ]
        # Before this existed every one of these was a 401, and so would the
        # ten-thousandth have been.
        assert statuses[0] == 401
        assert statuses[-1] == 429

    def test_a_throttled_response_uses_the_platform_error_envelope(self):
        limit = _auth_limit()
        client = APIClient()
        payload = {"email": "nobody@example.com", "password": "wrong-guess"}
        response = None
        for _ in range(limit + 2):
            response = client.post("/api/v1/auth/login", payload, format="json")

        assert response is not None
        assert response.status_code == 429
        # Every other error on this API is `{"error": {...}}`; a 429 that broke
        # the shape would be the one error a client cannot parse.
        assert "error" in response.json()
        assert response.json()["error"]["message"]

    def test_registration_is_limited_too(self):
        """Otherwise it is an unmetered account-creation endpoint."""
        limit = _auth_limit()
        client = APIClient()
        statuses = []
        for index in range(limit + 2):
            statuses.append(
                client.post(
                    "/api/v1/auth/register",
                    {"email": f"burst{index}@example.com", "password": "Sup3rSecret!pass"},
                    format="json",
                ).status_code
            )
        assert 429 in statuses


@pytest.mark.django_db
class TestRetryAfter:
    """A 429 without `Retry-After` is a rate limit that behaves like an outage.

    The custom error envelope rebuilds every DRF response body, and the first
    version dropped DRF's headers with it — so a throttled client was told
    "too many requests" and given no way to know when to come back. It would
    either give up or retry immediately and stay throttled.
    """

    def test_a_throttled_response_says_when_to_come_back(self):
        limit = _auth_limit()
        client = APIClient()
        payload = {"email": "nobody@example.com", "password": "wrong-guess"}
        response = None
        for _ in range(limit + 2):
            response = client.post("/api/v1/auth/login", payload, format="json")

        assert response is not None and response.status_code == 429
        assert "Retry-After" in response
        assert int(response["Retry-After"]) > 0

    def test_the_wait_is_rounded_up_not_down(self):
        # DRF's `wait` is fractional. Rounding down tells a client to retry a
        # moment BEFORE the window opens, producing a second 429 and — for a
        # client that trusts the header — a retry loop.
        from rest_framework.exceptions import Throttled

        from core.errors import exception_handler

        response = exception_handler(Throttled(wait=0.2), {})
        assert response is not None
        assert response["Retry-After"] == "1"

    def test_a_401_still_names_its_authentication_scheme(self):
        # The same header-preserving path. Without `WWW-Authenticate` a client
        # is told it is unauthorised but not which scheme to use.
        from rest_framework.exceptions import NotAuthenticated

        from core.errors import exception_handler

        exc = NotAuthenticated()
        # `auth_header` is set by DRF's authentication classes at raise time,
        # not declared on the exception class — hence the ignore.
        exc.auth_header = 'Bearer realm="api"'  # type: ignore[attr-defined]
        response = exception_handler(exc, {})
        assert response is not None
        assert response["WWW-Authenticate"] == 'Bearer realm="api"'
