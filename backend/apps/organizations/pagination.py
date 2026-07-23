from __future__ import annotations

from core.pagination import CursorPagination


class OrganizationCursorPagination(CursorPagination):
    # created_at is indexed together with owner_id (see models.py) — this
    # must match that index's ordering, or the list query stops being an
    # index scan.
    ordering = "-created_at"
