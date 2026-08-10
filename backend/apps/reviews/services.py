"""Review business rules: who may review, and keeping the counters true."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.booking.models import Booking, BookingStatus, Ticket, TicketStatus
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from core.errors import ConflictError, InvalidInputError, NotFoundError
from core.unit_of_work import UnitOfWork

from .models import BODY_MAX, MAX_RATING, MIN_RATING, EventReview, ReviewStatus
from .repositories import ReviewRepository

#: How long after an event ends somebody may still review it.
#:
#: Not unbounded, and not a dark pattern either way. Research on post-event
#: feedback is consistent that response quality and rate both fall off sharply
#: with delay — Eventbrite's own guidance puts the useful window at hours, not
#: months. A review written ninety days later is recollection rather than
#: experience, and an app that asks for one is asking about something the
#: person has forgotten.
#:
#: 30 days is generous against that evidence while still closing the window,
#: which matters because an open one means the prompt list grows forever.
REVIEW_WINDOW_DAYS = 30

#: A short settle before asking. Somebody is still at the venue, in a taxi, or
#: has just walked out — a prompt that fires the minute the doors close reads
#: as the app watching them.
REVIEW_DELAY_HOURS = 2


@dataclass(frozen=True)
class PendingReview:
    """One event this person could review but has not.

    A value object rather than a model: nothing is stored when a review is
    merely POSSIBLE. Deriving it keeps the state machine at one table instead
    of two that can disagree.
    """

    event_id: str
    booking_id: str
    title: str
    poster_url: str
    starts_at: object
    ended_at: object
    venue: str
    city: str


@dataclass(frozen=True)
class Eligibility:
    """Whether this person may review, and why not when they may not.

    `reason` is a machine-readable code the frontend switches on, because
    "not eligible" has five different right answers on screen: the event has
    not happened, it was cancelled, you did not go, your booking was refunded,
    or you have already reviewed.
    """

    allowed: bool
    reason: str = ""
    booking: Booking | None = None
    verified_attendee: bool = False


class ReviewService:
    """Constructed with its dependencies, like every other service here."""

    def __init__(self, *, reviews: ReviewRepository, events: EventRepository) -> None:
        self._reviews = reviews
        self._events = events

    # ── Eligibility ────────────────────────────────────────────────────────

    def check_eligibility(
        self, *, event_id: uuid.UUID | str, user_id: uuid.UUID | str
    ) -> Eligibility:
        """The single source of truth for who may review.

        ── WHY EACH RULE IS HERE ──────────────────────────────────────────────

        Modelled on Eventbrite's, which requires "a valid, paid ticket" and
        confirmed attendance, and tightened where this platform can do better.

        1. **The event happened.** Reviewing something that has not started is
           reviewing an expectation. `ends_at` when the organiser set one,
           otherwise `starts_at` — an event with no end time is over once it
           has begun, and treating a missing `ends_at` as "never ends" would
           silently make every such event unreviewable forever.
        2. **It was not cancelled.** A cancelled event was not attended by
           anybody, and star ratings on it would describe a refund, not a show.
        3. **A PAID booking.** `reserved` is an unpaid hold; `cancelled` and
           `expired` never became a ticket. This is the "valid, paid ticket"
           rule, read off the booking rather than asserted by the browser.
        4. **Not refunded away.** A booking whose tickets were all VOIDED is a
           refund — `payments.execute_refund` voids them in the same
           transaction as the refund record. Somebody who got their money back
           did not have the experience they would be rating.
        5. **Not already reviewed.** The database enforces this too; deciding
           it here is what lets the UI say so instead of showing a form that
           will 409.

        The window is checked LAST among the time rules so a late arrival is
        told "too late", not "not yet".
        """
        event = (
            Event.objects.filter(id=event_id).only("id", "status", "starts_at", "ends_at").first()
        )
        if event is None:
            raise NotFoundError("That event does not exist.")

        if event.status == EventStatus.CANCELLED:
            return Eligibility(False, "event_cancelled")

        finished_at = event.ends_at or event.starts_at
        now = timezone.now()
        if now < finished_at + timedelta(hours=REVIEW_DELAY_HOURS):
            return Eligibility(False, "event_not_finished")
        if now > finished_at + timedelta(days=REVIEW_WINDOW_DAYS):
            return Eligibility(False, "window_closed")

        booking = (
            Booking.objects.filter(event_id=event_id, user_id=user_id, status=BookingStatus.PAID)
            .order_by("created_at")
            .first()
        )
        if booking is None:
            return Eligibility(False, "did_not_attend")

        # A refund voids every still-active ticket on the booking, so "no
        # ticket survives" IS the refund test — and it reads the same column
        # check-in reads, rather than duplicating payments' refund logic here.
        live = Ticket.objects.filter(booking=booking).exclude(status=TicketStatus.VOID)
        if not live.exists():
            return Eligibility(False, "booking_refunded")

        if self._reviews.get_for_user(event_id=event_id, user_id=user_id) is not None:
            return Eligibility(False, "already_reviewed", booking=booking)

        # The badge. True only if a ticket was actually SCANNED — which this
        # platform knows and most cannot, because `checkin` writes it.
        scanned = Ticket.objects.filter(booking=booking, status=TicketStatus.USED).exists()
        return Eligibility(True, "", booking=booking, verified_attendee=scanned)

    # ── Writing ────────────────────────────────────────────────────────────

    def submit(
        self,
        *,
        event_id: uuid.UUID | str,
        user_id: uuid.UUID | str,
        rating: int,
        body: str = "",
    ) -> EventReview:
        """Create this person's review. Eligibility is re-checked here.

        The endpoint checks nothing — this does, because a rule enforced only
        at the boundary is a rule a second caller does not have.
        """
        if rating < MIN_RATING or rating > MAX_RATING:
            raise InvalidInputError(f"A rating has to be between {MIN_RATING} and {MAX_RATING}.")
        text = (body or "").strip()[:BODY_MAX]

        eligibility = self.check_eligibility(event_id=event_id, user_id=user_id)
        if not eligibility.allowed:
            if eligibility.reason == "already_reviewed":
                raise ConflictError("You have already reviewed this event.")
            raise InvalidInputError(_REFUSALS[eligibility.reason])

        try:
            with UnitOfWork():
                review = self._reviews.create(
                    event_id=event_id,
                    user_id=user_id,
                    booking=eligibility.booking,
                    rating=rating,
                    body=text,
                    verified_attendee=eligibility.verified_attendee,
                )
                # In the SAME transaction as the row. A counter updated after
                # the commit can be lost to a crash and drift permanently, and
                # nothing would ever notice — an average is not a number
                # anybody audits.
                self._events.apply_rating_delta(event_id=event_id, sum_delta=rating, count_delta=1)
        except IntegrityError as error:
            # The concurrent duplicate the unique constraint caught. The check
            # above passed for both requests; this is the one that decides.
            raise ConflictError("You have already reviewed this event.") from error

        _invalidate(event_id)
        return review

    def update(
        self,
        *,
        event_id: uuid.UUID | str,
        user_id: uuid.UUID | str,
        rating: int,
        body: str = "",
    ) -> EventReview:
        """Change your own review.

        ── WHY EDITING IS ALLOWED WHEN MEETUP FORBIDS IT ─────────────────────

        Meetup makes feedback permanent once submitted. That is defensible for
        a system where the rating is mostly private to organisers; ours is
        public and attached to a name. The common failure on a five-star row
        is a mis-tapped star, and making that permanent produces a number that
        is wrong forever rather than a considered one.

        The counter maths is the same code path as create, so allowing it costs
        nothing in correctness: the delta is `new - old` with the count
        unchanged.
        """
        if rating < MIN_RATING or rating > MAX_RATING:
            raise InvalidInputError(f"A rating has to be between {MIN_RATING} and {MAX_RATING}.")

        existing = self._reviews.get_for_user(event_id=event_id, user_id=user_id)
        if existing is None:
            raise NotFoundError("You have not reviewed this event.")
        if existing.status == ReviewStatus.HIDDEN:
            # Editing would not republish it, so the form would be a control
            # whose only effect is invisible. Say so instead.
            raise ConflictError("This review was removed by our team and cannot be edited.")

        previous = existing.rating
        with UnitOfWork():
            existing.rating = rating
            existing.body = (body or "").strip()[:BODY_MAX]
            existing.save(update_fields=["rating", "body", "updated_at"])
            if rating != previous:
                self._events.apply_rating_delta(
                    event_id=event_id, sum_delta=rating - previous, count_delta=0
                )
        _invalidate(event_id)
        return existing

    # ── Moderation ─────────────────────────────────────────────────────────

    def set_moderation(self, *, review_id: uuid.UUID | str, status: str) -> EventReview:
        """Hide or restore a review, keeping the counters honest.

        Goes through the service rather than an admin field toggle precisely
        because of the counters: `Event.rating_sum` counts PUBLISHED reviews
        only, so hiding one has to subtract it. A staff member editing the
        column in Django admin would silently corrupt every average on that
        event, which is the strongest argument for this method existing.
        """
        if status not in {ReviewStatus.PUBLISHED, ReviewStatus.HIDDEN}:
            raise InvalidInputError("A review is either published or hidden.")

        review = self._reviews.get(review_id)
        if review is None:
            raise NotFoundError("That review does not exist.")

        with UnitOfWork():
            # Conditional, and the row count is the decision: pressing Hide
            # twice must not subtract the rating twice.
            changed = self._reviews.set_status(review_id=review_id, status=status)
            if changed:
                sign = -1 if status == ReviewStatus.HIDDEN else 1
                self._events.apply_rating_delta(
                    event_id=review.event_id,
                    sum_delta=sign * review.rating,
                    count_delta=sign,
                )
        _invalidate(review.event_id)
        review.refresh_from_db()
        return review

    # ── Reading ────────────────────────────────────────────────────────────

    def pending_for_user(self, *, user_id: uuid.UUID | str, limit: int = 20) -> list[PendingReview]:
        """Events this person attended, has not reviewed, and still can.

        ── WHY THIS IS DERIVED AND NOT A TABLE ───────────────────────────────

        A `PendingReview` row would need creating when an event ends, deleting
        when a review lands, and reconciling when a booking is refunded — three
        writes and a scheduled job to keep a fact that is one query away. The
        booking rows already say everything: paid, for an event that has
        finished, not yet reviewed.

        Bounded on both sides. The window keeps the list from growing forever,
        and `limit` keeps one query from returning a decade of attendance.
        """
        now = timezone.now()
        candidates = list(
            Booking.objects.filter(
                user_id=user_id,
                status=BookingStatus.PAID,
                event__status__in=[EventStatus.LIVE, EventStatus.FINISHED],
            )
            .select_related("event")
            .only(
                "id",
                "event__id",
                "event__title",
                "event__poster_url",
                "event__starts_at",
                "event__ends_at",
                "event__venue",
                "event__city",
            )
            .order_by("-created_at")[: limit * 3]
        )

        # Narrowed in Python only after the DB has done the selective work: the
        # window depends on `COALESCE(ends_at, starts_at)`, which is not what
        # any existing index is on, and the candidate set here is already
        # bounded to a few rows per user.
        in_window = []
        for booking in candidates:
            finished_at = booking.event.ends_at or booking.event.starts_at
            if now < finished_at + timedelta(hours=REVIEW_DELAY_HOURS):
                continue
            if now > finished_at + timedelta(days=REVIEW_WINDOW_DAYS):
                continue
            in_window.append((booking, finished_at))

        # ── THE PROMPT LIST AND THE ELIGIBILITY CHECK MUST AGREE ────────
        # Without this the two disagreed, and a test caught it: a REFUNDED
        # booking was still prompted, so somebody would be asked to review an
        # event and then refused when they tried. A prompt that leads to a
        # refusal is worse than no prompt.
        #
        # One query for the whole candidate set rather than an `exists()` per
        # booking — the prompt endpoint runs on app open.
        refunded = set()
        if in_window:
            booking_ids = [b.id for b, _ in in_window]
            with_live = set(
                Ticket.objects.filter(booking_id__in=booking_ids)
                .exclude(status=TicketStatus.VOID)
                .values_list("booking_id", flat=True)
            )
            refunded = {b.id for b, _ in in_window if b.id not in with_live}
        in_window = [(b, f) for b, f in in_window if b.id not in refunded]

        already = self._reviews.reviewed_event_ids(
            user_id=user_id, event_ids=[b.event_id for b, _ in in_window]
        )
        return [
            PendingReview(
                event_id=str(booking.event_id),
                booking_id=str(booking.id),
                title=booking.event.title,
                poster_url=booking.event.poster_url or "",
                starts_at=booking.event.starts_at,
                ended_at=finished_at,
                venue=booking.event.venue,
                city=booking.event.city,
            )
            for booking, finished_at in in_window
            if str(booking.event_id) not in already
        ][:limit]


#: What each refusal says to the person who hit it. One sentence, naming the
#: thing they can act on — "not eligible" tells somebody nothing about whether
#: to wait, complain, or forget it.
_REFUSALS = {
    "event_cancelled": "This event was cancelled, so there is nothing to review.",
    "event_not_finished": "This event has not finished yet.",
    "window_closed": f"Reviews close {REVIEW_WINDOW_DAYS} days after an event.",
    "did_not_attend": "Only people who booked this event can review it.",
    "booking_refunded": "Your booking for this event was refunded.",
}


def _invalidate(event_id: uuid.UUID | str) -> None:
    """Drop the event's public caches so a new rating shows up.

    In `on_commit`, never before it — a concurrent reader would otherwise
    repopulate the cache with the pre-write average in the window before the
    write lands, which is the invalidation rule the whole codebase follows.
    """
    from apps.events.selectors import invalidate_event_caches

    from .selectors import invalidate_review_summary

    def drop() -> None:
        # BOTH: the event's own detail/list caches carry the denormalised
        # average, and the review summary is its own key. Dropping one and not
        # the other is how a page shows 4.6 beside a distribution adding up to
        # a different number.
        invalidate_event_caches(event_id)
        invalidate_review_summary(event_id)

    transaction.on_commit(drop)
