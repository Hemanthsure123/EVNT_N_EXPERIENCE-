"""Thin views for the operator console.

Every response is `private, no-store`. These are staff-only aggregates over
the whole platform — nothing here may sit in a shared or CDN cache, and the
short-TTL caching that does happen is server-side and per-key (see
selectors.py), where it can be reasoned about.

Reads only, with one exception: deciding a pending verification, which
delegates to `organizations`' own service rather than reaching into another
module's tables. The console owns no business rules.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from . import selectors
from .health import get_health
from .pagination import (
    ConsoleAuditPagination,
    ConsoleModerationHistoryPagination,
    ConsoleModerationPagination,
    ConsoleOrganizationPagination,
    ConsolePaymentPagination,
    ConsoleRefundPagination,
    ConsoleSettlementPagination,
    ConsoleUserPagination,
)
from .permissions import IsPlatformAdmin
from .repositories import ConsoleRepository
from .schemas import (
    ActivitySerializer,
    AdminOrganizationSerializer,
    AdminPaymentSerializer,
    AdminRefundSerializer,
    AdminSettlementSerializer,
    AdminUserSerializer,
    AuditEntrySerializer,
    BreakdownSerializer,
    HealthSerializer,
    ModerationDecisionSerializer,
    ModerationQueueSerializer,
    OverviewSerializer,
    PendingVerificationSerializer,
    SuspendUserSerializer,
    TimeseriesSerializer,
)


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


class ConsoleView(APIView):
    """Shared base: staff-only, never cached at the edge."""

    permission_classes = [IsPlatformAdmin]


class OverviewView(ConsoleView):
    @extend_schema(responses={200: OverviewSerializer})
    def get(self, request: Request) -> Response:
        return _no_store(Response(OverviewSerializer(selectors.get_overview()).data))


class TimeseriesView(ConsoleView):
    @extend_schema(
        parameters=[
            OpenApiParameter("metric", str, description="revenue | bookings | signups"),
            OpenApiParameter("days", int, description=f"1–{selectors.MAX_SERIES_DAYS}"),
        ],
        responses={200: TimeseriesSerializer},
    )
    def get(self, request: Request) -> Response:
        metric = request.query_params.get("metric", "revenue")
        if metric not in ("revenue", "bookings", "signups"):
            metric = "revenue"
        try:
            days = int(request.query_params.get("days", selectors.DEFAULT_SERIES_DAYS))
        except (TypeError, ValueError):
            days = selectors.DEFAULT_SERIES_DAYS
        payload = selectors.get_timeseries(metric, days)
        return _no_store(Response(TimeseriesSerializer(payload).data))


class BreakdownView(ConsoleView):
    @extend_schema(
        parameters=[
            OpenApiParameter("by", str, description="events_by_city | revenue_by_city"),
            OpenApiParameter("limit", int),
        ],
        responses={200: BreakdownSerializer},
    )
    def get(self, request: Request) -> Response:
        by = request.query_params.get("by", "events_by_city")
        if by not in ("events_by_city", "revenue_by_city"):
            by = "events_by_city"
        try:
            limit = int(request.query_params.get("limit", 8))
        except (TypeError, ValueError):
            limit = 8
        return _no_store(Response(BreakdownSerializer(selectors.get_breakdown(by, limit)).data))


class ActivityView(ConsoleView):
    @extend_schema(parameters=[OpenApiParameter("limit", int)], responses={200: ActivitySerializer})
    def get(self, request: Request) -> Response:
        try:
            limit = int(request.query_params.get("limit", 20))
        except (TypeError, ValueError):
            limit = 20
        return _no_store(Response({"data": selectors.get_activity(limit)}))


class HealthView(ConsoleView):
    @extend_schema(responses={200: HealthSerializer})
    def get(self, request: Request) -> Response:
        return _no_store(Response(HealthSerializer(get_health()).data))


class OrganizationListView(ConsoleView):
    pagination_class = ConsoleOrganizationPagination

    @extend_schema(
        parameters=[OpenApiParameter("verified_level", str)],
        responses={200: AdminOrganizationSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        queryset = ConsoleRepository().list_organizations(
            verified_level=request.query_params.get("verified_level")
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return _no_store(
            paginator.get_paginated_response(
                cast(list, AdminOrganizationSerializer(page, many=True).data)
            )
        )


class UserListView(ConsoleView):
    pagination_class = ConsoleUserPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str),
            OpenApiParameter("role", str, description="organizer | staff | attendee | suspended"),
        ],
        responses={200: AdminUserSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        queryset = ConsoleRepository().list_users(
            search=request.query_params.get("q"), role=request.query_params.get("role")
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return _no_store(
            paginator.get_paginated_response(cast(list, AdminUserSerializer(page, many=True).data))
        )


class UserSuspensionView(ConsoleView):
    """Suspend or reinstate an account.

    The console owns no rule here either: `AccountAdminService` holds the two
    refusals (no self-suspension, no suspending staff) because they hold
    regardless of which operator is asking. This view proves the caller is
    staff and passes the decision along.
    """

    @extend_schema(request=SuspendUserSerializer, responses={200: AdminUserSerializer})
    def post(self, request: Request, user_id: UUID) -> Response:
        from config.di import build_account_admin_service

        payload = SuspendUserSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        user = build_account_admin_service().set_suspended(
            user_id=user_id,
            actor_id=cast(User, request.user).id,
            suspended=payload.validated_data["suspended"],
            reason=payload.validated_data.get("reason", ""),
        )
        return _no_store(Response(AdminUserSerializer(user).data))


class PaymentListView(ConsoleView):
    """Every payment on the platform.

    The console's read side over `payments`, which has no admin list of its
    own — the module owns the webhook, the refund rule and the ledger, and
    reporting on them is this module's job (see the note at the top of
    `repositories.py` about crossing boundaries downward only).
    """

    pagination_class = ConsolePaymentPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("status", str, description="created | paid | failed | refunded"),
            OpenApiParameter("q", str, description="Provider reference or customer email"),
        ],
        responses={200: AdminPaymentSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        queryset = ConsoleRepository().list_payments(
            status=request.query_params.get("status"), search=request.query_params.get("q")
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_payments(list(page or []))
        data = cast(list, AdminPaymentSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class RefundListView(ConsoleView):
    pagination_class = ConsoleRefundPagination

    @extend_schema(
        parameters=[OpenApiParameter("q", str, description="Provider reference or customer email")],
        responses={200: AdminRefundSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        queryset = ConsoleRepository().list_refunds(search=request.query_params.get("q"))
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_refunds(list(page or []))
        data = cast(list, AdminRefundSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class SettlementListView(ConsoleView):
    pagination_class = ConsoleSettlementPagination

    @extend_schema(
        parameters=[OpenApiParameter("status", str)],
        responses={200: AdminSettlementSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        queryset = ConsoleRepository().list_settlements(status=request.query_params.get("status"))
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return _no_store(
            paginator.get_paginated_response(
                cast(list, AdminSettlementSerializer(page, many=True).data)
            )
        )


class PendingVerificationListView(ConsoleView):
    @extend_schema(responses={200: PendingVerificationSerializer(many=True)})
    def get(self, request: Request) -> Response:
        records = ConsoleRepository().list_pending_verifications()
        return _no_store(Response({"data": PendingVerificationSerializer(records, many=True).data}))


class VerificationDecisionView(ConsoleView):
    """Approve or reject a pending verification.

    The console does NOT write to `organizations`' tables. It calls that
    module's own service, which owns the rules (and the outbox event that
    tells `notifications` to email the organizer). This view's whole job is
    to check the caller is staff and pass the decision along.
    """

    @extend_schema(request=None, responses={200: None})
    def post(self, request: Request, organization_id: str) -> Response:
        from config.di import build_organization_service

        approve = bool(request.data.get("approve", True))
        notes = str(request.data.get("notes", ""))[:500]
        service = build_organization_service()
        service.decide_verification(
            organization_id=organization_id,
            actor_id=cast(User, request.user).id,
            approve=approve,
            notes=notes,
        )
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


class EventModerationQueueView(ConsoleView):
    """Events an organizer has submitted and nobody has decided yet.

    This is the gate that makes the marketplace curated rather than open: an
    event is not public until a row here has been approved.
    """

    pagination_class = ConsoleModerationPagination

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "status",
                str,
                description="pending_review (default) | live | rejected | archived",
            )
        ],
        responses={200: ModerationQueueSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        from apps.events.repositories import EventRepository

        # An unrecognised status falls back to the pending queue rather than
        # widening — the repository owns that rule, so `draft` cannot be
        # reached by guessing a query string.
        wanted = request.query_params.get("status")
        queryset = EventRepository().list_for_moderation(status=wanted)
        # The paginator's ordering has to MATCH the queryset's — cursor
        # pagination does not check, and a mismatch silently returns wrong
        # pages rather than failing. Pending is FIFO; every decided list is
        # newest-first.
        paginator = (
            self.pagination_class()
            if wanted in (None, "", "pending_review")
            else ConsoleModerationHistoryPagination()
        )
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = [
            {
                "id": event.id,
                "title": event.title,
                "description": event.description,
                "venue": event.venue,
                "city": event.city,
                "starts_at": event.starts_at,
                "ends_at": event.ends_at,
                "poster_url": event.poster_url,
                "status": event.status,
                "submitted_at": event.submitted_at,
                "moderated_at": event.moderated_at,
                "moderation_note": event.moderation_note,
                "organization_id": event.organization_id,
                "organization_name": event.organization.name,
                "verified_level": event.organization.verified_level,
                "created_at": event.created_at,
            }
            for event in (page or [])
        ]
        data = cast(list, ModerationQueueSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class EventModerationDecisionView(ConsoleView):
    """Approve or reject a submitted event.

    The rule lives in `events`' own moderation service — the console owns no
    business logic, exactly as it delegates a verification decision to
    `organizations`.
    """

    @extend_schema(request=ModerationDecisionSerializer, responses={200: None})
    def post(self, request: Request, event_id: UUID) -> Response:
        from config.di import build_event_moderation_service

        payload = ModerationDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_event_moderation_service()
        event = service.moderate(
            event_id=event_id,
            actor_id=cast(User, request.user).id,
            approve=payload.validated_data["approve"],
            note=payload.validated_data.get("note", ""),
        )
        return _no_store(Response({"id": str(event.id), "status": event.status}))


class EventUnpublishView(ConsoleView):
    """Take a live event back off sale, with a reason.

    Hides the listing; it does not cancel anybody's booking. Refunding is a
    separate, deliberate decision in `payments`.
    """

    @extend_schema(request=ModerationDecisionSerializer, responses={200: None})
    def post(self, request: Request, event_id: UUID) -> Response:
        from config.di import build_event_moderation_service

        note = str(request.data.get("note", ""))
        service = build_event_moderation_service()
        event = service.unpublish(
            event_id=event_id, actor_id=cast(User, request.user).id, note=note
        )
        return _no_store(Response({"id": str(event.id), "status": event.status}))


class AuditLogView(ConsoleView):
    """The immutable record of who did what.

    Reads the audit log, NOT the outbox: the outbox says what the domain did,
    this says what a person did. Actor emails are resolved in one extra query
    for the whole page — `actor_id` is a plain string so the trail outlives the
    account, which rules out a join.
    """

    pagination_class = ConsoleAuditPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("action", str, description="Prefix, e.g. `event.` or `organization.`"),
            OpenApiParameter("target_id", str),
        ],
        responses={200: AuditEntrySerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        repository = ConsoleRepository()
        queryset = repository.list_audit(
            action=request.query_params.get("action"),
            target_id=request.query_params.get("target_id"),
        )
        paginator = self.pagination_class()
        page = list(paginator.paginate_queryset(queryset, request, view=self) or [])
        emails = repository.actor_emails([entry.actor_id for entry in page])
        rows = [
            {
                "id": entry.id,
                "actor_id": entry.actor_id,
                "actor_email": emails.get(entry.actor_id, ""),
                "action": entry.action,
                "target_type": entry.target_type,
                "target_id": entry.target_id,
                "metadata": entry.metadata,
                "created_at": entry.created_at,
            }
            for entry in page
        ]
        data = cast(list, AuditEntrySerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))
