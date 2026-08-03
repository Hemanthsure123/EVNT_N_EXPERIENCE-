"""Port for Web Push delivery.

Push is the one channel the platform asked users to grant a permission for
without being able to use it: the discovery grid's subscribe card called
`Notification.requestPermission()` and then said "Notifications are on for
this device", which was true about the browser permission and false about
everything that matters — nothing subscribed, nothing was stored, and
nothing could ever be sent.

── WHY THIS PORT NEEDS NO VENDOR ─────────────────────────────────────────

Web Push is a W3C/IETF standard, not a product. The browser tells you which
push service to talk to (`subscription.endpoint` — Google's FCM for Chrome,
Mozilla's autopush for Firefox, Apple's for Safari), the payload is
encrypted with keys the browser generated, and the sender authenticates
with VAPID keys you generate yourself. So unlike email or SMS there is no
account to open and no key to be issued: `manage.py generate_vapid_keys`
prints a pair and that is the entire credential story.

── UNSUBSCRIBED IS A NORMAL RESULT, NOT AN ERROR ─────────────────────────

`send` returns a `PushResult` rather than raising, because "this
subscription is gone" is the most common outcome at any scale — people
clear site data, uninstall browsers, and let installs expire. A push
service reports that as `404`/`410`, which is not a failure to handle but a
row to delete. Conflating it with a transient network error would either
retry something that can never succeed, or dead-letter a device that simply
moved on.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class PushSubscription:
    """Exactly what the browser's `PushSubscription.toJSON()` carries.

    `p256dh` and `auth` are the browser's own encryption keys. The payload is
    encrypted TO them, which is what makes push end-to-end encrypted between
    this server and that device — the push service in the middle relays
    ciphertext it cannot read.
    """

    endpoint: str
    p256dh: str
    auth: str


@dataclass(frozen=True)
class PushResult:
    delivered: bool
    #: True when the push service says this subscription no longer exists
    #: (404/410). The caller should DELETE the row — retrying cannot help.
    gone: bool = False
    error: str = ""


class PushPort(ABC):
    @abstractmethod
    def is_configured(self) -> bool:
        """Whether sending is actually possible.

        Callers ask BEFORE offering the feature, so a deployment without
        VAPID keys says push is unavailable rather than collecting
        subscriptions it can never deliver to.
        """

    @abstractmethod
    def public_key(self) -> str:
        """The VAPID public key, for `pushManager.subscribe`. Public by design
        — it is handed to every browser that subscribes."""

    @abstractmethod
    def send(
        self,
        *,
        subscription: PushSubscription,
        title: str,
        body: str,
        url: str = "",
        tag: str = "",
    ) -> PushResult:
        """Deliver one notification to one device. Never raises for an
        expected outcome; see `PushResult`."""
