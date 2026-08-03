"""Cursor pagination per list, with `ordering` matching each query's own sort.

A mismatch between a paginator's `ordering` and its queryset's silently returns
WRONG pages — rows repeated, rows skipped — rather than failing, so each class
below states the query it belongs to.
"""

from __future__ import annotations

from core.pagination import CursorPagination


class PerformerBrowsePagination(CursorPagination):
    #: Matches `list_published`: featured first, then newest. Two keys, because
    #: `is_featured` is a boolean and nowhere near unique — without the
    #: tiebreak, performers sharing a flag can straddle a page boundary and one
    #: of them disappears from the list entirely.
    ordering = ("-is_featured", "-created_at")


class PerformerOwnerPagination(CursorPagination):
    ordering = "-created_at"


class PerformerModerationPagination(CursorPagination):
    #: FIFO — the act that has waited longest is reviewed first.
    ordering = "submitted_at"


class PerformerModerationHistoryPagination(CursorPagination):
    #: The decided lists. `-created_at` rather than `-moderated_at` because a
    #: cursor needs a non-null monotonic column, and a profile can reach
    #: `archived` without ever being moderated.
    ordering = "-created_at"


class BookingRequestPagination(CursorPagination):
    ordering = "-created_at"


class OpenRequestPagination(CursorPagination):
    #: Matches `list_open_for_performer`: soonest event first, because a brief
    #: for next week is worth more than one for next year.
    ordering = ("event_date", "-created_at")
