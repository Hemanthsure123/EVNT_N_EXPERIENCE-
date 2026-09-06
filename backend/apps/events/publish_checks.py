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
from .taxonomy import MIN_TAGS_TO_PUBLISH

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


def _require_tags(event: Event) -> None:
    """Enough tags to be FOUND.

    ── WHY THIS IS A PUBLISH GATE AND NOT A SAVE-TIME RULE ────────────────

    Tags are the only thing on an event that decides whether somebody browsing
    a filter ever sees it. An event with none is not incomplete in the way a
    missing age limit is — it is invisible, and the organizer discovers that
    weeks later as "nobody came".

    But it is emphatically NOT a validation rule. The wizard is local-first and
    autosaves on a keystroke, so a save-time minimum means somebody who has
    typed a title cannot keep it while they think about tags. Completeness
    belongs where completeness is already decided, next to "at least one
    ticket type".

    The number comes from `taxonomy.MIN_TAGS_TO_PUBLISH`. It counts TAGS, not
    dimensions: a rule of "one from each of the seven" reads as tidier and is
    worse in practice — an online-only event has nothing true to say under
    "Setting" beyond `online`, and forcing a choice under every heading is how
    a taxonomy fills up with tags nobody meant.
    """
    if len(event.tags or []) < MIN_TAGS_TO_PUBLISH:
        raise EventNotPublishableError(
            f"Pick at least {MIN_TAGS_TO_PUBLISH} tags so people browsing can find this event."
        )


# The core checks every event must pass. Modules append to this list via
# register_publish_check(); order is preserved (checks run first-registered
# first), and the first failure raises.
_PUBLISH_CHECKS: list[PublishCheck] = [
    _require_title,
    _require_venue,
    _require_future_start,
    _require_tags,
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
