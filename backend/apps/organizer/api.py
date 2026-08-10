"""Thin views for the organizer dashboard.

Every response is `private, no-store`. These are one organizer's own revenue,
customers and drafts — nothing here may sit in a shared or CDN cache. The
short-TTL caching that does happen is server-side and per-owner (see
`selectors.py`), where it can be reasoned about.

Reads only. Every write an organizer performs already has a home in the module
that owns the rule — creating an event is `events`, refunding a payment is
`payments`, releasing a payout is `settlements`. This module owns no business
rules and reaches into no other module's writes.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from core.errors import NotFoundError
from core.query_params import datetime_param, int_param, uuid_param

from . import selectors
from .pagination import (
    OrganizerBookingPagination,
    OrganizerCustomerPagination,
    OrganizerEventRowPagination,
    OrganizerRefundPagination,
)
from .permissions import IsOrganizer
from .repositories import OrganizerRepository
from .schemas import (
    ActivitySerializer,
    AudienceSerializer,
    BreakdownSerializer,
    CustomerProfileSerializer,
    CustomerRowSerializer,
    EventAnalyticsSerializer,
    EventRowSerializer,
    OrganizerBookingSerializer,
    OrganizerOverviewSerializer,
    OrganizerRefundSerializer,
    TimeseriesSerializer,
    UnifiedActivitySerializer,
)


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


_int_param = int_param


#: Re-exported from `core.query_params`, which is now the ONE place a filter
#: date is parsed. These lists had them first; the operator console asks the
#: same question of different data, and two date parsers is two chances for one
#: of them to be the strict one.
_datetime_param = datetime_param


_uuid_param = uuid_param


class OrganizerView(APIView):
    """Shared base: authenticated, never cached at the edge."""

    permission_classes = [IsOrganizer]

    @property
    def owner_id(self) -> UUID:
        return cast(User, self.request.user).id


class OverviewView(OrganizerView):
    @extend_schema(responses={200: OrganizerOverviewSerializer})
    def get(self, request: Request) -> Response:
        payload = selectors.get_overview(self.owner_id)
        return _no_store(Response(OrganizerOverviewSerializer(payload).data))


class TimeseriesView(OrganizerView):
    @extend_schema(
        parameters=[
            OpenApiParameter("metric", str, description="revenue | bookings | tickets"),
            OpenApiParameter("days", int, description=f"1–{selectors.MAX_SERIES_DAYS}"),
        ],
        responses={200: TimeseriesSerializer},
    )
    def get(self, request: Request) -> Response:
        payload = selectors.get_timeseries(
            self.owner_id,
            request.query_params.get("metric", "revenue"),
            _int_param(request, "days", selectors.DEFAULT_SERIES_DAYS),
        )
        return _no_store(Response(TimeseriesSerializer(payload).data))


class BreakdownView(OrganizerView):
    @extend_schema(
        parameters=[
            OpenApiParameter(
                "by", str, description="revenue_by_event | revenue_by_city | bookings_by_status"
            ),
            OpenApiParameter("limit", int),
        ],
        responses={200: BreakdownSerializer},
    )
    def get(self, request: Request) -> Response:
        payload = selectors.get_breakdown(
            self.owner_id,
            request.query_params.get("by", "revenue_by_event"),
            _int_param(request, "limit", 10),
        )
        return _no_store(Response(BreakdownSerializer(payload).data))


class EventRowListView(OrganizerView):
    """The dashboard's events TABLE.

    Distinct from `GET /organizer/events` (in the `events` module), which is
    the plain owner list. This one carries the aggregate columns the table
    shows — capacity, sold, revenue, check-ins — so the table is ONE request
    with one cursor, rather than two paginated lists the client has to zip
    together with different cursors.
    """

    pagination_class = OrganizerEventRowPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, description="Title or venue substring"),
            OpenApiParameter("status", str),
            OpenApiParameter("city", str),
            OpenApiParameter("starts_after", str, description="ISO-8601, inclusive"),
            OpenApiParameter("starts_before", str, description="ISO-8601, exclusive"),
        ],
        responses={200: EventRowSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        queryset = OrganizerRepository().event_rows(
            self.owner_id,
            search=request.query_params.get("q"),
            status=request.query_params.get("status"),
            city=request.query_params.get("city"),
            starts_after=_datetime_param(request, "starts_after"),
            starts_before=_datetime_param(request, "starts_before"),
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_event_rows(list(page or []))
        data = cast(list, EventRowSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class BookingListView(OrganizerView):
    pagination_class = OrganizerBookingPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("event_id", str),
            OpenApiParameter("status", str),
            OpenApiParameter("q", str, description="Customer email/name or payment reference"),
            OpenApiParameter("created_after", str, description="ISO-8601, inclusive"),
            OpenApiParameter("created_before", str, description="ISO-8601, exclusive"),
        ],
        responses={200: OrganizerBookingSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        # A malformed filter is an empty filter, not a 500. The list is already
        # scoped to the caller, so this can only ever widen to "all my
        # bookings".
        queryset = OrganizerRepository().bookings(
            self.owner_id,
            event_id=_uuid_param(request, "event_id"),
            status=request.query_params.get("status"),
            search=request.query_params.get("q"),
            created_after=_datetime_param(request, "created_after"),
            created_before=_datetime_param(request, "created_before"),
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_bookings(list(page or []))
        data = cast(list, OrganizerBookingSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class CustomerListView(OrganizerView):
    pagination_class = OrganizerCustomerPagination

    @extend_schema(
        parameters=[OpenApiParameter("q", str, description="Email or name substring")],
        responses={200: CustomerRowSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        queryset = OrganizerRepository().customers(
            self.owner_id, search=request.query_params.get("q")
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        data = cast(list, CustomerRowSerializer(list(page or []), many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class CustomerDetailView(OrganizerView):
    @extend_schema(responses={200: CustomerProfileSerializer})
    def get(self, request: Request, customer_id: UUID) -> Response:
        payload = selectors.get_customer_profile(self.owner_id, customer_id)
        if not payload["recent_bookings"] and payload["bookings"] == 0:
            # Never bought from this organizer -> as far as this dashboard is
            # concerned the customer does not exist. 404 rather than an empty
            # profile, so the drawer cannot render a stranger's blank record.
            raise NotFoundError("No customer record for this organizer.")
        return _no_store(Response(CustomerProfileSerializer(payload).data))


class EventAnalyticsView(OrganizerView):
    @extend_schema(
        parameters=[OpenApiParameter("days", int)],
        responses={200: EventAnalyticsSerializer},
    )
    def get(self, request: Request, event_id: UUID) -> Response:
        if not OrganizerRepository().owns_event(self.owner_id, event_id):
            # NotFound, not PermissionDenied — see permissions.py. A 403 here
            # would confirm the event exists to anyone guessing ids.
            raise NotFoundError("Event not found.")
        payload = selectors.get_event_analytics(
            self.owner_id, event_id, _int_param(request, "days", selectors.DEFAULT_SERIES_DAYS)
        )
        return _no_store(Response(EventAnalyticsSerializer(payload).data))


class RefundListView(OrganizerView):
    """Refunds issued against this organizer's events.

    READ ONLY, like everything else in this module. Issuing a refund is
    `POST /payments/{id}/refund` — owned by `payments`, which owns the rule.
    """

    pagination_class = OrganizerRefundPagination

    @extend_schema(
        parameters=[OpenApiParameter("event_id", str)],
        responses={200: OrganizerRefundSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        queryset = OrganizerRepository().refunds(
            self.owner_id, event_id=_uuid_param(request, "event_id")
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_refunds(list(page or []))
        data = cast(list, OrganizerRefundSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class ActivityView(OrganizerView):
    """The bookings-only feed the KPI strip has always used.

    Kept as-is because it is a different question from the unified feed below —
    "who just bought" rather than "what happened" — and because changing its
    shape would break a rendered surface for no gain.
    """

    @extend_schema(
        parameters=[OpenApiParameter("limit", int)],
        responses={200: ActivitySerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        payload = selectors.get_activity(self.owner_id, _int_param(request, "limit", 20))
        return _no_store(Response({"data": ActivitySerializer(payload, many=True).data}))


class ActivityFeedView(OrganizerView):
    """The Activity Centre: bookings, refunds, admissions, payouts and
    publishing decisions in one ordered timeline.

    Five bounded reads merged in the selector — see the comment on
    `OrganizerRepository`'s activity section for why this is not one SQL union
    and not the outbox.
    """

    @extend_schema(
        parameters=[OpenApiParameter("limit", int)],
        responses={200: UnifiedActivitySerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        payload = selectors.get_unified_activity(self.owner_id, _int_param(request, "limit", 30))
        return _no_store(Response({"data": UnifiedActivitySerializer(payload, many=True).data}))


class AudienceView(OrganizerView):
    @extend_schema(responses={200: AudienceSerializer})
    def get(self, request: Request) -> Response:
        return _no_store(Response(AudienceSerializer(selectors.get_audience(self.owner_id)).data))
