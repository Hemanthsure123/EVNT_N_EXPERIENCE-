from __future__ import annotations

from core.pagination import CursorPagination


class EventCursorPagination(CursorPagination):
    # Public browse: soonest-upcoming first. Must match the (status, starts_at)
    # index ordering so the list stays an index range scan. Ascending, because
    # discovery shows the next events first.
    ordering = "starts_at"


class OrganizerEventCursorPagination(CursorPagination):
    # Organizer dashboard: newest-created first, matching (organization, created_at).
    ordering = "-created_at"
