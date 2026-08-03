"""Cursor pagination per list, with `ordering` matching each query's own sort.

Cursor rather than page-number for the reason CLAUDE.md's performance
checklist gives: no `COUNT(*)` per request, and stable under the constant
inserts an operations console is looking at. Each class states the ordering
its repository query actually uses — a mismatch silently stops the scan being
an index scan.
"""

from __future__ import annotations

from core.pagination import CursorPagination


class ConsoleOrganizationPagination(CursorPagination):
    ordering = "-created_at"


class ConsoleUserPagination(CursorPagination):
    ordering = "-date_joined"


class ConsoleSettlementPagination(CursorPagination):
    ordering = "-created_at"


class ConsoleModerationPagination(CursorPagination):
    #: FIFO — the organizer who has waited longest is reviewed first, matching
    #: `EventRepository.list_for_moderation`'s pending ordering and its index.
    ordering = "submitted_at"


class ConsoleModerationHistoryPagination(CursorPagination):
    """For the DECIDED lists, which sort newest-decision-first.

    A separate class rather than a mutable `ordering`, because the paginator's
    ordering MUST match the queryset's. Cursor pagination does not validate
    that: given a mismatch it silently returns wrong pages — rows repeated,
    rows skipped — rather than failing. `-created_at` rather than
    `-moderated_at` because the cursor needs a non-null, monotonic column, and
    an event can reach `archived` without ever being moderated.
    """

    ordering = "-created_at"


class ConsolePaymentPagination(CursorPagination):
    ordering = "-created_at"


class ConsoleRefundPagination(CursorPagination):
    ordering = "-created_at"


class ConsoleAuditPagination(CursorPagination):
    ordering = "-created_at"
