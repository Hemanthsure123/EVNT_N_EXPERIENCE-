"""`show_google_oauth_setup`.

The command's job is to print strings, which is not worth testing. Its
INSPECTIONS are, because each one encodes a mistake that produces the same
opaque Google error page and is invisible when read by eye in a console text
field.
"""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.management import call_command


def run(**overrides) -> str:
    out = StringIO()
    call_command("show_google_oauth_setup", stdout=out)
    return out.getvalue()


@pytest.fixture(autouse=True)
def _configured(settings):
    settings.GOOGLE_OAUTH_CLIENT_ID = "123-abc.apps.googleusercontent.com"
    settings.GOOGLE_OAUTH_CLIENT_SECRET = "GOCSPX-secret"
    settings.GOOGLE_OAUTH_SIGNIN_REDIRECT_URI = (
        "http://localhost:8000/api/v1/auth/oauth/google/signin/callback"
    )
    settings.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:8000/api/v1/auth/oauth/google/callback"


def test_it_prints_both_uris_so_they_can_be_pasted(settings):
    output = run()

    assert "/api/v1/auth/oauth/google/signin/callback" in output
    assert "/api/v1/auth/oauth/google/callback" in output
    assert "123-abc.apps.googleusercontent.com" in output


def test_a_healthy_configuration_reports_no_problems(settings):
    assert "Likely problems" not in run()


def test_a_trailing_slash_is_called_out(settings):
    """The most common paste error, and the one that looks identical to a
    correct entry in Google's UI."""
    settings.GOOGLE_OAUTH_SIGNIN_REDIRECT_URI += "/"

    assert "ends with a slash" in run()


def test_http_on_a_public_host_is_called_out(settings):
    """Google permits plain http ONLY for loopback, so this fails in
    production while working perfectly on the developer's machine."""
    settings.GOOGLE_OAUTH_SIGNIN_REDIRECT_URI = (
        "http://api.example.com/api/v1/auth/oauth/google/signin/callback"
    )

    assert "non-local host" in run()


def test_https_on_a_public_host_is_fine(settings):
    settings.GOOGLE_OAUTH_SIGNIN_REDIRECT_URI = (
        "https://api.example.com/api/v1/auth/oauth/google/signin/callback"
    )

    assert "Likely problems" not in run()


def test_a_missing_redirect_uri_is_reported_rather_than_printed_blank(settings):
    settings.GOOGLE_OAUTH_SIGNIN_REDIRECT_URI = ""

    output = run()
    assert "not configured" in output


def test_a_missing_secret_is_flagged_because_it_fails_AFTER_consent(settings):
    """The worst place to discover it: the user has already approved, and the
    failure lands on our callback instead of Google's screen."""
    settings.GOOGLE_OAUTH_CLIENT_SECRET = ""

    assert "MISSING" in run()


def test_no_client_id_stops_early_rather_than_printing_a_setup_nobody_can_do(settings):
    settings.GOOGLE_OAUTH_CLIENT_ID = ""

    output = run()
    assert "not set" in output
    assert "Authorised redirect URIs" not in output
