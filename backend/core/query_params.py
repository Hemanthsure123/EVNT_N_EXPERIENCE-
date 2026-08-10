"""Reading filter values off a query string, once.

These live in `core` rather than in one module's `api.py` because the operator
console and the organizer dashboard ask the SAME questions of different data —
"between these two dates", "matching this text" — and two copies of a date
parser is two chances for one of them to be the strict one. The organizer's
lists had these first; the console's list endpoints now share them verbatim.

THE GOVERNING RULE: **a malformed filter is treated as ABSENT, not as an
error.** These params come from links people share and hand-edit, and from date
pickers with their own ideas about formatting. Every list that uses them is
already scoped by permission, so the worst a bad value can do is widen the
result to "everything I am allowed to see" — and a dashboard that 400s because
a picker emitted something unexpected is worse than one showing more rows than
were asked for.
"""

from __future__ import annotations

import datetime as dt
from uuid import UUID

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.request import Request


def int_param(request: Request, name: str, default: int) -> int:
    try:
        return int(request.query_params.get(name, default))
    except (TypeError, ValueError):
        return default


def bounded_int_param(request: Request, name: str, default: int, *, low: int, high: int) -> int:
    """An int clamped into a range, for a `limit` or a window of days.

    Clamped rather than rejected: somebody asking for 10,000 days of a chart
    wants "as much as you have", and answering that with a 400 helps nobody.
    """
    return max(low, min(high, int_param(request, name, default)))


def datetime_param(request: Request, name: str) -> dt.datetime | None:
    """An ISO-8601 query param as an aware datetime, or None."""
    raw = request.query_params.get(name)
    if not raw:
        return None
    parsed = parse_datetime(raw)
    if parsed is None and " " in raw:
        # `2026-07-29T06:21:32+00:00` sent WITHOUT percent-encoding arrives as
        # `...32 00:00`, because `+` means space in a query string. That is one
        # of the most common client slips there is, and silently dropping the
        # filter looks identical to the filter not working — so the space is
        # read back as the plus it started as. A client that encodes correctly
        # (or sends a `Z` suffix, as `toISOString()` does) never reaches here.
        parsed = parse_datetime(raw.replace(" ", "+"))
    if parsed is None:
        return None
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)


def date_range_params(
    request: Request, *, after: str, before: str
) -> tuple[dt.datetime | None, dt.datetime | None]:
    """Both ends of a range, with a REVERSED pair swapped rather than dropped.

    Somebody who picked the dates in the other order meant the span between
    them — the same rule the public browse page's date filters follow, and for
    the same reason: the alternative is a range matching nothing, which reads
    as "there is no data" rather than "you picked backwards".
    """
    start, end = datetime_param(request, after), datetime_param(request, before)
    if start and end and end < start:
        return end, start
    return start, end


def uuid_param(request: Request, name: str) -> UUID | None:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


def text_param(request: Request, name: str, *, max_length: int = 120) -> str | None:
    """A free-text filter, trimmed, capped, and None when it says nothing.

    The cap is not cosmetic: these values reach a `LIKE` or a `tsquery`, and an
    unbounded string from a query param is an unbounded scan. A blank or
    whitespace-only value is None so that clearing a search box widens the list
    instead of filtering it to the empty string.
    """
    raw = request.query_params.get(name)
    if raw is None:
        return None
    cleaned = raw.strip()[:max_length]
    return cleaned or None
