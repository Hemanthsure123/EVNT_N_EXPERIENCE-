"""Read side of the organizer dashboard (CQRS-lite, like every other module).

Composes `OrganizerRepository` aggregates into the payloads the dashboard
renders. No ORM here, no serializers — those live either side.

CACHING, and the one rule that governs it: **every key is namespaced by the
owner.** `console:overview` is a single platform-wide key because there is one
platform. Here there are thousands of organizers, and a key that forgot its
owner would serve one organizer's revenue to the next request from another —
the worst possible cache bug on a money surface. So the owner id is the first
thing in every key, and nothing in this file builds a key any other way.

  - `organizer:{owner}:overview`            — 30s
  - `organizer:{owner}:series:{m}:{d}`      — 300s
  - `organizer:{owner}:breakdown:{by}:{n}`  — 300s
  - `organizer:{owner}:event:{id}:analytics` — 60s

No invalidation-on-write, for the same reason `console` has none: these are
aggregates touched by bookings, payments, refunds, check-ins and settlements,
so precise invalidation would mean five modules knowing about this one. Short
TTLs are the simpler, more robust answer for a dashboard. Tables and lists —
where an organizer acts on an individual row — are NOT cached at all.
"""

from __future__ import annotations

import datetime as dt
from typing import Any
from uuid import UUID

from django.utils import timezone

from core.ports.cache_port import CachePort

from .repositories import OrganizerRepository

OVERVIEW_TTL_SECONDS = 30
SERIES_TTL_SECONDS = 300
BREAKDOWN_TTL_SECONDS = 300
EVENT_ANALYTICS_TTL_SECONDS = 60

MAX_SERIES_DAYS = 365
DEFAULT_SERIES_DAYS = 30
MAX_BREAKDOWN_ITEMS = 20
MAX_ACTIVITY_ITEMS = 50
MAX_TOP_CITIES = 5

SERIES_METRICS = ("revenue", "bookings", "tickets")
BREAKDOWN_KINDS = ("revenue_by_event", "revenue_by_city", "bookings_by_status")

#: IST — the same anchor `console` uses. "Today" for an Indian organizer means
#: the Indian day; disagreeing with the operator console about when today
#: starts would make the two dashboards report different revenue for the same
#: hour.
PLATFORM_TZ = dt.timezone(dt.timedelta(hours=5, minutes=30))


def _default_cache() -> CachePort:
    from config.di import cache_port

    return cache_port()


def day_bounds(now: dt.datetime | None = None) -> tuple[dt.datetime, dt.datetime]:
    """Start and end of "today" in the platform timezone, as aware UTC instants."""
    now = now or timezone.now()
    local = now.astimezone(PLATFORM_TZ)
    start_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        start_local.astimezone(dt.timezone.utc),
        (start_local + dt.timedelta(days=1)).astimezone(dt.timezone.utc),
    )


def _percent_change(current: int, previous: int) -> float | None:
    """Trend as a percentage, or `None` when there is nothing to compare to.

    Returning `None` rather than 0 or 100 is deliberate: yesterday's zero makes
    "up 100%" meaningless, and the dashboard renders a dash instead of a
    triumphant green arrow that means nothing. A made-up trend is worse than an
    absent one.
    """
    if previous == 0:
        return None
    return round(((current - previous) / previous) * 100, 1)


