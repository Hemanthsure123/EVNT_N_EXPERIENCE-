"""Object-level permission, per the module shape. NOT used by the current
views — the verify/attendance endpoints check organizer ownership inside the
service against the event row they already load (avoiding a second fetch, the
same pattern the other modules document). Kept ready for a future
get_object()-based endpoint, and as the clean seam where the later `teams`
module will grant delegated gate-staff access.
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.events.models import Event


class IsEventOrganizer(BasePermission):
    def has_object_permission(self, request: Request, view: APIView, obj: Event) -> bool:
        return str(request.user.id) == str(obj.organization.owner_id)
