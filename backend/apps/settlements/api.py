"""Thin views. Settlement figures are per-organizer, sensitive money data →
every response is `private, no-store` (a shared/CDN cache must never serve one
organizer's figures to another, and stale money must never read as
authoritative). The PRIMARY payout path is the scheduled job, not a request;
the admin release endpoint only *triggers* it (the payout runs off-request)."""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import build_settlement_service

from .exceptions import NotSettlementOwnerError, SettlementNotFoundError
from .pagination import SettlementCursorPagination
from .schemas import SettlementSerializer
from .selectors import get_settlement, list_settlements


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


class OrganizerSettlementListView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = SettlementCursorPagination

    @extend_schema(responses={200: SettlementSerializer(many=True)})
    def get(self, request: Request) -> Response:
        # The query already filters to the caller's own events — an organizer
        # only ever sees their own settlements.
        queryset = list_settlements(cast(User, request.user).id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        data = cast(list, SettlementSerializer(page, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class OrganizerSettlementDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: SettlementSerializer})
    def get(self, request: Request, event_id: str) -> Response:
        settlement = get_settlement(event_id)
        if settlement is None:
            raise SettlementNotFoundError(str(event_id))
        if str(settlement.event.organization.owner_id) != str(cast(User, request.user).id):
            raise NotSettlementOwnerError()
        return _no_store(Response(SettlementSerializer(settlement).data))


class AdminSettlementReleaseView(APIView):
    # Guarded manual trigger — staff/admin only. The primary release path is the
    # scheduled job; this exists for ops (e.g. re-driving a dead-lettered payout
    # after fixing a linked account).
    permission_classes = [IsAdminUser]

    @extend_schema(request=None, responses={202: None})
    def post(self, request: Request, settlement_id: str) -> Response:
        # Pre-checks the event is finished (EventNotFinished surfaces as 409),
        # then enqueues — the external payout still runs off the request path.
        build_settlement_service().request_release(settlement_id)
        return _no_store(Response({"status": "release_initiated"}))