def get_overview(
    owner_id: UUID,
    *,
    repository: OrganizerRepository | None = None,
    cache: CachePort | None = None,
) -> dict[str, Any]:
    """The six KPI tiles, each with yesterday's number for the trend.

    Every field is a real count or sum over rows this organizer owns. The
    comparison window is the SAME length as the current one (today vs
    yesterday), so the percentage answers a question that makes sense.
    """
    repository = repository or OrganizerRepository()
    cache = cache or _default_cache()

    key = f"organizer:{owner_id}:overview"
    cached = cache.get(key)
    if cached is not None:
        return cached

    now = timezone.now()
    start, end = day_bounds(now)
    prev_start, prev_end = start - dt.timedelta(days=1), start

    revenue_today = repository.sum_revenue_between(owner_id, start, end)
    revenue_yesterday = repository.sum_revenue_between(owner_id, prev_start, prev_end)
    bookings_today = repository.count_bookings_between(owner_id, start, end, status="paid")
    bookings_yesterday = repository.count_bookings_between(
        owner_id, prev_start, prev_end, status="paid"
    )
    tickets_today = repository.count_tickets_sold_between(owner_id, start, end)
    tickets_yesterday = repository.count_tickets_sold_between(owner_id, prev_start, prev_end)

    # Conversion = paid bookings / all bookings STARTED in the window. A
    # reserved-then-expired hold is exactly the abandonment this measures, so
    # the denominator is every booking row, not just the successful ones.
    started_today = repository.count_bookings_between(owner_id, start, end)
    conversion = round((bookings_today / started_today) * 100, 1) if started_today else None
    started_yesterday = repository.count_bookings_between(owner_id, prev_start, prev_end)
    conversion_yesterday = (
        round((bookings_yesterday / started_yesterday) * 100, 1) if started_yesterday else None
    )

    payload = {
        "revenue_today_minor": revenue_today,
        "revenue_change_pct": _percent_change(revenue_today, revenue_yesterday),
        "bookings_today": bookings_today,
        "bookings_change_pct": _percent_change(bookings_today, bookings_yesterday),
        "tickets_sold_today": tickets_today,
        "tickets_change_pct": _percent_change(tickets_today, tickets_yesterday),
        "events_upcoming": repository.count_upcoming_events(owner_id, now),
        "refunds_today": repository.count_refunds_between(owner_id, start, end),
        "refunds_today_minor": repository.sum_refunds_between(owner_id, start, end),
        "checkins_today": repository.count_checkins_between(owner_id, start, end),
        "conversion_pct": conversion,
        "conversion_change_pct": (
            None
            if conversion is None or conversion_yesterday is None
            else round(conversion - conversion_yesterday, 1)
        ),
        "generated_at": now.isoformat(),
    }
    cache.set(key, payload, timeout_seconds=OVERVIEW_TTL_SECONDS)
    return payload


def get_timeseries(
    owner_id: UUID,
    metric: str,
    days: int,
    *,
    end_date: dt.date | None = None,
    repository: OrganizerRepository | None = None,
    cache: CachePort | None = None,
) -> dict[str, Any]:
    """A DENSE daily series — every day in the window, zeros included.

    The database returns only days that have rows. Handing that to a chart
    draws a line that skips quiet days, silently turning a flat week into a
    climb. Filling the gaps here lets the chart stay dumb — and it is also what
    makes the KPI sparklines truthful.

    ── WHY A LENGTH AND AN END, NOT A FROM AND A TO ─────────────────────────

    A custom range arrives as two dates and is stored as `days` + `end_date`,
    because the window LENGTH is what everything downstream already speaks:
    the bound at `MAX_SERIES_DAYS`, the dense fill, the cache key, and the
    `days` field in the response. Keeping a second representation alongside it
    would mean two ways to express the same window and two places to get the
    clamp wrong.

    `end_date=None` keeps the previous behaviour exactly — a window ending
    today — so every existing caller, the KPI sparklines included, is
    unaffected and no cache entry changes shape.
    """
    repository = repository or OrganizerRepository()
    cache = cache or _default_cache()
    days = max(1, min(days, MAX_SERIES_DAYS))
    metric = metric if metric in SERIES_METRICS else "revenue"

    # A future end is clamped to today rather than refused: these params come
    # from a date picker somebody can type into, the view is already scoped to
    # the caller, and the worst a wrong value can do is show a window with no
    # rows in it. Same reasoning as the organizer list filters, which treat a
    # malformed date as absent instead of answering 400.
    # BOTH bounds: `day_bounds` returns (start of today, start of TOMORROW), so
    # the end bound's local date is tomorrow's. Deriving "today" from it moved
    # every custom window forward by a day — caught by
    # `test_a_future_end_is_clamped_to_today_not_refused`, which is the only
    # assertion that compares a clamped window against the rolling one.
    today_start, today_end = day_bounds()
    if end_date is not None:
        end_date = min(end_date, today_start.astimezone(PLATFORM_TZ).date())

    # The cache key carries the end, or a marker for "today". Without it a
    # custom window would be served the rolling window's cached points, which
    # is the kind of bug that shows a plausible chart for the wrong dates.
    key = (
        f"organizer:{owner_id}:series:{metric}:{days}:{end_date.isoformat() if end_date else 'now'}"
    )
    cached = cache.get(key)
    if cached is not None:
        return cached

    if end_date is None:
        end = today_end
    else:
        # `day_bounds` works in PLATFORM_TZ, so the window has to end at that
        # date's local midnight — not UTC's, which would shift every point by
        # a day for half the year.
        end = dt.datetime.combine(end_date + dt.timedelta(days=1), dt.time.min, tzinfo=PLATFORM_TZ)
    start = end - dt.timedelta(days=days)
    reader = {
        "revenue": repository.revenue_by_day,
        "bookings": repository.bookings_by_day,
        "tickets": repository.tickets_by_day,
    }[metric]
    by_day = dict(reader(owner_id, start, end))

    first_day = start.astimezone(PLATFORM_TZ).date()
    points = [
        {
            "date": (first_day + dt.timedelta(days=offset)).isoformat(),
            "value": int(by_day.get(first_day + dt.timedelta(days=offset), 0)),
        }
        for offset in range(days)
    ]

    payload = {"metric": metric, "days": days, "points": points}
    cache.set(key, payload, timeout_seconds=SERIES_TTL_SECONDS)
    return payload


