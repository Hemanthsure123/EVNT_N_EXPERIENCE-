"""STAGED COMPOSITION — these three factories belong in `config/di.py`.

`config/di.py` is the composition root and the only file allowed to know which
concrete adapter backs each port. These functions are written exactly as they
should appear there and are parked here only because this slice does not own
that file; the module's wiring notes carry the paste-ready version and the four
import lines that change when it lands. Nothing here selects an adapter — the
port factories are imported from the real composition root, which is what keeps
this a staging area rather than a second root.

`PUBLIC_API_BASE_URL` is read through `getattr` for the same reason: the
setting has to be declared in `config/settings/base.py` (see the wiring notes),
and until it is, `BroadcastService` refuses to send rather than emitting email
whose links point nowhere.
"""

from __future__ import annotations

from django.conf import settings

from .repositories import (
    AnnouncementDeliveryRepository,
    AnnouncementRepository,
    SubscriberRepository,
)
from .services import BroadcastService, ClickTrackingService, SubscriptionService


def build_subscription_service() -> SubscriptionService:
    """Joining and leaving the Curatix list. Public; the view throttles it."""
    return SubscriptionService(subscribers=SubscriberRepository())


def build_click_tracking_service() -> ClickTrackingService:
    """The tracked redirect in an announcement email."""
    return ClickTrackingService(
        deliveries=AnnouncementDeliveryRepository(),
        site_url=settings.PUBLIC_SITE_URL,
    )


def build_broadcast_service() -> BroadcastService:
    """Sending one announcement to the subscriber list.

    `notifier` is `NotificationService` itself — announcements asks
    notifications to send; nothing in notifications knows this module exists.
    """
    from config.di import build_notification_service, task_queue_port

    return BroadcastService(
        announcements=AnnouncementRepository(),
        subscribers=SubscriberRepository(),
        deliveries=AnnouncementDeliveryRepository(),
        subscriptions=build_subscription_service(),
        notifier=build_notification_service(),
        task_queue=task_queue_port(),
        tracking_base_url=getattr(settings, "PUBLIC_API_BASE_URL", ""),
        site_url=settings.PUBLIC_SITE_URL,
    )
