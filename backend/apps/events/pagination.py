from __future__ import annotations

from core.pagination import CursorPagination

from .repositories import PUBLIC_LIST_ORDERING


class EventCursorPagination(CursorPagination):
    # Public browse: soonest-upcoming first, then the newest-published among
    # events that start together. The SAME tuple the repository orders by — see
    # `PUBLIC_LIST_ORDERING` for why that has to be one constant: DRF replaces
    # the queryset's ordering with this one, so a mismatch is silently resolved
    # in the paginator's favour.
    ordering = PUBLIC_LIST_ORDERING


class OrganizerEventCursorPagination(CursorPagination):
    # Organizer dashboard: newest-created first, matching (organization, created_at).
    ordering = "-created_at"