def get_breakdown(
    owner_id: UUID,
    by: str,
    limit: int,
    *,
    repository: OrganizerRepository | None = None,
    cache: CachePort | None = None,
) -> dict[str, Any]:
    repository = repository or OrganizerRepository()
    cache = cache or _default_cache()
    limit = max(1, min(limit, MAX_BREAKDOWN_ITEMS))
    by = by if by in BREAKDOWN_KINDS else "revenue_by_event"

    key = f"organizer:{owner_id}:breakdown:{by}:{limit}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    reader = {
        "revenue_by_event": repository.revenue_by_event_label,
        "revenue_by_city": repository.revenue_by_city,
        "bookings_by_status": repository.bookings_by_status,
    }[by]
    payload = {
        "by": by,
        "items": [
            {"label": label or "Unknown", "value": value}
            for label, value in reader(owner_id, limit)
        ],
    }
    cache.set(key, payload, timeout_seconds=BREAKDOWN_TTL_SECONDS)
    return payload


def decorate_event_rows(rows: list, *, repository: OrganizerRepository | None = None) -> list[dict]:
    """Merge per-event aggregates onto ONE page of events.

    Three grouped queries against just this page's ids, merged by key — a fixed
    cost for a page of any size. See the note at the top of `repositories.py`
    for why these are not annotations on the base queryset.
    """
    repository = repository or OrganizerRepository()
    event_ids = [row.id for row in rows]
    if not event_ids:
        return []

    capacity = repository.capacity_by_event(event_ids)
    revenue = repository.revenue_by_event(event_ids)
    checkins = repository.checkins_by_event(event_ids)

    decorated = []
    for row in rows:
        cap, sold, tier_count = capacity.get(row.id, (0, 0, 0))
        decorated.append(
            {
                "id": row.id,
                "title": row.title,
                "status": row.status,
                "venue": row.venue,
                "city": row.city,
                "starts_at": row.starts_at,
                "ends_at": row.ends_at,
                "poster_url": row.poster_url,
                "organization_id": row.organization_id,
                "organization_name": row.organization.name,
                # Both of these exist so the dashboard can mirror the publish
                # gate instead of discovering it by being refused. The gate is
                # "organization verified" AND "at least one ticket type" AND
                # "starts in the future"; a Submit button that offers itself and
                # then fails is how an organizer concludes the platform is
                # broken rather than that their event is incomplete.
                "organization_verified_level": row.organization.verified_level,
                "ticket_type_count": tier_count,
                "capacity": cap,
                "sold": sold,
                "revenue_minor": revenue.get(row.id, 0),
                "checkins": checkins.get(row.id, 0),
                "from_price_minor": row.from_price_minor,
                "tickets_available": row.tickets_available,
                "version": row.version,
                "created_at": row.created_at,
                # The operator's feedback on a rejection. Exposed ONLY here —
                # this endpoint is scoped to the caller's own events. It is
                # deliberately NOT on `EventDetailSerializer`, which serves the
                # public detail page: an internal review note must never be
                # readable by an attendee.
                "moderation_note": row.moderation_note,
                "submitted_at": row.submitted_at,
            }
        )
    return decorated


