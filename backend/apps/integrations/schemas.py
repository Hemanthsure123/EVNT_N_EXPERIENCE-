"""Boundary DTOs for the Google connection.

No serializer here exposes a token, an expiry or a ciphertext. The client
needs to know THAT a calendar is connected, WHICH account it is, and whether
it still works — never the credential itself. A field that leaked one would
put a long-lived key to somebody's calendar into a JSON response, browser
memory and any error tracker that captured it.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import CalendarEventLink, GoogleConnection


class GoogleConnectionSerializer(serializers.ModelSerializer):
    """The connection as its owner sees it."""

    connected = serializers.SerializerMethodField()
    needs_reconnect = serializers.SerializerMethodField()
    calendar_enabled = serializers.SerializerMethodField()

    class Meta:
        model = GoogleConnection
        fields = [
            "account_email",
            "status",
            "status_detail",
            "connected",
            "needs_reconnect",
            "calendar_enabled",
            "connected_at",
            "last_synced_at",
        ]
        read_only_fields = fields

    def get_connected(self, connection: GoogleConnection) -> bool:
        return connection.is_active

    def get_needs_reconnect(self, connection: GoogleConnection) -> bool:
        return not connection.is_active

    def get_calendar_enabled(self, connection: GoogleConnection) -> bool:
        """Whether the calendar scope was actually granted.

        Separate from `connected` because a user can consent to sign-in and
        untick calendar access: the connection is live, and calendar writes
        would still 403. The UI needs to tell those apart to prompt correctly.
        """
        from .services import CALENDAR_EVENTS_SCOPE

        return connection.has_scope(CALENDAR_EVENTS_SCOPE)


class CalendarStatusSerializer(serializers.Serializer):
    """What the frontend asks BEFORE offering anything.

    `available` is about the DEPLOYMENT (are OAuth credentials configured),
    `connection` is about this USER. Conflating them would make an
    unconfigured deployment look like an unconnected user, and the UI would
    offer a Connect button that can only ever 503.
    """

    available = serializers.BooleanField()
    connection = GoogleConnectionSerializer(allow_null=True)


class AuthorizationUrlSerializer(serializers.Serializer):
    authorization_url = serializers.URLField()


class AddToCalendarRequestSerializer(serializers.Serializer):
    booking_id = serializers.UUIDField()


class CalendarLinkSerializer(serializers.ModelSerializer):
    """The created entry, so the UI can link straight to it in Google."""

    class Meta:
        model = CalendarEventLink
        fields = ["booking", "google_event_id", "html_link", "created_at"]
        read_only_fields = fields
