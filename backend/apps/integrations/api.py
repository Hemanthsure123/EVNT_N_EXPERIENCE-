"""Thin views for connecting Google and syncing calendars.

Every response is `private, no-store`: this is one person's third-party
account status and it must never reach a shared cache.

── ONE VIEW IS UNAUTHENTICATED, AND ONLY ONE ────────────────────────────

`GoogleOAuthCallbackView`. It has to be: the browser arrives back from
Google as a plain top-level redirect, with no Authorization header. The
`state` parameter is the credential — random, server-side, single-use and
short-lived (see `GoogleOAuthService`). It is also the only view that
redirects rather than returning JSON, because a human is looking at it.
"""

from __future__ import annotations

from typing import cast
from urllib.parse import urlencode

from django.conf import settings
from django.shortcuts import redirect
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import build_calendar_sync_service, build_google_oauth_service, calendar_port
from core.errors import DomainError
from core.throttling import AnonWriteThrottle, WriteThrottle

from .repositories import GoogleConnectionRepository
from .schemas import (
    AddToCalendarRequestSerializer,
    AuthorizationUrlSerializer,
    CalendarStatusSerializer,
    GoogleConnectionSerializer,
)


def _private(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


class GoogleCalendarStatusView(APIView):
    """Is this available here, and is this user connected?

    The frontend asks this before rendering anything, so an unconfigured
    deployment shows nothing rather than a Connect button that 503s.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: CalendarStatusSerializer})
    def get(self, request: Request) -> Response:
        connection = GoogleConnectionRepository().get_for_user(cast(User, request.user).id)
        payload = {
            "available": calendar_port().is_configured(),
            "connection": GoogleConnectionSerializer(connection).data if connection else None,
        }
        return _private(Response(CalendarStatusSerializer(payload).data))


class GoogleCalendarConnectView(APIView):
    """Start the OAuth flow. Returns a URL for the browser to visit.

    A URL rather than a 302: the caller is `fetch` from a React app, and a
    redirect would be followed by the fetch itself — landing Google's consent
    HTML in a JSON parser instead of in front of the user.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    @extend_schema(request=None, responses={200: AuthorizationUrlSerializer})
    def post(self, request: Request) -> Response:
        user = cast(User, request.user)
        result = build_google_oauth_service().start_authorization(
            user_id=user.id,
            # Narrows Google's account chooser to the address they signed up
            # with. Grants nothing — purely a convenience.
            login_hint=user.email,
        )
        return _private(
            Response(
                AuthorizationUrlSerializer({"authorization_url": result.authorization_url}).data
            )
        )

    @extend_schema(responses={204: None})
    def delete(self, request: Request) -> Response:
        """Disconnect. 204 whether or not a connection existed.

        Idempotent on purpose: a double-click must not 404 on an operation
        whose goal — "I am not connected" — is already satisfied.
        """
        build_google_oauth_service().disconnect(user_id=cast(User, request.user).id)
        return _private(Response(status=status.HTTP_204_NO_CONTENT))


class GoogleOAuthCallbackView(APIView):
    """Where Google sends the browser back. Unauthenticated by necessity.

    Always REDIRECTS to the frontend, success or failure, because a person is
    looking at this — a JSON error body would be a wall of braces at the end
    of a consent flow. The outcome travels as a query parameter the frontend
    turns into a sentence.
    """

    permission_classes: list = []
    authentication_classes: list = []
    throttle_classes = [AnonWriteThrottle]

    @extend_schema(
        parameters=[
            OpenApiParameter("code", str),
            OpenApiParameter("state", str),
            OpenApiParameter("error", str),
        ],
        responses={302: None},
    )
    def get(self, request: Request) -> Response:
        target = f"{settings.PUBLIC_SITE_URL or ''}/account/settings"

        try:
            build_google_oauth_service().complete_authorization(
                state=request.query_params.get("state", ""),
                code=request.query_params.get("code", ""),
                error=request.query_params.get("error", ""),
            )
        except DomainError as error:
            # The code is machine-readable and the message is human-readable;
            # the frontend picks whichever it needs. Never a stack trace, and
            # never a silent redirect that implies success.
            query = urlencode({"calendar": "error", "reason": error.code, "message": error.message})
            return redirect(f"{target}?{query}")  # type: ignore[return-value]

        return redirect(f"{target}?{urlencode({'calendar': 'connected'})}")  # type: ignore[return-value]


class AddBookingToCalendarView(APIView):
    """Put a booked event into the connected calendar, or say why not.

    ── NEVER FAKES SUCCESS ──────────────────────────────────────────────

    Three distinct outcomes, three distinct statuses, because the frontend
    must do something different for each:

      201  created — `google_event_id` and a link to it
      404  `calendar_not_connected` — offer to connect
      409  `calendar_reconnect_required` — the grant lapsed; offer to reconnect
      403  `oauth_insufficient_scope` — they unticked calendar; reconnect
      502  `calendar_sync_failed` — Google is unhappy; retryable

    A single 200-with-a-flag would let a UI show "Added to your calendar"
    for a request that added nothing.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    @extend_schema(request=AddToCalendarRequestSerializer, responses={201: None})
    def post(self, request: Request) -> Response:
        payload = AddToCalendarRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        google_event_id = build_calendar_sync_service().add_booking(
            user_id=cast(User, request.user).id,
            booking_id=payload.validated_data["booking_id"],
        )
        return _private(
            Response({"google_event_id": google_event_id}, status=status.HTTP_201_CREATED)
        )

    @extend_schema(request=AddToCalendarRequestSerializer, responses={204: None})
    def delete(self, request: Request) -> Response:
        """Remove one entry. 204 whether or not it was there."""
        payload = AddToCalendarRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        build_calendar_sync_service().remove_booking(
            user_id=cast(User, request.user).id,
            booking_id=payload.validated_data["booking_id"],
        )
        return _private(Response(status=status.HTTP_204_NO_CONTENT))
