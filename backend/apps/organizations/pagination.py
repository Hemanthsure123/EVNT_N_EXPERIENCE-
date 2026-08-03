from __future__ import annotations

from core.pagination import CursorPagination


class OrganizationCursorPagination(CursorPagination):
    # created_at is indexed together with owner_id (see models.py) — this
    # must match that index's ordering, or the list query stops being an
    # index scan.
    ordering = "-created_at"


class FollowingCursorPagination(CursorPagination):
    # Matches `org_follow_user_recent_idx` — (user, -created_at). Cursor
    # pagination does not verify that its ordering matches the queryset's
    # index; given a mismatch it silently returns wrong pages rather than
    # failing, so the two are kept next to each other on purpose.
    ordering = "-created_at"
