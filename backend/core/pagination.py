"""Standard list-endpoint envelope, shared by every module so API consumers
learn the shape once: {"data": [...], "meta": {count, next, previous}}."""

from __future__ import annotations

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
