"""Routes for third-party account connections. Mounted under /api/v1/."""

from __future__ import annotations

from django.urls import path

from . import api

urlpatterns = [
    path(
        "me/integrations/google",
        api.GoogleCalendarStatusView.as_view(),
        name="google-integration-status",
    ),
    path(
        "me/integrations/google/connect",
        api.GoogleCalendarConnectView.as_view(),
        name="google-integration-connect",
    ),
    # Unauthenticated — the browser returns from Google with no token of ours.
    # Registered VERBATIM as the Authorized redirect URI in the Google console.
    path(
        "auth/oauth/google/callback",
        api.GoogleOAuthCallbackView.as_view(),
        name="google-oauth-callback",
    ),
    path(
        "me/calendar/events",
        api.AddBookingToCalendarView.as_view(),
        name="calendar-add-booking",
    ),
]
