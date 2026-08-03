"""Error reporting.

Server exceptions are already logged as structured JSON with a request id
(`core/logging.py`), which is the record of truth. What logs cannot do is
tell anyone that something broke — reading them requires already suspecting
a problem. This adds reporting on top, never instead.

**No credential is needed to have this code.** `SENTRY_DSN` unset means the
SDK is never imported and nothing changes; setting it turns reporting on
with no code change anywhere else. That is the whole seam: this is the only
file in the codebase that knows Sentry exists.

Two decisions worth stating, because both are about not leaking:

- **`send_default_pii` stays off.** Sentry would otherwise attach request
  bodies, cookies and the authenticated user's email to every event. A
  ticketing platform's request bodies contain names, phone numbers and
  payment references, and an error tracker is not a place to store them.
  The request id is attached instead, which joins an alert to the logs
  without moving any of the data into a third party.
- **The DSN is not a secret in the usual sense** (it is embedded in client
  bundles by design) but it is still an ingest endpoint, so it comes from
  the environment rather than the repo like everything else.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # TYPE-ONLY, and it has to be: `sentry_sdk._types.Event` is itself declared
    # under the SDK's own `TYPE_CHECKING` guard, so importing it at runtime
    # raises ImportError even when sentry-sdk IS installed. Guarding it here
    # also keeps the module's promise that nothing imports the SDK unless
    # SENTRY_DSN is set — `from __future__ import annotations` means the
    # annotation below is never evaluated.
    from sentry_sdk._types import Event, Hint

logger = logging.getLogger(__name__)


def init_error_reporting(
    *,
    dsn: str,
    environment: str,
    release: str = "",
    traces_sample_rate: float = 0.0,
) -> bool:
    """Return True if reporting was switched on.

    Never raises. An observability tool that can stop the application from
    starting has inverted its own purpose — if the SDK is missing or the DSN
    is malformed, that is worth a log line, not an outage.
    """
    if not dsn:
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.django import DjangoIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        logger.warning(
            "observability.sdk_missing: SENTRY_DSN is set but sentry-sdk is not "
            'installed. Install the extra: pip install -e ".[observability]"'
        )
        return False

    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=environment,
            release=release or None,
            traces_sample_rate=traces_sample_rate,
            # PII off — see the module docstring.
            send_default_pii=False,
            integrations=[
                DjangoIntegration(),
                # Breadcrumbs from INFO, events from ERROR. `logger.exception`
                # calls already scattered through the codebase become reports
                # without a single call site changing.
                LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
            ],
            before_send=_scrub,
        )
    except Exception:
        logger.warning("observability.init_failed", exc_info=True)
        return False

    logger.info("observability.enabled", extra={"environment": environment})
    return True


# Header and body keys that must never leave the platform, matched
# case-insensitively against a substring. Deliberately broad: a false
# positive costs a redacted field in a stack trace, a false negative costs a
# webhook secret sitting in a third party's database.
_SENSITIVE = (
    "authorization",
    "cookie",
    "token",
    "secret",
    "password",
    "signature",
    "x-razorpay",
    "idempotency-key",
    "qr",
)


def _scrub(event: Event, hint: Hint) -> Event:
    """Sentry's `before_send`. Typed with the SDK's own `Event`/`Hint` rather
    than `dict`: `before_send` is the last thing to run before an event leaves
    the platform, and `dict` made mypy accept any shape here — including one
    that quietly stopped matching what Sentry passes."""
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                key: ("[redacted]" if _is_sensitive(key) else value)
                for key, value in headers.items()
            }
        # Bodies are dropped wholesale rather than filtered. A booking payload
        # is nested and vendor payloads change shape without warning, so
        # key-matching would eventually miss one.
        request.pop("data", None)
        request.pop("cookies", None)
    return event


def _is_sensitive(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in _SENSITIVE)
