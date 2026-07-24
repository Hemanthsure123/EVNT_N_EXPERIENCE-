"""Object-level permission, consistent with every module's shape. NOT used by
the current views — cancel ownership is enforced inside services.py (which
already locks the booking row), and the detail read checks ownership against
the row it just loaded. Kept for a future get_object()-based endpoint (see the
identical note in the other modules)."""

from __future__ import annotations

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from .models import Booking


class IsBookingOwner(BasePermission):
    def has_object_permission(self, request: Request, view: APIView, obj: Booking) -> bool:
        return str(obj.user_id) == str(request.user.id)
