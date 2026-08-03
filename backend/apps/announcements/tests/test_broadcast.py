"""Sending one announcement to the list.

The themes: the operator's press only creates rows and enqueues, the unique
constraint makes pressing twice safe, and the actual send is somebody else's
job — this module hands each recipient to `notifications` and records which
message it got.
"""

from __future__ import annotations

import datetime as dt
import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.announcements.exceptions import BroadcastNotConfigured, NotSendable
from apps.announcements.models import Announcement, AnnouncementDelivery, Subscriber
from apps.announcements.services import (
    ANNOUNCEMENT_NOTIFICATION_TYPE,
    BROADCAST_TASK,
    BroadcastService,
)
from core.errors import NotFoundError
from core.models import AuditLog

from .conftest import (
    SITE_BASE,
    TRACKING_BASE,
    CountingQueue,
    RecordingNotifier,
    make_broadcast_service,
    make_subscribers,
)


@pytest.mark.django_db
class TestQueueing:
    def test_the_press_creates_a_row_per_subscriber_and_sends_nothing(
        self,
        broadcast: BroadcastService,
        announcement: Announcement,
        notifier: RecordingNotifier,
        staff,
    ) -> None:
        make_subscribers(3)

        result = broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

        assert (result.recipients, result.newly_queued) == (3, 3)
        assert AnnouncementDelivery.objects.count() == 3
        # Nothing has been rendered, claimed or sent. That is the contract:
        # rendering thousands of messages inside an admin request is how the
        # console times out with half a campaign committed.
        assert notifier.calls == []

    def test_the_fan_out_is_enqueued_after_commit(
        self,
        broadcast: BroadcastService,
        announcement: Announcement,
        queue: CountingQueue,
        staff,
        django_capture_on_commit_callbacks,
    ) -> None:
        """Before commit, the task could start against rows that are not there
        yet, find nothing, and report success on a campaign never delivered."""
        make_subscribers(2)

        with django_capture_on_commit_callbacks(execute=True):
            broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

        assert queue.calls == [(BROADCAST_TASK, {"announcement_id": str(announcement.id)})]

    def test_an_unsubscribed_reader_is_not_queued(
        self, broadcast: BroadcastService, announcement: Announcement, staff
    ) -> None:
        make_subscribers(2)
        gone = Subscriber.objects.create(email="gone@example.com")
        gone.unsubscribed_at = gone.created_at
        gone.save()

        result = broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

        assert result.recipients == 2
        assert not AnnouncementDelivery.objects.filter(subscriber=gone).exists()

    def test_pressing_send_twice_reaches_only_the_new_people(
        self, broadcast: BroadcastService, announcement: Announcement, staff
    ) -> None:
        """`announcement_delivery_unique` is what makes the button safe to
        press again — and re-pressing IS the operator's retry."""
        make_subscribers(2)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

        make_subscribers(1, prefix="latecomer")
        again = broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

        assert (again.recipients, again.newly_queued) == (3, 1)
        assert AnnouncementDelivery.objects.count() == 3

    def test_queueing_is_audited(
        self, broadcast: BroadcastService, announcement: Announcement, staff
    ) -> None:
        make_subscribers(1)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

        entry = AuditLog.objects.get(action="announcement.broadcast_queued")
        assert entry.actor_id == str(staff.id)
        assert entry.metadata["recipients"] == 1

    def test_an_unknown_announcement_is_not_found(self, broadcast: BroadcastService, staff) -> None:
        with pytest.raises(NotFoundError):
            broadcast.queue_broadcast(actor_id=staff.id, announcement_id=uuid.uuid4())


