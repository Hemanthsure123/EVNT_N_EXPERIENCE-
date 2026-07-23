"""Object-level permission, consistent with every module's shape. NOT used
by this module's current views — update/verification/payout-account
ownership is enforced inside services.py, which already loads the
Organization row to perform the write; a DRF has_object_permission check
here would mean fetching that same row a second time just for the
permission check. Kept for a future endpoint built around DRF's own
get_object() flow (e.g. a generic viewset), where that redundancy
wouldn't apply."""

from __future__ import annotations

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from .models import Organization


class IsOrganizationOwner(BasePermission):
    def has_object_permission(self, request: Request, view: APIView, obj: Organization) -> bool:
        return str(obj.owner_id) == str(request.user.id)
