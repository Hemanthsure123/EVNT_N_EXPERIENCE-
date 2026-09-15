"""The event analytics page, beyond revenue, sales-by-day and attendance.

The page used to end with a section headed "Not measured yet" that named six
things this platform did not record: the booking-window trend, tickets per day,
a price-change timeline, a pricing-feature log, group-offer uptake, and
per-event audience quality. Each needed a real change rather than a render, and
this module is the read half of those changes:

- the booking window and the per-day ticket counts come from each paid
  booking's own `created_at`, grouped in Postgres — the data always existed,
  the payload simply never carried it;
- the price and feature timelines come from the append-only logs `ticketing`
  now writes inside every tier edit's own transaction;
- group-offer uptake comes from `BookingItem.group_min_quantity`, which records
  the band that priced each line;
- audience quality is asked of THIS event's buyers — first-time versus
  returning is never read off the account-wide audience figure, which is
  exactly the substitution the old page refused to make;
- views, impressions and click-through come from `events.EventEngagementDay`,
  which the browser feeds because the public read path is edge-cached.

── EVERY FIGURE IS REAL, OR IT IS ABSENT ──────────────────────────────────

A rate whose denominator is zero is `None`, as everywhere on this dashboard.
And a figure whose RECORDING began after the event did is scoped to the window
it covers: conversion over views divides the seats sold SINCE the first
recorded view by those views, because dividing an event's lifetime sales by a
week of views is a conversion rate many times higher than the truth.

── NO QUERY LIVES HERE ─────────────────────────────────────────────────────

Shaping only. Every number arrives from `OrganizerRepository` as a grouped
aggregate computed in Postgres; this file decides what the numbers mean.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from apps.ticketing.models import PricingChangeKind, PricingFeature

from .repositories import OrganizerRepository, SalesWindow

#: The booking-window chart's longest reach, in days. A year covers any
#: realistic on-sale; past it the chart keeps the most recent days.
MAX_WINDOW_DAYS = 365

#: What "last minute" means: bookings made in the final hours before the doors.
LATE_BOOKING_HOURS = 72

#: The most entries of each pricing log read for one event. Far above anything
#: an organizer produces by hand; it exists so a runaway script cannot make this
#: page read an unbounded log.
MAX_LOG_ENTRIES = 200

#: The most periods sales are attributed to. Each period is two conditional
#: aggregates inside ONE statement (`event_sales_in_windows`), so this bounds
#: the width of that SELECT — never the number of queries.
MAX_WINDOWS = 80

#: A price entry within this of the tier's own creation IS its creation price.
#: The service writes the first entry with the tier's `created_at`, so the two
#: are equal; the tolerance only absorbs clock rounding.
_SAME_INSTANT = dt.timedelta(seconds=1)

_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)

#: Which booking-item column says a feature priced the line. Exactly one of
#: `phase_name` / `group_min_quantity` is ever set (the buyer pays the lower of
#: the two and only the winner is recorded), so no seat is counted under both.
_PRICED_BY = {
    PricingFeature.EARLY_BIRD.value: "phase",
    PricingFeature.GROUP_OFFERS.value: "band",
}


def pct(part: int | float, whole: int | float | None, *, places: int = 1) -> float | None:
    """A real ratio of two real counts, or None when there is no denominator.

    One decimal everywhere except the two rates that live in the low single
    digits — view conversion and click-through — where a tenth of a percent is
    most of the signal, so they carry two.
    """
    return round((part / whole) * 100, places) if whole else None


def _iso(value: dt.datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


@dataclass(frozen=True)
class Span:
    """A stretch of one tier's pricing history.

    Three things share the shape: a face price that was on offer (`price_minor`
    set), a feature that was switched on (`feature` set), and the sales made
    before the log began (neither). `start is None` means "since before the log
    could see", never "since the dawn of time".
    """

    tier: dict
    start: dt.datetime | None
    end: dt.datetime | None
    price_minor: int | None = None
    kind: str = ""
    feature: str = ""


def price_spans(tiers: list[dict], changes: list[dict]) -> tuple[list[Span], list[Span]]:
    """Each tier's face-price history as periods, plus what came before it.

    Returns `(tracked, untracked)`.

    ── THE PAST IS DERIVED WHERE IT IS PROVABLE, AND NEVER INVENTED ────────

    - A tier with log entries has exactly those periods.
    - A tier with NO entries whose `version` is still 1 has never been edited,
      so the price on its row has held since it was created. That period is
      derived here rather than stored, which is why the log needed no backfill
      — and it covers the tiers that never went through the service at all
      (a cloned event's copies, a fixture, the admin).
    - A tier with no entries that HAS been edited has an unknown past. It gets
      one untracked span covering all its sales; its log begins at its next
      edit.
    - When a tier's first entry is later than its creation — a `BASELINE`
      written at the first edit after the log existed — the sales before it
      are an untracked span too, reported at whatever they were billed.
    """
    by_tier: dict[Any, list[dict]] = defaultdict(list)
    for change in changes:
        by_tier[change["ticket_type_id"]].append(change)

    tracked: list[Span] = []
    untracked: list[Span] = []
    for tier in tiers:
        entries = sorted(by_tier.get(tier["id"], []), key=lambda entry: entry["changed_at"])
        if not entries and tier["version"] == 1:
            entries = [
                {
                    "price_minor": tier["price_minor"],
                    "changed_at": tier["created_at"],
                    "kind": PricingChangeKind.CREATED.value,
                }
            ]
        if not entries:
            untracked.append(Span(tier=tier, start=None, end=None))
            continue
        if entries[0]["changed_at"] > tier["created_at"] + _SAME_INSTANT:
            untracked.append(Span(tier=tier, start=None, end=entries[0]["changed_at"]))
        for index, entry in enumerate(entries):
            following = entries[index + 1]["changed_at"] if index + 1 < len(entries) else None
            # A withdrawn tier's last price ended when the tier did.
            end = following if following is not None else tier["deleted_at"]
            if end is not None and end <= entry["changed_at"]:
                continue
            tracked.append(
                Span(
                    tier=tier,
                    start=entry["changed_at"],
                    end=end,
                    price_minor=int(entry["price_minor"]),
                    kind=str(entry["kind"]),
                )
            )
    return tracked, untracked


def feature_spans(tiers: list[dict], changes: list[dict]) -> list[Span]:
    """When each tier's early-bird schedule and group offers were switched on.

    The log records TRANSITIONS, so the periods are its on/off pairs. The same
    three rules as `price_spans` cover what the log cannot see: a never-edited
    tier's current configuration has held since creation; an edited tier's
    configuration is "on since before the log began" (`start is None`); and a
    log whose first word is "off" means it was on before that.
    """
    by_key: dict[tuple[Any, str], list[dict]] = defaultdict(list)
    for change in changes:
        by_key[(change["ticket_type_id"], str(change["feature"]))].append(change)

    spans: list[Span] = []
    for tier in tiers:
        for feature in (PricingFeature.EARLY_BIRD.value, PricingFeature.GROUP_OFFERS.value):
            on_now = (
                bool(tier["has_phases"])
                if feature == PricingFeature.EARLY_BIRD.value
                else bool(tier["group_bands"])
            )
            entries = sorted(by_key.get((tier["id"], feature), []), key=lambda e: e["changed_at"])
            if not entries:
                if on_now:
                    start = tier["created_at"] if tier["version"] == 1 else None
                    spans.append(
                        Span(tier=tier, start=start, end=tier["deleted_at"], feature=feature)
                    )
                continue

            first = entries[0]
            if not first["enabled"] and first["kind"] != PricingChangeKind.BASELINE.value:
                spans.append(Span(tier=tier, start=None, end=first["changed_at"], feature=feature))

            is_open = False
            opened: dt.datetime | None = None
            for entry in entries:
                if entry["enabled"] and not is_open:
                    is_open = True
                    # A BASELINE "on" marks when the log began, not when the
                    # organizer switched it on — which happened earlier, unseen.
                    opened = (
                        None
                        if entry["kind"] == PricingChangeKind.BASELINE.value
                        else entry["changed_at"]
                    )
                elif not entry["enabled"] and is_open:
                    spans.append(
                        Span(tier=tier, start=opened, end=entry["changed_at"], feature=feature)
                    )
                    is_open = False
            if is_open:
                spans.append(Span(tier=tier, start=opened, end=tier["deleted_at"], feature=feature))
    return spans


def booking_window(
    by_day: list[tuple[dt.date, int, int]],
    *,
    first_day: dt.date,
    last_day: dt.date,
) -> list[dict[str, Any]]:
    """Orders and seats per day, DENSE — every day in the window, zeros included.

    The database returns only days that had a booking, and handing that to a
    chart draws a line that skips the quiet days, turning a flat week into a
    climb. Past `MAX_WINDOW_DAYS` the most recent days are kept.
    """
    if last_day < first_day:
        last_day = first_day
    span = (last_day - first_day).days + 1
    if span > MAX_WINDOW_DAYS:
        first_day = last_day - dt.timedelta(days=MAX_WINDOW_DAYS - 1)
        span = MAX_WINDOW_DAYS
    counts = {day: (orders, seats) for day, orders, seats in by_day}
    window = []
    for offset in range(span):
        day = first_day + dt.timedelta(days=offset)
        orders, seats = counts.get(day, (0, 0))
        window.append({"date": day.isoformat(), "orders": orders, "seats": seats})
    return window


def build_event_insights(
    repository: OrganizerRepository,
    event_id: UUID,
    *,
    created_at: dt.datetime | None,
    starts_at: dt.datetime | None,
    ends_at: dt.datetime | None,
    tiers: list[dict],
    sold: int,
    checkins: int,
    started: int,
    now: dt.datetime,
    tz: dt.tzinfo,
) -> dict[str, Any]:
    """Every section the analytics page used to list as not measured.

    `tiers` is `OrganizerRepository.event_tiers_detail` — live tiers plus the
    withdrawn ones that sold something — and `sold`/`checkins`/`started` are the
    figures the selector has already read, passed in so no count is taken twice.
    """
    over_at = ends_at or starts_at
    event_ended = over_at is not None and now >= over_at
    has_started = starts_at is not None and now >= starts_at

    late_since = starts_at - dt.timedelta(hours=LATE_BOOKING_HOURS) if starts_at else now
    summary = repository.event_order_summary(event_id, late_since=late_since)
    orders = int(summary["orders"] or 0)
    seats = int(summary["seats"] or 0)
    by_day = repository.event_seats_by_day(event_id, tzinfo=tz)

    engagement = _engagement(repository.event_engagement_totals(event_id), by_day)

    first_at: dt.datetime | None = summary["first_at"]
    last_at: dt.datetime | None = summary["last_at"]
    today = now.astimezone(tz).date()
    booked_days = [day for day, _orders, _seats in by_day]
    first_day = created_at.astimezone(tz).date() if created_at else today
    if booked_days:
        first_day = min(first_day, booked_days[0])
    anchor = starts_at.astimezone(tz).date() if starts_at else today
    last_day = min(max([anchor, *booked_days[-1:]]), today)

    late_seats = int(summary["late_seats"] or 0)
    coupon_orders = int(summary["coupon_orders"] or 0)

    return {
        # Every booking ever started, lapsed holds included — a hold is a cart,
        # and one that was abandoned is exactly what this card exists to show.
        "add_to_cart": started,
        "orders": orders,
        "seats": seats,
        "event_ended": event_ended,
        # Only once the event is OVER. Before that, somebody not yet scanned is
        # still on their way, and calling them a no-show is a claim about a
        # person that has not happened.
        "no_shows": max(0, sold - checkins) if event_ended and sold else None,
        "engagement": engagement,
        "order_split": {
            "single": {
                "orders": int(summary["single_orders"] or 0),
                "revenue_minor": int(summary["single_minor"] or 0),
            },
            "multiple": {
                "orders": int(summary["multiple_orders"] or 0),
                "revenue_minor": int(summary["multiple_minor"] or 0),
            },
        },
        "booking_insights": {
            "first_booking_at": _iso(first_at),
            "last_booking_at": _iso(last_at),
            # Calendar days in IST between the first and the last booking.
            "period_days": (
                (last_at.astimezone(tz).date() - first_at.astimezone(tz).date()).days
                if first_at and last_at
                else None
            ),
            "late_window_hours": LATE_BOOKING_HOURS,
            # Only once the doors have opened: until then the final 72 hours
            # have not finished happening, and a share of an unfinished window
            # would drift upward all the way to the show.
            "late_seats": late_seats if has_started else None,
            "late_pct": pct(late_seats, seats) if has_started else None,
        },
        "booking_window": booking_window(by_day, first_day=first_day, last_day=last_day),
        **_pricing_history(repository, event_id, tiers, now=now, event_ended=event_ended),
        "group_offers": _group_offers(repository, event_id, tiers, summary),
        "coupons": {
            # "A redemption exists" and "discount > 0" are the same question
            # by construction — see CLAUDE.md, "Coupons".
            "orders": coupon_orders,
            "pct_of_orders": pct(coupon_orders, orders),
            "discount_minor": int(summary["discount_minor"] or 0),
        },
        "audience": _audience(repository, event_id, engagement),
        "feedback": _feedback(repository.event_rating_counts(event_id)),
        "tiers": _tiers(tiers, repository.event_tier_sales(event_id), now=now),
    }


def _engagement(totals: dict, by_day: list[tuple[dt.date, int, int]]) -> dict[str, Any]:
    """Views, impressions and click-through — `None` for an event with no rows.

    No rows is NOT zero views. It is "nothing was recorded", which is the truth
    for every event that ended before the browser began reporting, and a zero
    there would tell an organizer nobody ever looked at their sold-out show.
    """
    recorded = bool(totals["days"])
    tracked_since: dt.date | None = totals["first_day"]

    def figure(key: str) -> int | None:
        return int(totals[key] or 0) if recorded else None

    views = figure("views")
    impressions = figure("impressions")
    feed_views = figure("feed_views")
    located = figure("located_views")
    local = figure("local_views")
    # Seats booked on or after the first recorded day, over the views recorded
    # in the same window — see the module docstring.
    tracked_seats = sum(
        seats
        for day, _orders, seats in by_day
        if tracked_since is not None and day >= tracked_since
    )
    return {
        "tracked_since": tracked_since.isoformat() if tracked_since else None,
        "views": views,
        "impressions": impressions,
        "feed_views": feed_views,
        "located_views": located,
        "local_views": local,
        "view_cvr_pct": pct(tracked_seats, views, places=2) if recorded else None,
        "ctr_pct": pct(feed_views or 0, impressions, places=2) if recorded else None,
        "local_pct": pct(local or 0, located) if recorded else None,
    }


def _pricing_history(
    repository: OrganizerRepository,
    event_id: UUID,
    tiers: list[dict],
    *,
    now: dt.datetime,
    event_ended: bool,
) -> dict[str, Any]:
    """The price timeline, the sales before it began, and the feature log.

    Every period's seats and revenue come from ONE statement of conditional
    aggregates over the event's paid booking items (`event_sales_in_windows`)
    — a period is a WHERE, not a query. Revenue here is what the lines were
    BILLED, so an early-bird sale counts at its early-bird price.
    """
    price_changes = repository.event_price_changes(event_id, limit=MAX_LOG_ENTRIES)
    feature_changes = repository.event_feature_changes(event_id, limit=MAX_LOG_ENTRIES)
    tracked, untracked = price_spans(tiers, price_changes)
    features = feature_spans(tiers, feature_changes)

    labelled: list[tuple[str, Span]] = (
        [("price", span) for span in tracked]
        + [("untracked", span) for span in untracked]
        + [("feature", span) for span in features]
    )
    truncated = (
        len(labelled) > MAX_WINDOWS
        or len(price_changes) >= MAX_LOG_ENTRIES
        or len(feature_changes) >= MAX_LOG_ENTRIES
    )
    if len(labelled) > MAX_WINDOWS:
        # The most RECENT periods are the ones an organizer is pricing from.
        labelled.sort(key=lambda item: item[1].start or _EPOCH)
        labelled = labelled[-MAX_WINDOWS:]

    windows = [
        SalesWindow(
            key=f"w{index}",
            ticket_type_id=span.tier["id"],
            start=span.start,
            end=span.end,
            priced_by=_PRICED_BY.get(span.feature, ""),
        )
        for index, (_kind, span) in enumerate(labelled)
    ]
    sales = repository.event_sales_in_windows(event_id, windows)

    price_timeline: list[dict[str, Any]] = []
    untracked_sales: list[dict[str, Any]] = []
    feature_log: list[dict[str, Any]] = []
    for (kind, span), window in zip(labelled, windows, strict=True):
        seats, revenue = sales.get(window.key, (0, 0))
        identity = {"tier_id": str(span.tier["id"]), "tier_name": span.tier["name"]}
        if kind == "price":
            active = span.end is None and not event_ended and not _tier_is_past(span.tier, now)
            price_timeline.append(
                {
                    **identity,
                    "price_minor": span.price_minor,
                    "started_at": _iso(span.start),
                    "ended_at": _iso(span.end),
                    "seats": seats,
                    "revenue_minor": revenue,
                    "status": "active" if active else "ended",
                    "kind": span.kind,
                }
            )
        elif kind == "untracked":
            # A stretch the log never saw is only worth a row if something SOLD
            # in it. Otherwise the tier's current price is on the tier table.
            if seats:
                untracked_sales.append(
                    {**identity, "until": _iso(span.end), "seats": seats, "revenue_minor": revenue}
                )
        else:
            live = span.end is None and span.tier["deleted_at"] is None
            feature_log.append(
                {
                    **identity,
                    "feature": span.feature,
                    "enabled_at": _iso(span.start),
                    "disabled_at": _iso(span.end),
                    # Seats the FEATURE priced in this period — an early-bird
                    # row counts early-bird-priced seats, not every seat sold
                    # while the schedule happened to exist.
                    "seats": seats,
                    "status": "enabled" if live else "disabled",
                }
            )

    price_timeline.sort(key=lambda row: (row["started_at"] or "", row["tier_name"]))
    feature_log.sort(key=lambda row: (row["enabled_at"] or "", row["tier_name"], row["feature"]))
    return {
        "price_timeline": price_timeline,
        "untracked_sales": untracked_sales,
        "feature_log": feature_log,
        "history_truncated": truncated,
    }


def _tier_is_past(tier: dict, now: dt.datetime) -> bool:
    """Withdrawn, or its sale window has closed."""
    return tier["deleted_at"] is not None or (
        tier["sale_end"] is not None and tier["sale_end"] < now
    )


def _group_offers(
    repository: OrganizerRepository, event_id: UUID, tiers: list[dict], summary: dict
) -> dict[str, Any]:
    """Orders priced by a group band, and what each band brought in.

    `orders` is DISTINCT bookings, read from the order summary rather than
    summed over bands: one booking can carry two tiers each priced by its own
    band, and summing per band would count it twice.
    """
    bands = repository.event_group_band_sales(event_id)
    return {
        # Whether a live tier OFFERS group pricing right now — a config fact,
        # separate from whether anybody has used it.
        "enabled": any(bool(tier["group_bands"]) for tier in tiers if tier["deleted_at"] is None),
        "orders": int(summary["group_orders"] or 0),
        "seats": sum(band["seats"] for band in bands),
        "revenue_minor": sum(band["revenue_minor"] for band in bands),
        "bands": bands,
    }


def _audience(
    repository: OrganizerRepository, event_id: UUID, engagement: dict[str, Any]
) -> dict[str, Any]:
    """Who came, asked of THIS event's paying buyers.

    "Returning" means a paid booking for a DIFFERENT event on this platform,
    made before this buyer's first booking here — a person buying two tickets
    to the same show on two days is not a returning member.

    "Interest conversion" is people who SAVED the event and then booked it.
    The reference design says "matched preferences", and nothing on this
    platform records a preference to match against; a save is the one
    expression of interest this platform does store, so that is what this
    measures, and the label says so.
    """
    attendees, returning = repository.event_audience(event_id)
    savers, converted = repository.event_interest_conversion(event_id)
    first_time = max(0, attendees - returning)
    return {
        "attendees": attendees,
        "first_time": first_time,
        "repeat": returning,
        "first_time_pct": pct(first_time, attendees),
        "repeat_pct": pct(returning, attendees),
        "savers": savers,
        "saved_then_booked": converted,
        "interest_conversion_pct": pct(converted, savers),
        # From the VIEWS that carried a city — nothing stores where a buyer
        # lives, and the header's city is the visitor's own choice. Null for an
        # event with no located views, not 0%.
        "located_views": engagement["located_views"],
        "local_pct": engagement["local_pct"],
    }


def _feedback(counts: dict[int, int]) -> dict[str, Any]:
    """Published ratings, all five buckets always.

    Computed on the SERVER over every review. The page used to average the
    reviews it happened to have loaded and label it that way, because the
    reviews list is cursor-paginated with no aggregate; this is that aggregate.
    """
    total = sum(counts.values())
    average = round(sum(rating * n for rating, n in counts.items()) / total, 1) if total else None
    return {
        "count": total,
        "average": average,
        # Always five rows: a breakdown that omits the ratings nobody gave is a
        # different shape from the one the data has.
        "breakdown": [
            {"rating": rating, "count": counts.get(rating, 0)} for rating in (5, 4, 3, 2, 1)
        ],
    }


def _tiers(tiers: list[dict], sales: dict[Any, dict], *, now: dt.datetime) -> list[dict[str, Any]]:
    """The tier table: the list price, plus what each tier actually sold.

    `revenue_minor` keeps its old meaning — sold x list price — because the
    operator console renders this same payload. `charged_minor` is what the
    lines were BILLED, so an early-bird or group-priced seat counts at the price
    it went for, and `per_person_minor` is that over the seats.
    """
    rows = []
    for tier in tiers:
        sold = sales.get(tier["id"], {"orders": 0, "seats": 0, "gross": 0})
        rows.append(
            {
                "id": str(tier["id"]),
                "name": tier["name"],
                "price_minor": int(tier["price_minor"]),
                "quantity": int(tier["quantity"]),
                "sold": int(tier["sold"]),
                "reserved": int(tier["reserved"]),
                "revenue_minor": int(tier["sold"]) * int(tier["price_minor"]),
                "orders": sold["orders"],
                "seats": sold["seats"],
                "charged_minor": sold["gross"],
                "per_person_minor": sold["gross"] // sold["seats"] if sold["seats"] else None,
                "is_past": _tier_is_past(tier, now),
                "is_deleted": tier["deleted_at"] is not None,
            }
        )
    return rows
