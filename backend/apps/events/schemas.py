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

from .models import (
    Event,
    EventCategory,
    EventSlot,
    EventStatus,
    MediaKind,
    QuestionKind,
    TimelineKind,
)
from .repositories import MEDIA_LIMITS
from .taxonomy import MAX_TAGS, EventType, unknown_tags


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


#: Input-only spellings of the schedule fields.
#:
#: The event window has been `starts_at`/`ends_at` since the first migration,
#: and those names are not a detail of this serializer — they are the column
#: names, the public `EventDetail` payload, the ticketing sale window, the
#: check-in window, the settlement payout date, the browse indexes, the
#: sitemap's `lastmod` and the `Event` JSON-LD. RENAMING THEM WOULD BE A
#: BREAKING CHANGE ACROSS EVERY ONE OF THOSE, plus the frontend's own
#: `draftFromEvent`/`toPatchInput` mapping, to buy nothing a caller can see.
#:
#: So `start_datetime`/`end_datetime` are accepted as ALIASES on the way in
#: and nothing changes on the way out. A client may send either spelling;
#: sending BOTH is refused rather than resolved, because picking a winner
#: silently discards one of two times somebody meant.
_DATETIME_ALIASES = {"start_datetime": "starts_at", "end_datetime": "ends_at"}


class _ScheduleAliasMixin:
    """Rewrites the alias spellings before any field validation runs.

    In `to_internal_value` rather than `validate`, because the canonical
    fields are declared `DateTimeField` and a value arriving under the alias
    would otherwise be dropped as an unknown key BEFORE anything looked at it
    — the silent-no-op failure mode this codebase keeps finding in its own
    write paths.

    `request.data` is a `QueryDict` on the multipart path (the poster is a
    `FileField`), which is immutable and whose `pop` returns a LIST. Both are
    handled explicitly; `.copy()` on a `QueryDict` returns a mutable one.
    """

    def to_internal_value(self, data):
        present = [alias for alias in _DATETIME_ALIASES if alias in data]
        if not present:
            # `super()` here is `serializers.Serializer` at every real call
            # site, but mypy sees the mixin standing alone and cannot know
            # that. Declaring it a Serializer subclass instead would make DRF
            # build the mixin's own (empty) field map and shadow the real one.
            return super().to_internal_value(data)  # type: ignore[misc]

        is_query_dict = hasattr(data, "getlist")
        merged = data.copy() if is_query_dict else dict(data)
        for alias in present:
            canonical = _DATETIME_ALIASES[alias]
            value = merged.pop(alias)
            if is_query_dict and isinstance(value, list):
                value = value[-1] if value else None
            if merged.get(canonical) not in (None, ""):
                raise serializers.ValidationError(
                    {alias: f"Send either {alias} or {canonical}, not both."}
                )
            merged[canonical] = value
        return super().to_internal_value(merged)  # type: ignore[misc]


#: How many rules one event may publish. A page of them is not a policy
#: section, it is a document nobody reads — and the event page renders them
#: all, un-paginated, because a policy behind a "show more" is a policy an
#: attendee will say they were never told.
MAX_POLICIES = 12

#: A bullet point is one scannable line, not a paragraph. The cap is generous
#: enough for a real list and short enough that an organiser who pastes three
#: sentences is told so before it reaches a card.
HIGHLIGHT_MAX_LENGTH = 120
#: Per list, not across the three. Eight points is already more than anybody
#: reads; past that the list stops being highlights.
MAX_HIGHLIGHTS = 8


