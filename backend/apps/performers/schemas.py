"""Boundary DTOs for the marketplace.

Money is integer **minor units** everywhere, as in the rest of the API. Two
response shapes for performers on purpose — a small `Card` for the browse grid
and a fuller `Detail` for the profile — so the highest-volume payload never
carries a bio nobody reads at that size.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import Occasion, PerformerType

_MAX_LIST_ITEMS = 12
_MAX_TAG_LENGTH = 40


class _TagListField(serializers.ListField):
    """Genres, languages and occasions.

    Capped in COUNT and in LENGTH: these are stored in a JSON column and
    rendered as chips, so an unbounded list is both a payload nobody reads and
    a row that can be made arbitrarily large by a client.
    """

    child = serializers.CharField(max_length=_MAX_TAG_LENGTH, allow_blank=False)

    def __init__(self, **kwargs) -> None:
        kwargs.setdefault("max_length", _MAX_LIST_ITEMS)
        kwargs.setdefault("required", False)
        kwargs.setdefault("default", list)
        super().__init__(**kwargs)


class PerformerSitemapEntrySerializer(serializers.Serializer):
    """One `/sitemap.xml` row: the id the URL is built from, and when the
    profile last changed. Nothing else — a sitemap needs a URL and a date."""

    id = serializers.CharField()
    updated_at = serializers.DateTimeField()


class PerformerCardSerializer(serializers.Serializer):
    id = serializers.CharField()
    stage_name = serializers.CharField()
    performer_type = serializers.CharField()
    tagline = serializers.CharField(allow_blank=True)
    city = serializers.CharField()
    travel_radius_km = serializers.IntegerField()
    #: Null means "price on ask", which is a real answer — the UI says so
    #: rather than rendering a zero.
    base_price_minor = serializers.IntegerField(allow_null=True)
    genres = serializers.ListField(child=serializers.CharField())
    languages = serializers.ListField(child=serializers.CharField())
    experience_years = serializers.IntegerField()
    is_featured = serializers.BooleanField()
    organization_id = serializers.CharField()
    organization_name = serializers.CharField()
    #: The organisation's verification, reused wholesale — a verified organiser
    #: is a verified performer, because it is the same legal entity.
    verified_level = serializers.CharField()
    photo_url = serializers.CharField(allow_blank=True)
    photo_alt = serializers.CharField(allow_blank=True)


class PerformerPhotoSerializer(serializers.Serializer):
    id = serializers.CharField()
    url = serializers.CharField()
    alt_text = serializers.CharField(allow_blank=True)
    caption = serializers.CharField(allow_blank=True)
    position = serializers.IntegerField()


class PerformerDetailSerializer(PerformerCardSerializer):
    bio = serializers.CharField(allow_blank=True)
    occasions = serializers.ListField(child=serializers.CharField())
    typical_set_minutes = serializers.IntegerField(allow_null=True)
    website_url = serializers.CharField(allow_blank=True)
    instagram_url = serializers.CharField(allow_blank=True)
    youtube_url = serializers.CharField(allow_blank=True)
    created_at = serializers.CharField()
    photos = PerformerPhotoSerializer(many=True)
    # Not inherited: the card carries the first photo, the detail carries all.
    photo_url = serializers.CharField(allow_blank=True, required=False)
    photo_alt = serializers.CharField(allow_blank=True, required=False)


class OwnerPerformerSerializer(serializers.Serializer):
    """The owner's own view — includes drafts, the version and the operator's
    note. `moderation_note` is deliberately NOT on the public payloads.

    `photos` is here because the studio cannot manage what it cannot see: the
    public detail carries them but 404s for anything not yet approved, so
    without this an owner could upload a photo and never see it again while
    their profile was still a draft. It is the same list the public payload
    returns, from the same repository method.
    """

    id = serializers.CharField()
    stage_name = serializers.CharField()
    performer_type = serializers.CharField()
    tagline = serializers.CharField(allow_blank=True)
    bio = serializers.CharField(allow_blank=True)
    city = serializers.CharField()
    travel_radius_km = serializers.IntegerField()
    base_price_minor = serializers.IntegerField(allow_null=True)
    genres = serializers.ListField(child=serializers.CharField())
    languages = serializers.ListField(child=serializers.CharField())
    occasions = serializers.ListField(child=serializers.CharField())
    experience_years = serializers.IntegerField()
    typical_set_minutes = serializers.IntegerField(allow_null=True)
    website_url = serializers.CharField(allow_blank=True)
    instagram_url = serializers.CharField(allow_blank=True)
    youtube_url = serializers.CharField(allow_blank=True)
    status = serializers.CharField()
    is_featured = serializers.BooleanField()
    version = serializers.IntegerField()
    submitted_at = serializers.DateTimeField(allow_null=True)
    moderated_at = serializers.DateTimeField(allow_null=True)
    moderation_note = serializers.CharField(allow_blank=True)
    organization_id = serializers.CharField()
    organization_name = serializers.CharField(source="organization.name")
    verified_level = serializers.CharField(source="organization.verified_level")
    created_at = serializers.DateTimeField()
    photos = serializers.SerializerMethodField()

    def get_photos(self, performer):
        """Read from an attribute the VIEW attaches.

        Not a related-manager lookup: `media` includes soft-deleted rows, and
        a per-row query here would be an N+1 across the owner's list. The views
        load the whole page's photos in ONE grouped query and hang them on each
        instance, the same discipline `decorate_cards` uses.
        """
        return PerformerPhotoSerializer(getattr(performer, "loaded_photos", []), many=True).data


class CreatePerformerRequestSerializer(serializers.Serializer):
    organization_id = serializers.UUIDField()
    stage_name = serializers.CharField(max_length=120)
    performer_type = serializers.ChoiceField(choices=PerformerType.choices)
    city = serializers.CharField(max_length=120)
    tagline = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    bio = serializers.CharField(required=False, allow_blank=True, default="")
    travel_radius_km = serializers.IntegerField(min_value=0, max_value=5000, required=False)
    base_price_minor = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    genres = _TagListField()
    languages = _TagListField()
    occasions = _TagListField()
    experience_years = serializers.IntegerField(min_value=0, max_value=100, required=False)
    typical_set_minutes = serializers.IntegerField(
        min_value=1, max_value=60 * 24, required=False, allow_null=True
    )
    website_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    instagram_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    youtube_url = serializers.CharField(max_length=500, required=False, allow_blank=True)


class UpdatePerformerRequestSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    stage_name = serializers.CharField(max_length=120, required=False)
    performer_type = serializers.ChoiceField(choices=PerformerType.choices, required=False)
    tagline = serializers.CharField(max_length=160, required=False, allow_blank=True)
    bio = serializers.CharField(required=False, allow_blank=True)
    city = serializers.CharField(max_length=120, required=False)
    travel_radius_km = serializers.IntegerField(min_value=0, max_value=5000, required=False)
    base_price_minor = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    genres = _TagListField()
    languages = _TagListField()
    occasions = _TagListField()
    experience_years = serializers.IntegerField(min_value=0, max_value=100, required=False)
    typical_set_minutes = serializers.IntegerField(
        min_value=1, max_value=60 * 24, required=False, allow_null=True
    )
    website_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    instagram_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    youtube_url = serializers.CharField(max_length=500, required=False, allow_blank=True)


class UploadPhotoRequestSerializer(serializers.Serializer):
    file = serializers.FileField()
    #: REQUIRED here even though the column allows blank — the column is
    #: permissive so a backfill survives, the API is strict so no new row can
    #: be created without it.
    alt_text = serializers.CharField(max_length=200)
    caption = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    position = serializers.IntegerField(min_value=0, default=0)


class BookingRequestSerializer(serializers.Serializer):
    id = serializers.CharField()
    performer_type = serializers.CharField()
    occasion = serializers.CharField()
    city = serializers.CharField()
    event_date = serializers.CharField()
    budget_min_minor = serializers.IntegerField()
    budget_max_minor = serializers.IntegerField()
    guests = serializers.IntegerField(allow_null=True)
    notes = serializers.CharField(allow_blank=True)
    status = serializers.CharField()
    status_display = serializers.CharField()
    contact_name = serializers.CharField(allow_blank=True)
    contact_phone = serializers.CharField(allow_blank=True)
    contact_email = serializers.CharField(allow_blank=True)
    #: Always 0 — nothing quotes any more. Kept on the shape because removing
    #: it breaks a client for no gain; see `decorate_requests`.
    quote_count = serializers.IntegerField()
    booked_performer_id = serializers.CharField(allow_null=True)
    booked_performer_name = serializers.CharField(allow_blank=True)
    created_at = serializers.CharField()


class OpenRequestSerializer(serializers.Serializer):
    """A lead, as a performer sees it.

    Deliberately carries NOTHING identifying the customer. A brief is a job to
    bid on; the customer's name and contact details are not the performer's to
    have until they are hired.
    """

    id = serializers.CharField()
    performer_type = serializers.CharField()
    occasion = serializers.CharField()
    city = serializers.CharField()
    event_date = serializers.CharField()
    budget_min_minor = serializers.IntegerField()
    budget_max_minor = serializers.IntegerField()
    guests = serializers.IntegerField(allow_null=True)
    notes = serializers.CharField(allow_blank=True)
    quote_count = serializers.IntegerField()
    created_at = serializers.CharField()


class CreateBookingRequestSerializer(serializers.Serializer):
    performer_type = serializers.ChoiceField(choices=PerformerType.choices)
    occasion = serializers.ChoiceField(choices=Occasion.choices, default=Occasion.OTHER)
    city = serializers.CharField(max_length=120)
    event_date = serializers.DateField()
    budget_min_minor = serializers.IntegerField(min_value=0)
    budget_max_minor = serializers.IntegerField(min_value=0)
    guests = serializers.IntegerField(
        min_value=1, max_value=1_000_000, required=False, allow_null=True
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)

    #: How to get back to them. All three are OPTIONAL and blank falls back to
    #: the account — which always has an email, and often a name and a phone.
    #: A blank field means "the account's is fine", not "do not contact me".
    #:
    #: They exist at all because the reader changed: this used to be a
    #: marketplace brief shown to performers, and a performer seeing a lead was
    #: deliberately shown the job and not the person. The only reader now is an
    #: operator whose whole job is to reply.
    contact_name = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=150
    )
    contact_phone = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=20
    )
    contact_email = serializers.EmailField(required=False, allow_blank=True, default="")

    def validate(self, attrs: dict) -> dict:
        if attrs["budget_max_minor"] < attrs["budget_min_minor"]:
            raise serializers.ValidationError(
                "The top of the budget has to be at least the bottom of it."
            )
        return attrs


class QuoteSerializer(serializers.Serializer):
    """A quote, as the CUSTOMER sees it — with the performer attached."""

    id = serializers.CharField()
    request_id = serializers.CharField()
    amount_minor = serializers.IntegerField()
    message = serializers.CharField(allow_blank=True)
    status = serializers.CharField()
    created_at = serializers.CharField()
    performer_id = serializers.CharField()
    performer_name = serializers.CharField()
    performer_type = serializers.CharField()
    performer_city = serializers.CharField()
    performer_experience_years = serializers.IntegerField()
    organization_name = serializers.CharField()
    verified_level = serializers.CharField()


class PerformerQuoteSerializer(serializers.Serializer):
    """A quote, as the PERFORMER sees it — with the brief attached."""

    id = serializers.CharField()
    request_id = serializers.CharField()
    amount_minor = serializers.IntegerField()
    message = serializers.CharField(allow_blank=True)
    status = serializers.CharField()
    created_at = serializers.CharField()
    request_city = serializers.CharField()
    request_occasion = serializers.CharField()
    request_event_date = serializers.CharField()
    request_status = serializers.CharField()


class SubmitQuoteSerializer(serializers.Serializer):
    performer_id = serializers.UUIDField()
    amount_minor = serializers.IntegerField(min_value=0)
    message = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)


class ModerationDecisionSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    note = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")


class FeatureDecisionSerializer(serializers.Serializer):
    featured = serializers.BooleanField()


class PauseSerializer(serializers.Serializer):
    paused = serializers.BooleanField()


class MarketplaceFacetsSerializer(serializers.Serializer):
    """What the filter panel may offer. Derived from LIVE performers, so a
    genre nobody performs never appears as a filter returning nothing."""

    cities = serializers.ListField(child=serializers.CharField())
    genres = serializers.ListField(child=serializers.CharField())
    languages = serializers.ListField(child=serializers.CharField())


class ReadinessSerializer(serializers.Serializer):
    """What still stands between a draft and a submission."""

    ready = serializers.BooleanField()
    problems = serializers.ListField(child=serializers.CharField())
