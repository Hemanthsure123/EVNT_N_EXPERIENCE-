"""Thin views.

The webhook is the security boundary: it takes NO user token (Razorpay calls
it server-to-server), and it authenticates purely by the HMAC signature over
the RAW request body. Everything else is per-user private data → `private,
no-store`.
"""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import build_payment_service, build_refund_request_service
from core.throttling import WebhookThrottle, WriteThrottle

from .exceptions import NotAllowedToViewPaymentError, PaymentNotFoundError
from .models import RefundRequestStatus
from .pagination import PendingRefundRequestPagination, RefundRequestPagination
from .repositories import RefundRequestRepository
from .schemas import (
    PaymentSerializer,
    RefundDecisionSerializer,
    RefundRequestCreateSerializer,
    RefundRequestSerializer,
    SimulatePaymentRequestSerializer,
    VerifyPaymentRequestSerializer,
    VerifyPaymentResponseSerializer,
)
from .selectors import get_payment_detail, refund_request_payload, refund_request_payloads


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


class WebhookView(APIView):
    # No user auth — Razorpay calls this server-to-server. The signature over
    # the raw body is the only credential (verified in the service).
    permission_classes = [AllowAny]
    authentication_classes: list = []
    # Set well ABOVE Razorpay's retry schedule: the signature is the real
    # gate, and throttling a genuine retry delays a ticket already paid for.
    throttle_classes = [WebhookThrottle]

    @extend_schema(request=None, responses={200: None})
    def post(self, request: Request) -> Response:
        # The HMAC is computed over the exact bytes Razorpay sent, so we must
        # verify against the RAW body — never the re-serialized parsed data.
        raw_body = request.body
        signature = request.headers.get("X-Razorpay-Signature", "")

        service = build_payment_service()
        outcome = service.handle_webhook(raw_body=raw_body, signature=signature)
        # Always 200 once safely recorded (verification failures raise -> 400).
        return Response({"status": outcome.status}, status=status.HTTP_200_OK)


class VerifyPaymentView(APIView):
    """`POST /payments/verify` — confirm a payment the provider was not able
    to tell us about.

    ── WHAT THIS IS NOT ──────────────────────────────────────────────────────

    It is NOT the browser reporting a successful payment. The body carries a
    single opaque id; the service throws it at the provider and uses only what
    comes back. Somebody who posts an invented id gets `ignored`, and somebody
    who posts a real id belonging to another customer's payment gets a payment
    whose order resolves to that customer's booking — which is already paid,
    so it dedupes and issues nothing. There is no id that makes this endpoint
    grant a ticket that was not paid for.

    ── WHY IT IS AUTHENTICATED ANYWAY ────────────────────────────────────────

    Correctness does not need the session — the provider's answer is the gate.
    But an unauthenticated endpoint that reaches a payment provider on demand
    is a free oracle for probing which payment ids exist, so it takes a token
    and a write throttle. Belt and braces, in that order.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    @extend_schema(
        request=VerifyPaymentRequestSerializer,
        responses={200: VerifyPaymentResponseSerializer},
    )
    def post(self, request: Request) -> Response:
        payload = VerifyPaymentRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_payment_service()
        outcome = service.verify_and_confirm(
            provider_payment_id=payload.validated_data["razorpay_payment_id"],
        )
        return _no_store(Response({"status": outcome.status}, status=status.HTTP_200_OK))


class SimulatePaymentView(APIView):
    """`POST /payments/simulate` — complete a payment on a deployment that has
    no real payment provider configured.

    ── IT IS NOT A BACK DOOR, AND IT IS NOT ALWAYS OPEN ──────────────────────

    It refuses outright unless the CONFIGURED port is a `SimulatedPaymentPort`
    — the real Razorpay adapter is not one, so with `PAYMENTS_BACKEND=razorpay`
    every call is a `409 simulated_payment_unavailable`. `core/preflight.py`
    already refuses to boot production on a fake backend, so in production this
    view can only ever refuse. It is mounted unconditionally on purpose: a route
    that vanishes based on a setting is a route nobody can test, and the honest
    refusal is the more useful answer to a client than a 404.

    ── WHAT THE CALLER GETS TO DECIDE ────────────────────────────────────────

    Which of their OWN bookings to pay for. That is all. The amount comes off
    the booking row, the payment id comes from the provider, and the confirm
    runs the same `verify_and_confirm` a real Razorpay payment runs — including
    the ledger dedupe and the amount check. The demo is a demo of the REAL
    fulfilment path, which is the only kind worth having.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    @extend_schema(
        request=SimulatePaymentRequestSerializer,
        responses={200: VerifyPaymentResponseSerializer},
    )
    def post(self, request: Request) -> Response:
        payload = SimulatePaymentRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_payment_service()
        outcome = service.simulate_capture(
            booking_id=payload.validated_data["booking_id"],
            actor_id=cast(User, request.user).id,
        )
        return _no_store(Response({"status": outcome.status}, status=status.HTTP_200_OK))


class PaymentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: PaymentSerializer})
    def get(self, request: Request, payment_id: str) -> Response:
        payment = get_payment_detail(payment_id)
        if payment is None:
            raise PaymentNotFoundError(str(payment_id))

        actor_id = str(cast(User, request.user).id)
        is_owner = str(payment.booking.user_id) == actor_id
        is_organizer = str(payment.booking.event.organization.owner_id) == actor_id
        if not (is_owner or is_organizer):
            raise NotAllowedToViewPaymentError()

        return _no_store(Response(PaymentSerializer(payment).data))


