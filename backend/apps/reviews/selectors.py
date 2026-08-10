"""Read-only queries for reviews. Kept off the write side (CQRS-lite)."""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass

from apps.events.models import Event
from config.di import cache_port

from .repositories import ReviewRepository

#: The summary is read on every event page view and changes only when somebody
#: reviews. 300s is the same rung `console` uses for its aggregates: short
#: enough that a new review appears promptly, long enough to absorb the traffic
#: a popular event's page generates. Invalidated on every write anyway, so the
#: TTL is a backstop rather than the mechanism.
SUMMARY_TTL_SECONDS = 300


@dataclass(frozen=True)
class ReviewSummary:
    average: float
    count: int
    #: 1..5 -> how many. Always all five keys, zeros included — a chart handed
    #: only the stars that occurred draws a bar chart with missing bars, the
    #: same defect `console`'s dense timeseries exists to avoid.
    distribution: dict[int, int]


def summary_key(event_id: uuid.UUID | str) -> str:
    return f"event:reviews:{event_id}"


def get_review_summary(
    event_id: uuid.UUID | str, *, reviews: ReviewRepository | None = None
) -> ReviewSummary:
    """Average, count and distribution for one event.

    ── WHERE EACH NUMBER COMES FROM, AND WHY THEY DIFFER ─────────────────────

    `average` and `count` are read off the EVENT ROW (`rating_sum` /
    `rating_count`), which `apps.reviews` maintains atomically. That is the
    denormalised path the research pointed to: a card showing "4.6 (128)" must
    not aggregate review rows, and at 10,000 reviews an `AVG()` per page view
    is the wrong shape however well indexed.

    The DISTRIBUTION is aggregated live, because five more denormal columns
    would be five more things to keep in step through create, edit, hide and
    restore — four write paths — to save one indexed `GROUP BY` that runs on a
    cached read. That trade only pays at a scale this platform is nowhere near,
    and the cost of getting it wrong is a bar chart that lies.
    """
    cache = cache_port()
    cached = cache.get(summary_key(event_id))
    if isinstance(cached, dict):
        return ReviewSummary(
            average=float(cached["average"]),
            count=int(cached["count"]),
            distribution={int(k): int(v) for k, v in cached["distribution"].items()},
        )

    row = Event.objects.filter(id=event_id).values("rating_sum", "rating_count").first()
    total = int(row["rating_sum"]) if row else 0
    count = int(row["rating_count"]) if row else 0
    # Rounded to one place at the boundary rather than in each renderer, so the
    # web page, an email and a future app cannot disagree about whether 4.25 is
    # 4.2 or 4.3.
    average = round(total / count, 1) if count else 0.0

    repository = reviews or ReviewRepository()
    counts = repository.distribution(event_id)
    summary = ReviewSummary(
        average=average,
        count=count,
        distribution={star: counts.get(star, 0) for star in range(1, 6)},
    )
    cache.set(summary_key(event_id), asdict(summary), timeout_seconds=SUMMARY_TTL_SECONDS)
    return summary


def invalidate_review_summary(event_id: uuid.UUID | str) -> None:
    cache_port().delete(summary_key(event_id))
