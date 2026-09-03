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
from core.errors import InvalidInputError, NotFoundError
from core.query_params import date_range_params, text_param, uuid_param

from . import selectors
from .health import get_health
from .pagination import (
    ConsoleAuditPagination,
    ConsoleBookingPagination,
    ConsoleEnquiryPagination,
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
    AdminBookingDetailSerializer,
    AdminBookingSerializer,
    AdminCrewMemberSerializer,
    AdminEnquirySerializer,
    AdminOrganizationSerializer,
    AdminPaymentSerializer,
    AdminRefundSerializer,
    AdminSettlementSerializer,
    AdminUserSerializer,
    AuditEntrySerializer,
    BreakdownSerializer,
    DecideEnquirySerializer,
    DeleteEventResultSerializer,
    HealthSerializer,
    ModerationDecisionSerializer,
    ModerationQueueSerializer,
    OrganizationAnalyticsSerializer,
    OrganizerEventAnalyticsSerializer,
    OverviewSerializer,
    PendingVerificationSerializer,
    PromoteUserSerializer,
    RevokeVerificationSerializer,
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
    """Dependency status tiles.

    `?deep=1` additionally CONTACTS the payment provider and the storage bucket
    and inspects the outbox, instead of only reporting which adapter is
    configured. Opt-in rather than default, and cached for a minute, because a
    dashboard left open on a wall must not become traffic against Razorpay —
    and because an operator wants the deep answer before a Friday on-sale, not
    on every poll all week.
    """

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "deep",
                bool,
                description=(
                    "Contact the payment provider and storage, and check the outbox. " "Cached 60s."
                ),
            )
        ],
        responses={200: HealthSerializer},
    )
    def get(self, request: Request) -> Response:
        deep = request.query_params.get("deep") in ("1", "true", "True", "yes")
        return _no_store(Response(HealthSerializer(get_health(deep=deep)).data))


