from __future__ import annotations

from core.pagination import CursorPagination


class SettlementCursorPagination(CursorPagination):
    # Matches the list query's ORDER BY (-created_at) so it stays cursor-stable.
    ordering = "-created_at"
