import pytest

from core.adapters.local.console_email import ConsoleEmailAdapter
from core.adapters.local.console_sms import ConsoleSmsAdapter
from core.adapters.local.fake_payment import FakePaymentAdapter
from core.adapters.local.inprocess_event_bus import InProcessEventBusAdapter
from core.adapters.local.local_storage import LocalStorageAdapter
from core.adapters.local.locmem_cache import LocMemCacheAdapter
from core.adapters.local.sync_task_queue import SyncTaskQueueAdapter


def test_fake_payment_verifies_real_hmac_signatures():
    import hashlib
    import hmac

    secret = "test-webhook-secret"
    adapter = FakePaymentAdapter(webhook_secret=secret)
    body = b'{"event":"payment.captured"}'
    good = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    assert adapter.verify_webhook_signature(payload=body, signature=good) is True
    assert adapter.verify_webhook_signature(payload=body, signature="deadbeef") is False
    # A tampered body no longer matches the signature.
    assert adapter.verify_webhook_signature(payload=b'{"event":"forged"}', signature=good) is False


def test_fake_payment_orders_carry_transfers_and_refunds_are_idempotent():
    from core.ports.payment_port import OrderTransfer

    adapter = FakePaymentAdapter()

    transfers = [OrderTransfer(account_id="acc_1", amount_minor=9000, on_hold=True)]
    order_id = adapter.create_order(
        amount_minor=10000, currency="INR", receipt="r1", notes={}, transfers=transfers
    )
    assert adapter.orders[order_id]["transfers"] == transfers

    r1 = adapter.refund(payment_id="pay_1", amount_minor=10000, idempotency_key="refund:pay_1")
    r2 = adapter.refund(payment_id="pay_1", amount_minor=10000, idempotency_key="refund:pay_1")
    assert r1 == r2  # same key -> same refund, never double-refunded


def test_fake_payment_splits_transfers():
    adapter = FakePaymentAdapter()

    result = adapter.split_transfer(
        payment_id="pay_1",
        organizer_account_id="acc_1",
        organizer_amount_minor=9000,
        platform_fee_minor=1000,
    )
    assert result.payment_id == "pay_1"
    assert result.organizer_transfer_id is not None
    assert result.status == "processed"


def test_local_storage_upload_read_and_delete(tmp_path):
    adapter = LocalStorageAdapter(root=tmp_path, base_url="/media/")

    url = adapter.upload(path="tickets/a.txt", content=b"hello", content_type="text/plain")

    assert url == "/media/tickets/a.txt"
    assert (tmp_path / "tickets" / "a.txt").read_bytes() == b"hello"

    adapter.delete(path="tickets/a.txt")

    assert not (tmp_path / "tickets" / "a.txt").exists()


def test_local_storage_rejects_path_traversal(tmp_path):
    adapter = LocalStorageAdapter(root=tmp_path, base_url="/media/")

    with pytest.raises(ValueError):
        adapter.upload(path="../outside.txt", content=b"x", content_type="text/plain")


def test_locmem_cache_get_set_add_and_delete():
    cache = LocMemCacheAdapter()

    assert cache.get("k") is None
    assert cache.add("k", "v1") is True
    assert cache.add("k", "v2") is False
    assert cache.get("k") == "v1"

    cache.delete("k")

    assert cache.get("k") is None
    assert cache.ping() is True


def test_locmem_cache_lock_prevents_concurrent_acquisition():
    cache = LocMemCacheAdapter()

    with cache.lock("res") as acquired:
        assert acquired is True
        with cache.lock("res") as acquired_again:
            assert acquired_again is False

    with cache.lock("res") as acquired_after_release:
        assert acquired_after_release is True


def test_console_email_and_sms_adapters_do_not_raise():
    ConsoleEmailAdapter().send(to="a@example.com", subject="hi", body="body")
    ConsoleSmsAdapter().send(to="+911234567890", message="hi")


def test_inprocess_event_bus_dispatches_and_survives_a_failing_handler():
    bus = InProcessEventBusAdapter()
    received: list[dict] = []
    bus.subscribe("evt", received.append)

    def bad_handler(payload: dict) -> None:
        raise RuntimeError("boom")

    bus.subscribe("evt", bad_handler)

    bus.publish("evt", {"x": 1})

    assert received == [{"x": 1}]


def test_sync_task_queue_returns_a_task_id():
    queue = SyncTaskQueueAdapter()

    task_id = queue.enqueue("do_thing", {"a": 1})

    assert task_id.startswith("local_task_")
