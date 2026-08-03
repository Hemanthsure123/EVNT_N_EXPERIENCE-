"""Thin check-in views.

Both endpoints are organizer-only and per-user/operational, so responses are
`private, no-store` — an attendance count or a scan result must never be cached
by a shared/CDN cache. A denied scan is a successful, well-formed *result*
(HTTP 200 with ``allowed: false``), not an HTTP error — only bad auth
(403 / 404) raises.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import build_checkin_service
from core.throttling import CheckinThrottle

from .schemas import AttendanceSerializer, VerifyRequestSerializer, VerifyResultSerializer


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


class CheckinVerifyView(APIView):
    permission_classes = [IsAuthenticated]
    # High deliberately: a gate scans continuously during entry, and
    # denying a real scan means a queue at a door. A fake scan is already
    # harmless — the per-ticket row lock decides, not this.
    throttle_classes = [CheckinThrottle]

    @extend_schema(
        request=VerifyRequestSerializer,
        responses={200: VerifyResultSerializer},
        operation_id="checkin_verify",
    )
    def post(self, request: Request) -> Response:
        payload = VerifyRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        user = cast(User, request.user)
        service = build_checkin_service()
        result = service.verify_and_mark_used(
            event_id=data["event_id"],
            qr_token=data["qr_token"],
            gate=data["gate"],
            scanned_by_id=user.id,
            is_admin=user.is_staff,
        )
        body = VerifyResultSerializer(asdict(result)).data
        return _no_store(Response(body, status=status.HTTP_200_OK))


class EventAttendanceView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: AttendanceSerializer}, operation_id="event_attendance")
    def get(self, request: Request, event_id: str) -> Response:
        user = cast(User, request.user)
        service = build_checkin_service()
        attendance = service.get_attendance(
            event_id=event_id, actor_id=user.id, is_admin=user.is_staff
        )
        return _no_store(Response(AttendanceSerializer(asdict(attendance)).data))
