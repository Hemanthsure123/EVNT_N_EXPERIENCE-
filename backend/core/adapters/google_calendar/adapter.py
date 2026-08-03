"""Real CalendarPort adapter — Google Calendar API v3 + Google OAuth 2.0.

Reuses `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`. There is deliberately no second
OAuth client: Google issues one client per application, and a second one
would mean a second consent screen, a second verification review, and a user
who has "connected Google" twice with no way to tell the grants apart.

── SCOPES, AND WHY EXACTLY THESE THREE ──────────────────────────────────

    calendar.events   create/update/delete events. NOT `calendar`, which
                      also grants the ability to delete entire calendars —
                      a permission this feature never needs and which makes
                      Google's consent screen far more alarming.
    openid, email     identify WHICH Google account is connected. Without
                      it "Disconnect Google Calendar" is a button whose
                      effect the user cannot predict, because someone with
                      a personal and a work account cannot tell which one
                      they linked.

── PKCE ON A CONFIDENTIAL CLIENT ────────────────────────────────────────

This is a server-side client with a secret, so PKCE is not strictly
required. It is used anyway because it costs one hash and closes the
authorization-code-injection case: without it, an attacker who obtains a
code (from a log, a referer header, a shared browser) can redeem it, since
possession of the code plus our public client id is enough. With S256 they
also need the verifier, which never leaves this server.

── WHY `requests` AND NOT `google-api-python-client` ────────────────────

The Google client library pulls a large dependency tree, keeps its own
credential/refresh state, and would put a second notion of "the current
token" beside the database row that actually owns it. Four REST endpoints
over the existing `requests` dependency is less code and one source of
truth for token lifecycle.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from core.ports.calendar_port import (
    CalendarAuthError,
    CalendarError,
    CalendarEventDraft,
    CalendarEventRef,
    CalendarPort,
    OAuthTokens,
)

logger = logging.getLogger(__name__)

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"

SCOPES = (
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "email",
)

# Google's own errors for "this grant is dead". Everything else is transient.
_DEAD_GRANT_ERRORS = frozenset({"invalid_grant", "invalid_token", "unauthorized_client"})


class GoogleCalendarAdapter(CalendarPort):
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        connect_timeout: float = 3.0,
        read_timeout: float = 10.0,
    ) -> None:
        if not (client_id and client_secret):
            raise ValueError(
                "GOOGLE_OAUTH_CLIENT_ID and _SECRET are required; use DisabledCalendarAdapter."
            )
        self._client_id = client_id
        self._client_secret = client_secret
        self._timeout = (connect_timeout, read_timeout)

        self._session = requests.Session()
        retry = Retry(
            total=2,
            backoff_factor=0.5,
            status_forcelist=(429, 500, 502, 503, 504),
            # POST is included ON PURPOSE and it is safe here: token exchange
            # is idempotent on the code, and calendar writes carry an
            # idempotency key. Excluding POST would mean a single 503 during a
            # deploy loses somebody's calendar entry.
            allowed_methods=frozenset({"GET", "POST", "PUT", "DELETE"}),
            raise_on_status=False,
        )
        self._session.mount("https://", HTTPAdapter(max_retries=retry, pool_maxsize=8))

    def is_configured(self) -> bool:
        return True

    # ---------------------------------------------------------------- oauth

    def build_authorization_url(
        self, *, state: str, code_challenge: str, redirect_uri: str, login_hint: str = ""
    ) -> str:
        from urllib.parse import urlencode

        params = {
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            # `offline` is what makes Google issue a refresh token at all.
            # Without it the connection dies in an hour and never recovers.
            "access_type": "offline",
            # `consent` forces the consent screen every time, which looks
            # redundant but is not: Google returns a refresh token ONLY on a
            # fresh consent. Without this a user who reconnects gets an access
            # token and no refresh token, and the connection silently expires
            # an hour later with no way to renew it.
            "prompt": "consent",
            # Lets Google narrow the account chooser without granting anything.
            "login_hint": login_hint,
            # Asks Google to report which scopes were actually granted, so a
            # user who unticks calendar access is detected at callback rather
            # than on the first failed write.
            "include_granted_scopes": "true",
        }
        return f"{_AUTH_URL}?{urlencode({k: v for k, v in params.items() if v})}"

    def _token_request(self, payload: dict[str, str]) -> dict:
        try:
            response = self._session.post(_TOKEN_URL, data=payload, timeout=self._timeout)
        except requests.RequestException as exc:
            raise CalendarError("Could not reach Google's token endpoint") from exc

        try:
            body = response.json()
        except ValueError as exc:
            raise CalendarError("Google's token endpoint returned a non-JSON body") from exc

        if response.status_code >= 400:
            error = str(body.get("error", ""))
            description = str(body.get("error_description", "")) or error
            if error in _DEAD_GRANT_ERRORS or response.status_code in (400, 401):
                # `invalid_grant` covers ALL of: user revoked access in their
                # Google account, refresh token expired after 6 months idle,
                # password changed, or the code was already redeemed. Every
                # one needs the same answer — reconnect — and none is
                # retryable.
                raise CalendarAuthError(f"Google rejected the grant: {description}")
            raise CalendarError(f"Google token request failed: {description}")
        return body

    @staticmethod
    def _account_email(body: dict) -> str:
        """Read the email out of the id_token WITHOUT verifying its signature.

        Safe here, and only here: this token arrived over TLS directly from
        Google's token endpoint in response to a request carrying our client
        secret. There is no third party in the path to forge it. (A signature
        check WOULD be required for an id_token received from a browser, which
        is why sign-in — when it is built — must verify against Google's JWKS
        rather than reuse this.)
        """
        raw = body.get("id_token")
        if not raw:
            return ""
        try:
            import base64
            import json

            payload = raw.split(".")[1]
            payload += "=" * (-len(payload) % 4)  # restore base64url padding
            claims = json.loads(base64.urlsafe_b64decode(payload))
            return str(claims.get("email", ""))
        except Exception:
            # A malformed id_token must not break an otherwise valid
            # connection; the email is a display convenience, not a credential.
            logger.warning("google_calendar.id_token_unreadable")
            return ""

    def _tokens(self, body: dict) -> OAuthTokens:
        expires_in = int(body.get("expires_in", 3600))
        return OAuthTokens(
            access_token=str(body.get("access_token", "")),
            # 60s of slack: a token that expires while a request is in flight
            # produces a 401 the caller reads as a revoked grant.
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=max(0, expires_in - 60)),
            refresh_token=str(body.get("refresh_token", "")),
            scopes=str(body.get("scope", "")).split(),
            account_email=self._account_email(body),
        )

    def exchange_code(self, *, code: str, code_verifier: str, redirect_uri: str) -> OAuthTokens:
        body = self._token_request(
            {
                "code": code,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            }
        )
        tokens = self._tokens(body)
        if not tokens.access_token:
            raise CalendarAuthError("Google returned no access token")
        return tokens

    def refresh_access_token(self, refresh_token: str) -> OAuthTokens:
        if not refresh_token:
            raise CalendarAuthError("No refresh token stored for this connection")
        body = self._token_request(
            {
                "refresh_token": refresh_token,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "grant_type": "refresh_token",
            }
        )
        return self._tokens(body)

    def revoke(self, token: str) -> None:
        if not token:
            return
        try:
            self._session.post(_REVOKE_URL, data={"token": token}, timeout=self._timeout)
        except requests.RequestException:
            # Never raises. Disconnecting must succeed from the user's side
            # even when Google is unreachable — the local row is deleted
            # either way, and an unrevoked token expires on its own.
            logger.warning("google_calendar.revoke_failed", exc_info=True)

    # ------------------------------------------------------------- calendar

    def _calendar_request(
        self, method: str, path: str, *, access_token: str, json: dict | None = None
    ) -> dict:
        try:
            response = self._session.request(
                method,
                f"{_CALENDAR_BASE}{path}",
                headers={"Authorization": f"Bearer {access_token}"},
                json=json,
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            raise CalendarError("Could not reach Google Calendar") from exc

        if response.status_code in (401, 403):
            # 401 is an expired/revoked token. 403 is usually insufficient
            # scope — a user who granted sign-in but unticked calendar. Both
            # need a reconnect, not a retry.
            raise CalendarAuthError("Google Calendar rejected the credentials")
        if response.status_code == 404:
            raise CalendarError("not_found")
        if response.status_code == 410:
            # Google's "already deleted". Its own outcome — see delete_event.
            raise CalendarError("gone")
        if response.status_code >= 400:
            raise CalendarError(f"Google Calendar returned {response.status_code}")

        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            return {}

    @staticmethod
    def _body(draft: CalendarEventDraft) -> dict[str, Any]:
        body: dict[str, Any] = {
            "summary": draft.summary,
            "description": draft.description,
            "location": draft.location,
            # Times are sent as UTC ISO-8601 with an explicit timeZone. Sending
            # a naive local time is how an event lands three hours out in
            # somebody's calendar — the platform stores everything in UTC
            # (USE_TZ=True), so UTC is what leaves it.
            "start": {
                "dateTime": draft.starts_at.astimezone(timezone.utc).isoformat(),
                "timeZone": "UTC",
            },
            "end": {
                "dateTime": draft.ends_at.astimezone(timezone.utc).isoformat(),
                "timeZone": "UTC",
            },
            "source": {"title": "Curatix", "url": draft.url} if draft.url else None,
            # Google dedupes on this within a calendar, so a retried create
            # updates the same entry instead of adding a second one.
            "id": draft.idempotency_key or None,
        }
        if draft.reminder_minutes:
            body["reminders"] = {
                "useDefault": False,
                "overrides": [
                    {"method": "popup", "minutes": minutes}
                    for minutes in sorted(set(draft.reminder_minutes))[:5]
                ],
            }
        else:
            # Explicitly the calendar's own defaults, rather than silently
            # none. A ticket with no reminder is a ticket somebody misses.
            body["reminders"] = {"useDefault": True}
        return {key: value for key, value in body.items() if value is not None}

    def create_event(
        self, *, access_token: str, calendar_id: str, draft: CalendarEventDraft
    ) -> CalendarEventRef:
        from urllib.parse import quote

        try:
            body = self._calendar_request(
                "POST",
                f"/calendars/{quote(calendar_id, safe='')}/events",
                access_token=access_token,
                json=self._body(draft),
            )
        except CalendarError as error:
            if str(error) == "not_found":
                raise CalendarError("That calendar no longer exists") from error
            raise

        return CalendarEventRef(
            event_id=str(body.get("id", "")),
            calendar_id=calendar_id,
            html_link=str(body.get("htmlLink", "")),
            status=str(body.get("status", "confirmed")),
        )

    def update_event(
        self,
        *,
        access_token: str,
        calendar_id: str,
        event_id: str,
        draft: CalendarEventDraft,
    ) -> CalendarEventRef:
        from urllib.parse import quote

        payload = self._body(draft)
        # The id is in the URL for an update; leaving it in the body makes
        # Google reject the request as an attempted id change.
        payload.pop("id", None)

        try:
            body = self._calendar_request(
                "PUT",
                f"/calendars/{quote(calendar_id, safe='')}/events/{quote(event_id, safe='')}",
                access_token=access_token,
                json=payload,
            )
        except CalendarError as error:
            if str(error) in ("not_found", "gone"):
                # The user deleted it from their own calendar. Their choice
                # wins; re-creating it would be the platform overruling them.
                raise CalendarError("That calendar entry no longer exists") from error
            raise

        return CalendarEventRef(
            event_id=str(body.get("id", event_id)),
            calendar_id=calendar_id,
            html_link=str(body.get("htmlLink", "")),
            status=str(body.get("status", "confirmed")),
        )

    def delete_event(self, *, access_token: str, calendar_id: str, event_id: str) -> None:
        from urllib.parse import quote

        try:
            self._calendar_request(
                "DELETE",
                f"/calendars/{quote(calendar_id, safe='')}/events/{quote(event_id, safe='')}",
                access_token=access_token,
            )
        except CalendarError as error:
            if str(error) in ("not_found", "gone"):
                # Already absent. The caller's intent is satisfied, so this is
                # a success — raising would dead-letter a sync that achieved
                # exactly what it set out to do.
                return
            raise


class DisabledCalendarAdapter(CalendarPort):
    """What runs with no OAuth client configured — the default.

    Every method refuses. Nothing pretends to have connected a calendar or
    written to one: `is_configured()` is False, the connect endpoint answers
    503, and the UI does not offer the button.
    """

    def is_configured(self) -> bool:
        return False

    def _refuse(self) -> CalendarError:
        return CalendarError("Google Calendar is not configured on this deployment.")

    def build_authorization_url(self, *, state, code_challenge, redirect_uri, login_hint="") -> str:
        raise self._refuse()

    def exchange_code(self, *, code, code_verifier, redirect_uri) -> OAuthTokens:
        raise self._refuse()

    def refresh_access_token(self, refresh_token) -> OAuthTokens:
        raise self._refuse()

    def revoke(self, token) -> None:
        return None

    def create_event(self, *, access_token, calendar_id, draft) -> CalendarEventRef:
        raise self._refuse()

    def update_event(self, *, access_token, calendar_id, event_id, draft) -> CalendarEventRef:
        raise self._refuse()

    def delete_event(self, *, access_token, calendar_id, event_id) -> None:
        raise self._refuse()
