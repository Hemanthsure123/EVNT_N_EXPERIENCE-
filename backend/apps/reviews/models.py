"""Post-event reviews.

── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────

A review is about an EVENT, so `apps/events` looks like its home — but
eligibility is a fact about a BOOKING, and `events` must not import `booking`:
dependencies point booking → events, never back. Putting it in `booking` is no
better; a review is not a booking.

So `reviews` sits above both and imports downward from each, which is exactly
what `console` does for the same reason. Nothing depends on it.

── ONE REVIEW PER PERSON PER EVENT, ENFORCED BY THE DATABASE ─────────────

The unique constraint is the real guard. A check-then-insert leaves a window
two concurrent submissions both pass, which is how a double-tapped Submit
becomes two reviews and two increments of the rating counter. Same reasoning
as `performers`' one-quote-per-request rule.

── THE BOOKING IS RECORDED ON THE ROW ────────────────────────────────────

`booking` is stored, not just checked. It is what made the review admissible,
and keeping it means a later question — "was this reviewer actually scanned
in?", "was this booking refunded after the review was written?" — is answerable
without re-deriving eligibility from scratch against rules that may have moved.
It is also what makes the verified-attendee badge cheap.

── STATUS IS FOR MODERATION, AND IT IS WHAT THE COUNTERS COUNT ───────────

`published` reviews are the ones the public sees and the ONLY ones counted in
`Event.rating_sum` / `rating_count`. Hiding a review therefore has to decrement
those counters, which is why moderation goes through the service rather than
the admin toggling a field.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models

#: Long enough for a considered paragraph, short enough that the column is not
#: a place to paste an essay. Mirrored in the serializer and the textarea.
BODY_MAX = 2000

#: The scale. Five stars, because every platform researched uses five and a
#: reviewer's intuition for "4 out of 5" does not transfer to a 10-point scale.
MIN_RATING = 1
MAX_RATING = 5


class ReviewStatus(models.TextChoices):
    PUBLISHED = "published", "Published"
    #: Removed by an operator. Kept rather than deleted: the row is the record
    #: that this person already reviewed this event, and deleting it would let
    #: somebody post abuse, have it removed, and immediately post it again.
    HIDDEN = "hidden", "Hidden"


class EventReview(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey("events.Event", on_delete=models.CASCADE, related_name="reviews")
    # PROTECT, like `Booking.user`: a review is content attributed to a person
    # and an account with reviews should not vanish out from under them.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="event_reviews"
    )
    # The booking that made this admissible. SET_NULL rather than CASCADE — a
    # booking is PROTECTed and will not be deleted, but if that ever changed,
    # losing the review with it would be the wrong trade.
    booking = models.ForeignKey(
        "booking.Booking", on_delete=models.SET_NULL, null=True, related_name="reviews"
    )
    rating = models.PositiveSmallIntegerField()
    #: Optional. A rating alone is a complete review — insisting on prose is
    #: how a 5-star experience becomes no review at all.
    body = models.TextField(blank=True, default="", max_length=BODY_MAX)
    #: Whether any ticket on the booking was actually SCANNED at the gate.
    #: Frozen at write time from `Ticket.status == used`, not recomputed: it
    #: is a statement about the night in question, and a ticket voided by a
    #: later refund should not retroactively unverify a review.
    #:
    #: This is stronger than what the platforms researched can offer —
    #: Eventbrite asks attendees to "confirm attendance" themselves — because
    #: this system holds the actual scan.
    verified_attendee = models.BooleanField(default=False)
    status = models.CharField(
        max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.PUBLISHED
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "reviews"
        db_table = "event_review"
        ordering = ["-created_at", "-id"]
        constraints = [
            # THE duplicate guard. Not a service check — two concurrent
            # submissions both pass a check-then-insert, and each would
            # increment the event's rating counters.
            models.UniqueConstraint(fields=["event", "user"], name="one_review_per_event_per_user"),
            # A rating outside 1-5 corrupts every average derived from it, and
            # a serializer is not the last line of defence.
            models.CheckConstraint(
                check=models.Q(rating__gte=MIN_RATING) & models.Q(rating__lte=MAX_RATING),
                name="review_rating_within_scale",
            ),
        ]
        indexes = [
            # The public list: WHERE event=? AND status='published'
            # ORDER BY created_at DESC. Exactly this query, exactly this order,
            # so the cursor paginator's keyset walks the index.
            models.Index(fields=["event", "status", "-created_at"], name="review_event_recent_idx"),
            # The distribution: GROUP BY rating for one event's published rows.
            models.Index(fields=["event", "status", "rating"], name="review_event_rating_idx"),
            # "Has this person already reviewed?" — asked once per pending-review
            # candidate, so it must not be a scan of the user's whole history.
            models.Index(fields=["user", "event"], name="review_user_event_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - admin convenience
        return f"{self.rating}★ {self.event_id} by {self.user_id}"
