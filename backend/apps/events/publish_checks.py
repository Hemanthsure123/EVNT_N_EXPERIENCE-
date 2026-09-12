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
from .models import Event, MediaKind
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
def _require_poster(event: Event) -> None:
    """The one image every surface draws. It cannot be absent at publish.

    ── WHY THIS IS A GATE AND NOT A COLUMN CONSTRAINT ─────────────────────

    `Event.poster_url` is `blank=True` and stays that way: an event is created
    by a wizard that autosaves on a keystroke, and a NOT NULL at the column
    would refuse the first save of a title. Completeness belongs where
    completeness is already decided — beside the tag minimum and the gallery
    floor, which both carry the same argument in their own docstrings.

    ── WHY IT IS REQUIRED AT ALL ──────────────────────────────────────────

    The poster is not decoration on this platform. It is the LCP element of
    the event page, the whole of a `PosterCard` on the front page, the shared
    element the mobile deck flies between two boxes, the OG image a shared
    link renders, and the artwork on the issued ticket. Without one, every one
    of those falls back to a flat placeholder — and a placeholder is a
    BROKEN-IMAGE fallback, not a permission to publish without artwork. An
    organizer who never uploads one ships a listing that reads, on every
    surface the platform has, as an event nobody finished making.
    """
    if not event.poster_url.strip():
        raise EventNotPublishableError(
            "An event poster is required. Add one in Media before publishing."
        )


def _require_gallery_size(event: Event) -> None:
    """A gallery is either absent or a GALLERY — never one lonely photograph.

    ── WHY THE FLOOR IS HERE AND THE CEILING IS NOT ───────────────────────

    The maximum (`MEDIA_LIMITS[GALLERY]`) is an upload-time refusal, because
    the eleventh image is a request that can be answered on its own terms:
    there is no room, and nothing about the event's other state changes that.

    The minimum cannot work that way. Images arrive one at a time, so a
    save-time floor would refuse the first upload for being the first, and a
    removal-time floor would refuse an organizer replacing both of their
    photographs unless they added before subtracting. Completeness belongs
    where completeness is already decided — beside "has enough tags", which
    carries the same argument in its own docstring.

    ZERO IS NOT A FAILURE. Most events on this platform publish no gallery,
    the section is absent rather than empty when they do, and a gate
    demanding two photographs of a club night would refuse to publish it.
    The rule is about a gallery that EXISTS being worth the name.
    """
    from .repositories import MIN_GALLERY_IMAGES, EventContentRepository

    count = EventContentRepository().count_media(event.id, MediaKind.GALLERY)
    if count == 0 or count >= MIN_GALLERY_IMAGES:
        return
    raise EventNotPublishableError(
        f"A gallery needs at least {MIN_GALLERY_IMAGES} photos. "
        "Add another, or remove the one you have."
    )


# register_publish_check(); order is preserved (checks run first-registered
# first), and the first failure raises.
_PUBLISH_CHECKS: list[PublishCheck] = [
    _require_title,
    _require_venue,
    _require_future_start,
    _require_tags,
    _require_poster,
    _require_gallery_size,
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
