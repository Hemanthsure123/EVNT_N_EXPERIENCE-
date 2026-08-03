"""Google as an identity provider — "sign in with Google".

Uses the SAME OAuth client as the calendar integration. Google issues one
client per application, and a second would mean a second consent screen and a
second verification review for no benefit. What differs is the scope set and
the redirect URI (a client may register many).

── SCOPES, AND WHY ONLY THESE ───────────────────────────────────────────

    openid, email     who this is, and their address
    profile           their display name, so the first screen after sign-up
                      is not addressed to nobody

NOT `calendar.events`. Demanding calendar access in order to LOG IN is the
kind of consent screen that makes people close the tab, and it would grant a
permission the sign-in path never uses. Connecting a calendar is a separate,
additive grant the user makes later, from their profile.

── HOW THE ID TOKEN IS TRUSTED ──────────────────────────────────────────

The id_token is a JWT. Its signature is NOT checked against Google's JWKS
here, and that is a deliberate, specification-backed decision rather than a
shortcut:

  * The token is fetched by THIS SERVER from Google's token endpoint over
    TLS, in a request authenticated with our client secret. It never passes
    through the browser. OpenID Connect Core §3.1.3.7 states that when the
    token is received directly from the token endpoint over a TLS-protected
    channel, the client MAY use the TLS server validation in place of
    checking the signature; Google's own documentation says the same.
  * Fetching and caching Google's rotating JWKS would add a network
    dependency, a cache, and a failure mode (key rotation mid-request) to
    protect against an attacker who would already need to have broken TLS to
    Google — at which point they can simply return whatever identity they
    like regardless of the signature.

What IS checked, on every response, because these are cheap and catch real
misconfiguration and real attacks:

    aud   must be OUR client id. Without this, an id_token minted for a
          DIFFERENT application would be accepted — the classic confused
          deputy, and the single most important claim check there is.
    iss   must be Google.
    exp   must be in the future.
    sub   must be present. It is the only stable account identifier.

If the signature ever needs checking (a provider that returns tokens through
the browser, say), it belongs here and nowhere else.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlencode

import requests

from core.ports.oidc_port import OidcError, OidcIdentity, OidcIdentityError, OidcPort

logger = logging.getLogger(__name__)

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"

SCOPES = ("openid", "email", "profile")

#: Google has used both spellings for as long as OIDC has existed.
_VALID_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})

#: Tolerance for clock skew between us and Google when checking `exp`.
_LEEWAY_SECONDS = 60


class GoogleOidcAdapter(OidcPort):
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        connect_timeout: float = 3.0,
        read_timeout: float = 10.0,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        # Bounded, like every other outbound call: a sign-in that hangs holds
        # a gunicorn worker, and the user is staring at a spinner.
        self._timeout = (connect_timeout, read_timeout)
        self._session = requests.Session()

    def is_configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def build_authorization_url(
        self, *, state: str, code_challenge: str, redirect_uri: str, login_hint: str = ""
    ) -> str:
        params = {
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            # NO `access_type=offline` and NO `prompt=consent`, unlike the
            # calendar flow. Both exist there to obtain a REFRESH token for
            # long-lived background access. Sign-in needs the identity once,
            # at this instant, and asking for offline access to something we
            # will never poll is a permission we should not hold.
            #
            # Omitting `prompt` also means a returning user who has already
            # consented is signed straight in without a second consent screen.
            "include_granted_scopes": "true",
        }
        if login_hint:
            params["login_hint"] = login_hint
        return f"{_AUTH_URL}?{urlencode(params)}"

    def exchange_code(self, *, code: str, code_verifier: str, redirect_uri: str) -> OidcIdentity:
        try:
            response = self._session.post(
                _TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": code_verifier,
                },
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            raise OidcError(f"Could not reach Google to complete sign-in: {exc}") from exc

        if response.status_code != 200:
            # Google puts the reason in the body; the status alone is useless
            # for diagnosis. The body is logged, never returned to the caller —
            # it can echo the authorization code back.
            logger.warning(
                "google_oidc.token_exchange_failed",
                extra={"status": response.status_code, "detail": response.text[:400]},
            )
            raise OidcError("Google rejected the sign-in attempt.")

        payload = response.json()
        id_token = payload.get("id_token")
        if not id_token:
            # Means the `openid` scope was not granted, which should be
            # impossible given the URL we built — so it indicates the client
            # is misconfigured rather than anything the user did.
            raise OidcIdentityError("Google returned no id_token.")

        claims = self._decode_claims(id_token)
        self._assert_claims_are_ours(claims)

        subject = str(claims.get("sub") or "")
        email = str(claims.get("email") or "").strip().lower()
        if not subject:
            raise OidcIdentityError("Google returned an identity with no subject.")
        if not email:
            # Without an address there is no account to find or create.
            raise OidcIdentityError("Google returned no email address for this account.")

        return OidcIdentity(
            subject=subject,
            email=email,
            # Google sends this as a real bool or the string "true" depending
            # on the endpoint. Normalise rather than trusting truthiness —
            # the STRING "false" is truthy, and that would invert the check
            # that stops an unverified account taking over a real one.
            email_verified=str(claims.get("email_verified", "")).lower() == "true",
            full_name=str(claims.get("name") or "").strip(),
        )

    @staticmethod
    def _decode_claims(id_token: str) -> dict[str, Any]:
        """Read the claim set. See the module docstring on why the signature
        is not re-checked here."""
        import jwt

        try:
            return dict(
                jwt.decode(
                    id_token,
                    options={"verify_signature": False, "verify_aud": False},
                    algorithms=["RS256"],
                )
            )
        except Exception as exc:  # PyJWT raises several distinct types
            raise OidcIdentityError("Google returned an unreadable id_token.") from exc

    def _assert_claims_are_ours(self, claims: dict[str, Any]) -> None:
        audience = claims.get("aud")
        # `aud` may be a list when the token is issued for several clients.
        audiences = audience if isinstance(audience, list) else [audience]
        if self._client_id not in [str(a) for a in audiences]:
            # THE important one: an id_token minted for a different
            # application would otherwise be accepted as a login here.
            raise OidcIdentityError("That Google token was not issued for this application.")

        if str(claims.get("iss") or "") not in _VALID_ISSUERS:
            raise OidcIdentityError("That token was not issued by Google.")

        expires_at = claims.get("exp")
        if not isinstance(expires_at, int | float) or expires_at + _LEEWAY_SECONDS < time.time():
            raise OidcIdentityError("That Google token has expired. Try signing in again.")


class DisabledOidcAdapter(OidcPort):
    """What a deployment with no Google credentials gets.

    Refuses rather than pretends, the same way `DisabledPushAdapter` does: the
    sign-in endpoint answers 503 and the UI hides the button, instead of
    offering a control that fails after a redirect to Google.
    """

    def is_configured(self) -> bool:
        return False

    def build_authorization_url(
        self, *, state: str, code_challenge: str, redirect_uri: str, login_hint: str = ""
    ) -> str:
        raise OidcError("Google sign-in is not configured on this deployment.")

    def exchange_code(self, *, code: str, code_verifier: str, redirect_uri: str) -> OidcIdentity:
        raise OidcError("Google sign-in is not configured on this deployment.")
