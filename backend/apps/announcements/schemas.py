"""Boundary DTOs for announcements."""

from __future__ import annotations

from rest_framework import serializers

from .models import BODY_MAX, SOURCE_MAX, TITLE_MAX, AnnouncementKind, Placement


class LiveAnnouncementSerializer(serializers.Serializer):
    """What a visitor sees. Deliberately lean — no schedule, no author."""

    id = serializers.CharField()
    kind = serializers.CharField()
    title = serializers.CharField()
    body = serializers.CharField(allow_blank=True)
    link_path = serializers.CharField(allow_blank=True)
    link_label = serializers.CharField(allow_blank=True)
    dismissible = serializers.BooleanField()


class AdminAnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        from .models import Announcement

        model = Announcement
        fields = [
            "id",
            "kind",
            "placement",
            "title",
            "body",
            "link_path",
            "link_label",
            "starts_at",
            "ends_at",
            "is_active",
            "dismissible",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class WriteAnnouncementSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=AnnouncementKind.choices)
    placement = serializers.ChoiceField(choices=Placement.choices, default=Placement.HOME)
    title = serializers.CharField(max_length=TITLE_MAX)
    body = serializers.CharField(max_length=BODY_MAX, required=False, allow_blank=True, default="")
    link_path = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    link_label = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    is_active = serializers.BooleanField(default=True)
    dismissible = serializers.BooleanField(default=True)


class PatchAnnouncementSerializer(WriteAnnouncementSerializer):
    kind = serializers.ChoiceField(choices=AnnouncementKind.choices, required=False)
    placement = serializers.ChoiceField(choices=Placement.choices, required=False)
    title = serializers.CharField(max_length=TITLE_MAX, required=False)
    is_active = serializers.BooleanField(required=False)
    dismissible = serializers.BooleanField(required=False)

    def validate(self, attrs: dict) -> dict:
        if not attrs:
            raise serializers.ValidationError("Provide at least one field to update.")
        return attrs


# --- the email side ------------------------------------------------------


class SubscribeRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()
    #: A SLUG, not free text. This is written by an unauthenticated caller and
    #: read back in an operator's table, so it is constrained to a shape an
    #: admin UI can render without escaping decisions and an operator can group
    #: by without discovering forty spellings of "homepage". Anything else is a
    #: 400 rather than a silent rewrite — the frontend picks these values, so a
    #: rejected one is our bug and should be loud.
    #:
    #: The ignore is for the NAME, not the field: `Field` declares its own
    #: `source` attribute, so the stubs see a declaration being overwritten with
    #: an incompatible type. It never happens at runtime — `SerializerMetaclass`
    #: POPS every declared field off the class into `_declared_fields`, so the
    #: class attribute is gone before an instance exists. Renaming the payload
    #: key to dodge a false positive would be the tail wagging the API.
    source = serializers.RegexField(  # type: ignore[assignment]
        rf"^[a-z0-9_-]{{0,{SOURCE_MAX}}}$",
        max_length=SOURCE_MAX,
        required=False,
        allow_blank=True,
        default="",
    )


class SubscribeResponseSerializer(serializers.Serializer):
    """Fixed shape, always. See `SubscriptionService`: any variation between a
    new address and a known one is an account-existence oracle on a public
    endpoint."""

    status = serializers.CharField()


class UnsubscribeRequestSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=500)


class BroadcastResultSerializer(serializers.Serializer):
    announcement_id = serializers.CharField()
    recipients = serializers.IntegerField()
    newly_queued = serializers.IntegerField()


class AnnouncementAnalyticsSerializer(serializers.Serializer):
    """The four figures, and deliberately no fifth. There is no `opened` field
    because there is no honest way to measure one — see the model."""

    announcement_id = serializers.CharField()
    recipients = serializers.IntegerField()
    delivered = serializers.IntegerField()
    clicked = serializers.IntegerField()
    click_rate = serializers.FloatField()
