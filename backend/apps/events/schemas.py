"""Boundary DTOs. Two response shapes on purpose (see CLAUDE.md's
Performance checklist): a tiny `EventCard` for high-volume list/search
responses, and a fuller `EventDetail` for the single-event page. Neither
serializes the whole model.

`from_price` is the cheapest ticket price in **minor units** (paise/cents),
exposed as an integer to avoid float money. It and `tickets_available` are
null until the `ticketing` module populates the denormalized columns behind
them.
"""

from __future__ import annotations

from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.organizations.models import VerifiedLevel

from .models import Event, EventStatus, MediaKind, TimelineKind
from .repositories import MEDIA_LIMITS


def _validate_coordinate_pair(attrs: dict) -> None:
    """Latitude and longitude arrive together or not at all.

    Half a pair is worse than none: the event page renders a map when both
    are present, so a lone latitude would either crash the marker or place it
    at longitude 0 — a line through the Atlantic, Ghana and Antarctica.
    """
    has_lat = attrs.get("latitude") is not None
    has_lng = attrs.get("longitude") is not None
    if has_lat != has_lng:
        raise serializers.ValidationError("latitude and longitude must be provided together.")


class CreateEventRequestSerializer(serializers.Serializer):
    organization_id = serializers.UUIDField()
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    venue = serializers.CharField(max_length=255)
    city = serializers.CharField(max_length=120)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    poster = serializers.FileField(required=False)

    # --- Where the venue is ----------------------------------------------
    # Written together by the organizer's venue picker when a Places
    # suggestion is chosen. All three are null-able so an organizer who typed
    # a venue freehand is not forced to invent coordinates — the event page
    # then shows the address and a directions link instead of a map.
    place_id = serializers.CharField(max_length=255, required=False, allow_blank=True)
    latitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=7,
        # Decimal, not int: DRF compares against the parsed value and warns
        # (loudly, on every import) when the bound is a different type.
        min_value=Decimal("-90"),
        max_value=Decimal("90"),
        required=False,
        allow_null=True,
    )
    longitude = serializers.DecimalField(
        max_digits=10,
        decimal_places=7,
        min_value=Decimal("-180"),
        max_value=Decimal("180"),
        required=False,
        allow_null=True,
    )

    def validate_starts_at(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("starts_at must be in the future.")
        return value

    def validate(self, attrs: dict) -> dict:
        ends_at = attrs.get("ends_at")
        if ends_at is not None and ends_at <= attrs["starts_at"]:
            raise serializers.ValidationError("ends_at must be after starts_at.")
        _validate_coordinate_pair(attrs)
        return attrs


class UpdateEventRequestSerializer(serializers.Serializer):
    # The optimistic-lock version the client last read; the write fails with
    # 409 stale_event_version if the event has changed since.
    version = serializers.IntegerField(min_value=1)
    title = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    venue = serializers.CharField(max_length=255, required=False)
    city = serializers.CharField(max_length=120, required=False)
    starts_at = serializers.DateTimeField(required=False)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    poster = serializers.FileField(required=False)

    # --- Where the venue is ----------------------------------------------
    # Written together by the organizer's venue picker when a Places
    # suggestion is chosen. All three are null-able so an organizer who typed
    # a venue freehand is not forced to invent coordinates — the event page
    # then shows the address and a directions link instead of a map.
    place_id = serializers.CharField(max_length=255, required=False, allow_blank=True)
    latitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=7,
        # Decimal, not int: DRF compares against the parsed value and warns
        # (loudly, on every import) when the bound is a different type.
        min_value=Decimal("-90"),
        max_value=Decimal("90"),
        required=False,
        allow_null=True,
    )
    longitude = serializers.DecimalField(
        max_digits=10,
        decimal_places=7,
        min_value=Decimal("-180"),
        max_value=Decimal("180"),
        required=False,
        allow_null=True,
    )

    # Content fields. Every one is optional and blank-able: an organizer who
    # does not know the age policy must be able to leave it empty, because a
    # required field is how "All ages" ends up on an 18+ event.
    short_description = serializers.CharField(max_length=200, required=False, allow_blank=True)
    #: Null-able rather than 0-able — `duration_minutes=0` would render as
    #: "0 minutes", which is a claim; null renders as nothing.
    duration_minutes = serializers.IntegerField(
        min_value=1, max_value=60 * 24 * 30, required=False, allow_null=True
    )
    language = serializers.CharField(max_length=80, required=False, allow_blank=True)
    age_restriction = serializers.CharField(max_length=60, required=False, allow_blank=True)
    accessibility_notes = serializers.CharField(max_length=500, required=False, allow_blank=True)
    seo_title = serializers.CharField(max_length=70, required=False, allow_blank=True)
    seo_description = serializers.CharField(max_length=160, required=False, allow_blank=True)

    _EDITABLE = {
        "title",
        "description",
        "venue",
        "city",
        "starts_at",
        "ends_at",
        "poster",
        "place_id",
        "latitude",
        "longitude",
        "short_description",
        "duration_minutes",
        "language",
        "age_restriction",
        "accessibility_notes",
        "seo_title",
        "seo_description",
    }

    def validate_starts_at(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("starts_at must be in the future.")
        return value

    def validate(self, attrs: dict) -> dict:
        if not (self._EDITABLE & attrs.keys()):
            raise serializers.ValidationError("Provide at least one field to update.")
        starts_at, ends_at = attrs.get("starts_at"), attrs.get("ends_at")
        if starts_at is not None and ends_at is not None and ends_at <= starts_at:
            raise serializers.ValidationError("ends_at must be after starts_at.")
        _validate_coordinate_pair(attrs)
        return attrs


class EventSearchQuerySerializer(serializers.Serializer):
    """Validates the public browse/search query string at the edge."""

    q = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    city = serializers.CharField(required=False, allow_blank=True)
    starts_after = serializers.DateTimeField(required=False)
    starts_before = serializers.DateTimeField(required=False)


class EventCardSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    from_price = serializers.IntegerField(
        source="from_price_minor", read_only=True, allow_null=True
    )

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "venue",
            "city",
            "starts_at",
            "poster_url",
            "from_price",
            "tickets_available",
            "organization_id",
            "organization_name",
        ]
        read_only_fields = fields


class EventMediaSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.CharField()
    url = serializers.CharField()
    alt_text = serializers.CharField(allow_blank=True)
    caption = serializers.CharField(allow_blank=True)
    position = serializers.IntegerField()


class EventFaqSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    question = serializers.CharField()
    answer = serializers.CharField()
    position = serializers.IntegerField()


class EventTimelineSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.CharField()
    # `label` collides with an attribute DRF's `Field` defines — see the
    # identical note in apps/console/schemas.py. The wire name stays.
    label = serializers.CharField()  # type: ignore[assignment]
    description = serializers.CharField(allow_blank=True)
    starts_at = serializers.DateTimeField(allow_null=True)
    position = serializers.IntegerField()


class EventDetailSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    from_price = serializers.IntegerField(
        source="from_price_minor", read_only=True, allow_null=True
    )
    #: Has a platform operator verified this organizer?
    #:
    #: A BOOLEAN rather than the level, deliberately. `unverified` and `pending`
    #: are the same fact to a buyer — nobody has checked yet — and `pending` is
    #: an internal review state that is not an attendee's to read (the same
    #: reasoning that keeps `moderation_note` off this serializer). It comes off
    #: the organization row the `select_related` join already loads, so the
    #: organiser card can finally show a verified badge instead of the frontend
    #: inventing one or omitting the question.
    organization_verified = serializers.SerializerMethodField()

    def get_organization_verified(self, event: Event) -> bool:
        return event.organization.verified_level == VerifiedLevel.VERIFIED

    class Meta:
        model = Event
        fields = [
            "id",
            "organization_id",
            "organization_name",
            "organization_verified",
            "title",
            "description",
            "venue",
            "city",
            # Null unless the organizer picked a real place. The frontend
            # renders a map only when both are present — never a marker at
            # (0, 0), which is in the Gulf of Guinea.
            "place_id",
            "latitude",
            "longitude",
            "starts_at",
            "ends_at",
            "status",
            "poster_url",
            "from_price",
            "tickets_available",
            "version",
            "created_at",
            # Content fields. Every one is blank/null unless an organizer filled
            # it in, and the frontend omits the row rather than guessing.
            "short_description",
            "duration_minutes",
            "language",
            "age_restriction",
            "accessibility_notes",
            "seo_title",
            "seo_description",
        ]
        read_only_fields = fields


class OrganizerEventSummarySerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    from_price = serializers.IntegerField(
        source="from_price_minor", read_only=True, allow_null=True
    )

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "city",
            "starts_at",
            "status",
            "poster_url",
            "from_price",
            "organization_id",
            "organization_name",
        ]
        read_only_fields = fields


class WriteEventMediaSerializer(serializers.Serializer):
    """Attach one image or video to an event.

    `alt_text` is REQUIRED here even though the column allows blank: the column
    is permissive so historical rows survive a backfill, the API is strict so
    no new row can be created without it. An image nobody can describe is
    invisible to a screen reader, and this is the most-viewed image on the
    platform.
    """

    kind = serializers.ChoiceField(choices=MediaKind.choices, default=MediaKind.GALLERY)
    url = serializers.CharField(max_length=500)
    alt_text = serializers.CharField(max_length=200)
    caption = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    position = serializers.IntegerField(min_value=0, default=0)


class WriteEventFaqSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=200)
    answer = serializers.CharField()
    position = serializers.IntegerField(min_value=0, default=0)


class WriteEventTimelineSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=TimelineKind.choices, default=TimelineKind.MAIN)
    label = serializers.CharField(max_length=120)  # type: ignore[assignment]
    description = serializers.CharField(
        max_length=300, required=False, allow_blank=True, default=""
    )
    #: Nullable: an organizer often knows the running order before the clock
    #: times, and forcing a time would make them invent one.
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    position = serializers.IntegerField(min_value=0, default=0)


class _PartialUpdateSerializer(serializers.Serializer):
    """Shared "at least one field" rule for the in-place content edits.

    Every field on a PATCH is optional, so an empty body would otherwise
    validate cleanly and produce an `UPDATE` that sets nothing, an audit row
    claiming an edit, and a cache invalidation — for a request that asked for no
    change. `UpdateEventRequestSerializer` applies exactly this rule to the
    event itself; the collections get it for the same reason.
    """

    #: Subclasses list the fields a PATCH may touch. A frozenset because it is
    #: intersected with the body's keys and never mutated.
    _EDITABLE: frozenset[str] = frozenset()

    def validate(self, attrs: dict) -> dict:
        if not (self._EDITABLE & attrs.keys()):
            raise serializers.ValidationError("Provide at least one field to update.")
        return attrs


class UpdateEventMediaSerializer(_PartialUpdateSerializer):
    """Edit one attached image or video in place.

    `url` is deliberately NOT editable. Repointing a row at different bytes
    while keeping its alt text and caption is how an image ends up described as
    something it is not — and swapping an asset is already remove-then-add,
    which is honest about creating a new row.

    `alt_text` may be omitted, but not blanked: a row that HAS a description
    must not be able to lose it, for the same reason the create path requires
    one. (`CharField` refuses `""` and whitespace-only by default, so this is
    the field declaration and not a separate check.)
    """

    kind = serializers.ChoiceField(choices=MediaKind.choices, required=False)
    alt_text = serializers.CharField(max_length=200, required=False)
    caption = serializers.CharField(max_length=200, required=False, allow_blank=True)
    position = serializers.IntegerField(min_value=0, required=False)

    _EDITABLE = frozenset({"kind", "alt_text", "caption", "position"})


class _ReorderItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    position = serializers.IntegerField(min_value=0)


