"""The attendee questionnaire: the organiser's side, and the booking gate.

Two things in this file carry weight and the rest is scaffolding:

1. **A required question cannot be walked past.** The check lives in
   `create_booking`, which is the one place a client cannot route around — a
   "submit your answers" endpoint the browser is trusted to call before paying
   is a gate with an API-shaped hole in it, and refusing at CONFIRM would mean
   taking somebody's money and then declining to issue their ticket.
2. **An answer can only ever point at a question on the same event.** The ids
   arrive from a browser; without the check a guessed uuid writes a row against
   another organiser's question, or fails on the foreign key deep inside the
   reserve transaction where the error means nothing to anybody.
"""

from __future__ import annotations

import pytest

from apps.events.exceptions import EventNotFoundError
from apps.events.models import EventQuestion, EventStatus, QuestionKind
from apps.events.repositories import EventContentRepository
from core.errors import InvalidInputError

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures


@pytest.fixture
def content_service():
    from apps.events.repositories import EventContentRepository, EventRepository
    from apps.events.services import EventContentService
    from core.adapters.local.local_storage import LocalStorageAdapter

    return EventContentService(
        events=EventRepository(),
        content=EventContentRepository(),
        storage=LocalStorageAdapter(),
    )


@pytest.mark.django_db
class TestAuthoringQuestions:
    def test_a_question_is_added_and_listed(self, content_service, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)

        content_service.add_question(
            event_id=event.id, actor_id=owner.id, prompt="Any dietary needs?", kind="short_text"
        )

        rows = content_service.list_questions(event_id=event.id, actor_id=owner.id)
        assert [row.prompt for row in rows] == ["Any dietary needs?"]

    def test_the_cap_is_five(self, content_service, make_event, owner):
        """A checkout that asks six questions is a checkout people leave."""
        event = make_event(status=EventStatus.DRAFT)
        for index in range(5):
            content_service.add_question(
                event_id=event.id, actor_id=owner.id, prompt=f"Q{index}", kind="short_text"
            )

        with pytest.raises(InvalidInputError):
            content_service.add_question(
                event_id=event.id, actor_id=owner.id, prompt="One too many", kind="short_text"
            )

    def test_a_choice_question_needs_at_least_two_options(self, content_service, make_event, owner):
        """One option is not a choice — it renders as a dropdown with nothing to
        decide, and zero renders as a dead control."""
        event = make_event(status=EventStatus.DRAFT)

        with pytest.raises(InvalidInputError):
            content_service.add_question(
                event_id=event.id,
                actor_id=owner.id,
                prompt="T-shirt size",
                kind=QuestionKind.CHOICE,
                choices=["M"],
            )

    def test_choice_options_are_trimmed_and_de_duplicated(self, content_service, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)

        question = content_service.add_question(
            event_id=event.id,
            actor_id=owner.id,
            prompt="T-shirt size",
            kind=QuestionKind.CHOICE,
            choices=["  S ", "M", "S", "  ", "L"],
        )

        assert question.choices == ["S", "M", "L"]

    def test_options_are_dropped_when_the_kind_is_not_a_choice(
        self, content_service, make_event, owner
    ):
        """Options on a yes/no question are options nothing reads — and leaving
        them would let a later kind change resurrect stale ones."""
        event = make_event(status=EventStatus.DRAFT)

        question = content_service.add_question(
            event_id=event.id,
            actor_id=owner.id,
            prompt="Bringing a guest?",
            kind=QuestionKind.BOOLEAN,
            choices=["Yes", "No", "Maybe"],
        )

        assert question.choices == []

    def test_switching_a_choice_question_to_boolean_clears_its_options(
        self, content_service, make_event, owner
    ):
        """The kind and the options must be considered TOGETHER on a PATCH.
        Changing one without re-reading the other leaves a row whose `choices`
        contradict its `kind`, and the renderer trusts the kind."""
        event = make_event(status=EventStatus.DRAFT)
        question = content_service.add_question(
            event_id=event.id,
            actor_id=owner.id,
            prompt="T-shirt size",
            kind=QuestionKind.CHOICE,
            choices=["S", "M"],
        )

        updated = content_service.update_question(
            event_id=event.id,
            actor_id=owner.id,
            question_id=question.id,
            changes={"kind": QuestionKind.BOOLEAN},
        )

        assert updated.choices == []

    def test_removing_a_question_is_a_soft_delete(self, content_service, make_event, owner):
        """`BookingAnswer.question` is PROTECTed. An answer whose prompt was
        hard-deleted is a value with no question — "Vegetarian" against
        nothing, which an organiser cannot act on."""
        event = make_event(status=EventStatus.DRAFT)
        question = content_service.add_question(
            event_id=event.id, actor_id=owner.id, prompt="Any dietary needs?", kind="short_text"
        )

        content_service.remove_question(
            event_id=event.id, actor_id=owner.id, question_id=question.id
        )

        assert content_service.list_questions(event_id=event.id, actor_id=owner.id) == []
        assert EventQuestion.objects.filter(pk=question.id).exists()

    def test_another_organizers_event_is_not_reachable(
        self, content_service, make_event, other_user
    ):
        event = make_event(status=EventStatus.DRAFT)

        # A 404, not a 403: a 403 confirms the event exists to anyone guessing
        # ids. Same rule the rest of the ownership checks follow.
        with pytest.raises(EventNotFoundError):
            content_service.add_question(
                event_id=event.id, actor_id=other_user.id, prompt="Mine now", kind="short_text"
            )


@pytest.mark.django_db
class TestTheRepositoryReads:
    def test_required_ids_are_just_the_required_ones(self, content_service, make_event, owner):
        event = make_event(status=EventStatus.DRAFT)
        optional = content_service.add_question(
            event_id=event.id, actor_id=owner.id, prompt="Anything else?", kind="short_text"
        )
        required = content_service.add_question(
            event_id=event.id,
            actor_id=owner.id,
            prompt="Dietary needs?",
            kind="short_text",
            is_required=True,
        )

        ids = EventContentRepository().required_question_ids(event.id)

        assert ids == {str(required.id)}
        assert str(optional.id) not in ids

    def test_a_retired_question_is_no_longer_required(self, content_service, make_event, owner):
        """Otherwise retiring a question would make every checkout on that
        event unbookable, with nothing on screen to answer."""
        event = make_event(status=EventStatus.DRAFT)
        question = content_service.add_question(
            event_id=event.id,
            actor_id=owner.id,
            prompt="Dietary needs?",
            kind="short_text",
            is_required=True,
        )
        content_service.remove_question(
            event_id=event.id, actor_id=owner.id, question_id=question.id
        )

        assert EventContentRepository().required_question_ids(event.id) == set()
