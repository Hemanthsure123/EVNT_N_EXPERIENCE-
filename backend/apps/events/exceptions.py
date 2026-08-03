from __future__ import annotations

from apps.organizations.models import VerifiedLevel
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


class OrganizationNotVerifiedError(PermissionDeniedError):
    """The organization behind this event has not been approved by a platform
    operator, so it may not put anything in front of buyers yet.

    A PERMISSION error rather than a readiness conflict: nothing about the
    event is wrong, and no amount of editing it changes the answer. The
    question is who is asking, which is why this is raised beside the
    ownership check rather than registered as a publish check (a check in
    `publish_checks.py` receives only the `Event` and would have to load the
    organization a second time to answer).

    `details` carries the level so the UI can tell "submit for verification"
    apart from "we are still reviewing you" without parsing the message.
    """

    code = "organization_not_verified"

    def __init__(self, verified_level: str) -> None:
        if verified_level == VerifiedLevel.PENDING:
            message = (
                "Your organization is still being verified. You can keep working on this "
                "event — you can submit it for review once a platform operator approves "
                "your organization."
            )
        else:
            message = (
                "Your organization has to be verified before an event can be submitted "
                "for review. Submit your organization for verification first."
            )
        super().__init__(message, verified_level=verified_level)


class NotPlatformOperatorError(PermissionDeniedError):
    """A moderation decision was attempted by somebody who is not staff.

    Defence in depth. The console's views already refuse a non-operator, but
    approval is the ONLY path an event has to `live`, and a rule that exists
    solely in a view is one internal caller away from being skipped. The
    service that owns the transition proves the caller for itself.
    """

    code = "not_platform_operator"

    def __init__(self) -> None:
        super().__init__("Only a platform operator can decide on a submitted event.")


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


class EventNotUnderReviewError(ConflictError):
    """Someone else already decided this one, or it was never submitted."""

    code = "event_not_under_review"

    def __init__(self) -> None:
        super().__init__("This event is not awaiting review — it may already have been decided.")


class EventNotLiveError(ConflictError):
    code = "event_not_live"

    def __init__(self) -> None:
        super().__init__("Only a published event can be taken down.")
