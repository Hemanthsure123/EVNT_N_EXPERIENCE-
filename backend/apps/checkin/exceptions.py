from __future__ import annotations

from core.errors import NotFoundError, PermissionDeniedError


class NotEventCheckerError(PermissionDeniedError):
    """The requester is not the organizer/owner of this event, so they may not
    verify tickets for it. (Delegated gate-staff permissions arrive with the
    later `teams` module — this is the clean seam for it.)"""

    code = "not_allowed_to_check_in"

    def __init__(self) -> None:
        super().__init__("Only the event's organizer can check in tickets for it.")


class EventNotFoundForCheckinError(NotFoundError):
    """No such event to check in for."""

    code = "event_not_found"

    def __init__(self, event_id: str) -> None:
        super().__init__(f"Event '{event_id}' not found.")
