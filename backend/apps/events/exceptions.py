from __future__ import annotations

from core.errors import ConflictError, NotFoundError, PermissionDeniedError


class EventNotFoundError(NotFoundError):
    """No active event exists with this id (or it isn't publicly visible)."""

    code = "event_not_found"

    def __init__(self, event_id: str) -> None:
        super().__init__(f"Event '{event_id}' not found.")


class NotEventOwnerError(PermissionDeniedError):
    """The requesting user doesn't own the organization behind this event."""

    code = "not_event_owner"

    def __init__(self) -> None:
        super().__init__("Only the owning organization can manage this event.")


class StaleEventVersionError(ConflictError):
    """The event was modified by someone else since this client last read it
    (optimistic-lock version mismatch)."""

    code = "stale_event_version"

    def __init__(self) -> None:
        super().__init__("This event was changed since you loaded it. Reload and try again.")


class EventNotPublishableError(ConflictError):
    """The event failed one of the publish-readiness checks."""

    code = "event_not_publishable"

    def __init__(self, reason: str) -> None:
        super().__init__(reason)


class InvalidEventStateError(ConflictError):
    """The requested lifecycle transition isn't allowed from the current status."""

    code = "invalid_event_state"

    def __init__(self, message: str) -> None:
        super().__init__(message)
