"""Thin views.

The webhook is the security boundary: it takes NO user token (Razorpay calls
it server-to-server), and it authenticates purely by the HMAC signature over
the RAW request body. Everything else is per-user private data → `private,
no-store`.
"""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import build_payment_service
from core.throttling import WebhookThrottle, WriteThrottle

from .exceptions import NotAllowedToViewPaymentError, PaymentNotFoundError
from .schemas import (
    PaymentSerializer,
    SimulatePaymentRequestSerializer,
    VerifyPaymentRequestSerializer,
    VerifyPaymentResponseSerializer,
)
from .selectors import get_payment_detail


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
