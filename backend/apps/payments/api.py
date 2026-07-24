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

from .exceptions import NotAllowedToViewPaymentError, PaymentNotFoundError
from .schemas import PaymentSerializer
from .selectors import get_payment_detail


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


class WebhookView(APIView):
    # No user auth — Razorpay calls this server-to-server. The signature over
    # the raw body is the only credential (verified in the service).
    permission_classes = [AllowAny]
    authentication_classes: list = []

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
