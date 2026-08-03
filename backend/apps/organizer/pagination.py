"""Cursor pagination per list, with `ordering` matching each query's own sort.

Cursor rather than page-number for the reason CLAUDE.md's performance checklist
gives: no `COUNT(*)` per request, and stable while rows are being inserted
underneath — which, on a dashboard watching a live on-sale, is constantly.

Each class states the ordering its repository query actually uses. A mismatch
silently stops the scan being an index scan, and cursor pagination will happily
return wrong pages rather than complain.
"""

from __future__ import annotations

from core.pagination import CursorPagination


class OrganizerEventRowPagination(CursorPagination):
    ordering = "-created_at"


class OrganizerBookingPagination(CursorPagination):
    ordering = "-created_at"


class OrganizerRefundPagination(CursorPagination):
    ordering = "-created_at"


class OrganizerCustomerPagination(CursorPagination):
    #: Matches `OrganizerRepository.customers()`. Two keys, because lifetime
    #: value is not unique — without the tiebreak, two customers who have spent
    #: exactly the same amount can straddle a page boundary and one of them
    #: disappears from the list entirely.
    ordering = ("-lifetime_value_minor", "email")