def decorate_bookings(rows: list, *, repository: OrganizerRepository | None = None) -> list[dict]:
    """Attach ticket quantity to a page of bookings in one grouped query."""
    repository = repository or OrganizerRepository()
    booking_ids = [row.id for row in rows]
    quantities = repository.booking_item_counts(booking_ids) if booking_ids else {}
    return [
        {
            "id": row.id,
            "status": row.status,
            "total_amount_minor": row.total_amount_minor,
            "platform_fee_minor": row.platform_fee_minor,
            "payment_ref": row.payment_ref,
            # Null unless there is a payment that could actually be refunded.
            # The UI enables its action on THIS, never on `payment_ref`.
            "payment_id": getattr(row, "captured_payment_id", None),
            "hold_expires_at": row.hold_expires_at,
            "created_at": row.created_at,
            "quantity": quantities.get(row.id, 0),
            "customer_id": row.user_id,
            "customer_email": row.user.email,
            "customer_name": row.user.full_name,
            "event_id": row.event_id,
            "event_title": row.event.title,
            "event_starts_at": row.event.starts_at,
        }
        for row in rows
    ]


def get_customer_profile(
    owner_id: UUID, customer_id: UUID, *, repository: OrganizerRepository | None = None
) -> dict[str, Any]:
    """Not cached: a support agent opening this drawer is usually reacting to
    something that just happened, and a 30-second-old refund count is exactly
    the thing that makes them give the wrong answer."""
    repository = repository or OrganizerRepository()
    totals = repository.customer_totals(owner_id, customer_id)
    bookings = list(repository.customer_bookings(owner_id, customer_id)[:20])
    return {
        **totals,
        "customer_id": customer_id,
        "email": bookings[0].user.email if bookings else "",
        "recent_bookings": [
            {
                "id": booking.id,
                "status": booking.status,
                "total_amount_minor": booking.total_amount_minor,
                "created_at": booking.created_at,
                "event_id": booking.event_id,
                "event_title": booking.event.title,
                "event_starts_at": booking.event.starts_at,
            }
            for booking in bookings
        ],
        "top_cities": [
            {"label": label or "Unknown", "value": value}
            for label, value in repository.customer_top_cities(
                owner_id, customer_id, MAX_TOP_CITIES
            )
        ],
    }


def get_event_analytics(
    owner_id: UUID,
    event_id: UUID,
    days: int,
    *,
    repository: OrganizerRepository | None = None,
    cache: CachePort | None = None,
) -> dict[str, Any]:
    repository = repository or OrganizerRepository()
    cache = cache or _default_cache()
    days = max(1, min(days, MAX_SERIES_DAYS))

    key = f"organizer:{owner_id}:event:{event_id}:analytics:{days}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    _, end = day_bounds()
    start = end - dt.timedelta(days=days)

    header = repository.event_header(event_id)
    refunded_minor, refunded_count = repository.event_refund_totals(event_id)
    tiers = repository.event_tier_breakdown(event_id)
    capacity = sum(int(tier["quantity"]) for tier in tiers)
    sold = sum(int(tier["sold"]) for tier in tiers)
    by_status = repository.event_bookings_by_status(event_id)
    started = sum(by_status.values())
    paid = by_status.get("paid", 0)
    revenue = repository.revenue_by_event([event_id]).get(event_id, 0)

    # Admissions come from the TICKET rows, not from `ScanLog(allowed)` —
    # CLAUDE.md's check-in rule: the used-ticket count is the source of truth
    # and the scan log is a parallel audit source that must agree with it. The
    # events table already counted it this way; counting scans here instead
    # would let the same event report two different attendance figures on two
    # screens. `scans_by_result` below is the audit breakdown (how many were
    # denied, and why), which is a different question.
    checkins = repository.checkins_by_event([event_id]).get(event_id, 0)
    scans = repository.event_scan_results(event_id)

    by_day = dict(repository.event_sales_by_day(event_id, start, end))
    first_day = start.astimezone(PLATFORM_TZ).date()
    timeline = [
        {
            "date": (first_day + dt.timedelta(days=offset)).isoformat(),
            "value": int(by_day.get(first_day + dt.timedelta(days=offset), 0)),
        }
        for offset in range(days)
    ]

    payload = {
        "event_id": str(event_id),
        # The event's own identity, so an analytics ROUTE can render its own
        # header without a second request. `None` when the row has been
        # soft-deleted under us, which the serializer allows and the client
        # renders as "this event is gone" rather than as an empty title.
        "event": (
            {
                "id": str(header.id),
                "title": header.title,
                "status": header.status,
                "starts_at": header.starts_at.isoformat(),
                "ends_at": header.ends_at.isoformat() if header.ends_at else None,
                "venue": header.venue,
                "city": header.city,
            }
            if header is not None
            else None
        ),
        "revenue_minor": revenue,
        # Money that went back. Deliberately NOT subtracted from `revenue_minor`
        # — see `event_refund_totals`; that figure already excludes refunded
        # payments, so netting here would deduct it twice.
        "refunded_minor": refunded_minor,
        "refunded_count": refunded_count,
        "capacity": capacity,
        "sold": sold,
        "checkins": checkins,
        # Every rate below is a real ratio of two real counts, and is `None`
        # rather than 0 when its denominator is zero — a 0% conversion on an
        # event nobody has opened yet is a false statement, not a neutral one.
        "sell_through_pct": round((sold / capacity) * 100, 1) if capacity else None,
        "conversion_pct": round((paid / started) * 100, 1) if started else None,
        "abandonment_pct": round(((started - paid) / started) * 100, 1) if started else None,
        "attendance_pct": round((checkins / sold) * 100, 1) if sold else None,
        "bookings_by_status": [
            {"label": label, "value": value} for label, value in sorted(by_status.items())
        ],
        "scans_by_result": [
            {"label": label, "value": value} for label, value in sorted(scans.items())
        ],
        "tiers": [
            {
                "id": str(tier["id"]),
                "name": tier["name"],
                "price_minor": int(tier["price_minor"]),
                "quantity": int(tier["quantity"]),
                "sold": int(tier["sold"]),
                "reserved": int(tier["reserved"]),
                "revenue_minor": int(tier["sold"]) * int(tier["price_minor"]),
            }
            for tier in tiers
        ],
        "sales_timeline": timeline,
    }
    cache.set(key, payload, timeout_seconds=EVENT_ANALYTICS_TTL_SECONDS)
    return payload


