from __future__ import annotations

from core.pagination import CursorPagination


class MyTicketsCursorPagination(CursorPagination):
    # Newest-issued first, matching the (booking, created_at) access pattern.
    ordering = "-created_at"
