"""Object-level permission placeholder for future endpoints that act on a
specific user id (e.g. an admin viewing/editing another user). Not yet used
by /me, which relies on DRF's built-in IsAuthenticated — kept here so this
app's shape matches every other module's from day one."""

from __future__ import annotations

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from .models import User


class IsSelf(BasePermission):
    def has_object_permission(self, request: Request, view: APIView, obj: User) -> bool:
        return obj == request.user
