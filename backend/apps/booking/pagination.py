from __future__ import annotations

from core.pagination import CursorPagination


class MyTicketsCursorPagination(CursorPagination):
    # Newest-issued first, matching the (booking, created_at) access pattern.
    ordering = "-created_at"


class MyBookingsCursorPagination(CursorPagination):
    """Newest purchase first.

    `-created_at` matches `BookingRepository.list_for_user`'s ordering exactly.
    Cursor pagination does NOT validate that its `ordering` agrees with the
    queryset's — given a mismatch it silently returns wrong pages rather than
    failing — which is why this is its own class rather than a reuse of the
    tickets paginator that happens to share a string today.
    """

    ordering = "-created_at"
