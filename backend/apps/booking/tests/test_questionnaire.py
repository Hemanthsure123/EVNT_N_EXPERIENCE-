"""The questionnaire gate on `create_booking`.

── WHY THE CHECK IS HERE AND NOWHERE ELSE ────────────────────────────────

`create_booking` is the one place a client cannot route around. The two
alternatives were both considered and are both worse:

- A separate "submit your answers" endpoint the browser is trusted to call
  before paying is a gate with an API-shaped hole in it.
- Refusing at CONFIRM would mean taking somebody's money and then declining to
  issue their ticket, which is the single outcome `payments` exists to prevent.

It runs BEFORE any row lock is taken, for the same reason `_validate_items`
does: refusing after locking per-tier rows means holding the platform's hottest
locks to do work that was always going to fail.
"""

from __future__ import annotations

import pytest

from apps.booking.models import BookingAnswer
from apps.events.models import EventQuestion, QuestionKind
from apps.events.repositories import EventContentRepository
from core.errors import InvalidInputError

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures


def _ask(event, prompt: str, *, required: bool = False, position: int = 0) -> EventQuestion:
    """A question straight on the row — this file is about the BOOKING gate,
    so the organiser's own service is scaffolding it does not need."""
    return EventQuestion.objects.create(
        event=event,
        prompt=prompt,
        kind=QuestionKind.SHORT_TEXT,
        is_required=required,
        position=position,
    )


@pytest.fixture
def second_event(organizer):
    """Another event under the same owner — enough to prove the boundary is
    per-EVENT, not per-organiser. A different owner would pass the same test
    for the weaker reason."""
    from datetime import timedelta

    from django.utils import timezone

    from apps.events.models import Event, EventStatus
    from apps.events.repositories import EventRepository
    from apps.organizations.repositories import OrganizationRepository

    org = OrganizationRepository().create(owner_id=organizer.id, name="Second Brand")
    other = EventRepository().create(
        organization_id=org.id,
        title="Someone else's night",
        venue="Hall",
        city="Pune",
        starts_at=timezone.now() + timedelta(days=20),
    )
    Event.objects.filter(pk=other.id).update(status=EventStatus.LIVE)
    other.refresh_from_db()
    return other


@pytest.mark.django_db
class TestTheGate:
    def test_a_booking_without_a_questionnaire_is_unaffected(
        self, booking_service, buyer, event, make_tier
    ):
        """The overwhelmingly common case: no questions, nothing sent."""
        result = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": make_tier().id, "quantity": 1}],
        )

        assert result.booking is not None

    def test_a_required_question_blocks_a_booking_with_no_answers(
        self, booking_service, buyer, event, make_tier
    ):
        _ask(event, "Any dietary needs?", required=True)

        with pytest.raises(InvalidInputError):
            booking_service.create_booking(
                user_id=buyer.id,
                event_id=event.id,
                items=[{"ticket_type_id": make_tier().id, "quantity": 1}],
            )

    def test_a_blank_string_does_not_count_as_an_answer(
        self, booking_service, buyer, event, make_tier
    ):
        """A field somebody tabbed through is not an answer, and storing `""`
        would make the organiser's export claim they had responded."""
        question = _ask(event, "Any dietary needs?", required=True)

        with pytest.raises(InvalidInputError):
            booking_service.create_booking(
                user_id=buyer.id,
                event_id=event.id,
                items=[{"ticket_type_id": make_tier().id, "quantity": 1}],
                answers={str(question.id): "   "},
            )

    def test_answering_the_required_question_lets_the_booking_through(
        self, booking_service, buyer, event, make_tier
    ):
        question = _ask(event, "Any dietary needs?", required=True)

        result = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": make_tier().id, "quantity": 1}],
            answers={str(question.id): "  Vegetarian  "},
        )

        stored = BookingAnswer.objects.get(booking=result.booking, question=question)
        # Trimmed on the way in, like every other free-text field here.
        assert stored.answer == "Vegetarian"

    def test_an_optional_question_may_be_skipped(self, booking_service, buyer, event, make_tier):
        _ask(event, "Anything else we should know?")

        result = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": make_tier().id, "quantity": 1}],
        )

        assert BookingAnswer.objects.filter(booking=result.booking).count() == 0

    def test_a_retired_question_stops_blocking(self, booking_service, buyer, event, make_tier):
        """Otherwise retiring a question would make every checkout on that event
        unbookable, with nothing left on screen to answer."""
        question = _ask(event, "Any dietary needs?", required=True)
        EventContentRepository().soft_delete_question(question.id)

        result = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": make_tier().id, "quantity": 1}],
        )

        assert result.booking is not None


@pytest.mark.django_db
class TestTheCrossEventBoundary:
    """The security half. The ids come from a browser."""

    def test_an_answer_to_another_events_question_is_refused(
        self, booking_service, buyer, event, make_tier, second_event
    ):
        foreign = _ask(second_event, "Their question")

        with pytest.raises(InvalidInputError):
            booking_service.create_booking(
                user_id=buyer.id,
                event_id=event.id,
                items=[{"ticket_type_id": make_tier().id, "quantity": 1}],
                answers={str(foreign.id): "not mine to answer"},
            )

    def test_nothing_is_written_when_the_answers_are_refused(
        self, booking_service, buyer, event, make_tier, second_event
    ):
        """The refusal happens BEFORE the reserve, so there is no booking and no
        held inventory to clean up — which is the whole reason it runs there."""
        foreign = _ask(second_event, "Their question")

        with pytest.raises(InvalidInputError):
            booking_service.create_booking(
                user_id=buyer.id,
                event_id=event.id,
                items=[{"ticket_type_id": make_tier().id, "quantity": 1}],
                answers={str(foreign.id): "x"},
            )

        assert BookingAnswer.objects.count() == 0

    def test_an_answer_to_a_question_that_does_not_exist_is_refused(
        self, booking_service, buyer, event, make_tier
    ):
        import uuid as _uuid

        with pytest.raises(InvalidInputError):
            booking_service.create_booking(
                user_id=buyer.id,
                event_id=event.id,
                items=[{"ticket_type_id": make_tier().id, "quantity": 1}],
                answers={str(_uuid.uuid4()): "invented"},
            )