def get_activity(
    owner_id: UUID, limit: int, *, repository: OrganizerRepository | None = None
) -> list[dict[str, Any]]:
    """Not cached: a feed exists to be current, and a stale "just now" is worse
    than one more indexed query."""
    repository = repository or OrganizerRepository()
    limit = max(1, min(limit, MAX_ACTIVITY_ITEMS))
    return [
        {
            "id": str(booking.id),
            "type": f"booking.{booking.status}",
            "customer": booking.user.full_name or booking.user.email,
            "event_id": str(booking.event_id),
            "event_title": booking.event.title,
            "amount_minor": booking.total_amount_minor,
            "created_at": booking.created_at.isoformat(),
        }
        for booking in repository.recent_events_for_activity(owner_id, limit)
    ]


def decorate_refunds(refunds: list[Any]) -> list[dict[str, Any]]:
    """Flatten a page of refunds into the row the table renders.

    `is_partial` is COMPUTED from the two amounts rather than stored, because
    partiality is a fact about the pair — a 500-rupee refund against a
    500-rupee payment is full, the same amount against 1500 is partial. Storing
    it would let the flag and the amounts disagree.
    """
    return [
        {
            "id": str(refund.id),
            "provider_ref": refund.rzp_refund_id,
            "amount_minor": refund.amount_minor,
            "reason": refund.reason,
            "created_at": refund.created_at.isoformat(),
            "payment_id": str(refund.payment_id),
            "payment_ref": refund.payment.rzp_payment_id,
            "payment_amount_minor": refund.payment.amount_minor,
            "is_partial": refund.amount_minor < refund.payment.amount_minor,
            "booking_id": str(refund.payment.booking_id),
            "event_id": str(refund.payment.booking.event_id),
            "event_title": refund.payment.booking.event.title,
        }
        for refund in refunds
    ]


