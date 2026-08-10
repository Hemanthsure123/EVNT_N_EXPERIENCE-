"""Thin views for support. Every read is per-viewer and `private, no-store`.

Support threads carry payment complaints and gate refusals in somebody's own
words with their name attached. Nothing here is cached, and nothing here is
reachable without a session.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.di import build_support_service
from core.pagination import CursorPagination

from .models import SupportQuery
from .repositories import SupportRepository
from .schemas import (
    RaiseQueryRequestSerializer,
    ReplyRequestSerializer,
    StatusRequestSerializer,
    SupportQuerySerializer,
)
from .services import Viewer


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


def _viewer(request: Request) -> Viewer:
    """Who is asking, resolved once per request.

    The organizations are read here rather than in the service so the service
    stays a pure rule engine over what it is given — and so a view that has
    already loaded them (the organizer queue) does not pay for a second query.
    """
    user = request.user
    organization_ids: tuple[str, ...] = ()
    if user.is_authenticated:
        from apps.organizations.models import Organization

        organization_ids = tuple(
            str(value)
            for value in Organization.objects.filter(
                owner_id=user.id, deleted_at__isnull=True
            ).values_list("id", flat=True)
        )
    return Viewer(
        user_id=user.id,
        is_staff=bool(getattr(user, "is_staff", False)),
        organization_ids=organization_ids,
    )


class SupportQueryPagination(CursorPagination):
    #: Matches `support_status_recent_idx` and the model's own ordering.
    #: A paginator whose ordering disagrees with the queryset returns wrong
    #: pages silently rather than failing — see the console's own note.
    ordering = ("-created_at", "-id")


class MySupportQueriesView(APIView):
    """The customer's own threads, and the one place a query is raised."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=SupportQuerySerializer(many=True), tags=["support"])
    def get(self, request: Request) -> Response:
        rows = SupportRepository().list_for_user(user_id=request.user.id)
        paginator = SupportQueryPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        data = cast(list, SupportQuerySerializer(page or [], many=True).data)
        return _no_store(paginator.get_paginated_response(data))

    @extend_schema(
        request=RaiseQueryRequestSerializer,
        responses={201: SupportQuerySerializer},
        tags=["support"],
    )
    def post(self, request: Request) -> Response:
        payload = RaiseQueryRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        # A ticket identifies its own event, and the browser is not asked to
        # agree: resolving it here is what stops a query being routed to an
        # organization the sender does not have a ticket for.
        event_id = data.get("event_id")
        ticket_id = data.get("ticket_id")
        if ticket_id:
            from apps.booking.models import Ticket

            ticket = (
                Ticket.objects.filter(id=ticket_id, booking__user_id=request.user.id)
                .select_related("booking")
                .first()
            )
            # A ticket that is not theirs is simply dropped rather than
            # rejected: the query is still worth raising, it just carries no
            # ticket. Refusing would turn a support request into a puzzle.
            ticket_id = ticket.id if ticket else None
            if ticket is not None and not event_id:
                event_id = ticket.booking.event_id

        query = build_support_service().raise_query(
            user_id=request.user.id,
            subject=data["subject"],
            body=data["body"],
            audience=data["audience"],
            event_id=event_id,
            ticket_id=ticket_id,
        )
        return _no_store(
            Response(SupportQuerySerializer(query).data, status=status.HTTP_201_CREATED)
        )


class SupportQueryDetailView(APIView):
    """One thread, for whoever is entitled to it."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=SupportQuerySerializer, tags=["support"])
    def get(self, request: Request, query_id: UUID) -> Response:
        service = build_support_service()
        query = service.get_for_viewer(query_id=query_id, viewer=_viewer(request))
        return _no_store(Response(_with_replies(query)))


class SupportReplyView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=ReplyRequestSerializer,
        responses=SupportQuerySerializer,
        tags=["support"],
    )
    def post(self, request: Request, query_id: UUID) -> Response:
        payload = ReplyRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        query = build_support_service().reply(
            query_id=query_id, viewer=_viewer(request), body=payload.validated_data["body"]
        )
        return _no_store(Response(_with_replies(query)))


class SupportStatusView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=StatusRequestSerializer,
        responses=SupportQuerySerializer,
        tags=["support"],
    )
    def post(self, request: Request, query_id: UUID) -> Response:
        payload = StatusRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        query = build_support_service().set_status(
            query_id=query_id, viewer=_viewer(request), status=payload.validated_data["status"]
        )
        return _no_store(Response(_with_replies(query)))


class OrganizerSupportQueriesView(APIView):
    """The organiser's queue — their events only, and only what was sent to them."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[OpenApiParameter("status", str)],
        responses=SupportQuerySerializer(many=True),
        tags=["support"],
    )
    def get(self, request: Request) -> Response:
        viewer = _viewer(request)
        rows = SupportRepository().list_for_organizations(
            organization_ids=viewer.organization_ids,
            status=request.query_params.get("status") or None,
        )
        paginator = SupportQueryPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        data = cast(list, SupportQuerySerializer(page or [], many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class AdminSupportQueriesView(APIView):
    """Platform-wide. Staff only."""

    permission_classes = [IsAdminUser]

    @extend_schema(
        parameters=[OpenApiParameter("status", str)],
        responses=SupportQuerySerializer(many=True),
        tags=["support"],
    )
    def get(self, request: Request) -> Response:
        rows = SupportRepository().list_for_platform(
            status=request.query_params.get("status") or None
        )
        paginator = SupportQueryPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        data = cast(list, SupportQuerySerializer(page or [], many=True).data)
        return _no_store(paginator.get_paginated_response(data))


def _with_replies(query: SupportQuery) -> dict:
    """Serialize one thread WITH its messages.

    The list endpoints deliberately do not do this — a page of twenty threads
    would carry every message on every one of them, and a queue is scanned by
    subject. The detail endpoint is where somebody is reading a conversation.
    """
    data = dict(SupportQuerySerializer(query).data)
    from .schemas import SupportReplySerializer

    replies = SupportRepository().replies_for(query_id=query.id)
    data["replies"] = SupportReplySerializer(replies, many=True).data
    return data