class CancelEventRequestSerializer(serializers.Serializer):
    """A reason is REQUIRED, unlike archive, which needs none.

    Everybody who booked is shown this verbatim. "Cancelled" with no reason is
    the message that generates every support ticket this endpoint exists to
    prevent, so the field cannot be blank and cannot be whitespace.
    """

    reason = serializers.CharField(max_length=500, trim_whitespace=True)

    def validate_reason(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError(
                "Say why this event is being cancelled — everyone who booked will see it."
            )
        return value.strip()


class CancelEventResultSerializer(serializers.Serializer):
    """What the click actually did. A bare 200 would leave an organiser who
    just spent money with no idea how much."""

    event_id = serializers.CharField()
    title = serializers.CharField()
    reason = serializers.CharField()
    refunds_enqueued = serializers.IntegerField()
    holds_released = serializers.IntegerField()
    attendees_notified = serializers.IntegerField()


class HighlightListField(serializers.ListField):
    """One of the three bullet lists: included, not included, guidelines.

    Written whole and replaced whole — an empty list CLEARS it, the same
    contract `policies` has and for the same reason: these entries have no
    server identity, so there is nothing to diff and no per-row patch to get
    wrong.

    Blank entries are DROPPED rather than refused, and duplicates with them.
    This is `ticketing.PerkListField`'s rule, restated because the failure it
    avoids is the same one: an organiser who tabbed through an empty row should
    not have the whole event save fail, and an empty bullet on a public page is
    a rendering fault rather than a promise.
    """

    def __init__(self, **kwargs) -> None:
        kwargs.setdefault(
            "child", serializers.CharField(max_length=HIGHLIGHT_MAX_LENGTH, allow_blank=True)
        )
        kwargs.setdefault("max_length", MAX_HIGHLIGHTS)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        cleaned: list[str] = []
        for point in super().to_internal_value(data):
            text = point.strip()
            if text and text not in cleaned:
                cleaned.append(text)
        return cleaned


class TagListField(serializers.ListField):
    """The tag matrix, validated against the closed vocabulary.

    An UNKNOWN tag is REFUSED here, unlike an unknown category on the browse
    query, and the asymmetry is deliberate: a browse filter comes from a link
    somebody may have edited and the worst an unknown value can do is widen the
    results, while this is a WRITE that decides how an event is found for the
    rest of its life. A tag the vocabulary does not contain matches no filter
    and appears on no chip — it would be a silent no-op stored forever.

    Every unknown value is named at once. A boundary that reports one at a time
    makes a client fix a list by trial and error.
    """

    def __init__(self, **kwargs) -> None:
        kwargs.setdefault("child", serializers.CharField(max_length=40))
        kwargs.setdefault("max_length", MAX_TAGS)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        # De-duplicate while PRESERVING ORDER: the order is the organiser's,
        # and a set would reorder the chips on every save.
        cleaned: list[str] = []
        for tag in super().to_internal_value(data):
            text = tag.strip()
            if text and text not in cleaned:
                cleaned.append(text)
        unknown = unknown_tags(cleaned)
        if unknown:
            raise serializers.ValidationError(
                f"Not tags we know: {', '.join(unknown)}. Choose from the list."
            )
        return cleaned


class EventPolicySerializer(serializers.Serializer):
    """One of an organiser's own rules for their event.

    `title` and `body` are both REQUIRED and both non-blank. A rule with no
    body is a heading an attendee cannot act on ("Entry policy" — and then
    what?), and a body with no title is a paragraph with no place in a list.
    Whitespace-only is refused for the same reason: it renders as an empty row
    and reads as a rendering fault.
    """

    title = serializers.CharField(max_length=80, trim_whitespace=True)
    body = serializers.CharField(max_length=600, trim_whitespace=True)

    def validate_title(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A policy needs a title.")
        return value.strip()

    def validate_body(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A policy needs something under its title.")
        return value.strip()


class CreateEventRequestSerializer(_ScheduleAliasMixin, serializers.Serializer):
    organization_id = serializers.UUIDField()
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    venue = serializers.CharField(max_length=255)
    city = serializers.CharField(max_length=120)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    poster = serializers.FileField(required=False)

    # ── CATEGORY ON THE CREATE, AND ITS ABSENCE WAS A BUG ─────────────────
    #
    # This serializer did not declare `category` and `create_event()` did not
    # accept one, so every event built through the wizard landed UNCATEGORISED
    # and stayed that way until the first PATCH happened to carry it. A
    # DRF `Serializer` drops undeclared keys silently, so the wizard sent the
    # organiser's choice, the API answered 201, and the value went nowhere —
    # the same shape of failure CLAUDE.md records for `category` being missing
    # from `toPatchInput` and for tier `position` never being sent.
    #
    # `required=False`: a draft is allowed to be uncategorised, which is what
    # blank means and is different from `other` ("none of these" — a real
    # choice somebody made).
    category = serializers.ChoiceField(
        choices=EventCategory.choices, required=False, allow_blank=True, default=""
    )
    #: The organizer's own label, by id. Verified to belong to THIS event's
    #: organization in the service before it is written — a uuid from a
    #: browser is not evidence of ownership.
    custom_category = serializers.UUIDField(required=False, allow_null=True)

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


class UpdateEventRequestSerializer(_ScheduleAliasMixin, serializers.Serializer):
    # The optimistic-lock version the client last read; the write fails with
    # 409 stale_event_version if the event has changed since.
    version = serializers.IntegerField(min_value=1)
    title = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    venue = serializers.CharField(max_length=255, required=False)
    city = serializers.CharField(max_length=120, required=False)
    #: A CHOICE here, unlike the browse filter's free CharField — and the
    #: asymmetry is deliberate. A reader following a hand-edited link should
    #: get a wider list, not a 400; an organiser SAVING a category is writing
    #: a column the browse index depends on, so an unknown value must be
    #: refused at the boundary rather than silently stored and never matched.
    #:
    #: `allow_blank=True`, and its absence was a bug an organizer could not
    #: work around. The column's own docstring says blank is a legal, distinct
    #: state — "not categorised", as opposed to `other`, which is somebody
    #: choosing none of the eight — but a `ChoiceField` refuses `""` by
    #: default, so the one value the model calls legal was the one value this
    #: field rejected. Deselecting a category (the wizard's "None of these",
    #: or pressing a chosen tile again) sent `category: ""` and got a 400 for a
    #: perfectly ordinary edit; there was no other way to undo the choice, so a
    #: mis-tapped tile stayed on the event permanently.
    category = serializers.ChoiceField(
        choices=EventCategory.choices, required=False, allow_blank=True
    )
    #: `allow_null` is the "remove my label" path: a client sends null to
    #: detach, which is distinct from omitting the field (leave it alone).
    custom_category = serializers.UUIDField(required=False, allow_null=True)
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
    #: The whole list, replaced wholesale — an empty list CLEARS it.
    #:
    #: Wholesale rather than per-row for the same reason a sale-phase schedule
    #: is: these entries have no server identity to preserve, so there is
    #: nothing to diff and no per-row patch to get wrong. The editor holds the
    #: list, the save writes the list.
    policies = EventPolicySerializer(many=True, required=False)
    #: The three bullet lists, same wholesale contract as `policies`.
    highlights_included = HighlightListField(required=False)
    highlights_excluded = HighlightListField(required=False)
    guidelines = HighlightListField(required=False)
    #: A ChoiceField, so an unknown sub-classification is refused at the
    #: boundary rather than stored. `allow_blank` because clearing it back to
    #: "not said" is a legitimate edit.
    event_type = serializers.ChoiceField(
        choices=EventType.choices, required=False, allow_blank=True
    )
    tags = TagListField(required=False)

    _EDITABLE = {
        "title",
        "description",
        "venue",
        "city",
        "category",
        "custom_category",
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
        "policies",
        "highlights_included",
        "highlights_excluded",
        "guidelines",
        "event_type",
        "tags",
    }

    # ── NO `validate_starts_at` HERE, AND ITS ABSENCE IS THE FIX ──────────
    #
    # This serializer used to refuse any `starts_at` that was not in the
    # future, exactly as the create serializer does. On a CREATE that is
    # right: an event that has already happened is not a thing to publish.
    # On an UPDATE it locked organizers out of their own events.
    #
    # `toPatchInput` sends the WHOLE editable surface on every save — it is
    # deliberately not a diff, because a field it omitted would be blanked
    # (see CLAUDE.md, "draftFromEvent is pure and tested because its failure
    # is DATA LOSS"). So every save re-sent `starts_at`, and the moment an
    # event's start time passed, every subsequent PATCH answered 400 with a
    # message about a field the organizer had not touched. Fixing a typo on a
    # running festival, correcting a venue mid-event, adding an FAQ the
    # morning after — all refused, permanently, with no way out.
    #
    # The check is not dropped; it MOVES to `EventService.update_event`,
    # which is the only layer that can see the stored row and can therefore
    # tell "moving the start into the past" (refused) from "this event has
    # already started and is being edited" (allowed).

    def validate(self, attrs: dict) -> dict:
        if not (self._EDITABLE & attrs.keys()):
            raise serializers.ValidationError("Provide at least one field to update.")
        policies = attrs.get("policies")
        if policies is not None and len(policies) > MAX_POLICIES:
            raise serializers.ValidationError(
                {"policies": f"An event can have at most {MAX_POLICIES} policies."}
            )
        # Kept as the CHEAP pre-check for the both-fields-present case, so an
        # obviously inverted window is refused at the boundary without a
        # round trip to the database. It is NOT the guarantee: a PATCH
        # carrying only `ends_at` has nothing here to compare against, which
        # is why the authoritative check runs against the merged row in the
        # service. Same split, and the same reason, as coupons'
        # `validate_terms`.
        starts_at, ends_at = attrs.get("starts_at"), attrs.get("ends_at")
        if starts_at is not None and ends_at is not None and ends_at <= starts_at:
            raise serializers.ValidationError("ends_at must be after starts_at.")
        _validate_coordinate_pair(attrs)
        return attrs


class EventSearchQuerySerializer(serializers.Serializer):
    """Validates the public browse/search query string at the edge."""

    q = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    city = serializers.CharField(required=False, allow_blank=True)
    #: An UNKNOWN category is treated as absent rather than as a 400.
    #:
    #: `ChoiceField` would reject it, and these params come from links people
    #: share and hand-edit — the browse view is already scoped safely, so the
    #: worst an unrecognised value can do is widen the list. A browse page that
    #: 400s because a stale link carries a retired slug is worse than one
    #: showing more results than asked for. Same reasoning as the date filters.
    category = serializers.CharField(required=False, allow_blank=True)
    #: Every publicly-visible event by one organiser — what the event widget's
    #: "More from {organiser}" section asks for. A UUIDField rather than a
    #: CharField because, unlike `category`, a malformed value here is not a
    #: stale slug somebody shared: it is a caller sending the wrong thing, and
    #: silently widening the list to EVERY event under a heading naming one
    #: organiser would attribute other people's events to them.
    organization_id = serializers.UUIDField(required=False)
    #: The sub-classification, and one tag. Both `CharField`, both treated as
    #: ABSENT when unrecognised — the same rule `category` above states, for
    #: the same reason: these arrive in shared and hand-edited links.
    #:
    #: ONE tag rather than a list, deliberately. Several tags is either AND
    #: (which narrows to nothing fast across seven dimensions — "rooftop" and
    #: "beginner-friendly" and "food-included" is a handful of events in the
    #: country) or OR (which is not what a chip row looks like it does). One
    #: tag is honest, indexable and matches how the chips actually read; a
    #: multi-tag mode can be added when there is a UI that means it.
    event_type = serializers.CharField(required=False, allow_blank=True)
    tag = serializers.CharField(required=False, allow_blank=True)
    starts_after = serializers.DateTimeField(required=False)
    starts_before = serializers.DateTimeField(required=False)


class EventCardSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    from_price = serializers.IntegerField(
        source="from_price_minor", read_only=True, allow_null=True
    )
    #: Owned by `apps.reviews` and denormalised onto the event row, so a card
    #: shows "4.6 (128)" without joining or aggregating review rows. `None`
    #: rather than 0.0 when nobody has reviewed — a zero average renders as a
    #: real, terrible score, which is the one thing an unrated event must not
    #: look like.
    rating = serializers.SerializerMethodField()

    def get_rating(self, obj) -> float | None:
        count = obj.rating_count or 0
        return round(obj.rating_sum / count, 1) if count else None

    class Meta:
        model = Event
        fields = [
            "id",
            # The readable half of `/events/{slug}-{id}`. Sent on every payload
            # that a link is built from, so the frontend CONCATENATES rather
            # than re-deriving it — a slug computed independently on both sides
            # eventually disagrees, and a canonical tag that disagrees with the
            # sitemap is an SEO bug nobody notices for months.
            "slug",
            "title",
            "venue",
            "city",
            "category",
            # The sub-classification, so a card can say "Open mic" where the
            # category could only say "Music & dance". Cheap — one varchar on
            # a payload already carrying a poster URL. `tags` is deliberately
            # NOT here: it is a filter, read on the event page, and putting a
            # JSON array on every one of twenty cards buys nothing a chip row
            # would show.
            "event_type",
            "starts_at",
            "poster_url",
            "from_price",
            "tickets_available",
            "organization_id",
            "organization_name",
            "rating",
            "rating_count",
        ]
        read_only_fields = fields


class EventMediaSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.CharField()
    url = serializers.CharField()
    alt_text = serializers.CharField(allow_blank=True)
    caption = serializers.CharField(allow_blank=True)
    position = serializers.IntegerField()
    #: A vertical VIDEO — a YouTube Short. The player draws 9:16 for these
    #: instead of letterboxing them inside a 16:9 frame. Always false for the
    #: image kinds, whose shape comes from `MEDIA_SPECS` at upload.
    is_vertical = serializers.BooleanField()


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
    #: See the note on `EventCardSerializer.rating` — same denormals, same
    #: None-when-unrated rule.
    rating = serializers.SerializerMethodField()

    def get_rating(self, obj) -> float | None:
        count = obj.rating_count or 0
        return round(obj.rating_sum / count, 1) if count else None

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
            # See EventCardSerializer — the frontend concatenates, never derives.
            "slug",
            "organization_id",
            "organization_name",
            "organization_verified",
            "title",
            "description",
            "venue",
            "city",
            "category",
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
            "rating",
            "rating_count",
            "version",
            "created_at",
            # Content fields. Every one is blank/null unless an organizer filled
            # it in, and the frontend omits the row rather than guessing.
            "short_description",
            "duration_minutes",
            "language",
            "age_restriction",
            "accessibility_notes",
            # The organiser's own rules. A list of {title, body}; empty for an
            # event that set none, which the page renders as nothing rather
            # than as a heading with no content under it.
            "policies",
            # The three bullet lists and the taxonomy. Each is empty/blank for
            # an event that set none, and the page omits the section rather
            # than drawing an empty heading.
            "highlights_included",
            "highlights_excluded",
            "guidelines",
            "event_type",
            "tags",
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
            # So the organizer's own table links to the canonical public URL
            # rather than one that redirects.
            "slug",
            "title",
            "city",
            "category",
            "starts_at",
            "status",
            "poster_url",
            "from_price",
            "organization_id",
            "organization_name",
        ]
        read_only_fields = fields


class EventSitemapEntrySerializer(serializers.ModelSerializer):
    """One `/sitemap.xml` row: what to link to, and when it last changed.

    Three columns, deliberately. A sitemap needs a URL and a date; serializing a
    card here would read a poster URL, a price and an organization name only to
    discard them, on the one endpoint whose response is the largest on the
    platform.

    `updated_at` is the point of the endpoint as much as the URL is — the
    frontend's sitemap previously stamped every entry with the build time,
    which tells a crawler nothing about which pages are worth re-fetching.
    """

    class Meta:
        model = Event
        fields = ["id", "slug", "updated_at"]
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


class EventQuestionSerializer(serializers.Serializer):
    """One question, as both the organiser's editor and the checkout read it.

    The SAME serializer for both audiences, because there is nothing private
    here: a question is shown to every buyer by definition. `EventFaq` has the
    same property and shares its serializer the same way.
    """

    id = serializers.UUIDField()
    prompt = serializers.CharField()
    #: Shadows DRF's `Field.help_text`, which is a typing artifact only —
    #: the serializer metaclass moves declared fields into `_declared_fields`,
    #: so nothing is actually overwritten. Same ignore as `label` on
    #: `WriteEventTimelineSerializer`.
    help_text = serializers.CharField(allow_blank=True)  # type: ignore[assignment]
    kind = serializers.CharField()
    #: Empty for every kind except `choice` — see `QuestionKind`.
    choices = serializers.ListField(child=serializers.CharField())
    is_required = serializers.BooleanField()
    position = serializers.IntegerField()


class WriteEventQuestionSerializer(serializers.Serializer):
    prompt = serializers.CharField(max_length=200)
    kind = serializers.ChoiceField(choices=QuestionKind.choices, default=QuestionKind.SHORT_TEXT)
    help_text = serializers.CharField(  # type: ignore[assignment]
        max_length=200, required=False, allow_blank=True, default=""
    )
    #: Validated in the SERVICE rather than here, because the rule is
    #: conditional on `kind` and a serializer that enforced it would have to
    #: re-derive the kind on a PATCH that changes only one of the two.
    choices = serializers.ListField(
        child=serializers.CharField(max_length=100), required=False, default=list
    )
    is_required = serializers.BooleanField(default=False)
    position = serializers.IntegerField(min_value=0, default=0)


class UpdateEventQuestionSerializer(serializers.Serializer):
    prompt = serializers.CharField(max_length=200, required=False)
    kind = serializers.ChoiceField(choices=QuestionKind.choices, required=False)
    help_text = serializers.CharField(  # type: ignore[assignment]
        max_length=200, required=False, allow_blank=True
    )
    choices = serializers.ListField(child=serializers.CharField(max_length=100), required=False)
    is_required = serializers.BooleanField(required=False)
    position = serializers.IntegerField(min_value=0, required=False)

    def validate(self, attrs: dict) -> dict:
        if not attrs:
            raise serializers.ValidationError("Provide at least one field to update.")
        return attrs


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


class EventSlotSerializer(serializers.ModelSerializer):
    """One session, as the ticket panel renders it."""

    class Meta:
        model = EventSlot
        fields = ["id", "label", "starts_at", "ends_at", "position", "is_active"]
        read_only_fields = fields


class CreateEventSlotSerializer(serializers.Serializer):
    """What an organiser supplies to add a session."""

    # `label` shadows DRF `Field.label`, hence the ignore. Renaming the API
    # field would be worse: this IS what an organiser calls the thing, and
    # the shadowing is harmless on a Serializer used only as a request DTO.
    label = serializers.CharField(  # type: ignore[assignment]
        max_length=80, required=False, allow_blank=True, default=""
    )
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    position = serializers.IntegerField(required=False, min_value=0, default=0)

    def validate(self, attrs: dict) -> dict:
        """A slot that ends before it starts is a typo, not a schedule.

        Checked HERE rather than as a DB constraint because `ends_at` is
        nullable and the message an organiser needs ("the end is before the
        start") is a boundary concern, not a storage one.
        """
        ends_at = attrs.get("ends_at")
        if ends_at and ends_at <= attrs["starts_at"]:
            raise serializers.ValidationError(
                {"ends_at": "This slot ends before it starts — check the times."}
            )
        return attrs


class UpdateEventSlotSerializer(serializers.Serializer):
    label = serializers.CharField(  # type: ignore[assignment]
        max_length=80, required=False, allow_blank=True
    )
    starts_at = serializers.DateTimeField(required=False)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    position = serializers.IntegerField(required=False, min_value=0)
    #: Taking a session off sale WITHOUT deleting it. A slot whose tiers have
    #: sold cannot be removed at all, so this is the only honest "cancel".
    is_active = serializers.BooleanField(required=False)


class EventScheduleSerializer(serializers.Serializer):
    """The event's AUTHORITATIVE window, plus the lock token that goes with it.

    ── WHY THIS EXISTS: THE SESSIONS REVERT LOOP ─────────────────────────

    Adding or editing a session re-derives the event's own window from its
    slots (`EventService._sync_event_window`) — the sessions ARE the schedule
    once an event has any. That write goes through `set_window`, which
    deliberately does NOT bump `version`, so that a schedule sync cannot
    invalidate the optimistic-lock token an organiser is holding while they
    edit the description somewhere else.

    The cost of that decision is this endpoint. The wizard holds `starts_at`
    in its local draft and re-sends the WHOLE editable surface on every
    autosave (it is not a diff, on purpose — a field it omitted would be
    blanked). So after a slot write the server's window has moved, the
    draft's has not, the stale version still matches because the sync did not
    bump it, and the next autosave quietly writes the old time back. The
    organiser sees their session save and their schedule revert, with no error
    anywhere — which is exactly the "my change did not save" report.

    A read rather than a change to the sync's locking: bumping `version` there
    would trade this bug for a 409 on every unrelated edit made while a
    session was added, and the sync's own docstring explains why it must not.
    """

    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField(allow_null=True)
    #: The token to send on the NEXT update. Included so a client refreshing
    #: its window after a slot write does not need a second round trip to the
    #: full event detail to stay writable.
    version = serializers.IntegerField()


class OrganizerCategorySerializer(serializers.Serializer):
    """One of an organization's own category labels, on its own screens."""

    id = serializers.UUIDField(read_only=True)
    # `label` collides with an attribute DRF's `Field` already defines, so
    # mypy reads it as a bad override. The wire name is what the picker reads;
    # it stays. Same note as `HomepageCategorySerializer` in apps/cms.
    label = serializers.CharField(max_length=60)  # type: ignore[assignment]
    #: DERIVED from `label` and never accepted from a client — see
    #: `OrganizerCategoryService._slug_for`. A client-set slug would be a
    #: second source of truth for the uniqueness key inside an organization.
    slug = serializers.CharField(read_only=True)
    image_url = serializers.CharField(read_only=True)
    image_alt_text = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(required=False)
    created_at = serializers.DateTimeField(read_only=True)


class CreateOrganizerCategoryRequestSerializer(serializers.Serializer):
    """What an organizer typed. Nothing else.

    No `image_url` here on purpose: the column holds a URL our own storage
    adapter returned, and taking one from a request body would make it an
    arbitrary remote image on a public page — which is the objection
    `cms.Category.icon` records against URLs in the first place. The picture
    arrives through the upload endpoint, which validates the bytes.
    """

    label = serializers.CharField(max_length=60)  # type: ignore[assignment]


class UpdateOrganizerCategoryRequestSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=60, required=False)  # type: ignore[assignment]
    is_active = serializers.BooleanField(required=False)


class OrganizerCategoryImageRequestSerializer(serializers.Serializer):
    file = serializers.FileField()
    #: REQUIRED here although the column allows blank — the `EventMedia
    #: .alt_text` split, for the same reason. The column is permissive so a
    #: backfill survives; the API is strict so no NEW row is created without it.
    alt_text = serializers.CharField(max_length=200)


class CategoryPickerEntrySerializer(serializers.Serializer):
    """One row of the organizer's category picker, global or their own.

    `source` is the field that matters and it is why this is not just a list
    of labels: a `global` row writes to `Event.category` (a closed browse
    facet, indexed, with bundled artwork) and an `organizer` row writes to
    `Event.custom_category` (a foreign key to a private label). A client that
    could not tell them apart would eventually send a custom slug as
    `category` and get a 400 it has no way to explain.

    `id` is null for a global row — there is no table behind it — and
    `image_url` is blank for one, because its illustration ships in the
    frontend bundle keyed on `slug`. See `OrganizerCategoryService.picker`.
    """

    id = serializers.UUIDField(allow_null=True)
    slug = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]
    image_url = serializers.CharField(allow_blank=True)
    image_alt_text = serializers.CharField(allow_blank=True)
    # `source` collides with an attribute DRF's `Field` already defines, so
    # mypy reads it as a bad override — the same note `label` carries here and
    # in apps/cms. The WIRE NAME is what the picker branches on; it stays.
    source = serializers.ChoiceField(choices=["global", "organizer"])  # type: ignore[assignment]
    is_active = serializers.BooleanField()


