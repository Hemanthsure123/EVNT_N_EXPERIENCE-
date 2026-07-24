"""Object-level permission, per the module shape. NOT used by the current views
— the list query filters to the caller's own settlements, and the detail view
checks ownership against the row it already loads (avoiding a second fetch, the
same pattern the other modules document). Kept ready for a future get_object()-
based endpoint, and as the seam where the later `teams` module will grant
organizer sub-users read access to their organization's settlements.
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from .models import Settlement


class IsSettlementOwner(BasePermission):
    def has_object_permission(self, request: Request, view: APIView, obj: Settlement) -> bool:
        return str(request.user.id) == str(obj.event.organization.owner_id)
