"""Boundary DTOs for the CMS.

Every text field's maximum is declared HERE as well as on the model, so the
API rejects an over-long headline with a field error the CMS can show inline —
rather than a 500 from the database, or a silent truncation.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import (
    CTA_MAX,
    DESCRIPTION_MAX,
    HEADLINE_MAX,
    RIBBON_MAX,
    Collection,
    FeaturedCity,
    PopularSearch,
)


class HeroSerializer(serializers.Serializer):
    headline = serializers.CharField(allow_blank=True)
    description = serializers.CharField(allow_blank=True)
    primary_cta = serializers.CharField(allow_blank=True)
    secondary_cta = serializers.CharField(allow_blank=True)
    search_placeholder = serializers.CharField(allow_blank=True)
    trust_badges = serializers.ListField(child=serializers.CharField())


class RibbonSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    text = serializers.CharField(allow_blank=True)


class HomepageCategorySerializer(serializers.Serializer):
    id = serializers.CharField()
    slug = serializers.CharField()
    # `label` collides with an attribute DRF's `Field` already defines,
    # so mypy reads it as a bad override. The wire name is what the CMS
    # and the homepage both read; it stays. Same note as apps/console.
    label = serializers.CharField()  # type: ignore[assignment]
    icon = serializers.CharField(allow_blank=True)
    search_term = serializers.CharField(allow_blank=True)


class HomepageCardSerializer(serializers.Serializer):
    entry_id = serializers.CharField()
    id = serializers.CharField()
    title = serializers.CharField()
    venue = serializers.CharField()
    city = serializers.CharField()
    starts_at = serializers.CharField()
    poster_url = serializers.CharField(allow_blank=True)
    from_price = serializers.IntegerField(allow_null=True)
    tickets_available = serializers.IntegerField(allow_null=True)
    organization_id = serializers.CharField()
    organization_name = serializers.CharField()


class HomepageSerializer(serializers.Serializer):
    hero = HeroSerializer()
    ribbon = RibbonSerializer()
    footer_note = serializers.CharField(allow_blank=True)
    categories = HomepageCategorySerializer(many=True)
    collections = serializers.DictField(child=HomepageCardSerializer(many=True))
    version = serializers.IntegerField()
    generated_at = serializers.CharField()


class UpdateHomepageSerializer(serializers.Serializer):
    """The CMS's write payload.

    `version` is required and is the optimistic lock — the client sends back
    what it read, and a mismatch is a 409 rather than a silent overwrite of
    whoever saved first.
    """

    version = serializers.IntegerField(min_value=1)
    hero_headline = serializers.CharField(max_length=HEADLINE_MAX, required=False, allow_blank=True)
    hero_description = serializers.CharField(
        max_length=DESCRIPTION_MAX, required=False, allow_blank=True
    )
    hero_primary_cta = serializers.CharField(max_length=CTA_MAX, required=False, allow_blank=True)
    hero_secondary_cta = serializers.CharField(max_length=CTA_MAX, required=False, allow_blank=True)
    search_placeholder = serializers.CharField(
        max_length=CTA_MAX * 2, required=False, allow_blank=True
    )
    ribbon_text = serializers.CharField(max_length=RIBBON_MAX, required=False, allow_blank=True)
    ribbon_enabled = serializers.BooleanField(required=False)
    trust_badges = serializers.ListField(
        child=serializers.CharField(max_length=40), required=False, max_length=4
    )
    footer_note = serializers.CharField(max_length=RIBBON_MAX, required=False, allow_blank=True)

    _EDITABLE = {
        "hero_headline",
        "hero_description",
        "hero_primary_cta",
        "hero_secondary_cta",
        "search_placeholder",
        "ribbon_text",
        "ribbon_enabled",
        "trust_badges",
        "footer_note",
    }

    def validate(self, attrs: dict) -> dict:
        if not (self._EDITABLE & attrs.keys()):
            raise serializers.ValidationError("Provide at least one field to update.")
        return attrs


class FeatureEventSerializer(serializers.Serializer):
    event_id = serializers.UUIDField()
    collection = serializers.ChoiceField(choices=Collection.choices)
    position = serializers.IntegerField(min_value=0, default=0)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)


class ReorderItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    position = serializers.IntegerField(min_value=0)


class ReorderSerializer(serializers.Serializer):
    order = ReorderItemSerializer(many=True)


class AdminFeaturedSerializer(serializers.Serializer):
    """The admin list — includes scheduled and expired slots the public read
    filters out, because that is exactly what an operator needs to see."""

    id = serializers.UUIDField()
    collection = serializers.CharField()
    position = serializers.IntegerField()
    city = serializers.CharField(allow_blank=True)
    starts_at = serializers.DateTimeField(allow_null=True)
    ends_at = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    event_id = serializers.UUIDField()
    event_title = serializers.CharField()
    event_status = serializers.CharField()
    event_starts_at = serializers.DateTimeField()


class CategorySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    slug = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]
    icon = serializers.CharField(allow_blank=True)
    search_term = serializers.CharField(allow_blank=True)
    position = serializers.IntegerField()
    is_visible = serializers.BooleanField()
    archived_at = serializers.DateTimeField(allow_null=True)


class WriteCategorySerializer(serializers.Serializer):
    slug = serializers.SlugField(max_length=60)
    label = serializers.CharField(max_length=60)  # type: ignore[assignment]
    icon = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    search_term = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )
    position = serializers.IntegerField(min_value=0, default=0)
    is_visible = serializers.BooleanField(default=True)


class PatchCategorySerializer(serializers.Serializer):
    label = serializers.CharField(max_length=60, required=False)  # type: ignore[assignment]
    icon = serializers.CharField(max_length=60, required=False, allow_blank=True)
    search_term = serializers.CharField(max_length=120, required=False, allow_blank=True)
    position = serializers.IntegerField(min_value=0, required=False)
    is_visible = serializers.BooleanField(required=False)

    def validate(self, attrs: dict) -> dict:
        if not attrs:
            raise serializers.ValidationError("Provide at least one field to update.")
        return attrs


class FeaturedCitySerializer(serializers.ModelSerializer):
    class Meta:
        model = FeaturedCity
        fields = ["id", "name", "image_url", "position", "is_visible", "created_at"]
        read_only_fields = ["id", "created_at"]


class WriteFeaturedCitySerializer(serializers.Serializer):
    name = serializers.CharField(max_length=80)
    image_url = serializers.URLField(required=False, allow_blank=True, default="")
    position = serializers.IntegerField(min_value=0, default=0)
    is_visible = serializers.BooleanField(default=True)


class PatchFeaturedCitySerializer(serializers.Serializer):
    name = serializers.CharField(max_length=80, required=False)
    image_url = serializers.URLField(required=False, allow_blank=True)
    position = serializers.IntegerField(min_value=0, required=False)
    is_visible = serializers.BooleanField(required=False)


class PopularSearchSerializer(serializers.ModelSerializer):
    class Meta:
        model = PopularSearch
        fields = ["id", "label", "query", "position", "is_visible", "created_at"]
        read_only_fields = ["id", "created_at"]


class WritePopularSearchSerializer(serializers.Serializer):
    # `label` collides with an attribute DRF's `Field` already defines, so
    # mypy reads it as a bad override. The wire name is what the admin UI and
    # the search panel both read; it stays. Same note as
    # `HomepageCategorySerializer` above.
    label = serializers.CharField(max_length=60)  # type: ignore[assignment]
    query = serializers.CharField(max_length=120)
    position = serializers.IntegerField(min_value=0, default=0)
    is_visible = serializers.BooleanField(default=True)


class PatchPopularSearchSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=60, required=False)  # type: ignore[assignment]
    query = serializers.CharField(max_length=120, required=False)
    position = serializers.IntegerField(min_value=0, required=False)
    is_visible = serializers.BooleanField(required=False)
