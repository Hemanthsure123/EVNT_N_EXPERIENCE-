"""Boundary DTOs for reviews."""

from __future__ import annotations

from rest_framework import serializers

from .models import BODY_MAX, MAX_RATING, MIN_RATING, EventReview


def display_name(full_name: str) -> str:
    """ "Hemanth Sure" -> "Hemanth S." — the public identity of a reviewer.

    ── THE PRIVACY MODEL, AND WHY IT IS THIS ONE ─────────────────────────────

    A review is public and permanent, and it is attached to somebody who bought
    a ticket rather than to a pseudonym they chose. Publishing a full legal
    name against a night out is more exposure than anyone opted into by
    booking; publishing nothing makes every review read as anonymous and worth
    less. First name plus a surname initial is where the platforms researched
    settle, and it is enough for a reader to tell two reviewers apart.

    The email NEVER appears — it is not in the serializer and not in the
    repository's field set, so it cannot be added back by accident.
    """
    parts = [part for part in (full_name or "").strip().split() if part]
    if not parts:
        return "Curatix guest"
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}."


class ReviewSerializer(serializers.ModelSerializer):
    author = serializers.SerializerMethodField()
    #: Surfaced so the UI can mark an edited review honestly rather than
    #: presenting a changed opinion as the original one.
    edited = serializers.SerializerMethodField()

    class Meta:
        model = EventReview
        fields = ["id", "rating", "body", "verified_attendee", "author", "edited", "created_at"]
        read_only_fields = fields

    def get_author(self, obj: EventReview) -> str:
        return display_name(getattr(obj.user, "full_name", ""))

    def get_edited(self, obj: EventReview) -> bool:
        # A second of slack: `auto_now_add` and `auto_now` are two separate
        # `timezone.now()` calls on the same INSERT, so they differ by
        # microseconds on every freshly created row.
        return (obj.updated_at - obj.created_at).total_seconds() > 1


class ReviewSummarySerializer(serializers.Serializer):
    average = serializers.FloatField()
    count = serializers.IntegerField()
    distribution = serializers.DictField(child=serializers.IntegerField())


class SubmitReviewRequestSerializer(serializers.Serializer):
    rating = serializers.IntegerField(min_value=MIN_RATING, max_value=MAX_RATING)
    #: Optional, and that is deliberate: a rating alone is a complete review.
    #: Requiring prose is how a five-star night becomes no review at all.
    body = serializers.CharField(required=False, allow_blank=True, max_length=BODY_MAX)


class EligibilitySerializer(serializers.Serializer):
    allowed = serializers.BooleanField()
    #: Machine-readable, because "not eligible" has five different right
    #: answers on screen. The message is chosen by the client from the code.
    reason = serializers.CharField(allow_blank=True)
    verified_attendee = serializers.BooleanField()


class PendingReviewSerializer(serializers.Serializer):
    event_id = serializers.CharField()
    booking_id = serializers.CharField()
    title = serializers.CharField()
    poster_url = serializers.CharField(allow_blank=True)
    starts_at = serializers.DateTimeField()
    ended_at = serializers.DateTimeField()
    venue = serializers.CharField()
    city = serializers.CharField()


class ModerationRequestSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[("published", "Published"), ("hidden", "Hidden")])
