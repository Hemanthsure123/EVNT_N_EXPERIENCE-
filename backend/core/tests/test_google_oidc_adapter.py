"""The Google OIDC adapter's claim checks.

`test_google_sign_in.py` fakes this port to test POLICY. This file tests the
thing the fake stands in for: turning Google's response into an identity we
are willing to log somebody in as.

No network. The token endpoint is stubbed, so these assert what the adapter
does with a response — including responses a real attacker would send.
"""

from __future__ import annotations

import base64
import json
import time

import pytest

from core.adapters.google_oidc.adapter import GoogleOidcAdapter
from core.ports.oidc_port import OidcError, OidcIdentityError

CLIENT_ID = "123-abc.apps.googleusercontent.com"


def _id_token(**claims) -> str:
    """A JWT-shaped string. The signature is not checked here — see the
    adapter's module docstring on why (the token is fetched by us, from
    Google's token endpoint, over TLS) — so a stub header/signature is
    faithful to what the code actually inspects."""
    payload = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "google-subject-1",
        "email": "person@example.com",
        "email_verified": True,
        "exp": int(time.time()) + 600,
        **claims,
    }
    encode = lambda data: base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{encode({'alg': 'RS256'})}.{encode(payload)}.stub-signature"


class _Response:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> dict:
        return self._payload


@pytest.fixture
def adapter(monkeypatch) -> GoogleOidcAdapter:
    return GoogleOidcAdapter(client_id=CLIENT_ID, client_secret="secret")


def _stub_token_response(adapter: GoogleOidcAdapter, monkeypatch, payload, status=200):
    monkeypatch.setattr(adapter._session, "post", lambda *a, **k: _Response(status, payload))


class TestTheAudienceCheck:
    """The single most important claim.

    Without it, an id_token minted for a DIFFERENT application — trivially
    obtained by anyone who runs their own Google app and asks a victim to sign
    in to it — would be accepted as a login here. The classic confused deputy.
    """

    def test_a_token_for_another_application_is_refused(self, adapter, monkeypatch):
        _stub_token_response(
            adapter, monkeypatch, {"id_token": _id_token(aud="someone-elses-client-id")}
        )
        with pytest.raises(OidcIdentityError, match="not issued for this application"):
            adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")

    def test_our_audience_inside_a_list_is_accepted(self, adapter, monkeypatch):
        """Google sends `aud` as a list when a token covers several clients."""
        _stub_token_response(
            adapter, monkeypatch, {"id_token": _id_token(aud=["other", CLIENT_ID])}
        )
        identity = adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")
        assert identity.email == "person@example.com"


class TestTheOtherClaimChecks:
    def test_a_token_from_another_issuer_is_refused(self, adapter, monkeypatch):
        _stub_token_response(adapter, monkeypatch, {"id_token": _id_token(iss="https://evil.test")})
        with pytest.raises(OidcIdentityError, match="not issued by Google"):
            adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")

    def test_an_expired_token_is_refused(self, adapter, monkeypatch):
        _stub_token_response(
            adapter, monkeypatch, {"id_token": _id_token(exp=int(time.time()) - 3600)}
        )
        with pytest.raises(OidcIdentityError, match="expired"):
            adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")

    def test_both_google_issuer_spellings_are_accepted(self, adapter, monkeypatch):
        """Google has used both for as long as OIDC has existed."""
        _stub_token_response(
            adapter, monkeypatch, {"id_token": _id_token(iss="accounts.google.com")}
        )
        assert adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r").subject

    def test_a_token_with_no_subject_is_refused(self, adapter, monkeypatch):
        _stub_token_response(adapter, monkeypatch, {"id_token": _id_token(sub="")})
        with pytest.raises(OidcIdentityError, match="no subject"):
            adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")

    def test_a_token_with_no_email_is_refused(self, adapter, monkeypatch):
        """Without an address there is no account to find or create."""
        _stub_token_response(adapter, monkeypatch, {"id_token": _id_token(email="")})
        with pytest.raises(OidcIdentityError, match="no email"):
            adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")


class TestTheVerifiedFlag:
    """`email_verified` decides whether an account can be adopted, so reading
    it wrongly is an account-takeover bug."""

    def test_a_string_false_is_not_treated_as_verified(self, adapter, monkeypatch):
        """Google sends this as a bool or as a STRING depending on the
        endpoint, and the string "false" is truthy in Python — a plain
        truthiness check would invert this exact protection."""
        _stub_token_response(adapter, monkeypatch, {"id_token": _id_token(email_verified="false")})
        identity = adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")
        assert identity.email_verified is False

    def test_a_string_true_is_treated_as_verified(self, adapter, monkeypatch):
        _stub_token_response(adapter, monkeypatch, {"id_token": _id_token(email_verified="true")})
        assert adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r").email_verified

    def test_a_missing_flag_is_not_verified(self, adapter, monkeypatch):
        """Absent must fail CLOSED. Defaulting to verified would make a
        malformed or truncated response an account-takeover vector."""
        _stub_token_response(adapter, monkeypatch, {"id_token": _id_token(email_verified=None)})
        identity = adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")
        assert identity.email_verified is False


class TestFailureModes:
    def test_a_rejected_exchange_does_not_leak_googles_body_to_the_caller(
        self, adapter, monkeypatch
    ):
        """The body can echo the authorization code back. It is logged, not
        returned."""
        _stub_token_response(
            adapter, monkeypatch, {"error": "invalid_grant", "code": "SENSITIVE"}, status=400
        )
        with pytest.raises(OidcError) as caught:
            adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")

        assert "SENSITIVE" not in str(caught.value)

    def test_a_response_without_an_id_token_is_refused(self, adapter, monkeypatch):
        _stub_token_response(adapter, monkeypatch, {"access_token": "at"})
        with pytest.raises(OidcIdentityError, match="no id_token"):
            adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")

    def test_an_unreadable_id_token_is_refused(self, adapter, monkeypatch):
        _stub_token_response(adapter, monkeypatch, {"id_token": "not-a-jwt"})
        with pytest.raises(OidcIdentityError, match="unreadable"):
            adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r")

    def test_the_email_is_normalised(self, adapter, monkeypatch):
        """Google may return mixed case; our accounts are keyed on the address,
        so two casings must not become two accounts."""
        _stub_token_response(
            adapter, monkeypatch, {"id_token": _id_token(email="  Person@Example.COM ")}
        )
        assert adapter.exchange_code(code="c", code_verifier="v", redirect_uri="r").email == (
            "person@example.com"
        )


class TestConfiguration:
    def test_missing_credentials_report_unconfigured(self):
        assert GoogleOidcAdapter(client_id="", client_secret="").is_configured() is False
        assert GoogleOidcAdapter(client_id=CLIENT_ID, client_secret="s").is_configured() is True

    def test_the_authorization_url_asks_for_identity_scopes_only(self, adapter):
        """Demanding calendar access in order to LOG IN is the kind of consent
        screen that makes people close the tab."""
        url = adapter.build_authorization_url(
            state="s", code_challenge="c", redirect_uri="https://api.test/cb"
        )
        assert "openid" in url and "email" in url and "profile" in url
        assert "calendar" not in url
        # No offline access: sign-in reads the identity once and never calls a
        # Google API afterwards, so a refresh token would be a credential we
        # hold for no reason.
        assert "access_type=offline" not in url
