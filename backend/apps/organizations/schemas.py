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
        ]
        read_only_fields = fields


class OrganizationSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "verified_level", "logo_url", "created_at"]
        read_only_fields = fields


class VerificationRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = VerificationRecord
        fields = ["id", "organization_id", "status", "notes", "created_at", "processed_at"]
        read_only_fields = fields
