"""List-endpoint pagination, shared by every module so API consumers learn
the shape once.

Two flavours, both used deliberately:

- `DefaultPagination` (page-number) — kept as the DRF-wide default for any
  endpoint that genuinely needs a total count or jump-to-page. It costs an
  extra COUNT(*) query per request.
- `CursorPagination` — the standard for list endpoints going forward (see
  CLAUDE.md's Performance checklist). No COUNT(*) query, and stable even
  if rows are inserted/deleted between pages. Subclass it per view and set
  `ordering` to a field that's actually indexed for that query (see
  apps/organizations/pagination.py for an example) — there's no safe
  one-size-fits-all default ordering across models.
"""

from __future__ import annotations

from rest_framework.pagination import CursorPagination as DRFCursorPagination
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class DefaultPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_paginated_response(self, data: list) -> Response:
        # DRF only calls this after paginate_queryset() has run, so self.page
        # is always set here — the base class just types it as Optional.
        assert self.page is not None
        return Response(
            {
                "data": data,
                "meta": {
                    "count": self.page.paginator.count,
                    "next": self.get_next_link(),
                    "previous": self.get_previous_link(),
                },
            }
        )


class CursorPagination(DRFCursorPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100
    cursor_query_param = "cursor"

    def get_paginated_response(self, data: list) -> Response:
        # No `count` here on purpose — a total count would need its own
        # COUNT(*) query, which is exactly the cost cursor pagination exists
        # to avoid.
        return Response(
            {
                "data": data,
                "meta": {
                    "next": self.get_next_link(),
                    "previous": self.get_previous_link(),
                },
            }
        )
