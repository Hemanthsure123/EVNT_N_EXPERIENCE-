"""Read side of announcements.

Cached per placement with a generation counter, the same shape the CMS uses:
one writer (an operator), so precise invalidation is correct, and the homepage
placement is read by every anonymous visitor.

  - `ann:{placement}:v{gen}` — 300s
  - `ann:gen`                — bumped on every write

The CAMPAIGN ANALYTICS below are deliberately NOT cached. They are read by a
handful of operators on an admin page, they are two index-backed aggregates,
and they change every time somebody clicks — an operator who sends a test and
refreshes needs to see their own click, not a figure from thirty seconds ago
that looks exactly like the tracking being broken.
"""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone

from core.errors import NotFoundError
from core.ports.cache_port import CachePort

from .repositories import AnnouncementDeliveryRepository, AnnouncementRepository

TTL_SECONDS = 300
GENERATION_KEY = "ann:gen"
PLACEMENTS = ("home", "organizer", "admin")


def _cache() -> CachePort:
    from config.di import cache_port

    return cache_port()


def _generation(cache: CachePort) -> int:
    """Absent means ZERO, not one.

    `incr` on a missing key sets it to 1. If the default were also 1, the very
    first invalidation would be a no-op — the key would go from "absent,
    treated as 1" to "1", the cache key would not change, and the stale
    payload would keep being served. Starting at 0 means the first write moves
    v0 -> v1 and genuinely orphans the old entry.
    """
    value = cache.get(GENERATION_KEY)
    return int(value) if value is not None else 0


def invalidate_announcements() -> None:
    cache = _cache()
    try:
        cache.incr(GENERATION_KEY)
    except Exception:  # pragma: no cover - adapter without incr on a cold key
        cache.set(GENERATION_KEY, _generation(cache) + 1, timeout_seconds=None)


def get_live(
    placement: str,
    *,
    repository: AnnouncementRepository | None = None,
    cache: CachePort | None = None,
) -> list[dict[str, Any]]:
    repository = repository or AnnouncementRepository()
    cache = cache or _cache()
    placement = placement if placement in PLACEMENTS else "home"

    key = f"ann:{placement}:v{_generation(cache)}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    rows = [
        {
            "id": str(row.id),
            "kind": row.kind,
            "title": row.title,
            "body": row.body,
            "link_path": row.link_path,
            "link_label": row.link_label,
            "dismissible": row.dismissible,
        }
        for row in repository.list_live(placement=placement, now=timezone.now())
    ]
    cache.set(key, rows, timeout_seconds=TTL_SECONDS)
    return rows


def get_announcement_analytics(
    announcement_id: uuid.UUID | str,
    *,
    announcements: AnnouncementRepository | None = None,
    deliveries: AnnouncementDeliveryRepository | None = None,
) -> dict[str, Any]:
    """The four figures an operator gets for a campaign, and only those four.

    - `recipients` — delivery rows. How many people the send was queued for.
    - `delivered`  — rows whose notification actually reached `sent`. How many
      members received the announcement by mail; the difference from
      `recipients` is a real backlog or a real dead-letter, not rounding.
    - `clicked`    — rows with a `clicked_at`. How many came back to the
      platform.
    - `click_rate` — `clicked / delivered`.

    DELIVERED IS THE DENOMINATOR, not recipients. Nobody can click an email
    that was never sent, so dividing by queued rows would report a campaign
    still in flight as a campaign people ignored — and the number would climb
    on its own as the backlog drains, which is the most misleading shape a
    metric can have.

    There is no `opened` here and no fifth figure is coming. See
    `AnnouncementDelivery`'s docstring: a pixel measures Apple's proxy and
    Gmail's cache, not a person.

    The three COUNTS are computed in Postgres in one query — the O(n) work
    never leaves the database. `click_rate` is one division of the two integers
    that query returned; expressing it in SQL would add a cast and a NULLIF and
    move nothing.
    """
    announcements = announcements or AnnouncementRepository()
    deliveries = deliveries or AnnouncementDeliveryRepository()

    # A mistyped id would otherwise return four zeros, which reads as "this
    # campaign reached nobody" — the same wrong-in-a-knowable-direction number
    # this module refuses to render for opens. One PK lookup buys a 404.
    if announcements.get(announcement_id) is None:
        raise NotFoundError("No such announcement.")

    totals = deliveries.aggregate_engagement(announcement_id)

    delivered = int(totals["delivered"] or 0)
    clicked = int(totals["clicked"] or 0)
    return {
        "announcement_id": str(announcement_id),
        "recipients": int(totals["recipients"] or 0),
        "delivered": delivered,
        "clicked": clicked,
        # Zero over zero is zero, not an error and not null: a campaign nobody
        # has received yet has a click rate of nothing, and the admin renders
        # the raw counts beside it so "0 of 0" is never mistaken for failure.
        "click_rate": round(clicked / delivered, 4) if delivered else 0.0,
    }