class CrewMemberSerializer(serializers.Serializer):
    """A roster row, as the organizer's own screens see it."""

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(max_length=120)
    role = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    details = serializers.CharField(required=False, allow_blank=True, default="")
    photo_url = serializers.CharField(read_only=True)
    photo_alt_text = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(required=False)
    created_at = serializers.DateTimeField(read_only=True)


class CreateCrewMemberRequestSerializer(serializers.Serializer):
    """Add somebody to the roster, with their portrait in the SAME request.

    ── WHY THE PHOTO IS OPTIONAL HERE RATHER THAN UPLOAD-ONLY ────────────

    The portrait endpoint (`.../crew/{id}/photo`) needs a member to attach to,
    so a photo could only ever be a SECOND request — which is why the "Add
    crew member" dialog says "A photo attaches to somebody who exists, so it
    appears here the moment you save". That is an honest sentence about a
    two-step flow, and it is still the flow for anyone who wants it: this
    serializer changes nothing about that endpoint.

    What it adds is the one-request path, because "Who's taking the stage" is
    a carousel of FACES — a lineup card with no picture is the section's
    weakest state, and making the picture a separate deliberate step is how it
    ends up skipped.

    NO `photo_url` FIELD, and that is deliberate. `CrewMember.photo_url` holds
    a URL our own storage adapter returned; accepting one from a request body
    would make it an arbitrary remote image on a public event page, bypassing
    the size, allow-list and magic-byte checks in `core.uploads` — which exist
    because an SVG served from our own origin is stored XSS. The bytes come
    through `photo` and nowhere else.
    """

    name = serializers.CharField(max_length=120)
    role = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    details = serializers.CharField(required=False, allow_blank=True, default="")
    photo = serializers.FileField(required=False)
    photo_alt_text = serializers.CharField(max_length=200, required=False, allow_blank=True)

    def validate(self, attrs: dict) -> dict:
        """Alt text is required WITH a photo and meaningless without one.

        The same rule the dedicated upload endpoint enforces, restated here
        because this is now a second door to the same column. Making it
        unconditionally required would refuse every text-only member; leaving
        it optional beside a file would let a portrait onto a public page with
        no description, which is the accessibility failure the split between
        the permissive column and the strict API exists to prevent.
        """
        if attrs.get("photo") is not None and not (attrs.get("photo_alt_text") or "").strip():
            raise serializers.ValidationError(
                {
                    "photo_alt_text": (
                        "Describe the photo — it is read aloud to people who cannot see it."
                    )
                }
            )
        return attrs


class UpdateCrewMemberRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False)
    role = serializers.CharField(max_length=80, required=False, allow_blank=True)
    details = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)


class CrewPhotoRequestSerializer(serializers.Serializer):
    file = serializers.FileField()
    #: REQUIRED here although the column allows blank — the same split
    #: `EventMedia.alt_text` makes. The column is permissive so a backfill
    #: survives; the API is strict so no NEW row is created without it.
    alt_text = serializers.CharField(max_length=200)


class CrewPhotoAltTextRequestSerializer(serializers.Serializer):
    """Correcting the description of a portrait that is already stored.

    Separate from `CrewPhotoRequestSerializer` rather than reusing it with an
    optional `file`: a serializer where every field is optional accepts an
    empty body, and "PATCH with nothing in it" would then read as a successful
    no-op instead of the mistake it is. `alt_text` is required here for the
    same reason it is required on upload.
    """

    alt_text = serializers.CharField(max_length=200)


class EventCrewEntrySerializer(serializers.Serializer):
    """One person on a lineup, flattened for the page that draws them.

    `role` resolves the per-event override HERE rather than in the template, so
    the fallback to the roster's own role lives in exactly one place and the
    public payload and the organizer's picker can never disagree about what
    somebody is billed as.
    """

    id = serializers.UUIDField(source="member_id", read_only=True)
    name = serializers.CharField(source="member.name", read_only=True)
    role = serializers.SerializerMethodField()
    photo_url = serializers.CharField(source="member.photo_url", read_only=True)
    photo_alt_text = serializers.CharField(source="member.photo_alt_text", read_only=True)
    position = serializers.IntegerField(read_only=True)

    def get_role(self, row) -> str:
        return (row.billed_as or row.member.role or "").strip()