class OrganizationListView(ConsoleView):
    pagination_class = ConsoleOrganizationPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("verified_level", str),
            OpenApiParameter("q", str, description="Organisation name"),
            OpenApiParameter("created_after", str, description="ISO-8601, inclusive"),
            OpenApiParameter("created_before", str, description="ISO-8601, inclusive"),
        ],
        responses={200: AdminOrganizationSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        created_after, created_before = date_range_params(
            request, after="created_after", before="created_before"
        )
        queryset = ConsoleRepository().list_organizations(
            verified_level=request.query_params.get("verified_level"),
            search=text_param(request, "q"),
            created_after=created_after,
            created_before=created_before,
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
            OpenApiParameter("created_after", str, description="ISO-8601, inclusive"),
            OpenApiParameter("created_before", str, description="ISO-8601, inclusive"),
        ],
        responses={200: AdminUserSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        created_after, created_before = date_range_params(
            request, after="created_after", before="created_before"
        )
        queryset = ConsoleRepository().list_users(
            search=text_param(request, "q"),
            role=request.query_params.get("role"),
            created_after=created_after,
            created_before=created_before,
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


class EnquiryListView(ConsoleView):
    """The hire desk.

    Somebody wanting a band sends what they need; this is where it lands, and
    an operator gets back to them. There is no matching and no quoting — the
    platform has no performer supply side, so a queue an operator works by
    hand is the whole mechanism rather than a fallback for one.
    """

    pagination_class = ConsoleEnquiryPagination

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "status",
                str,
                description="new (default view) | in_progress | closed_won | closed_lost",
            ),
            OpenApiParameter("q", str, description="City, contact, or anything in the notes"),
        ],
        responses={200: AdminEnquirySerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        from apps.performers.repositories import BookingRequestRepository

        queryset = BookingRequestRepository().list_for_operator(
            status=request.query_params.get("status"),
            search=text_param(request, "q"),
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.enquiry_payloads(list(page or []))
        data = cast(list, AdminEnquirySerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class EnquiryDecisionView(ConsoleView):
    """Move one enquiry through the queue."""

    @extend_schema(request=DecideEnquirySerializer, responses={200: AdminEnquirySerializer})
    def patch(self, request: Request, enquiry_id: UUID) -> Response:
        from apps.console.selectors import enquiry_payloads
        from config.di import build_marketplace_service

        payload = DecideEnquirySerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        updated = build_marketplace_service().decide_enquiry(
            request_id=enquiry_id,
            actor_id=cast(User, request.user).id,
            status=payload.validated_data["status"],
            admin_note=payload.validated_data.get("admin_note", ""),
        )
        return _no_store(Response(AdminEnquirySerializer(enquiry_payloads([updated])[0]).data))


class UserRoleView(ConsoleView):
    """Grant or remove the operator role.

    ── WHY THIS IS SEPARATE FROM SUSPENSION ───────────────────────────────

    Suspension is an ACCESS decision — it stops somebody signing in at all.
    This is a ROLE decision: it changes what an account can reach while signed
    in. `AccountAdminService.set_suspended` already refuses to suspend a staff
    member and tells the operator to "remove their operator role first" — this
    is that endpoint, and until now it did not exist, so the instruction
    pointed at nothing.
    """

    @extend_schema(request=PromoteUserSerializer, responses={200: AdminUserSerializer})
    def post(self, request: Request, user_id: UUID) -> Response:
        from config.di import build_account_admin_service

        payload = PromoteUserSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        user = build_account_admin_service().set_operator(
            user_id=user_id,
            actor_id=cast(User, request.user).id,
            is_operator=payload.validated_data["is_staff"],
            reason=payload.validated_data.get("reason", ""),
        )
        return _no_store(Response(AdminUserSerializer(user).data))


class UserVerificationView(ConsoleView):
    """Revoke an operator's trust in a proven address.

    Its own endpoint rather than a flag on the suspension one, because it is a
    DIFFERENT decision: suspension says "this person is out of service",
    revocation says "the address they proved is no longer trusted" — and the
    second implies the first while the first does not imply the second.
    Collapsing them would make reinstating somebody silently re-assert an
    address nobody re-checked.

    There is deliberately no un-revoke. The way back is the ordinary one: an
    operator reinstates the account and the person verifies their address
    again, which is the whole point of having withdrawn the trust.
    """

    @extend_schema(request=RevokeVerificationSerializer, responses={200: AdminUserSerializer})
    def delete(self, request: Request, user_id: UUID) -> Response:
        from config.di import build_account_admin_service

        payload = RevokeVerificationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        user = build_account_admin_service().revoke_verification(
            user_id=user_id,
            actor_id=cast(User, request.user).id,
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
            OpenApiParameter("created_after", str, description="ISO-8601, inclusive"),
            OpenApiParameter("created_before", str, description="ISO-8601, inclusive"),
        ],
        responses={200: AdminPaymentSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        created_after, created_before = date_range_params(
            request, after="created_after", before="created_before"
        )
        queryset = ConsoleRepository().list_payments(
            status=request.query_params.get("status"),
            search=text_param(request, "q"),
            created_after=created_after,
            created_before=created_before,
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_payments(list(page or []))
        data = cast(list, AdminPaymentSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class BookingListView(ConsoleView):
    """Search every booking on the platform — the support desk's core tool.

    Before this existed there was NO way to answer "the customer says they paid
    but has no ticket" from the product. `GET /bookings/{id}` is scoped to the
    booking's owner, so an operator could not open one even holding the id, and
    the only route was the Django admin.

    The payment search partly covered it and structurally could not cover it
    fully: a booking that never reached payment — the abandoned checkout, which
    is exactly what people phone about — has no `Payment` row to be found by.
    """

    pagination_class = ConsoleBookingPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("status", str, description="reserved | paid | cancelled | expired"),
            OpenApiParameter(
                "q",
                str,
                description=(
                    "Customer email, booking id (prefix), payment reference, "
                    "payment order id, or event title"
                ),
            ),
            OpenApiParameter("created_after", str, description="ISO-8601, inclusive"),
            OpenApiParameter("created_before", str, description="ISO-8601, inclusive"),
            OpenApiParameter("event_id", str, description="One event, by id"),
        ],
        responses={200: AdminBookingSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        created_after, created_before = date_range_params(
            request, after="created_after", before="created_before"
        )
        queryset = ConsoleRepository().list_bookings(
            status=request.query_params.get("status"),
            search=text_param(request, "q"),
            created_after=created_after,
            created_before=created_before,
            # A malformed id is treated as ABSENT rather than as a 400, the
            # same rule the date filters follow: the list is already
            # staff-scoped, so the worst it can do is widen.
            event_id=uuid_param(request, "event_id"),
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_bookings(list(page or []))
        data = cast(list, AdminBookingSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class BookingDetailView(ConsoleView):
    """One booking, expanded — items, and whether tickets were actually issued.

    A separate endpoint rather than fattening every row of the list: the
    tickets and items are only wanted for the ONE booking an operator opens,
    and prefetching them for a page of 25 would be a much heavier query for a
    table that shows neither.
    """

    @extend_schema(responses={200: AdminBookingDetailSerializer})
    def get(self, request: Request, booking_id: str) -> Response:
        booking = ConsoleRepository().booking_detail(booking_id)
        if booking is None:
            raise NotFoundError(f"Booking '{booking_id}' not found.")
        payload = selectors.booking_detail_payload(booking)
        return _no_store(Response(AdminBookingDetailSerializer(payload).data))


class RefundListView(ConsoleView):
    pagination_class = ConsoleRefundPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, description="Provider reference or customer email"),
            OpenApiParameter("created_after", str, description="ISO-8601, inclusive"),
            OpenApiParameter("created_before", str, description="ISO-8601, inclusive"),
        ],
        responses={200: AdminRefundSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        created_after, created_before = date_range_params(
            request, after="created_after", before="created_before"
        )
        queryset = ConsoleRepository().list_refunds(
            search=text_param(request, "q"),
            created_after=created_after,
            created_before=created_before,
        )
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
            ),
            OpenApiParameter("q", str, description="Event title, venue, city or organiser"),
            OpenApiParameter("starts_after", str, description="ISO-8601, inclusive"),
            OpenApiParameter("starts_before", str, description="ISO-8601, inclusive"),
        ],
        responses={200: ModerationQueueSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        from apps.events.repositories import EventRepository

        # An unrecognised status falls back to the pending queue rather than
        # widening — the repository owns that rule, so `draft` cannot be
        # reached by guessing a query string.
        wanted = request.query_params.get("status")
        starts_after, starts_before = date_range_params(
            request, after="starts_after", before="starts_before"
        )
        queryset = EventRepository().list_for_moderation(
            status=wanted,
            search=text_param(request, "q"),
            starts_after=starts_after,
            starts_before=starts_before,
        )
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


class AdminEventDetailView(ConsoleView):
    """Edit or remove ANY event, as a platform operator.

    Both delegate to `EventModerationService`, which proves staff for itself
    and then reuses `EventService`'s own write — so an operator edit takes the
    same optimistic lock, the same editable-field allow-list and the same cache
    invalidation an organizer's edit takes. There is no operator-only write
    path that could drift from the rules.
    """

    @extend_schema(request=None, responses={200: None})
    def patch(self, request: Request, event_id: UUID) -> Response:
        from config.di import build_event_moderation_service, build_event_service

        version = request.data.get("version")
        if version is None:
            raise InvalidInputError("An edit must carry the version it is based on.")
        try:
            expected_version = int(version)
        except (TypeError, ValueError) as exc:
            raise InvalidInputError("`version` must be a number.") from exc

        changes = {k: v for k, v in request.data.items() if k != "version"}
        event = build_event_moderation_service().update_event(
            event_id=event_id,
            actor_id=cast(User, request.user).id,
            expected_version=expected_version,
            changes=changes,
            events_service=build_event_service(),
        )
        return _no_store(
            Response({"id": str(event.id), "status": event.status, "version": event.version})
        )

    @extend_schema(request=None, responses={200: DeleteEventResultSerializer})
    def delete(self, request: Request, event_id: UUID) -> Response:
        """Remove an event, in ANY state, and make good on it.

        ── IT NO LONGER RETURNS 204 ───────────────────────────────────────

        It used to, because it used to be a no-op on anything with bookings —
        it refused those outright. It now REFUNDS them, so the response carries
        a summary: how many refunds started, how many holds were freed, how
        many attendees were emailed. A destructive action that spends money
        must not answer with a blank success.

        See `EventModerationService.delete_event` for why the operator is never
        blocked and why the delete is soft.
        """
        from config.di import build_event_moderation_service

        # The reason rides a query parameter because a DELETE body is not
        # reliably forwarded by every proxy, and this one is audited.
        reason = str(request.query_params.get("reason", "") or request.data.get("reason", ""))
        summary = build_event_moderation_service().delete_event(
            event_id=event_id, actor_id=cast(User, request.user).id, reason=reason
        )
        return _no_store(Response(DeleteEventResultSerializer(summary).data))


class AdminEventAnalyticsView(ConsoleView):
    """One event's analytics, for an operator.

    ── IT IS THE ORGANIZER'S OWN REPORT, NOT A SECOND ONE ────────────────────

    This delegates to `apps.organizer.selectors.get_event_analytics` after
    resolving who owns the event, rather than growing a console-shaped copy.
    Two reasons, and the second is the important one:

    1. An operator answering "my numbers look wrong" has to be looking at the
       SAME numbers the organizer is looking at. A parallel implementation
       would eventually disagree, and the support conversation would then be
       about which screen to believe.
    2. It is the module that owns the rule — revenue counted at capture,
       admissions from ticket rows rather than scan logs, refunds netted — and
       those definitions should live in exactly one place.

    Reading across a module boundary is what this module does (see the class
    docstring): console reads, and never writes through anything but the owning
    module's service.
    """

    @extend_schema(
        parameters=[OpenApiParameter("days", int)],
        responses={200: OrganizerEventAnalyticsSerializer},
    )
    def get(self, request: Request, event_id: UUID) -> Response:
        from apps.organizer import selectors as organizer_selectors

        owner_id = ConsoleRepository().event_owner_id(event_id)
        if owner_id is None:
            raise NotFoundError("Event not found.")
        try:
            days = int(request.query_params.get("days", organizer_selectors.DEFAULT_SERIES_DAYS))
        except (TypeError, ValueError):
            days = organizer_selectors.DEFAULT_SERIES_DAYS
        payload = organizer_selectors.get_event_analytics(owner_id, event_id, days)
        return _no_store(Response(OrganizerEventAnalyticsSerializer(payload).data))


class AdminOrganizationAnalyticsView(ConsoleView):
    """One organizer's dashboard, for an operator — same reasoning as above.

    Returns the organizer's own KPI tiles and their daily series, so an
    operator investigating an organization sees what that organization sees.
    """

    @extend_schema(
        parameters=[
            OpenApiParameter("metric", str, description="revenue | bookings | tickets"),
            OpenApiParameter("days", int),
        ],
        responses={200: OrganizationAnalyticsSerializer},
    )
    def get(self, request: Request, organization_id: UUID) -> Response:
        from apps.organizer import selectors as organizer_selectors

        owner_id = ConsoleRepository().organization_owner_id(organization_id)
        if owner_id is None:
            raise NotFoundError("Organization not found.")
        metric = request.query_params.get("metric", "revenue")
        try:
            days = int(request.query_params.get("days", organizer_selectors.DEFAULT_SERIES_DAYS))
        except (TypeError, ValueError):
            days = organizer_selectors.DEFAULT_SERIES_DAYS
        return _no_store(
            Response(
                OrganizationAnalyticsSerializer(
                    {
                        "overview": organizer_selectors.get_overview(owner_id),
                        "timeseries": organizer_selectors.get_timeseries(owner_id, metric, days),
                    }
                ).data
            )
        )


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


class AdminOrganizationCrewView(ConsoleView):
    """One organization's crew roster, for an operator.

    READ ONLY, like everything else in this module. An operator can see who an
    organization puts on stage — which is what makes a report about a lineup
    actionable — and cannot edit somebody else's roster, because that is the
    organizer's own screen and a console that writes here would be a console
    that can break `events`' invariants.

    No `ADMIN_SECTIONS` entry: there is no platform-wide crew endpoint behind
    it, and a nav item that leads to a page needing an id it does not have is
    worse than no nav item.
    """

    @extend_schema(responses={200: AdminCrewMemberSerializer(many=True)})
    def get(self, request: Request, organization_id: str) -> Response:
        from . import repositories

        rows = repositories.ConsoleRepository().crew_for_organization(organization_id)
        return _no_store(Response({"data": AdminCrewMemberSerializer(rows, many=True).data}))
