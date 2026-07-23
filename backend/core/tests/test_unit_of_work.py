import pytest

from apps.accounts.models import User
from core.models import OutboxEvent
from core.unit_of_work import UnitOfWork


class Boom(Exception):
    pass


@pytest.mark.django_db
def test_publishes_pending_outbox_events_after_commit(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True), UnitOfWork() as uow:
        User.objects.create_user(email="uow-commit@example.com", password="pass12345")
        uow.publish("test.uow_commit", {"ok": True})

    event = OutboxEvent.objects.get(event_type="test.uow_commit")
    assert event.published_at is not None


@pytest.mark.django_db
def test_rolls_back_every_write_when_the_block_raises():
    with pytest.raises(Boom), UnitOfWork() as uow:
        User.objects.create_user(email="uow-rollback@example.com", password="pass12345")
        uow.publish("test.uow_rollback", {})
        raise Boom()

    assert not User.objects.filter(email="uow-rollback@example.com").exists()
    assert not OutboxEvent.objects.filter(event_type="test.uow_rollback").exists()


@pytest.mark.django_db
def test_does_not_schedule_a_publish_when_the_block_raises(django_capture_on_commit_callbacks):
    with (
        django_capture_on_commit_callbacks(execute=True) as callbacks,
        pytest.raises(Boom),
        UnitOfWork() as uow,
    ):
        uow.publish("test.uow_no_publish_on_error", {})
        raise Boom()

    assert callbacks == []