class ReorderEventMediaSerializer(serializers.Serializer):
    """A whole gallery's new order, in one request.

    ONE call rather than N single-row PATCHes: a drag-and-drop changes several
    positions at once, and applying them one request at a time leaves the
    gallery in an order nobody chose for as long as the sequence takes — or
    forever, if the tab closes halfway.

    The list is BOUNDED by the per-kind caps' total (`MEDIA_LIMITS`), computed
    rather than typed so it cannot drift from them. An unbounded list on an
    authenticated endpoint is an unbounded write.
    """

    items = serializers.ListField(
        child=_ReorderItemSerializer(),
        allow_empty=False,
        max_length=sum(MEDIA_LIMITS.values()),
    )

    def validate_items(self, value: list[dict]) -> list[dict]:
        ids = [item["id"] for item in value]
        if len(set(ids)) != len(ids):
            # Two positions for one row is a contradictory instruction, and
            # silently letting the last one win hides a client bug.
            raise serializers.ValidationError("Each media id may appear once.")
        return value


class EventMediaListSerializer(serializers.Serializer):
    """The whole gallery in its new order — what a reorder returns.

    Everything rather than only what moved, so the client replaces its local
    order outright instead of reconciling two lists (the same reasoning as
    `POST /me/saved-events` returning every saved id).
    """

    media = EventMediaSerializer(many=True)


class UpdateEventFaqSerializer(_PartialUpdateSerializer):
    """Edit one question and answer in place. Neither half may be blanked — an
    answer-less FAQ is worse than no FAQ."""

    question = serializers.CharField(max_length=200, required=False)
    answer = serializers.CharField(required=False)
    position = serializers.IntegerField(min_value=0, required=False)

    _EDITABLE = frozenset({"question", "answer", "position"})


class UpdateEventTimelineSerializer(_PartialUpdateSerializer):
    """Edit one running-order entry in place.

    `starts_at` is null-able here on purpose: a time an organizer entered and
    then discovered they do not know has to be removable, or the running order
    keeps advertising a clock time that is wrong.
    """

    label = serializers.CharField(max_length=120, required=False)  # type: ignore[assignment]
    description = serializers.CharField(max_length=300, required=False, allow_blank=True)
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    position = serializers.IntegerField(min_value=0, required=False)

    _EDITABLE = frozenset({"label", "description", "starts_at", "position"})


class EventContentSerializer(serializers.Serializer):
    """Everything the event page renders below the fold, in one payload.

    One request rather than three: these are always read together, and three
    round trips before the gallery paints is the difference between fast and
    not.
    """

    media = EventMediaSerializer(many=True)
    faqs = EventFaqSerializer(many=True)
    timeline = EventTimelineSerializer(many=True)


class SaveEventsRequestSerializer(serializers.Serializer):
    """One or many ids.

    A LIST rather than a single id, because the anonymous-to-signed-in merge
    sends everything the browser accumulated while logged out — and that has
    to be one idempotent call, not N.
    """

    event_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=True,
        # A generous ceiling that is still a ceiling: an unbounded list is an
        # unbounded write loop on an authenticated endpoint.
        max_length=200,
    )


class SavedIdsSerializer(serializers.Serializer):
    event_ids = serializers.ListField(child=serializers.CharField())


class SavedEventSerializer(serializers.Serializer):
    """A saved row, flattened to the card the grid already knows how to draw."""

    saved_at = serializers.DateTimeField(source="created_at")
    id = serializers.CharField(source="event.id")
    title = serializers.CharField(source="event.title")
    venue = serializers.CharField(source="event.venue")
    city = serializers.CharField(source="event.city")
    starts_at = serializers.DateTimeField(source="event.starts_at")
    poster_url = serializers.CharField(source="event.poster_url")
    from_price = serializers.IntegerField(source="event.from_price_minor", allow_null=True)
    tickets_available = serializers.IntegerField(source="event.tickets_available", allow_null=True)
    organization_id = serializers.CharField(source="event.organization.id")
    organization_name = serializers.CharField(source="event.organization.name")
    #: Whether it is still on sale. A saved event that was cancelled or has
    #: passed still shows — hiding it would look like the save was lost — but
    #: the card needs to say so rather than offering a dead "Book" button.
    is_available = serializers.SerializerMethodField()

    def get_is_available(self, row) -> bool:
        event = row.event
        return event.status == EventStatus.LIVE and event.deleted_at is None