class SetEventCrewRequestSerializer(serializers.Serializer):
    """The whole lineup, in order, as a list of roster ids.

    A LIST rather than an add/remove pair, because the control upstream is a
    multi-select: somebody manipulates a set and saves once. Bounded, because
    an authenticated endpoint that loops over whatever it is handed is an
    unbounded write — the same rule `POST /me/saved-events` follows.
    """

    member_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=True, max_length=25
    )


class EventContentSerializer(serializers.Serializer):
    """Everything the event page renders below the fold, in one payload.

    One request rather than three: these are always read together, and three
    round trips before the gallery paints is the difference between fast and
    not.
    """

    media = EventMediaSerializer(many=True)
    faqs = EventFaqSerializer(many=True)
    #: What the organiser needs to know before somebody turns up. On this
    #: payload for the same reason `slots` and `crew` are: already
    #: edge-cached, already invalidated by every content write, so the
    #: checkout renders them without a second round trip. `[]` for the
    #: great majority of events.
    questions = EventQuestionSerializer(many=True)
    timeline = EventTimelineSerializer(many=True)
    #: Who is taking the stage. On this payload for the same reason `slots` is:
    #: it is already edge-cached and already invalidated by every content write,
    #: so it costs one cached document instead of another round trip before the
    #: section can paint. It is `[]` far more often than not, and the frontend
    #: renders the section ABSENT rather than empty in that case.
    crew = EventCrewEntrySerializer(many=True)
    #: The sessions a buyer picks between. On THIS payload rather than an
    #: endpoint of its own because it is already edge-cached and already
    #: invalidated on every content write — one cached document with one
    #: invalidation, instead of a fourth round trip before the ticket panel
    #: can draw. Availability is NOT here: that lives on the uncached
    #: ticket-types read, where a number that must be current belongs.
    slots = EventSlotSerializer(many=True)


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
    #: Whether it is still on sale.
    #:
    #: A saved event that was CANCELLED or has PASSED still shows — hiding it
    #: would look like the save was lost, and a called-off show is exactly the
    #: thing somebody needs to be told about — but the card says so rather than
    #: offering a dead "Book" button.
    #:
    #: An event that is no longer publicly visible at all (soft-deleted,
    #: unpublished, withdrawn by moderation) never reaches this serializer:
    #: `SavedEventRepository.list_cards` filters those out, because a card
    #: linking to a page that 404s is worse than no card. This flag labels
    #: what is visible-but-unbuyable, not what is gone.
    is_available = serializers.SerializerMethodField()

    def get_is_available(self, row) -> bool:
        event = row.event
        return event.status == EventStatus.LIVE and event.deleted_at is None


