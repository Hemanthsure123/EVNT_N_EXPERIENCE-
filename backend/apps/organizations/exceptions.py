from __future__ import annotations

from core.errors import NotFoundError, PermissionDeniedError


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