class PaymentRefundView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    @extend_schema(request=None, responses={200: None})
    def post(self, request: Request, payment_id: str) -> Response:
        user = cast(User, request.user)
        service = build_payment_service()
        payment = service.refund_payment(
            payment_id=payment_id, actor_id=user.id, is_admin=user.is_staff
        )
        # The external refund is offloaded to the queue — acknowledge and let
        # the client poll GET /payments/{id} for the final refunded state.
        return _no_store(Response({"status": "refund_initiated", "payment_id": str(payment.id)}))


class _RefundRequestListMixin:
    """Shared paging for the three refund-request queues.

    The paginator MUST match the queryset's ordering, and the repository picks
    its ordering from the same `status` value — so both are derived from one
    input rather than kept in sync by hand. See `pagination.py`.
    """

    def _paginate(self, request: Request, queryset) -> Response:
        status_filter = request.query_params.get("status")
        paginator = (
            PendingRefundRequestPagination()
            if status_filter == RefundRequestStatus.PENDING
            else RefundRequestPagination()
        )
        # `self` is always an APIView here — this mixin is only ever mixed
        # into one, which the type system cannot see from the mixin alone.
        page = paginator.paginate_queryset(queryset, request, view=cast(APIView, self))
        rows = refund_request_payloads(list(page or []))
        data = cast(list, RefundRequestSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class BookingRefundRequestView(APIView):
    """POST /bookings/{id}/refund-requests — the customer asks.

    Mounted under the BOOKING rather than under /refund-requests, because that
    is the only place a customer ever starts from: they are looking at an order
    and want their money back for it. It also makes the booking id a path
    segment the permission check can rely on rather than a body field.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    @extend_schema(
        request=RefundRequestCreateSerializer,
        responses={201: RefundRequestSerializer},
        operation_id="booking_request_refund",
    )
    def post(self, request: Request, booking_id: str) -> Response:
        payload = RefundRequestCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        user = cast(User, request.user)
        created = build_refund_request_service().request_refund(
            booking_id=booking_id,
            user_id=user.id,
            reason=payload.validated_data["reason"],
        )
        # Re-read through the repository so the response carries the same
        # joined shape every other surface renders — the created instance has
        # no `select_related` behind it and would N+1 on the way out.
        row = RefundRequestRepository().get_for_decision(created.id)
        return _no_store(
            Response(
                RefundRequestSerializer(refund_request_payload(row)).data,
                status=status.HTTP_201_CREATED,
            )
        )


class MyRefundRequestListView(_RefundRequestListMixin, APIView):
    """GET /me/refund-requests — what the customer asked for, and what happened.

    The whole point of the model: before it, asking for a refund was an email
    thread with no status anybody could look at. This is the status.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("status", str, description="pending | approved | rejected | failed")
        ],
        responses={200: RefundRequestSerializer(many=True)},
        operation_id="my_refund_requests",
    )
    def get(self, request: Request) -> Response:
        user = cast(User, request.user)
        queryset = RefundRequestRepository().list_for_user(user.id)
        if status_filter := request.query_params.get("status"):
            queryset = queryset.filter(status=status_filter)
        return self._paginate(request, queryset)


class OrganizerRefundRequestListView(_RefundRequestListMixin, APIView):
    """GET /organizer/refund-requests — the queue an organizer works through."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[OpenApiParameter("status", str)],
        responses={200: RefundRequestSerializer(many=True)},
        operation_id="organizer_refund_requests",
    )
    def get(self, request: Request) -> Response:
        user = cast(User, request.user)
        queryset = RefundRequestRepository().list_for_organizer(
            user.id, status=request.query_params.get("status")
        )
        return self._paginate(request, queryset)


class RefundRequestDecisionView(APIView):
    """POST /refund-requests/{id}/decide — approve or reject.

    ONE endpoint for the organizer AND the operator, rather than an
    `/organizer/...` and an `/admin/...` pair. The rule is identical (own the
    event, or be staff), it lives in the service, and two endpoints would be two
    places for it to drift — with the admin copy inevitably being the lenient
    one. `is_admin` is passed through and the service decides.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    @extend_schema(
        request=RefundDecisionSerializer,
        responses={200: RefundRequestSerializer},
        operation_id="refund_request_decide",
    )
    def post(self, request: Request, request_id: str) -> Response:
        payload = RefundDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        user = cast(User, request.user)
        build_refund_request_service().decide(
            request_id=request_id,
            actor_id=user.id,
            approve=payload.validated_data["approve"],
            note=payload.validated_data.get("note", ""),
            is_admin=user.is_staff,
        )
        row = RefundRequestRepository().get_for_decision(request_id)
        return _no_store(Response(RefundRequestSerializer(refund_request_payload(row)).data))


class AdminRefundRequestListView(_RefundRequestListMixin, APIView):
    """GET /admin/refund-requests — platform-wide.

    Staff-only. It lives in `payments` rather than in `console` because unlike
    every other admin list, this one has a WRITE beside it that belongs to this
    module's own service — and splitting the read into `console` while the
    decision stays here would put one surface's two halves in two modules.
    """

    # DRF's own `is_staff` check, NOT `apps.console.permissions.IsPlatformAdmin`.
    # That class is literally `IsAdminUser` renamed, and importing it here
    # would make `payments` depend on `console` — the wrong direction. The
    # console is allowed to reach down into every module precisely because
    # nothing reaches back up into it.
    permission_classes = [IsAdminUser]

    @extend_schema(
        parameters=[OpenApiParameter("status", str)],
        responses={200: RefundRequestSerializer(many=True)},
        operation_id="admin_refund_requests",
    )
    def get(self, request: Request) -> Response:
        queryset = RefundRequestRepository().list_all(status=request.query_params.get("status"))
        return self._paginate(request, queryset)
