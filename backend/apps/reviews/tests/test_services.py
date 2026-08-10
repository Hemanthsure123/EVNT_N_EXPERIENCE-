"""Who may review, and whether the counters stay true.

Those are the two things worth testing here. Everything else is serialization.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.models import BookingStatus, Ticket, TicketStatus
from apps.events.models import Event, EventStatus
from apps.reviews.models import EventReview, ReviewStatus
from apps.reviews.selectors import get_review_summary
from apps.reviews.services import REVIEW_WINDOW_DAYS
from core.errors import ConflictError, InvalidInputError, NotFoundError

pytestmark = pytest.mark.django_db


def rating_of(event: Event) -> tuple[int, int]:
    event.refresh_from_db()
    return event.rating_sum, event.rating_count


class TestEligibility:
    def test_somebody_who_booked_and_attended_may_review(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        result = review_service.check_eligibility(event_id=event.id, user_id=attendee.id)
        assert result.allowed

    def test_somebody_who_never_booked_may_not(
        self, review_service, make_event, make_booking, attendee, stranger
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        result = review_service.check_eligibility(event_id=event.id, user_id=stranger.id)
        assert (result.allowed, result.reason) == (False, "did_not_attend")

    def test_an_unpaid_hold_is_not_attendance(
        self, review_service, make_event, make_booking, attendee
    ):
        # A `reserved` booking is somebody who got as far as the checkout page.
        event = make_event()
        make_booking(event=event, user=attendee, status=BookingStatus.RESERVED)
        result = review_service.check_eligibility(event_id=event.id, user_id=attendee.id)
        assert result.reason == "did_not_attend"

    def test_a_refunded_booking_loses_eligibility(
        self, review_service, make_event, make_booking, attendee
    ):
        # A refund VOIDS the tickets in the same transaction as the refund
        # record, so no live ticket IS the refund test.
        event = make_event()
        make_booking(event=event, user=attendee, ticket_status=TicketStatus.VOID)
        result = review_service.check_eligibility(event_id=event.id, user_id=attendee.id)
        assert result.reason == "booking_refunded"

    def test_an_event_that_has_not_finished_cannot_be_reviewed(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event(ended_hours_ago=-48)  # starts in the future
        make_booking(event=event, user=attendee)
        result = review_service.check_eligibility(event_id=event.id, user_id=attendee.id)
        assert result.reason == "event_not_finished"

    def test_the_settle_period_holds_the_prompt_back(
        self, review_service, make_event, make_booking, attendee
    ):
        # Doors closed thirty minutes ago. Asking now reads as the app watching
        # somebody walk out of the venue.
        event = make_event(ended_hours_ago=0)
        event.ends_at = timezone.now() - timedelta(minutes=30)
        event.save(update_fields=["ends_at"])
        make_booking(event=event, user=attendee)
        result = review_service.check_eligibility(event_id=event.id, user_id=attendee.id)
        assert result.reason == "event_not_finished"

    def test_the_window_closes(self, review_service, make_event, make_booking, attendee):
        event = make_event(ended_hours_ago=24 * (REVIEW_WINDOW_DAYS + 2))
        make_booking(event=event, user=attendee)
        result = review_service.check_eligibility(event_id=event.id, user_id=attendee.id)
        assert result.reason == "window_closed"

    def test_a_cancelled_event_cannot_be_rated(
        self, review_service, make_event, make_booking, attendee
    ):
        # Stars on a cancelled event would describe a refund, not a show.
        event = make_event(status=EventStatus.CANCELLED)
        make_booking(event=event, user=attendee)
        result = review_service.check_eligibility(event_id=event.id, user_id=attendee.id)
        assert result.reason == "event_cancelled"

    def test_a_missing_ends_at_uses_starts_at_rather_than_never_ending(
        self, review_service, make_event, make_booking, attendee
    ):
        # `ends_at` is nullable. Treating null as "no end" would make every
        # such event permanently unreviewable, silently.
        event = make_event()
        event.ends_at = None
        event.save(update_fields=["ends_at"])
        make_booking(event=event, user=attendee)
        assert review_service.check_eligibility(event_id=event.id, user_id=attendee.id).allowed

    def test_a_scanned_ticket_earns_the_verified_badge(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee, ticket_status=TicketStatus.USED)
        result = review_service.check_eligibility(event_id=event.id, user_id=attendee.id)
        assert result.allowed and result.verified_attendee

    def test_an_unscanned_ticket_does_not(self, review_service, make_event, make_booking, attendee):
        # The badge means "we scanned them in", so it must not be handed to
        # everybody who merely holds a ticket.
        event = make_event()
        make_booking(event=event, user=attendee)
        result = review_service.check_eligibility(event_id=event.id, user_id=attendee.id)
        assert result.allowed and not result.verified_attendee

    def test_an_unknown_event_is_not_found(self, review_service, attendee):
        import uuid as _uuid

        with pytest.raises(NotFoundError):
            review_service.check_eligibility(event_id=_uuid.uuid4(), user_id=attendee.id)


class TestSubmitting:
    def test_submitting_stores_the_review_and_moves_the_counters(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(
            event_id=event.id, user_id=attendee.id, rating=4, body="  Great sound.  "
        )
        assert review.rating == 4
        assert review.body == "Great sound."  # trimmed
        assert rating_of(event) == (4, 1)

    def test_an_ineligible_submission_is_refused_by_the_SERVICE(
        self, review_service, make_event, stranger
    ):
        # The endpoint checks nothing. A rule enforced only at the boundary is
        # a rule the next caller does not have.
        event = make_event()
        with pytest.raises(InvalidInputError):
            review_service.submit(event_id=event.id, user_id=stranger.id, rating=5)
        assert rating_of(event) == (0, 0)

    def test_a_second_review_is_a_conflict_and_does_not_double_count(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        review_service.submit(event_id=event.id, user_id=attendee.id, rating=5)
        with pytest.raises(ConflictError):
            review_service.submit(event_id=event.id, user_id=attendee.id, rating=1)
        assert rating_of(event) == (5, 1)

    def test_a_rating_outside_the_scale_is_refused(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        for bad in (0, 6, -1):
            with pytest.raises(InvalidInputError):
                review_service.submit(event_id=event.id, user_id=attendee.id, rating=bad)

    def test_the_database_refuses_an_out_of_scale_rating_even_past_the_service(
        self, make_event, make_booking, attendee
    ):
        """The CheckConstraint, proved rather than assumed.

        Validation in a serializer and a service is two layers of the same
        kind; this is the one that survives a direct ORM write, a data
        migration, or a future second writer.
        """
        from django.db.utils import IntegrityError

        event = make_event()
        booking = make_booking(event=event, user=attendee)
        with pytest.raises(IntegrityError):
            EventReview.objects.create(event=event, user=attendee, booking=booking, rating=9)

    def test_body_is_optional_because_a_rating_alone_is_a_review(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=5)
        assert review.body == ""


class TestEditing:
    def test_editing_adjusts_the_sum_and_leaves_the_count(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        review_service.submit(event_id=event.id, user_id=attendee.id, rating=2)
        review_service.update(event_id=event.id, user_id=attendee.id, rating=5, body="Better.")
        assert rating_of(event) == (5, 1)

    def test_editing_only_the_text_does_not_touch_the_counters(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        review_service.submit(event_id=event.id, user_id=attendee.id, rating=3)
        review_service.update(event_id=event.id, user_id=attendee.id, rating=3, body="More detail.")
        assert rating_of(event) == (3, 1)

    def test_editing_a_review_you_never_wrote_is_not_found(
        self, review_service, make_event, attendee
    ):
        event = make_event()
        with pytest.raises(NotFoundError):
            review_service.update(event_id=event.id, user_id=attendee.id, rating=5)


class TestModeration:
    def test_hiding_removes_it_from_the_average(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=1)
        review_service.set_moderation(review_id=review.id, status=ReviewStatus.HIDDEN)
        assert rating_of(event) == (0, 0)

    def test_hiding_twice_does_not_subtract_twice(
        self, review_service, make_event, make_booking, attendee
    ):
        """The conditional UPDATE, and why the row count is the decision.

        An unconditional write would report success for a no-op and the
        counters would drift by one every time an operator pressed Hide twice.
        """
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=4)
        review_service.set_moderation(review_id=review.id, status=ReviewStatus.HIDDEN)
        review_service.set_moderation(review_id=review.id, status=ReviewStatus.HIDDEN)
        assert rating_of(event) == (0, 0)

    def test_restoring_puts_it_back(self, review_service, make_event, make_booking, attendee):
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=4)
        review_service.set_moderation(review_id=review.id, status=ReviewStatus.HIDDEN)
        review_service.set_moderation(review_id=review.id, status=ReviewStatus.PUBLISHED)
        assert rating_of(event) == (4, 1)

    def test_a_hidden_review_still_blocks_a_second_one(
        self, review_service, make_event, make_booking, attendee
    ):
        # Otherwise: post abuse, get it removed, post it again.
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=1)
        review_service.set_moderation(review_id=review.id, status=ReviewStatus.HIDDEN)
        with pytest.raises(ConflictError):
            review_service.submit(event_id=event.id, user_id=attendee.id, rating=5)

    def test_a_hidden_review_cannot_be_edited_back_into_view(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=1)
        review_service.set_moderation(review_id=review.id, status=ReviewStatus.HIDDEN)
        with pytest.raises(ConflictError):
            review_service.update(event_id=event.id, user_id=attendee.id, rating=5)


class TestSummary:
    def test_an_unrated_event_reports_zero_rather_than_dividing_by_it(self, make_event):
        event = make_event()
        summary = get_review_summary(event.id)
        assert (summary.average, summary.count) == (0.0, 0)
        # Every star present, zeros included: a chart handed only the stars
        # that occurred draws missing bars.
        assert sorted(summary.distribution) == [1, 2, 3, 4, 5]

    def test_the_average_and_distribution_agree(
        self, review_service, make_event, make_booking, attendee, stranger
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        make_booking(event=event, user=stranger)
        review_service.submit(event_id=event.id, user_id=attendee.id, rating=5)
        review_service.submit(event_id=event.id, user_id=stranger.id, rating=4)
        summary = get_review_summary(event.id)
        assert (summary.average, summary.count) == (4.5, 2)
        assert summary.distribution[5] == 1 and summary.distribution[4] == 1

    def test_a_hidden_review_leaves_the_distribution_too(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        make_booking(event=event, user=attendee)
        review = review_service.submit(event_id=event.id, user_id=attendee.id, rating=1)
        review_service.set_moderation(review_id=review.id, status=ReviewStatus.HIDDEN)
        summary = get_review_summary(event.id)
        assert summary.count == 0 and summary.distribution[1] == 0


class TestPendingPrompts:
    def test_an_attended_event_appears(self, review_service, make_event, make_booking, attendee):
        event = make_event()
        make_booking(event=event, user=attendee)
        pending = review_service.pending_for_user(user_id=attendee.id)
        assert [row.event_id for row in pending] == [str(event.id)]

    def test_it_disappears_once_reviewed(self, review_service, make_event, make_booking, attendee):
        # The whole point: nobody is asked twice.
        event = make_event()
        make_booking(event=event, user=attendee)
        review_service.submit(event_id=event.id, user_id=attendee.id, rating=5)
        assert review_service.pending_for_user(user_id=attendee.id) == []

    def test_an_event_still_to_come_is_not_pending(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event(ended_hours_ago=-48)
        make_booking(event=event, user=attendee)
        assert review_service.pending_for_user(user_id=attendee.id) == []

    def test_an_event_past_the_window_is_not_pending(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event(ended_hours_ago=24 * (REVIEW_WINDOW_DAYS + 5))
        make_booking(event=event, user=attendee)
        assert review_service.pending_for_user(user_id=attendee.id) == []

    def test_a_refunded_booking_is_not_pending(
        self, review_service, make_event, make_booking, attendee
    ):
        event = make_event()
        booking = make_booking(event=event, user=attendee)
        Ticket.objects.filter(booking=booking).update(status=TicketStatus.VOID)
        # The prompt list is derived from bookings; the eligibility check is
        # what refuses the write. Both must agree, or somebody is prompted for
        # something they will then be refused.
        pending = review_service.pending_for_user(user_id=attendee.id)
        for row in pending:
            result = review_service.check_eligibility(event_id=row.event_id, user_id=attendee.id)
            assert result.allowed, "prompted for something the service would refuse"
