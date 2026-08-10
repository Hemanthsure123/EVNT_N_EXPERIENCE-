"""DRF serializers — the boundary DTOs for support."""

from __future__ import annotations

from rest_framework import serializers

from .models import (
    BODY_MAX,
    SUBJECT_MAX,
    SupportAudience,
    SupportQuery,
    SupportReply,
    SupportStatus,
)


class SupportReplySerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = SupportReply
        fields = ["id", "body", "created_at", "is_staff_reply", "author_name"]
        read_only_fields = fields


class SupportQuerySerializer(serializers.ModelSerializer):
    """A query as any of its three audiences sees it.

    ONE serializer for the customer, the organiser and the operator. They are
    three views of the same row, and three serializers is how they drift into
    disagreeing about what was said — the same reasoning as the refund-request
    lifecycle. Nothing here is sensitive to one side only: the asker's name and
    email are on it because both the organiser and support need to reply to a
    person, and the asker obviously knows their own.
    """

    asked_by_name = serializers.CharField(source="user.full_name", read_only=True)
    asked_by_email = serializers.EmailField(source="user.email", read_only=True)
    event_title = serializers.CharField(source="event.title", read_only=True, default="")
    replies = SupportReplySerializer(many=True, read_only=True)

    class Meta:
        model = SupportQuery
        fields = [
            "id",
            "audience",
            "status",
            "subject",
            "body",
            "event_id",
            "event_title",
            "ticket_id",
            "asked_by_name",
            "asked_by_email",
            "replies",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class RaiseQueryRequestSerializer(serializers.Serializer):
    subject = serializers.CharField(max_length=SUBJECT_MAX)
    body = serializers.CharField(max_length=BODY_MAX)
    audience = serializers.ChoiceField(
        choices=SupportAudience.choices, default=SupportAudience.PLATFORM
    )
    # Both optional: a general question is about neither. When a `ticket` is
    # given the view resolves its event, so a query raised from a QR code
    # reaches the right organiser without the browser being trusted to say
    # which event that is.
    event_id = serializers.UUIDField(required=False, allow_null=True)
    ticket_id = serializers.UUIDField(required=False, allow_null=True)


class ReplyRequestSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=BODY_MAX)


class StatusRequestSerializer(serializers.Serializer):
    # `answered` is excluded here as well as in the service: it is set by
    # replying, and offering it in the schema would advertise a value the
    # service refuses.
    status = serializers.ChoiceField(
        choices=[
            (SupportStatus.OPEN, "Open"),
            (SupportStatus.RESOLVED, "Resolved"),
            (SupportStatus.CLOSED, "Closed"),
        ]
    )
