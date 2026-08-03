"""Port for a user's third-party calendar.

Unlike every other port here, this one acts **on behalf of a specific
user**, using a credential that user granted and can revoke at any moment.
That changes the failure model, and the port's shape reflects it:

- Every method takes an `access_token`. There is no ambient credential —
  the adapter is stateless and the caller owns token lifecycle, because
  refreshing a token requires the database row the adapter must not know
  about.
- `CalendarAuthError` is separate from `CalendarError`. A revoked grant is
  not a transient failure: retrying it forever is pointless, and the only
  fix is asking the person to reconnect. Collapsing the two would either
  spam a dead endpoint or dead-letter a calendar sync that was merely
  rate-limited.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime


class CalendarError(RuntimeError):
    """A transient calendar failure. Safe to retry."""


class CalendarAuthError(CalendarError):
    """The grant is gone: revoked, expired beyond refresh, or scope removed.

    Retrying cannot help. The caller must mark the connection as needing
    reconnection and stop, rather than burning its retry budget.
    """


@dataclass(frozen=True)
class OAuthTokens:
    access_token: str
    expires_at: datetime
    #: Google returns a refresh token ONLY on the first consent, or when
    #: `prompt=consent` forces a fresh one. Blank on a refresh response is
    #: normal and must not overwrite the stored one — see the service.
    refresh_token: str = ""
    scopes: list[str] = field(default_factory=list)
    #: From the id_token when `openid`/`email` were granted. Lets a person
    #: see WHICH Google account is connected before disconnecting it.
    account_email: str = ""


@dataclass(frozen=True)
class CalendarEventDraft:
    """What to put in someone's calendar. Deliberately not a Google shape."""

    summary: str
    description: str
    location: str
    starts_at: datetime
    ends_at: datetime
    #: Deep link back to the event page, shown as the calendar entry's source.
    url: str = ""
    #: Minutes before the start for a popup reminder. Empty means "use the
    #: calendar's own default" — which is different from "no reminder", and
    #: the distinction is why this is a list rather than an int.
    reminder_minutes: list[int] = field(default_factory=list)
    #: Stable key so a retry updates rather than duplicating. Google dedupes
    #: on it within a calendar.
    idempotency_key: str = ""


@dataclass(frozen=True)
class CalendarEventRef:
    event_id: str
    calendar_id: str
    html_link: str = ""
    status: str = "confirmed"


class CalendarPort(ABC):
    @abstractmethod
    def is_configured(self) -> bool:
        """Whether an OAuth client exists. Asked BEFORE offering the feature."""

    @abstractmethod
    def build_authorization_url(
        self, *, state: str, code_challenge: str, redirect_uri: str, login_hint: str = ""
    ) -> str:
        """The URL to send the browser to for consent."""

    @abstractmethod
    def exchange_code(self, *, code: str, code_verifier: str, redirect_uri: str) -> OAuthTokens:
        """Authorization code -> tokens. Raises `CalendarAuthError` when the
        user denied consent or the code was already used."""

    @abstractmethod
    def refresh_access_token(self, refresh_token: str) -> OAuthTokens:
        """Mint a new access token. Raises `CalendarAuthError` on
        `invalid_grant`, which is what a revoked or expired grant looks like."""

    @abstractmethod
    def revoke(self, token: str) -> None:
        """Tell Google to forget the grant. Never raises for an already-dead
        token — disconnecting must always succeed from the user's side."""

    @abstractmethod
    def create_event(
        self, *, access_token: str, calendar_id: str, draft: CalendarEventDraft
    ) -> CalendarEventRef: ...

    @abstractmethod
    def update_event(
        self,
        *,
        access_token: str,
        calendar_id: str,
        event_id: str,
        draft: CalendarEventDraft,
    ) -> CalendarEventRef: ...

    @abstractmethod
    def delete_event(self, *, access_token: str, calendar_id: str, event_id: str) -> None:
        """Idempotent: an already-deleted event is a success, because the
        caller's intent — 'this should not be in the calendar' — is satisfied."""