class WaitlistEntrySerializer(serializers.Serializer):
    """One row of the account's own waiting list, flattened to a card.

    Deliberately NOT the same shape as `SavedEventSerializer`, though it is the
    sibling: a save is a bookmark, so its card is the browse card. A waitlist
    row carries two facts a bookmark does not — WHEN you joined, and whether we
    have already written to you — and those are the whole state of the thing.
    """

    joined_at = serializers.DateTimeField(source="created_at")
    #: Null while waiting. Set once, when we told them tickets came back — a
    #: person is written to about an event exactly once, which is what the
    #: message itself promises.
    notified_at = serializers.DateTimeField(allow_null=True)
    id = serializers.CharField(source="event.id")
    title = serializers.CharField(source="event.title")
    slug = serializers.CharField(source="event.slug")
    venue = serializers.CharField(source="event.venue")
    city = serializers.CharField(source="event.city")
    starts_at = serializers.DateTimeField(source="event.starts_at")
    poster_url = serializers.CharField(source="event.poster_url")
    tickets_available = serializers.IntegerField(source="event.tickets_available", allow_null=True)
    #: Whether the event is still on sale at all. A waiting list for a show
    #: that was CALLED OFF still shows, carrying `false` — hiding it would look
    #: like the join was lost, and a cancelled show is precisely the thing
    #: somebody waiting needs to be told about.
    is_available = serializers.SerializerMethodField()

    def get_is_available(self, row) -> bool:
        event = row.event
        return event.status == EventStatus.LIVE and event.deleted_at is None


class WaitlistStateSerializer(serializers.Serializer):
    """The answer to "am I on it", and the whole set for the client to hold.

    `event_ids` mirrors `SavedIdsSerializer`: the client REPLACES its local set
    from this rather than reconciling, so a join, a leave and a sign-in all
    settle to the same shape.
    """

    joined = serializers.BooleanField()
    event_ids = serializers.ListField(child=serializers.CharField())
