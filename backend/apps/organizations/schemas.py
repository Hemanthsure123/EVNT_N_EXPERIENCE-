from __future__ import annotations

from rest_framework import serializers

from .models import Organization, VerificationRecord


class CreateOrganizationRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    logo = serializers.FileField(required=False)


class UpdateOrganizationRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    logo = serializers.FileField(required=False)

    def validate(self, attrs: dict) -> dict:
        if not attrs:
            raise serializers.ValidationError("Provide at least one field to update.")
        return attrs


class SubmitVerificationRequestSerializer(serializers.Serializer):
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class OrganizationDetailSerializer(serializers.ModelSerializer):
    follower_count = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = [
            "id",
            "owner_id",
            "name",
            "verified_level",
            "payout_account_id",
            "logo_url",
            "created_at",
            "follower_count",
        ]
        # `follower_count` is left out: it is a declared SerializerMethodField
        # (already read-only), and DRF refuses to see a declared field named in
        # `read_only_fields`.
        read_only_fields = [
            "id",
            "owner_id",
            "name",
            "verified_level",
            "payout_account_id",
            "logo_url",
            "created_at",
        ]

    def get_follower_count(self, obj: Organization) -> int:
        """Annotated onto the row by `OrganizationRepository.get_active_by_id`.

        `getattr` with a 0 default rather than a query: this method runs per
        serialized instance, and a repository that forgot the annotation must
        not be able to turn a list into N counts. The one path that reaches here
        unannotated is a freshly created organization, which genuinely has zero
        followers — so the default is the truth, not a placeholder.

        Deliberately NOT accompanied by `is_following`/`notify`. This payload is
        cached server-side under `org:{id}` and shared by every reader; a
        per-user field in it would either be served to the wrong user or fork
        one hot key into one key per user. Per-user follow state has its own
        `private, no-store` endpoint — see api.OrganizationFollowView.
        """
        return getattr(obj, "follower_count", 0)


class OrganizationSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "verified_level", "logo_url", "created_at"]
        read_only_fields = fields


class FollowRequestSerializer(serializers.Serializer):
    """POST body for a follow. `notify` is optional on purpose: absent means
    "no opinion" — True on a new follow, and whatever it already was on a
    repeat. See OrganizationFollowRepository.follow."""

    notify = serializers.BooleanField(required=False)


class NotifyPreferenceSerializer(serializers.Serializer):
    """PATCH body. `notify` is REQUIRED here — this endpoint exists only to set
    it, so an empty body is a caller bug, not a default."""

    notify = serializers.BooleanField()


class FollowStateSerializer(serializers.Serializer):
    """What every follow endpoint returns: the caller's own state plus the
    organization's real follower count.

    The count is included on the writes as well as the read so the button never
    has to guess the new number by incrementing its own copy — which is how a
    displayed count drifts from the truth.
    """

    organization_id = serializers.UUIDField(read_only=True)
    is_following = serializers.BooleanField(read_only=True)
    notify = serializers.BooleanField(read_only=True)
    follower_count = serializers.IntegerField(read_only=True)


class FollowedOrganizationSerializer(serializers.Serializer):
    """One row of GET /me/following. Reads through the `select_related`
    organization, so it triggers no query of its own."""

    organization_id = serializers.UUIDField(source="organization.id", read_only=True)
    name = serializers.CharField(source="organization.name", read_only=True)
    verified_level = serializers.CharField(source="organization.verified_level", read_only=True)
    logo_url = serializers.CharField(source="organization.logo_url", read_only=True)
    notify = serializers.BooleanField(read_only=True)
    followed_at = serializers.DateTimeField(source="created_at", read_only=True)


class VerificationRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = VerificationRecord
        fields = ["id", "organization_id", "status", "notes", "created_at", "processed_at"]
        read_only_fields = fields
