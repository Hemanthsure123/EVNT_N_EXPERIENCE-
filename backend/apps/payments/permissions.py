"""Object-level permission, consistent with every module's shape. NOT used by
the current views — the webhook authenticates by signature (no user), and the
detail/refund views check owner/organizer access against the row they already
load. Kept for a future get_object()-based endpoint (see the identical note in
the other modules)."""

from __future__ import annotations

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from .models import Payment


class IsPaymentOwnerOrOrganizer(BasePermission):
    def has_object_permission(self, request: Request, view: APIView, obj: Payment) -> bool:
        actor_id = str(request.user.id)
        return actor_id in (
            str(obj.booking.user_id),
            str(obj.booking.event.organization.owner_id),
        )
