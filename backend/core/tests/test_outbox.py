import pytest
from django.db import transaction

from core.models import OutboxEvent
from core.outbox import publish_pending, record_event


@pytest.mark.django_db(transaction=True)
def test_record_event_requires_an_active_transaction():
    # Regular @pytest.mark.django_db wraps every test in an outer atomic
    # block for rollback, which would make this guard a no-op to test —
    # transaction=True runs this test without that wrapper so we can prove
    # record_event() actually rejects being called outside a transaction.
    with pytest.raises(RuntimeError):
        record_event(event_type="test.no_transaction", payload={})


@pytest.mark.django_db
def test_record_event_writes_a_row_inside_a_transaction():
    with transaction.atomic():
        event = record_event(event_type="test.recorded", payload={"a": 1}, aggregate_id="agg-1")

    stored = OutboxEvent.objects.get(pk=event.pk)
    assert stored.event_type == "test.recorded"
    assert stored.payload == {"a": 1}
    assert stored.aggregate_id == "agg-1"
    assert stored.published_at is None


@pytest.mark.django_db
def test_publish_pending_dispatches_to_the_event_bus_and_marks_published():
    from config.di import event_bus_port

    received: list[dict] = []
    event_bus_port().subscribe("test.publish", received.append)

    with transaction.atomic():
        record_event(event_type="test.publish", payload={"n": 1})

    published_count = publish_pending()

    assert published_count == 1
    assert received == [{"n": 1}]
    event = OutboxEvent.objects.get(event_type="test.publish")
    assert event.published_at is not None


@pytest.mark.django_db
def test_publish_pending_leaves_the_event_unpublished_if_the_bus_raises(monkeypatch):
    from config.di import event_bus_port

    with transaction.atomic():
        record_event(event_type="test.failing", payload={})

    def boom(event_type: str, payload: dict) -> None:
        raise RuntimeError("bus down")

    monkeypatch.setattr(event_bus_port(), "publish", boom)

    published_count = publish_pending()

    assert published_count == 0
    event = OutboxEvent.objects.get(event_type="test.failing")
    assert event.published_at is None
