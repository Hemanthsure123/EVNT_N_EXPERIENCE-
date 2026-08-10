"""Cursor pagination for the refund-request queues.

Two classes, and the split is not cosmetic. The PENDING queue is FIFO — the
customer who has waited longest is answered first, the same rule the moderation
queue follows — while every other view is newest-first. Cursor pagination does
NOT validate that its `ordering` matches the queryset's: given a mismatch it
silently returns wrong pages (rows repeated, rows skipped) rather than failing,
which is the trap `apps/console/pagination.py` documents at length after hitting
it once.

`RefundRequestRepository.list_for_organizer` picks its ordering from the same
`status` value the view uses to pick the paginator, so the two cannot drift
apart without both changing.
"""

from __future__ import annotations

from core.pagination import CursorPagination


class RefundRequestPagination(CursorPagination):
    """Everything except the pending queue: newest decision first."""

    ordering = "-created_at"


class PendingRefundRequestPagination(CursorPagination):
    """The pending queue: oldest first, so nobody is left at the bottom of a
    list that only ever grows from the top."""

    ordering = "created_at"