@pytest.mark.django_db
class TestRefusals:
    def test_a_switched_off_announcement_is_not_sent(
        self, broadcast: BroadcastService, announcement: Announcement, staff
    ) -> None:
        """A banner can be pulled. An email cannot, so the checks a banner does
        not need are the ones that matter here."""
        Announcement.objects.filter(pk=announcement.pk).update(is_active=False)

        with pytest.raises(NotSendable):
            broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

    def test_an_expired_window_is_not_sent(
        self, broadcast: BroadcastService, announcement: Announcement, staff
    ) -> None:
        Announcement.objects.filter(pk=announcement.pk).update(
            ends_at=timezone.now() - dt.timedelta(hours=1)
        )

        with pytest.raises(NotSendable):
            broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

    @pytest.mark.parametrize(("tracking", "site"), [("", SITE_BASE), (TRACKING_BASE, ""), ("", "")])
    def test_it_refuses_to_send_with_no_configured_origin(
        self,
        announcement: Announcement,
        notifier: RecordingNotifier,
        queue: CountingQueue,
        staff,
        tracking: str,
        site: str,
    ) -> None:
        """Sending anyway would mean an email with dead links AND a
        structurally-zero click rate — a figure that reads as "nobody engaged"
        when it means "nothing was measured"."""
        service = make_broadcast_service(
            notifier=notifier, task_queue=queue, tracking_base_url=tracking, site_url=site
        )
        make_subscribers(1)

        with pytest.raises(BroadcastNotConfigured):
            service.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

        assert AnnouncementDelivery.objects.count() == 0


@pytest.mark.django_db
class TestFanOut:
    def test_each_recipient_is_handed_to_notifications_once(
        self,
        broadcast: BroadcastService,
        announcement: Announcement,
        notifier: RecordingNotifier,
        staff,
    ) -> None:
        make_subscribers(3)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

        assert broadcast.send_pending(announcement.id) == 3
        assert len(notifier.calls) == 3
        assert {call["type"] for call in notifier.calls} == {ANNOUNCEMENT_NOTIFICATION_TYPE}
        # Every row now carries the log id of the message it became.
        assert AnnouncementDelivery.objects.filter(notification_log_id__isnull=True).count() == 0

    def test_running_the_fan_out_again_sends_nothing(
        self,
        broadcast: BroadcastService,
        announcement: Announcement,
        notifier: RecordingNotifier,
        staff,
    ) -> None:
        """A queue redelivering the task must not produce a second email. The
        stamped log id is the guard here; `notify`'s own dedupe key is the
        second one."""
        make_subscribers(2)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)
        broadcast.send_pending(announcement.id)

        assert broadcast.send_pending(announcement.id) == 0
        assert len(notifier.calls) == 2

    def test_the_dedupe_key_is_stable_per_announcement_and_address(
        self,
        broadcast: BroadcastService,
        announcement: Announcement,
        notifier: RecordingNotifier,
        staff,
    ) -> None:
        make_subscribers(1)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)
        broadcast.send_pending(announcement.id)

        assert notifier.calls[0]["dedupe_key"] == (
            f"announcement:{announcement.id}:email:reader0@example.com"
        )

    def test_the_call_to_action_is_the_tracked_url(
        self,
        broadcast: BroadcastService,
        announcement: Announcement,
        notifier: RecordingNotifier,
        staff,
    ) -> None:
        """The indirection IS the measurement — a raw `link_path` in the email
        would be a link nobody can count."""
        make_subscribers(1)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)
        broadcast.send_pending(announcement.id)

        delivery = AnnouncementDelivery.objects.get()
        url = notifier.calls[0]["context"]["url"]
        assert url.startswith(f"{TRACKING_BASE}/api/v1/a/{announcement.id}/r?")
        assert f"d={delivery.id}" in url
        assert "to=%2Fevents%3Fcity%3DMumbai" in url

    def test_every_message_carries_a_working_unsubscribe_link(
        self,
        broadcast: BroadcastService,
        announcement: Announcement,
        notifier: RecordingNotifier,
        subscriptions,
        staff,
    ) -> None:
        make_subscribers(1)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)
        broadcast.send_pending(announcement.id)

        url = notifier.calls[0]["context"]["unsubscribe_url"]
        assert url.startswith(f"{SITE_BASE}/unsubscribe?token=")

        token = parse_qs(urlparse(url).query)["token"][0]
        subscriptions.unsubscribe(token=token)
        assert Subscriber.objects.get().unsubscribed_at is not None

    def test_an_announcement_with_no_link_gets_no_tracked_url(
        self,
        broadcast: BroadcastService,
        notifier: RecordingNotifier,
        staff,
    ) -> None:
        """Its click rate is then honestly zero, because there was nothing to
        click — not zero because tracking silently failed."""
        bare = Announcement.objects.create(kind="maintenance", title="Brief downtime tonight")
        make_subscribers(1)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=bare.id)
        broadcast.send_pending(bare.id)

        assert notifier.calls[0]["context"]["url"] == ""

    def test_somebody_who_left_between_the_press_and_the_send_is_skipped(
        self,
        broadcast: BroadcastService,
        announcement: Announcement,
        notifier: RecordingNotifier,
        staff,
    ) -> None:
        make_subscribers(2)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)

        leaver = Subscriber.objects.get(email="reader0@example.com")
        Subscriber.objects.filter(pk=leaver.pk).update(unsubscribed_at=leaver.created_at)

        assert broadcast.send_pending(announcement.id) == 1
        assert [call["recipient"] for call in notifier.calls] == ["reader1@example.com"]

    def test_a_full_batch_re_enqueues_itself(
        self,
        broadcast: BroadcastService,
        announcement: Announcement,
        queue: CountingQueue,
        staff,
    ) -> None:
        """One press has to drive a list of any size, in bounded, resumable
        steps."""
        make_subscribers(5)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)
        queue.calls.clear()

        assert broadcast.send_pending(announcement.id, limit=2) == 2
        assert queue.calls == [(BROADCAST_TASK, {"announcement_id": str(announcement.id)})]

        # ... and the last, partial batch does not.
        broadcast.send_pending(announcement.id, limit=2)
        queue.calls.clear()
        broadcast.send_pending(announcement.id, limit=2)
        assert queue.calls == []

    def test_a_deleted_announcement_mid_send_is_a_quiet_no_op(
        self, broadcast: BroadcastService, announcement: Announcement, staff
    ) -> None:
        make_subscribers(1)
        broadcast.queue_broadcast(actor_id=staff.id, announcement_id=announcement.id)
        announcement_id = announcement.id
        Announcement.objects.filter(pk=announcement_id).delete()

        assert broadcast.send_pending(announcement_id) == 0
        # The delivery rows went with it — a measurement of a message nobody
        # can look at is not worth keeping.
        assert AnnouncementDelivery.objects.count() == 0


