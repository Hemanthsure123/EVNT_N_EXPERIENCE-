"""Real PushPort adapter — the Web Push protocol (RFC 8030 + VAPID RFC 8292).

Requires the optional `push` extra (`pip install -e ".[push]"`). Only
imported by config/di.py when PUSH_BACKEND=webpush AND VAPID keys are set;
with keys unset the DI factory returns the disabled adapter below instead,
so a deployment without them reports push as unavailable rather than
collecting subscriptions it can never deliver to.

There is no vendor here. `subscription.endpoint` names the push service the
browser chose, and this sends an encrypted payload to that URL signed with
our own VAPID key. Chrome, Firefox and Safari each run their own; none of
them needs an account.
"""

from __future__ import annotations

import json
import logging

from core.ports.push_port import PushPort, PushResult, PushSubscription

logger = logging.getLogger(__name__)

# What a push service returns when the subscription no longer exists. 410 is
# the specified answer; 404 shows up in practice from some services and means
# the same thing. Both are a row to delete, never a send to retry.
_GONE_STATUSES = frozenset({404, 410})

# Push services cap the payload. Chrome's limit is 4096 bytes of ciphertext,
# and encryption adds overhead, so the plaintext budget is smaller. A
# notification is a title and a line — anything approaching this is a bug in
# the caller, not a message worth truncating silently.
MAX_PAYLOAD_BYTES = 3000


class WebPushAdapter(PushPort):
    def __init__(self, *, public_key: str, private_key: str, contact: str) -> None:
        if not (public_key and private_key):
            raise ValueError("WebPushAdapter needs both VAPID keys; use DisabledPushAdapter.")
        if not contact:
            # The VAPID spec requires a `sub` claim, and push services reject a
            # token without one. Failing here beats a 403 from Firefox on the
            # first real send.
            raise ValueError(
                "VAPID_CONTACT is required — a mailto: or https URL a push "
                "service can reach you at. See REAL_INTEGRATIONS_AUDIT.md."
            )
        self._public_key = public_key
        self._private_key = private_key
        self._contact = contact

    def is_configured(self) -> bool:
        return True

    def public_key(self) -> str:
        return self._public_key

    def send(
        self,
        *,
        subscription: PushSubscription,
        title: str,
        body: str,
        url: str = "",
        tag: str = "",
    ) -> PushResult:
        from pywebpush import WebPushException, webpush

        payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
        if len(payload.encode()) > MAX_PAYLOAD_BYTES:
            # Refused rather than truncated: half a message is worse than a
            # logged error, and this can only be a caller bug.
            return PushResult(delivered=False, error="payload too large")

        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=payload,
                vapid_private_key=self._private_key,
                vapid_claims={"sub": self._contact},
                timeout=10,
            )
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in _GONE_STATUSES:
                # Expected at any scale — people clear site data and uninstall
                # browsers. The caller deletes the row; nothing is retried.
                return PushResult(delivered=False, gone=True, error="subscription expired")
            logger.warning("push.send_failed", extra={"status": status})
            return PushResult(delivered=False, error=f"push failed ({status or 'no status'})")
        except Exception as exc:  # noqa: BLE001 — a timeout or DNS failure is retryable
            logger.warning("push.send_error", exc_info=True)
            return PushResult(delivered=False, error=str(exc)[:200])

        return PushResult(delivered=True)


class DisabledPushAdapter(PushPort):
    """What runs when no VAPID keys are configured — which is the default.

    Not a fake: it does not pretend to deliver. `is_configured()` is False, so
    the subscription endpoint refuses to store anything and the UI says push
    is unavailable instead of asking for a browser permission it cannot
    honour. That distinction is the whole point — a console adapter that logs
    "sent!" is exactly the kind of thing this audit removed.
    """

    def is_configured(self) -> bool:
        return False

    def public_key(self) -> str:
        return ""

    def send(
        self,
        *,
        subscription: PushSubscription,
        title: str,
        body: str,
        url: str = "",
        tag: str = "",
    ) -> PushResult:
        return PushResult(delivered=False, error="push is not configured")
