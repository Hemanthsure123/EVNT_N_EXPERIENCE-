"""Object-level permission, consistent with every module's shape. NOT used
by the current views — tier create/edit ownership is enforced inside
services.py (which already loads the event/tier + its organization owner to
perform the write); a DRF has_object_permission here would re-fetch that row
just for the check. Kept for a future get_object()-based endpoint (see the
identical note in apps/events and apps/organizations)."""

from __future__ import annotations

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from .models import TicketType


class IsTicketTypeOwner(BasePermission):
    def has_object_permission(self, request: Request, view: APIView, obj: TicketType) -> bool:
        return str(obj.event.organization.owner_id) == str(request.user.id)