@pytest.mark.django_db
class TestBroadcastEndpoint:
    """`POST /admin/announcements/{id}/send`, through the composition root."""

    def _url(self, announcement: Announcement) -> str:
        return f"/api/v1/admin/announcements/{announcement.id}/send"

    @pytest.fixture
    def configured(self, settings):
        settings.PUBLIC_API_BASE_URL = TRACKING_BASE
        settings.PUBLIC_SITE_URL = SITE_BASE

    def test_staff_queue_a_campaign(self, announcement: Announcement, staff, configured) -> None:
        make_subscribers(2)
        client = APIClient()
        client.force_authenticate(user=staff)

        response = client.post(self._url(announcement))

        # 202, not 201: this accepted the work, it did not complete it.
        assert response.status_code == 202
        assert response.json() == {
            "announcement_id": str(announcement.id),
            "recipients": 2,
            "newly_queued": 2,
        }
        assert AnnouncementDelivery.objects.count() == 2

    def test_pressing_twice_reports_nothing_new_rather_than_failing(
        self, announcement: Announcement, staff, configured
    ) -> None:
        """An operator who is unsure whether it already went out needs an
        answer, not an error and not a second send."""
        make_subscribers(2)
        client = APIClient()
        client.force_authenticate(user=staff)

        client.post(self._url(announcement))
        second = client.post(self._url(announcement))

        assert second.json()["newly_queued"] == 0
        assert AnnouncementDelivery.objects.count() == 2

    def test_an_unconfigured_deployment_is_told_which_setting_is_missing(
        self, announcement: Announcement, staff, settings
    ) -> None:
        settings.PUBLIC_API_BASE_URL = ""
        settings.PUBLIC_SITE_URL = ""
        client = APIClient()
        client.force_authenticate(user=staff)

        response = client.post(self._url(announcement))

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "broadcast_not_configured"
        assert "PUBLIC_API_BASE_URL" in response.json()["error"]["message"]

    def test_a_member_cannot_send(self, announcement: Announcement, configured) -> None:
        member = User.objects.create_user(email="member@example.com", password="memberpass12345")
        client = APIClient()
        client.force_authenticate(user=member)

        assert client.post(self._url(announcement)).status_code == 403

    def test_it_needs_an_account(self, announcement: Announcement, configured) -> None:
        assert APIClient().post(self._url(announcement)).status_code == 401
