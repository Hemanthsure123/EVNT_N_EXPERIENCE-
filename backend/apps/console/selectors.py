"""Read side of the operator console (CQRS-lite, like every other module).

Everything here composes `ConsoleRepository` aggregates into the payloads the
dashboard actually renders. No ORM, no serializers — those live either side.

CACHING. The overview and the breakdowns are cache-aside with a short TTL,
because they are the most expensive reads on the platform (several
full-table aggregates) and they are polled by a dashboard that may sit open
on a wall screen all day. The TTLs are deliberately short — an operator
acting on a number needs it to be current, so this trades a little staleness
for a lot of database, not the other way round.

Keys and TTLs, matching the convention in CLAUDE.md's performance checklist:
  - `console:overview`          — 30s
  - `console:timeseries:{m}:{d}` — 300s (a day-grained series barely moves)
  - `console:breakdown:{by}:{n}` — 300s

There is no invalidation-on-write here, and that is the honest trade: these
are platform-wide aggregates touched by every module's writes, so precise
invalidation would mean every module knowing about the console. A 30-second
TTL is the simpler, more robust answer for a dashboard.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any

from django.utils import timezone

from apps.booking.models import BookingStatus
from core.ports.cache_port import CachePort

from .repositories import ConsoleRepository

OVERVIEW_TTL_SECONDS = 30
SERIES_TTL_SECONDS = 300
BREAKDOWN_TTL_SECONDS = 300

MAX_SERIES_DAYS = 90
DEFAULT_SERIES_DAYS = 30
MAX_BREAKDOWN_ITEMS = 20
MAX_ACTIVITY_ITEMS = 50

#: IST. The platform prices in rupees and sends DLT-templated SMS; "today" for
#: an operator here means the Indian day, not UTC. Matching the frontend's own
#: fixed anchor (see lib/discovery/date-windows.ts) keeps the two agreeing.
PLATFORM_TZ = dt.timezone(dt.timedelta(hours=5, minutes=30))


def _default_cache() -> CachePort:
    from config.di import cache_port

    return cache_port()


def platform_day_bounds(now: dt.datetime | None = None) -> tuple[dt.datetime, dt.datetime]:
    """Start and end of "today" in the platform timezone, as aware UTC instants."""
    now = now or timezone.now()
    local = now.astimezone(PLATFORM_TZ)
    start_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_local.astimezone(dt.timezone.utc), (start_local + dt.timedelta(days=1)).astimezone(
        dt.timezone.utc
    )


@dataclass(frozen=True)
class Overview:
    organizations: int
    pending_verifications: int
    revenue_today_minor: int
    bookings_today: int
    events_live: int
    tickets_issued: int
    checkins_today: int
    failed_payouts: int
    generated_at: str


def get_overview(
    *, repository: ConsoleRepository | None = None, cache: CachePort | None = None
) -> dict[str, Any]:
    repository = repository or ConsoleRepository()
    cache = cache or _default_cache()

    cached = cache.get("console:overview")
    if cached is not None:
        return cached

    now = timezone.now()
    start, end = platform_day_bounds(now)
    payload = {
        "organizations": repository.count_organizations(),
        "pending_verifications": repository.count_pending_verifications(),
        "revenue_today_minor": repository.sum_revenue_between(start, end),
        "bookings_today": repository.count_bookings_between(start, end),
        "events_live": repository.count_live_events(now),
        "tickets_issued": repository.count_tickets_issued(),
        "checkins_today": repository.count_checkins_between(start, end),
        "failed_payouts": repository.count_failed_payouts(),
        "generated_at": now.isoformat(),
    }
    cache.set("console:overview", payload, timeout_seconds=OVERVIEW_TTL_SECONDS)
    return payload


def get_timeseries(
    metric: str,
    days: int,
    *,
    repository: ConsoleRepository | None = None,
    cache: CachePort | None = None,
) -> dict[str, Any]:
    """A dense daily series — every day in the window, zeros included.

    The database only returns days that HAVE rows. Handing that straight to a
    chart draws a line that skips empty days entirely, which silently turns a
    quiet week into a steep climb. Filling the gaps here means the chart can
    stay dumb.
    """
    repository = repository or ConsoleRepository()
    cache = cache or _default_cache()
    days = max(1, min(days, MAX_SERIES_DAYS))

    key = f"console:timeseries:{metric}:{days}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    _, end = platform_day_bounds()
    start = end - dt.timedelta(days=days)
    # An unrecognised metric falls through to bookings rather than raising —
    # this endpoint feeds a chart, and a 400 on a typo would blank a dashboard
    # panel that has nothing to do with the mistake.
    if metric == "revenue":
        rows = repository.revenue_by_day(start, end)
    elif metric == "signups":
        rows = repository.signups_by_day(start, end)
    else:
        rows = repository.bookings_by_day(start, end)
    by_day = dict(rows)

    first_day = start.astimezone(PLATFORM_TZ).date()
    points = []
    for offset in range(days):
        day = first_day + dt.timedelta(days=offset)
        points.append({"date": day.isoformat(), "value": int(by_day.get(day, 0))})

    payload = {"metric": metric, "days": days, "points": points}
    cache.set(key, payload, timeout_seconds=SERIES_TTL_SECONDS)
    return payload


def get_breakdown(
    by: str,
    limit: int,
    *,
    repository: ConsoleRepository | None = None,
    cache: CachePort | None = None,
) -> dict[str, Any]:
    repository = repository or ConsoleRepository()
    cache = cache or _default_cache()
    limit = max(1, min(limit, MAX_BREAKDOWN_ITEMS))

    key = f"console:breakdown:{by}:{limit}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    rows = (
        repository.revenue_by_city(limit)
        if by == "revenue_by_city"
        else repository.events_by_city(limit)
    )
    payload = {
        "by": by,
        "items": [{"label": label or "Unknown", "value": value} for label, value in rows],
    }
    cache.set(key, payload, timeout_seconds=BREAKDOWN_TTL_SECONDS)
    return payload


def get_activity(
    limit: int, *, repository: ConsoleRepository | None = None
) -> list[dict[str, Any]]:
    """Not cached: an activity feed exists to be current, and a 30-second-old
    "just now" is worse than one extra indexed query."""
    repository = repository or ConsoleRepository()
    limit = max(1, min(limit, MAX_ACTIVITY_ITEMS))
    return [
        {
            "id": str(event.id),
            "type": event.event_type,
            "aggregate_id": event.aggregate_id,
            "payload": event.payload,
            "created_at": event.created_at.isoformat(),
        }
        for event in repository.recent_activity(limit)
    ]


def decorate_payments(payments: list[Any]) -> list[dict[str, Any]]:
    """Flatten a page of payments into the row the transactions table renders.

    The customer and the event are already loaded by `select_related`, so this
    is pure reshaping — no query is issued per row.
    """
    return [
        {
            "id": str(payment.id),
            "provider_order_id": payment.rzp_order_id,
            "provider_payment_id": payment.rzp_payment_id,
            "amount_minor": payment.amount_minor,
            "status": payment.status,
            "created_at": payment.created_at.isoformat(),
            "booking_id": str(payment.booking_id),
            "booking_total_minor": payment.booking.total_amount_minor,
            "platform_fee_minor": payment.booking.platform_fee_minor,
            "customer_email": payment.booking.user.email,
            "customer_name": payment.booking.user.full_name,
            "event_id": str(payment.booking.event_id),
            "event_title": payment.booking.event.title,
        }
        for payment in payments
    ]


def decorate_bookings(bookings: list[Any]) -> list[dict[str, Any]]:
    """Flatten a page of bookings into the support desk's row.

    `tickets_issued` is the column an operator actually reads: the whole
    question behind "I paid but got nothing" is whether tickets exist. It is
    counted from the prefetched relation rather than queried per row.

    `is_expired_hold` is COMPUTED rather than stored, the same way `is_partial`
    is on a refund — a booking sitting in `reserved` with a lapsed
    `hold_expires_at` has not been swept yet, and that distinction (reserved
    but dead vs reserved and live) is exactly what tells an operator whether to
    wait or to act.
    """
    now = timezone.now()
    return [
        {
            "id": str(booking.id),
            "status": booking.status,
            # Both annotated by `_booking_base` as correlated subqueries —
            # quantity lives on BookingItem and tickets on Ticket, so neither
            # is a column on Booking. See the note there on why aggregate
            # joins would inflate each other.
            "quantity": booking.quantity_total,
            "tickets_issued": booking.tickets_issued_total,
            "total_amount_minor": booking.total_amount_minor,
            "platform_fee_minor": booking.platform_fee_minor,
            "payment_ref": booking.payment_ref,
            "payment_order_id": booking.payment_order_id,
            "hold_expires_at": (
                booking.hold_expires_at.isoformat() if booking.hold_expires_at else None
            ),
            "is_expired_hold": bool(
                booking.status == BookingStatus.RESERVED
                and booking.hold_expires_at
                and booking.hold_expires_at <= now
            ),
            "created_at": booking.created_at.isoformat(),
            "customer_id": str(booking.user_id),
            "customer_email": booking.user.email,
            "customer_name": booking.user.full_name,
            "event_id": str(booking.event_id),
            "event_title": booking.event.title,
            "event_starts_at": booking.event.starts_at.isoformat(),
        }
        for booking in bookings
    ]


def booking_detail_payload(booking: Any) -> dict[str, Any]:
    """One booking, expanded — what an operator reads out on a support call.

    The tickets list is the answer to the most common question this surface
    exists for, so each carries its status: "three issued, one already used at
    the North gate" resolves a call that would otherwise involve the organizer.

    NO QR TOKEN is included, deliberately. It is the credential that admits
    somebody, an operator has no need for it to answer a question, and putting
    it in an admin payload would make every operator session a set of usable
    tickets. `POST /checkin/lookup` is how a token is checked, and it takes the
    token rather than handing one out.
    """
    now = timezone.now()
    return {
        **decorate_bookings([booking])[0],
        "items": [
            {
                "ticket_type_id": str(item.ticket_type_id),
                "ticket_type_name": item.ticket_type.name,
                "quantity": item.quantity,
                "unit_price_minor": item.unit_price_minor,
            }
            for item in booking.items.all()
        ],
        "tickets": [
            {
                "id": str(ticket.id),
                "ticket_type_name": ticket.ticket_type.name,
                "status": ticket.status,
                "used_at": ticket.used_at.isoformat() if ticket.used_at else None,
                "gate": ticket.gate or None,
                "attendee_name": ticket.attendee_name or None,
            }
            for ticket in booking.tickets.all()
        ],
        "server_time": now.isoformat(),
    }


def decorate_refunds(refunds: list[Any]) -> list[dict[str, Any]]:
    """Flatten a page of refunds.

    `is_partial` is COMPUTED from the pair rather than stored: a 500-rupee
    refund is full against a 500-rupee payment and partial against 1500.
    Storing it would let the flag and the amounts disagree.
    """
    return [
        {
            "id": str(refund.id),
            "provider_ref": refund.rzp_refund_id,
            "amount_minor": refund.amount_minor,
            "reason": refund.reason,
            "created_at": refund.created_at.isoformat(),
            "is_partial": refund.amount_minor < refund.payment.amount_minor,
            "payment_id": str(refund.payment_id),
            "payment_ref": refund.payment.rzp_payment_id,
            "payment_amount_minor": refund.payment.amount_minor,
            "booking_id": str(refund.payment.booking_id),
            "customer_email": refund.payment.booking.user.email,
            "event_id": str(refund.payment.booking.event_id),
            "event_title": refund.payment.booking.event.title,
        }
        for refund in refunds
    ]


def enquiry_payloads(rows: list) -> list[dict]:
    """Enquiry rows as the console renders them.

    The `_display` values are resolved HERE rather than in the client for the
    same reason `gender_display` is: a frontend that has to know the label for
    every enum value is a frontend that will get one wrong, and these two enums
    have fourteen members between them.

    `customer_email` sits alongside `contact_email` and is not a duplicate: the
    account's address and the address they asked to be contacted on are often
    different people — the bride's account, the planner's phone.
    """
    return [
        {
            "id": str(row.id),
            "performer_type": row.performer_type,
            "performer_type_display": row.get_performer_type_display(),
            "occasion": row.occasion,
            "occasion_display": row.get_occasion_display(),
            "city": row.city,
            "event_date": row.event_date,
            "budget_min_minor": row.budget_min_minor,
            "budget_max_minor": row.budget_max_minor,
            "guests": row.guests,
            "notes": row.notes,
            "contact_name": row.contact_name,
            "contact_phone": row.contact_phone,
            "contact_email": row.contact_email,
            "customer_email": row.customer.email if row.customer_id else "",
            "status": row.status,
            "status_display": row.get_status_display(),
            "admin_note": row.admin_note,
            "handled_by_email": row.handled_by.email if row.handled_by_id else "",
            "created_at": row.created_at,
        }
        for row in rows
    ]
