"""Web Push, end to end.

This is the capability the audit found faked: the discovery grid asked for a
browser permission and then told people "notifications are on for this
device" when nothing subscribed, nothing was stored and nothing could be
sent.

The tests that matter most are the ones asserting the platform refuses to
LOOK like it works when it cannot — an unconfigured deployment must reject a
subscription rather than store one it can never deliver to.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.notifications.models import (
    NotificationChannel,
    NotificationLog,
    NotificationStatus,
    NotificationType,
    PushSubscription,
)
from apps.notifications.repositories import (
    NotificationLogRepository,
    PushSubscriptionRepository,
)
from apps.notifications.services import NotificationService
from apps.notifications.templates import TemplateService
from core.adapters.local.console_email import ConsoleEmailAdapter
from core.adapters.local.console_sms import ConsoleSmsAdapter
from core.adapters.webpush.adapter import DisabledPushAdapter
from core.ports.push_port import PushPort, PushResult
from core.ports.push_port import PushSubscription as PushSubscriptionData
from core.ports.task_queue_port import TaskQueuePort

ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123"
OTHER_ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/xyz789"


class _RecordingPush(PushPort):
    """A test double, not a shipped fake. Nothing in the app ever selects it."""

    def __init__(self, *, gone: set[str] | None = None, fails: set[str] | None = None) -> None:
        self.sent: list[tuple[str, str, str, str]] = []
        self._gone = gone or set()
        self._fails = fails or set()

    def is_configured(self) -> bool:
        return True

    def public_key(self) -> str:
        return "BTestPublicKey"

    def send(self, *, subscription, title, body, url="", tag="") -> PushResult:
        if subscription.endpoint in self._gone:
            return PushResult(delivered=False, gone=True, error="expired")
        if subscription.endpoint in self._fails:
            return PushResult(delivered=False, error="push service unreachable")
        self.sent.append((subscription.endpoint, title, body, url))
        return PushResult(delivered=True)


class _NoQueue(TaskQueuePort):
    """Swallows enqueues: these tests call `dispatch` directly, so a queue that
    also ran it would make every assertion about a single send ambiguous."""

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        return "noop"


def _service(push: PushPort) -> NotificationService:
    """Built directly with adapters, never through config.di — a unit test must
    not depend on which backend Django settings happen to select."""
    return NotificationService(
        logs=NotificationLogRepository(),
        templates=TemplateService(),
        email=ConsoleEmailAdapter(),
        sms=ConsoleSmsAdapter(),
        push=push,
        push_subscriptions=PushSubscriptionRepository(),
        task_queue=_NoQueue(),
        max_attempts=3,
        retry_backoff_seconds=1,
    )


@pytest.fixture
def user(db):
    return User.objects.create_user(email="fan@example.com", password="pw", full_name="Fan")


@pytest.fixture
def client(user):
    api = APIClient()
    api.force_authenticate(user=user)
    return api


# --------------------------------------------------------------- the port


class TestDisabledAdapter:
    """The default. Deliberately not a console/fake adapter that logs 'sent!'."""

    def test_it_reports_itself_unconfigured(self):
        assert DisabledPushAdapter().is_configured() is False

    def test_it_has_no_public_key_to_subscribe_with(self):
        assert DisabledPushAdapter().public_key() == ""

    def test_it_never_claims_to_have_delivered(self):
        result = DisabledPushAdapter().send(
            subscription=PushSubscriptionData(endpoint="https://x", p256dh="k", auth="a"),
            title="t",
            body="b",
        )
        assert result.delivered is False


def test_di_returns_the_disabled_adapter_when_no_keys_are_set(settings):
    from config.di import push_port

    settings.VAPID_PUBLIC_KEY = ""
    settings.VAPID_PRIVATE_KEY = ""
    push_port.cache_clear()
    try:
        assert push_port().is_configured() is False
    finally:
        push_port.cache_clear()


# ------------------------------------------------------------ the endpoints


@pytest.mark.django_db
class TestPushConfigEndpoint:
    def test_it_reports_disabled_when_no_keys_are_configured(self, settings):
        from config.di import push_port

        settings.VAPID_PUBLIC_KEY = ""
        settings.VAPID_PRIVATE_KEY = ""
        push_port.cache_clear()
        try:
            body = APIClient().get("/api/v1/push/config").json()
        finally:
            push_port.cache_clear()

        # The frontend asks this BEFORE touching the browser. Getting it wrong
        # is how a permission prompt appears for a feature that cannot work.
        assert body == {"enabled": False, "public_key": ""}

    def test_it_needs_no_authentication(self):
        assert APIClient().get("/api/v1/push/config").status_code == 200

    def test_it_is_never_shared_cached(self):
        response = APIClient().get("/api/v1/push/config")
        assert response["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
class TestSubscribing:
    def test_an_unconfigured_deployment_refuses_to_store_a_subscription(self, client, settings):
        """The central assertion of this file.

        Storing a subscription we can never send to is what lets a UI say
        "you're subscribed" about nothing.
        """
        from config.di import push_port

        settings.VAPID_PUBLIC_KEY = ""
        settings.VAPID_PRIVATE_KEY = ""
        push_port.cache_clear()
        try:
            response = client.post(
                "/api/v1/me/push/subscriptions",
                {"endpoint": ENDPOINT, "p256dh": "key", "auth": "secret"},
                format="json",
            )
        finally:
            push_port.cache_clear()

        assert response.status_code == 422
        assert PushSubscription.objects.count() == 0

    def test_a_subscription_is_stored(self, client, user, monkeypatch):
        monkeypatch.setattr("apps.notifications.api.push_port", lambda: _RecordingPush())
        response = client.post(
            "/api/v1/me/push/subscriptions",
            {"endpoint": ENDPOINT, "p256dh": "key", "auth": "secret"},
            format="json",
        )
        assert response.status_code == 201
        row = PushSubscription.objects.get()
        assert row.user_id == user.id
        assert row.endpoint == ENDPOINT

    def test_resubscribing_the_same_browser_writes_one_row(self, client, monkeypatch):
        # A browser returns the SAME endpoint each time, and a page that
        # subscribes on every visit must not accumulate rows.
        monkeypatch.setattr("apps.notifications.api.push_port", lambda: _RecordingPush())
        payload = {"endpoint": ENDPOINT, "p256dh": "key", "auth": "secret"}
        client.post("/api/v1/me/push/subscriptions", payload, format="json")
        client.post("/api/v1/me/push/subscriptions", payload, format="json")
        assert PushSubscription.objects.count() == 1

    def test_a_non_https_endpoint_is_rejected(self, client, monkeypatch):
        monkeypatch.setattr("apps.notifications.api.push_port", lambda: _RecordingPush())
        response = client.post(
            "/api/v1/me/push/subscriptions",
            {"endpoint": "http://insecure.example/push", "p256dh": "k", "auth": "a"},
            format="json",
        )
        assert response.status_code == 400

    def test_anonymous_callers_cannot_subscribe(self):
        response = APIClient().post(
            "/api/v1/me/push/subscriptions",
            {"endpoint": ENDPOINT, "p256dh": "k", "auth": "a"},
            format="json",
        )
        assert response.status_code == 401

    def test_the_device_list_never_returns_the_encryption_keys(self, client, user):
        PushSubscriptionRepository().save_subscription(
            user_id=user.id, endpoint=ENDPOINT, p256dh="secret-key", auth="secret-auth"
        )
        body = client.get("/api/v1/me/push/subscriptions").json()
        assert set(body["data"][0]) == {"id", "user_agent", "created_at", "last_used_at"}

    def test_one_user_cannot_see_anothers_devices(self, client, db):
        other = User.objects.create_user(email="other@example.com", password="pw")
        PushSubscriptionRepository().save_subscription(
            user_id=other.id, endpoint=ENDPOINT, p256dh="k", auth="a"
        )
        assert client.get("/api/v1/me/push/subscriptions").json()["data"] == []

    def test_unsubscribing_removes_only_the_callers_device(self, client, user, db):
        other = User.objects.create_user(email="other@example.com", password="pw")
        repo = PushSubscriptionRepository()
        repo.save_subscription(user_id=user.id, endpoint=ENDPOINT, p256dh="k", auth="a")
        repo.save_subscription(user_id=other.id, endpoint=OTHER_ENDPOINT, p256dh="k", auth="a")

        response = client.delete(
            "/api/v1/me/push/subscriptions", {"endpoint": OTHER_ENDPOINT}, format="json"
        )
        assert response.status_code == 204
        # Somebody else's phone must not be unsubscribable by knowing its URL.
        assert PushSubscription.objects.filter(user_id=other.id).exists()


@pytest.mark.django_db
class TestRotation:
    """The service worker has no token, so this one endpoint is unauthenticated.
    What makes that safe is what it CANNOT do."""

    def test_it_moves_an_existing_subscription_to_a_new_endpoint(self, user):
        PushSubscriptionRepository().save_subscription(
            user_id=user.id, endpoint=ENDPOINT, p256dh="old", auth="old"
        )
        response = APIClient().post(
            "/api/v1/push/rotate",
            {
                "old_endpoint": ENDPOINT,
                "endpoint": OTHER_ENDPOINT,
                "p256dh": "new",
                "auth": "new",
            },
            format="json",
        )
        assert response.status_code == 204
        row = PushSubscription.objects.get()
        assert row.endpoint == OTHER_ENDPOINT
        assert row.user_id == user.id  # ownership unchanged

    def test_it_cannot_create_a_subscription(self):
        # An UPDATE with a WHERE, never an upsert — so an unauthenticated
        # caller can never subscribe anybody to anything.
        response = APIClient().post(
            "/api/v1/push/rotate",
            {
                "old_endpoint": "https://unknown.example/push",
                "endpoint": OTHER_ENDPOINT,
                "p256dh": "k",
                "auth": "a",
            },
            format="json",
        )
        assert response.status_code == 204
        assert PushSubscription.objects.count() == 0

    def test_an_unknown_endpoint_is_indistinguishable_from_a_known_one(self, user):
        PushSubscriptionRepository().save_subscription(
            user_id=user.id, endpoint=ENDPOINT, p256dh="k", auth="a"
        )
        known = APIClient().post(
            "/api/v1/push/rotate",
            {"old_endpoint": ENDPOINT, "endpoint": OTHER_ENDPOINT, "p256dh": "k", "auth": "a"},
            format="json",
        )
        unknown = APIClient().post(
            "/api/v1/push/rotate",
            {
                "old_endpoint": "https://nope.example/x",
                "endpoint": OTHER_ENDPOINT,
                "p256dh": "k",
                "auth": "a",
            },
            format="json",
        )
        # Otherwise this becomes an oracle for "is this endpoint subscribed?".
        assert known.status_code == unknown.status_code == 204


# --------------------------------------------------------------- delivery


@pytest.mark.django_db
class TestPushDelivery:
    def _claim(self, user, **overrides) -> NotificationLog:
        service = _service(_RecordingPush())
        log = service.notify(
            notification_type=NotificationType.EVENT_REMINDER_PUSH,
            recipient=str(user.id),
            context={
                "event_title": "Sunburn",
                "event_when": "Fri 12 Dec 2026, 19:00 UTC",
                "event_where": "Vagator, Goa",
                "url": "https://curatix.example/events/1",
                **overrides,
            },
            dedupe_key=f"test:{uuid.uuid4()}",
        )
        assert log is not None  # a push type with a recipient always claims
        return log

    def test_the_recipient_is_a_user_id_not_a_device(self, user):
        # One person with a laptop and a phone gets ONE logical reminder that
        # fans out, not two messages.
        log = self._claim(user)
        assert log is not None
        assert log.recipient == str(user.id)
        assert log.channel == NotificationChannel.PUSH

    def test_it_sends_to_every_device_the_user_subscribed(self, user):
        repo = PushSubscriptionRepository()
        repo.save_subscription(user_id=user.id, endpoint=ENDPOINT, p256dh="k", auth="a")
        repo.save_subscription(user_id=user.id, endpoint=OTHER_ENDPOINT, p256dh="k", auth="a")

        push = _RecordingPush()
        log = self._claim(user)
        _service(push).dispatch(log.id)

        assert {sent[0] for sent in push.sent} == {ENDPOINT, OTHER_ENDPOINT}
        log.refresh_from_db()
        assert log.status == NotificationStatus.SENT

    def test_the_deep_link_travels_to_the_device(self, user):
        # A notification with nowhere to go is a dead end, and the tray gives
        # no second chance to explain.
        PushSubscriptionRepository().save_subscription(
            user_id=user.id, endpoint=ENDPOINT, p256dh="k", auth="a"
        )
        push = _RecordingPush()
        log = self._claim(user)
        _service(push).dispatch(log.id)
        assert push.sent[0][3] == "https://curatix.example/events/1"

    def test_an_expired_subscription_is_deleted_not_retried(self, user):
        PushSubscriptionRepository().save_subscription(
            user_id=user.id, endpoint=ENDPOINT, p256dh="k", auth="a"
        )
        log = self._claim(user)
        _service(_RecordingPush(gone={ENDPOINT})).dispatch(log.id)

        # The row can never work again; keeping it means paying for a request
        # guaranteed to fail on every future send.
        assert PushSubscription.objects.count() == 0
        log.refresh_from_db()
        assert log.status == NotificationStatus.SENT

    def test_one_live_device_is_enough_for_success(self, user):
        repo = PushSubscriptionRepository()
        repo.save_subscription(user_id=user.id, endpoint=ENDPOINT, p256dh="k", auth="a")
        repo.save_subscription(user_id=user.id, endpoint=OTHER_ENDPOINT, p256dh="k", auth="a")

        log = self._claim(user)
        _service(_RecordingPush(gone={ENDPOINT})).dispatch(log.id)

        # Their old laptop expiring must not dead-letter a reminder their
        # phone already showed.
        log.refresh_from_db()
        assert log.status == NotificationStatus.SENT
        assert PushSubscription.objects.count() == 1

    def test_a_transport_failure_is_retried_like_any_other_send(self, user):
        PushSubscriptionRepository().save_subscription(
            user_id=user.id, endpoint=ENDPOINT, p256dh="k", auth="a"
        )
        log = self._claim(user)
        _service(_RecordingPush(fails={ENDPOINT})).dispatch(log.id)

        log.refresh_from_db()
        assert log.status == NotificationStatus.PENDING  # still retryable
        assert log.attempts == 1
        assert PushSubscription.objects.count() == 1  # not deleted — it may recover

    def test_a_user_with_no_devices_is_not_an_error(self, user):
        # Somebody unsubscribing between the claim and the send is ordinary,
        # and must not burn five retries.
        log = self._claim(user)
        _service(_RecordingPush()).dispatch(log.id)
        log.refresh_from_db()
        assert log.status == NotificationStatus.SENT
        assert log.provider_ref == "push:no-subscriptions"

    def test_delivery_stamps_last_used(self, user):
        PushSubscriptionRepository().save_subscription(
            user_id=user.id, endpoint=ENDPOINT, p256dh="k", auth="a"
        )
        log = self._claim(user)
        _service(_RecordingPush()).dispatch(log.id)
        assert PushSubscription.objects.get().last_used_at is not None


@pytest.mark.django_db
def test_the_stuck_sweeper_requeues_a_claim_that_was_never_dispatched(user):
    """The window this closes: `notify` claims a row and THEN enqueues. A
    process killed in between leaves a `pending` row nothing will ever look at
    again — the dedupe key exists, so a later notify returns it rather than
    re-enqueueing."""

    class _CountingQueue(TaskQueuePort):
        def __init__(self) -> None:
            self.calls: list[str] = []

        def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
            self.calls.append(payload["notification_id"])
            return "id"

    queue = _CountingQueue()
    service = NotificationService(
        logs=NotificationLogRepository(),
        templates=TemplateService(),
        email=ConsoleEmailAdapter(),
        sms=ConsoleSmsAdapter(),
        push=DisabledPushAdapter(),
        push_subscriptions=PushSubscriptionRepository(),
        task_queue=queue,
        max_attempts=3,
        retry_backoff_seconds=1,
    )

    stranded = NotificationLog.objects.create(
        dedupe_key="stranded:1",
        type=NotificationType.WELCOME,
        channel=NotificationChannel.EMAIL,
        recipient="fan@example.com",
        subject="s",
        body="b",
        status=NotificationStatus.PENDING,
    )
    # Older than the cutoff — `created_at` is auto_now_add, so it is moved.
    NotificationLog.objects.filter(pk=stranded.pk).update(
        created_at=timezone.now() - timedelta(seconds=600)
    )

    assert service.sweep_stuck(older_than_seconds=300, limit=10) == 1
    assert queue.calls == [str(stranded.id)]


@pytest.mark.django_db
def test_the_sweeper_leaves_a_freshly_claimed_notification_alone(user):
    # A cutoff that races healthy dispatches would double-send under load —
    # harmless thanks to the row lock, but pure waste.
    service = _service(_RecordingPush())
    NotificationLog.objects.create(
        dedupe_key="fresh:1",
        type=NotificationType.WELCOME,
        channel=NotificationChannel.EMAIL,
        recipient="fan@example.com",
        subject="s",
        body="b",
        status=NotificationStatus.PENDING,
    )
    assert service.sweep_stuck(older_than_seconds=300, limit=10) == 0
