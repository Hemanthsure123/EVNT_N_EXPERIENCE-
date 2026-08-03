"""Domain errors for third-party account connections.

Each maps to a distinct HTTP status because each needs a different action
from the caller, and the frontend branches on `code`.
"""

from __future__ import annotations

from core.errors import ConflictError, DomainError, NotFoundError


class IntegrationNotConfiguredError(DomainError):
    """No OAuth client on this deployment. Nothing the user can do."""

    code = "integration_not_configured"
    status_code = 503


class OAuthStateInvalidError(DomainError):
    """The callback's `state` did not match a pending authorization.

    Covers a forged callback, a replayed one (state is single-use), and one
    that simply took longer than the TTL. All three are 400 and all three
    are answered the same way — start again — so they are one error.
    """

    code = "oauth_state_invalid"
    status_code = 400


class OAuthConsentDeniedError(DomainError):
    """The user pressed Cancel on Google's consent screen.

    A 400 rather than a 403: nothing was denied by US, and the user made a
    legitimate choice that the UI should acknowledge rather than treat as a
    failure.
    """

    code = "oauth_consent_denied"
    status_code = 400


class InsufficientScopeError(DomainError):
    """Consent was given, but calendar access was unticked.

    Its own error because the fix is specific: reconnect and leave the
    calendar box checked. "Something went wrong" would send the user round
    the same loop.
    """

    code = "oauth_insufficient_scope"
    status_code = 403


class CalendarNotConnectedError(NotFoundError):
    """No active connection for this user. The caller should offer to connect."""

    code = "calendar_not_connected"


class CalendarReconnectRequiredError(DomainError):
    """A connection exists but its grant is dead.

    **409, deliberately.** Not 401 — the user IS authenticated with this
    platform; it is the Google grant that lapsed, and a 401 would make the
    frontend's interceptor try to refresh OUR token and then sign them out.
    Not 403 — nothing is forbidden, it just needs re-granting.
    """

    code = "calendar_reconnect_required"
    status_code = 409


class CalendarSyncFailedError(DomainError):
    """Google was reachable but refused or failed. Retryable."""

    code = "calendar_sync_failed"
    status_code = 502


class AlreadyConnectedError(ConflictError):
    code = "calendar_already_connected"
