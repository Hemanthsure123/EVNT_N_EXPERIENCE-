"""The access rules, which are the whole point of this module."""

from __future__ import annotations

import pytest

from apps.support.models import SupportAudience, SupportQuery, SupportStatus
from apps.support.repositories import SupportRepository
from apps.support.services import SupportService, Viewer
from core.errors import InvalidInputError, NotFoundError, PermissionDeniedError


@pytest.fixture
def service() -> SupportService:
    # Constructed directly with its repository, never through `config.di` — a
    # unit test must not depend on settings' backend selection.
    return SupportService(queries=SupportRepository())


def customer(user) -> Viewer:
    return Viewer(user_id=user.id, is_staff=False)


def operator(user) -> Viewer:
    return Viewer(user_id=user.id, is_staff=True)


@pytest.mark.django_db
def test_a_query_with_no_event_cannot_be_addressed_to_an_organizer(service, user):
    """Otherwise it lands in a queue nobody owns.

    Which is the failure this module replaced — an unanswered inbox — rebuilt
    inside it, with a status field to make it look attended.
    """
    query = service.raise_query(
        user_id=user.id,
        subject="Charged twice",
        body="Two debits for one booking.",
        audience=SupportAudience.ORGANIZER,
    )
    assert query.audience == SupportAudience.PLATFORM


@pytest.mark.django_db
def test_subject_and_body_are_required(service, user):
    with pytest.raises(InvalidInputError):
        service.raise_query(user_id=user.id, subject="   ", body="something", audience="platform")
    with pytest.raises(InvalidInputError):
        service.raise_query(user_id=user.id, subject="Help", body="  ", audience="platform")


@pytest.mark.django_db
def test_another_customer_gets_NOT_FOUND_rather_than_forbidden(service, user, other_user):
    """404, not 403.

    Telling somebody a query exists but is not theirs confirms an id they
    guessed. The two responses must be indistinguishable.
    """
    query = service.raise_query(
        user_id=user.id, subject="Refund", body="Please refund.", audience="platform"
    )
    with pytest.raises(NotFoundError):
        service.get_for_viewer(query_id=query.id, viewer=customer(other_user))


@pytest.mark.django_db
def test_staff_see_platform_queries_and_the_asker_sees_their_own(service, user, staff_user):
    query = service.raise_query(
        user_id=user.id, subject="Refund", body="Please refund.", audience="platform"
    )
    assert service.get_for_viewer(query_id=query.id, viewer=operator(staff_user)).id == query.id
    assert service.get_for_viewer(query_id=query.id, viewer=customer(user)).id == query.id


@pytest.mark.django_db
def test_a_staff_reply_marks_it_answered_and_a_customer_reply_does_not(service, user, staff_user):
    """`answered` means "somebody replied to you", not "there was activity".

    A customer adding detail to their own open thread has not answered it, and
    a queue that shows it as answered is a queue that hides work.
    """
    query = service.raise_query(
        user_id=user.id, subject="Gate", body="Would not scan.", audience="platform"
    )

    service.reply(query_id=query.id, viewer=customer(user), body="Adding a photo.")
    assert SupportQuery.objects.get(id=query.id).status == SupportStatus.OPEN

    service.reply(query_id=query.id, viewer=operator(staff_user), body="Looking into it.")
    assert SupportQuery.objects.get(id=query.id).status == SupportStatus.ANSWERED


@pytest.mark.django_db
def test_a_reply_from_the_asker_is_not_flagged_as_staff(service, user, staff_user):
    """Even when the asker IS an operator.

    Which hat somebody wore is a fact about the message, so it is stored rather
    than derived later from whether they happen to be staff.
    """
    query = service.raise_query(
        user_id=staff_user.id, subject="My own booking", body="Help.", audience="platform"
    )
    updated = service.reply(query_id=query.id, viewer=operator(staff_user), body="More detail.")
    assert updated.replies.first().is_staff_reply is False


@pytest.mark.django_db
def test_answered_cannot_be_set_by_hand(service, user, staff_user):
    query = service.raise_query(
        user_id=user.id, subject="Gate", body="Would not scan.", audience="platform"
    )
    with pytest.raises(InvalidInputError):
        service.set_status(
            query_id=query.id, viewer=operator(staff_user), status=SupportStatus.ANSWERED
        )


@pytest.mark.django_db
def test_only_the_answering_side_may_resolve(service, user, staff_user):
    query = service.raise_query(
        user_id=user.id, subject="Gate", body="Would not scan.", audience="platform"
    )
    with pytest.raises(PermissionDeniedError):
        service.set_status(query_id=query.id, viewer=customer(user), status=SupportStatus.RESOLVED)

    resolved = service.set_status(
        query_id=query.id, viewer=operator(staff_user), status=SupportStatus.RESOLVED
    )
    assert resolved.status == SupportStatus.RESOLVED


@pytest.mark.django_db
def test_the_asker_may_close_their_own_thread(service, user):
    query = service.raise_query(
        user_id=user.id, subject="Gate", body="Sorted itself out.", audience="platform"
    )
    closed = service.set_status(
        query_id=query.id, viewer=customer(user), status=SupportStatus.CLOSED
    )
    assert closed.status == SupportStatus.CLOSED


@pytest.mark.django_db
def test_a_closed_thread_refuses_replies(service, user):
    query = service.raise_query(
        user_id=user.id, subject="Gate", body="Sorted.", audience="platform"
    )
    service.set_status(query_id=query.id, viewer=customer(user), status=SupportStatus.CLOSED)
    with pytest.raises(InvalidInputError):
        service.reply(query_id=query.id, viewer=customer(user), body="Actually…")


@pytest.mark.django_db
def test_replying_to_a_resolved_thread_does_not_drag_it_back_to_answered(service, user, staff_user):
    """`mark_answered` is `open` -> `answered` only.

    Expressed as a predicate on the UPDATE rather than a read-then-write, so
    two replies landing together cannot both decide they were first.
    """
    query = service.raise_query(
        user_id=user.id, subject="Gate", body="Would not scan.", audience="platform"
    )
    service.set_status(
        query_id=query.id, viewer=operator(staff_user), status=SupportStatus.RESOLVED
    )
    service.reply(query_id=query.id, viewer=operator(staff_user), body="One more thing.")
    assert SupportQuery.objects.get(id=query.id).status == SupportStatus.RESOLVED
