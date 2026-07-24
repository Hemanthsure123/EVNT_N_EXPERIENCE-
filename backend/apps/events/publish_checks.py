"""Publish-readiness checks — an EXTENSIBLE list, so future modules can add
gates without touching the publish service.

Each check takes the `Event` about to be published and raises
`EventNotPublishableError` if it isn't ready. The service runs every
registered check before transitioning draft -> live.

The `ticketing` module is the motivating example: it will call
`register_publish_check(...)` from its `AppConfig.ready()` to add a "must
have at least one ticket type" gate — no edit to this module required. That
check lives in `ticketing` precisely because *this* module must not know
ticketing exists (dependencies point one way: ticketing -> events).
"""

from __future__ import annotations

from collections.abc import Callable

from django.utils import timezone

from .exceptions import EventNotPublishableError
from .models import Event

PublishCheck = Callable[[Event], None]


def _require_title(event: Event) -> None:
    if not event.title.strip():
        raise EventNotPublishableError("An event needs a title before it can be published.")


def _require_venue(event: Event) -> None:
    if not event.venue.strip():
        raise EventNotPublishableError("An event needs a venue before it can be published.")


def _require_future_start(event: Event) -> None:
    if event.starts_at <= timezone.now():
        raise EventNotPublishableError("An event can't be published after its start time.")


# The core checks every event must pass. Modules append to this list via
# register_publish_check(); order is preserved (checks run first-registered
# first), and the first failure raises.
_PUBLISH_CHECKS: list[PublishCheck] = [
    _require_title,
    _require_venue,
    _require_future_start,
]


def register_publish_check(check: PublishCheck) -> None:
    """Add a publish-readiness gate. Idempotent per callable, so an app that
    re-runs its AppConfig.ready() (as the dev autoreloader can) doesn't stack
    duplicate checks."""
    if check not in _PUBLISH_CHECKS:
        _PUBLISH_CHECKS.append(check)


def run_publish_checks(event: Event) -> None:
    """Raise EventNotPublishableError on the first failing check."""
    for check in _PUBLISH_CHECKS:
        check(event)
