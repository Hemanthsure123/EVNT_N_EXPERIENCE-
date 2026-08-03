from __future__ import annotations

from core.errors import ConflictError, NotFoundError, PermissionDeniedError


class OrganizationNotFoundError(NotFoundError):
    """No active organization exists with this id."""

    code = "organization_not_found"

    def __init__(self, organization_id: str) -> None:
        super().__init__(f"Organization '{organization_id}' not found.")


class NotOrganizationOwnerError(PermissionDeniedError):
    """The requesting user isn't this organization's owner."""

    code = "not_organization_owner"

    def __init__(self) -> None:
        super().__init__("Only the organization's owner can do this.")


class NotPlatformOperatorError(PermissionDeniedError):
    """A verification decision was attempted by somebody who is not staff.

    Defence in depth: the console view already refuses a non-operator, but
    approving a verification is what unlocks every gated organizer write on
    the platform, so the service that owns the rule proves the caller for
    itself rather than trusting whoever called it to have checked.
    """

    code = "not_platform_operator"

    def __init__(self) -> None:
        super().__init__("Only a platform operator can decide on a verification.")


class NoPendingVerificationError(ConflictError):
    """Decided on an organization with nothing awaiting review — usually a
    double submit, or two operators reviewing the same queue."""

    code = "no_pending_verification"

    def __init__(self, organization_id: str) -> None:
        super().__init__(f"Organization {organization_id} has no pending verification to decide.")


class NotFollowingError(NotFoundError):
    """A notification preference was changed on an organization the caller
    does not follow.

    Deliberately NOT treated as "follow them, then set the flag": the caller
    asked to change a setting on something they believe they already follow, so
    silently creating the follow would turn a stale tab into a subscription
    nobody pressed. The 404 tells the UI its state is out of date.
    """

    code = "not_following"

    def __init__(self) -> None:
        super().__init__("You do not follow this organization.")


class VerificationNotFoundError(NotFoundError):
    """Nothing has ever been submitted for this organization.

    A real state rather than a failure: it is what a brand-new organization
    looks like, and it is what tells the UI to offer the submit form.
    """

    code = "verification_not_found"

    def __init__(self) -> None:
        super().__init__("No verification has been submitted for this organization.")
