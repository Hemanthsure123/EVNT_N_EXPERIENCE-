"""How often an event is SEEN — the write side behind the organizer's views,
impressions and click-through.

── WHY THE BROWSER REPORTS IT ─────────────────────────────────────────────

The public event read is edge-cached, with a warm path of zero queries (see
CLAUDE.md, "The public read path"). A request the CDN answers never reaches
Django, so a server-side counter would count cache MISSES — a number that goes
down as a page gets more popular. The page reports itself instead, through
`POST /events/engagement`, and nothing on the read path changes.

── WHAT THE SERVER STILL DECIDES ──────────────────────────────────────────

The browser dedupes (one impression per card per page load, one view per event
per tab per half hour), and that is a courtesy rather than a guarantee: the
beacon is anonymous and can be replayed. So the server applies its own floor
on every beacon — each event counts at most ONCE per kind, whatever the batch
repeats — and the endpoint is throttled per IP. That BOUNDS inflation; it does
not prevent it, and these figures are indicative rather than audited. No money
is ever decided by them, which is what makes that trade acceptable.

── WHAT IS NEVER KEPT ─────────────────────────────────────────────────────

No user, no IP, no user agent, no session id. The visitor's chosen city is
compared with the event's on the way in and discarded; only the counts survive.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from uuid import UUID

from django.utils import timezone

from .repositories import EventEngagementRepository

#: IST, the platform's day — the same fixed offset
#: `apps.organizer.selectors.PLATFORM_TZ` anchors "today" to, so a view counted
#: today here lands on the day the dashboard calls today.
PLATFORM_TZ = dt.timezone(dt.timedelta(hours=5, minutes=30))

#: A beacon's bounds. Generous for a real page — the client flushes every few
#: seconds — and tight enough that one anonymous request cannot be a bulk write.
MAX_IMPRESSIONS = 100
MAX_VIEWS = 20

#: A view that began with a press on one of the event's cards. Everything else
#: — a shared link, a bookmark, a typed URL, an email — is `direct`.
SOURCE_FEED = "feed"
SOURCE_DIRECT = "direct"
VIEW_SOURCES = (SOURCE_FEED, SOURCE_DIRECT)

#: User agents that are machines. Link unfurlers matter as much as crawlers
#: here: pasting an event into a chat app makes the app's preview bot render
#: the page, and without this every share would count as a view by nobody.
#: `headless` catches the e2e suite, which must never write into these counts.
_AUTOMATED = re.compile(
    r"bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|monitor",
    re.IGNORECASE,
)


def is_automated(user_agent: str) -> bool:
    """True for a crawler, an unfurler, a monitor — or a request with no user
    agent at all, which no real browser sends."""
    return not user_agent or bool(_AUTOMATED.search(user_agent))


@dataclass(frozen=True)
class EngagementIncrement:
    """What one beacon adds to one event's counters for one day."""

    event_id: str
    date: dt.date
    impressions: int = 0
    views: int = 0
    feed_views: int = 0
    located_views: int = 0
    local_views: int = 0


def same_city(visitor_city: str | None, event_city: str | None) -> bool:
    """`Event.city` is free text and the header's city is a curated name, so the
    comparison ignores case and surrounding space — "mumbai " is Mumbai."""
    if not visitor_city or not event_city:
        return False
    return visitor_city.strip().casefold() == event_city.strip().casefold()


class EngagementService:
    def __init__(
        self,
        *,
        engagement: EventEngagementRepository,
        clock: Callable[[], dt.datetime] = timezone.now,
    ) -> None:
        self._engagement = engagement
        self._clock = clock

    def record(
        self,
        *,
        impressions: Iterable[UUID | str],
        views: Iterable[dict],
        city: str | None = None,
    ) -> int:
        """Add one beacon to today's counters. Returns how many events it touched.

        Each event counts ONCE per kind per beacon, whatever the batch repeats —
        see the module docstring. When the same event arrives as both a feed and
        a direct view, the feed wins: the press on the card is the fact the
        click-through rate exists to measure.

        Ids that are not live events are DROPPED rather than failing the batch.
        A tab left open reports an event deleted since, and the other ids in the
        same beacon are real.
        """
        seen = {str(event_id) for event_id in impressions}
        viewed: dict[str, str] = {}
        for view in views:
            event_id = str(view["event_id"])
            if viewed.get(event_id) != SOURCE_FEED:
                viewed[event_id] = view.get("source") or SOURCE_DIRECT
        if not seen and not viewed:
            return 0

        cities = self._engagement.cities_for(seen | set(viewed))
        if not cities:
            return 0

        day = self._clock().astimezone(PLATFORM_TZ).date()
        located = bool(city and city.strip())
        increments = []
        for event_id, event_city in cities.items():
            source = viewed.get(event_id)
            is_view = source is not None
            increments.append(
                EngagementIncrement(
                    event_id=event_id,
                    date=day,
                    impressions=1 if event_id in seen else 0,
                    views=1 if is_view else 0,
                    feed_views=1 if source == SOURCE_FEED else 0,
                    # Only VIEWS carry a city: "where are the people looking at
                    # this from" is asked of people who opened it, not of
                    # everybody who scrolled past a card.
                    located_views=1 if is_view and located else 0,
                    local_views=1 if is_view and same_city(city, event_city) else 0,
                )
            )
        self._engagement.add(increments)
        return len(increments)