def get_unified_activity(
    owner_id: UUID, limit: int, *, repository: OrganizerRepository | None = None
) -> list[dict[str, Any]]:
    """One ordered feed across bookings, refunds, admissions, payouts and
    publishing decisions.

    Each source is read with its own `[:limit]`, then all of them are merged
    and re-sorted by timestamp and truncated. That is deliberate: taking the
    newest `limit` from each guarantees the merged head is correct — the
    (limit+1)th row of any one source is older than that source's limit-th, so
    it can never displace anything already in the merged head.

    Every entry carries a `severity`, because a feed where a failed payout
    looks exactly like a ticket sale is a feed that buries the one thing that
    needed a human. Nothing here is derived or estimated — each row is a
    database record with its own timestamp.
    """
    repository = repository or OrganizerRepository()
    limit = max(1, min(limit, MAX_ACTIVITY_ITEMS))
    entries: list[dict[str, Any]] = []

    for booking in repository.recent_events_for_activity(owner_id, limit):
        entries.append(
            {
                "id": f"booking:{booking.id}",
                "kind": "booking",
                "type": f"booking.{booking.status}",
                "title": _BOOKING_TITLE.get(booking.status, "Booking updated"),
                "detail": booking.user.full_name or booking.user.email,
                "event_id": str(booking.event_id),
                "event_title": booking.event.title,
                "amount_minor": booking.total_amount_minor,
                "severity": "info",
                "at": booking.created_at.isoformat(),
            }
        )

    for refund in repository.recent_refunds_for_activity(owner_id, limit):
        booking = refund.payment.booking
        entries.append(
            {
                "id": f"refund:{refund.id}",
                "kind": "refund",
                "type": "payment.refunded",
                "title": "Refund issued",
                # The stored reason is a short machine-ish code
                # (`hold_expired`, `amount_mismatch`, an organizer's own text).
                # Shown as-is rather than prettified into something the record
                # does not say.
                "detail": refund.reason or "No reason recorded",
                "event_id": str(booking.event_id),
                "event_title": booking.event.title,
                "amount_minor": refund.amount_minor,
                "severity": "warning",
                "at": refund.created_at.isoformat(),
            }
        )

    for scan in repository.recent_scans_for_activity(owner_id, limit):
        entries.append(
            {
                "id": f"scan:{scan.id}",
                "kind": "checkin",
                "type": "ticket.checked_in",
                "title": "Attendee admitted",
                "detail": scan.gate or "No gate recorded",
                "event_id": str(scan.event_id),
                "event_title": scan.event.title,
                "amount_minor": 0,
                "severity": "info",
                "at": scan.scanned_at.isoformat(),
            }
        )

    for attempt in repository.recent_payouts_for_activity(owner_id, limit):
        failed = attempt.status == "failed"
        entries.append(
            {
                "id": f"payout:{attempt.id}",
                "kind": "payout",
                "type": f"payout.{attempt.status}",
                "title": _PAYOUT_TITLE.get(attempt.status, "Payout attempt"),
                "detail": attempt.error if failed else "",
                "event_id": str(attempt.settlement.event_id),
                "event_title": attempt.settlement.event.title,
                "amount_minor": attempt.amount_minor,
                "severity": "critical" if failed else "success",
                "at": attempt.created_at.isoformat(),
            }
        )

    for event in repository.recent_event_transitions(owner_id, limit):
        # `moderated_at` wins when both are set: an operator's decision is the
        # later fact, and the one the organizer needs to see.
        decided = event.moderated_at is not None
        stamp = event.moderated_at or event.submitted_at
        if stamp is None:  # pragma: no cover — the queryset requires one
            continue
        rejected = event.status == "rejected"
        entries.append(
            {
                "id": f"event:{event.id}:{'moderated' if decided else 'submitted'}",
                "kind": "publishing",
                "type": f"event.{event.status}",
                "title": _EVENT_TITLE.get(
                    event.status, "Submitted for review" if not decided else "Reviewed"
                ),
                "detail": event.moderation_note if rejected else "",
                "event_id": str(event.id),
                "event_title": event.title,
                "amount_minor": 0,
                "severity": "critical" if rejected else "info",
                "at": stamp.isoformat(),
            }
        )

    entries.sort(key=lambda entry: entry["at"], reverse=True)
    return entries[:limit]


_BOOKING_TITLE = {
    "paid": "Booking paid",
    "reserved": "Tickets held",
    "cancelled": "Booking cancelled",
    "expired": "Hold expired",
}
_PAYOUT_TITLE = {
    "success": "Payout released",
    "failed": "Payout failed",
    "adjustment": "Post-payout adjustment",
}
_EVENT_TITLE = {
    "pending_review": "Submitted for review",
    "live": "Event approved and live",
    "rejected": "Sent back by an operator",
    "archived": "Event archived",
}


def get_audience(
    owner_id: UUID, *, repository: OrganizerRepository | None = None
) -> dict[str, Any]:
    """Repeat-customer rate — one grouped query, no cache (it is cheap and it
    is the kind of number an organizer checks after a campaign)."""
    repository = repository or OrganizerRepository()
    customers, repeats = repository.repeat_customers(owner_id)
    return {
        "customers": customers,
        "repeat_customers": repeats,
        "repeat_pct": round((repeats / customers) * 100, 1) if customers else None,
    }
