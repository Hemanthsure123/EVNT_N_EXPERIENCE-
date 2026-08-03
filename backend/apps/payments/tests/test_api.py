from __future__ import annotations

import hashlib
import hmac
import json

import pytest
from django.conf import settings

from apps.booking.models import BookingStatus, Ticket
from apps.payments.models import Payment, PaymentStatus


def _signed_captured(order_id, amount, payment_id="pay_api_1"):
    """Sign with the SAME secret the DI-built fake adapter uses (settings)."""
    secret = settings.RAZORPAY_WEBHOOK_SECRET
    body = json.dumps(
        {
            "event": "payment.captured",
            "payload": {
                "payment": {"entity": {"id": payment_id, "order_id": order_id, "amount": amount}}
            },
        }
    ).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return body, sig


def _create_booking(api_client, buyer, event, tier, token_for, quantity=2):
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(buyer)}")
    resp = api_client.post(
        "/api/v1/bookings",
        {
            "event_id": str(event.id),
            "items": [{"ticket_type_id": str(tier.id), "quantity": quantity}],
        },
        format="json",
    )
    api_client.credentials()  # clear
    return resp.json()["booking"]


# --- POST /payments/webhook ------------------------------------------------


@pytest.mark.django_db
def test_webhook_endpoint_confirms_on_valid_signature(api_client, buyer, event, tier, token_for):
    booking = _create_booking(api_client, buyer, event, tier, token_for)
    from apps.booking.models import Booking

    b = Booking.objects.get(pk=booking["id"])
    body, sig = _signed_captured(b.payment_order_id, b.total_amount_minor)

    resp = api_client.post(
        "/api/v1/payments/webhook",
        data=body,
        content_type="application/json",
        HTTP_X_RAZORPAY_SIGNATURE=sig,
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "confirmed"
    b.refresh_from_db()
    assert b.status == BookingStatus.PAID
    assert Ticket.objects.filter(booking_id=b.id).count() == 2


@pytest.mark.django_db
def test_webhook_endpoint_rejects_bad_signature_with_400(api_client, buyer, event, tier, token_for):
    booking = _create_booking(api_client, buyer, event, tier, token_for)
    from apps.booking.models import Booking

    b = Booking.objects.get(pk=booking["id"])
    body, _sig = _signed_captured(b.payment_order_id, b.total_amount_minor)

    resp = api_client.post(
        "/api/v1/payments/webhook",
        data=body,
        content_type="application/json",
        HTTP_X_RAZORPAY_SIGNATURE="not-a-valid-signature",
    )

    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_webhook_signature"
    assert Payment.objects.count() == 0


@pytest.mark.django_db
def test_webhook_endpoint_needs_no_user_token(api_client, buyer, event, tier, token_for):
    # No Authorization header at all — the signature is the only credential.
    booking = _create_booking(api_client, buyer, event, tier, token_for)
    from apps.booking.models import Booking

    b = Booking.objects.get(pk=booking["id"])
    body, sig = _signed_captured(b.payment_order_id, b.total_amount_minor)

    resp = api_client.post(
        "/api/v1/payments/webhook",
        data=body,
        content_type="application/json",
        HTTP_X_RAZORPAY_SIGNATURE=sig,
    )
    assert resp.status_code == 200  # not 401


# --- POST /payments/simulate (demo deployments only) -----------------------
#
# The test settings run `PAYMENTS_BACKEND=fake`, so the DI-built service here
# is holding the same simulated provider a demo laptop would be.


@pytest.mark.django_db
def test_simulate_endpoint_completes_the_money_path_end_to_end(
    api_client, buyer, event, tier, token_for
):
    """The headline: from a reserved booking to an issued, scannable ticket
    over HTTP, with no payment provider and no inbound webhook anywhere."""
    from apps.booking.models import Booking
    from apps.booking.qr import verify_ticket_token

    booking = _create_booking(api_client, buyer, event, tier, token_for)

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(buyer)}")
    resp = api_client.post(
        "/api/v1/payments/simulate", {"booking_id": booking["id"]}, format="json"
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "confirmed"
    assert resp.headers["Cache-Control"] == "private, no-store"

    b = Booking.objects.get(pk=booking["id"])
    assert b.status == BookingStatus.PAID
    tickets = list(Ticket.objects.filter(booking_id=b.id))
    assert len(tickets) == 2
    for ticket in tickets:
        assert verify_ticket_token(ticket.qr_token, secret=settings.TICKET_QR_SIGNING_KEY)


@pytest.mark.django_db
def test_simulate_endpoint_is_idempotent_over_http(api_client, buyer, event, tier, token_for):
    from apps.booking.models import Booking

    booking = _create_booking(api_client, buyer, event, tier, token_for)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(buyer)}")

    first = api_client.post("/api/v1/payments/simulate", {"booking_id": booking["id"]}, "json")
    second = api_client.post("/api/v1/payments/simulate", {"booking_id": booking["id"]}, "json")

    assert first.json()["status"] == "confirmed"
    assert second.json()["status"] == "already_confirmed"
    b = Booking.objects.get(pk=booking["id"])
    assert Ticket.objects.filter(booking_id=b.id).count() == 2
    assert Payment.objects.filter(booking_id=b.id).count() == 1


@pytest.mark.django_db
def test_simulate_endpoint_requires_authentication(api_client, buyer, event, tier, token_for):
    booking = _create_booking(api_client, buyer, event, tier, token_for)
    resp = api_client.post(
        "/api/v1/payments/simulate", {"booking_id": booking["id"]}, format="json"
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_simulate_endpoint_refuses_a_booking_the_caller_does_not_own(
    api_client, buyer, other_user, event, tier, token_for
):
    from apps.booking.models import Booking

    booking = _create_booking(api_client, buyer, event, tier, token_for)

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")
    resp = api_client.post(
        "/api/v1/payments/simulate", {"booking_id": booking["id"]}, format="json"
    )

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_booking_owner"
    assert Booking.objects.get(pk=booking["id"]).status == BookingStatus.RESERVED


# --- GET /payments/{id} ----------------------------------------------------


@pytest.mark.django_db
def test_get_payment_detail_by_owner(api_client, payment_service, a_booking, buyer, token_for):
    from apps.payments.tests.conftest import signed_webhook

    body, sig = signed_webhook(
        event="payment.captured",
        order_id=a_booking.payment_order_id,
        payment_id="pay_detail_1",
        amount_minor=a_booking.total_amount_minor,
    )
    payment_service.handle_webhook(raw_body=body, signature=sig)
    payment = Payment.objects.get(rzp_order_id=a_booking.payment_order_id)

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(buyer)}")
    resp = api_client.get(f"/api/v1/payments/{payment.id}")

    assert resp.status_code == 200
    assert resp.json()["status"] == "paid"
    assert resp.json()["amount"] == a_booking.total_amount_minor
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_get_payment_detail_by_stranger_is_403(
    api_client, payment_service, a_booking, other_user, token_for
):
    from apps.payments.tests.conftest import signed_webhook

    body, sig = signed_webhook(
        event="payment.captured",
        order_id=a_booking.payment_order_id,
        payment_id="pay_detail_2",
        amount_minor=a_booking.total_amount_minor,
    )
    payment_service.handle_webhook(raw_body=body, signature=sig)
    payment = Payment.objects.get(rzp_order_id=a_booking.payment_order_id)

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")
    resp = api_client.get(f"/api/v1/payments/{payment.id}")

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_allowed_to_view_payment"


@pytest.mark.django_db
def test_get_payment_detail_query_budget(
    api_client, payment_service, a_booking, buyer, token_for, django_assert_num_queries
):
    from apps.payments.tests.conftest import signed_webhook

    body, sig = signed_webhook(
        event="payment.captured",
        order_id=a_booking.payment_order_id,
        payment_id="pay_detail_3",
        amount_minor=a_booking.total_amount_minor,
    )
    payment_service.handle_webhook(raw_body=body, signature=sig)
    payment = Payment.objects.get(rzp_order_id=a_booking.payment_order_id)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(buyer)}")

    # auth lookup + payment (booking+user+event+org joined). No N+1.
    with django_assert_num_queries(2):
        assert api_client.get(f"/api/v1/payments/{payment.id}").status_code == 200


# --- POST /payments/{id}/refund (organizer) --------------------------------


@pytest.mark.django_db
def test_organizer_can_refund_a_paid_payment(
    api_client, payment_service, a_booking, organizer, token_for
):
    from apps.payments.tests.conftest import signed_webhook

    body, sig = signed_webhook(
        event="payment.captured",
        order_id=a_booking.payment_order_id,
        payment_id="pay_refund_1",
        amount_minor=a_booking.total_amount_minor,
    )
    payment_service.handle_webhook(raw_body=body, signature=sig)
    payment = Payment.objects.get(rzp_order_id=a_booking.payment_order_id)

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(organizer)}")
    resp = api_client.post(f"/api/v1/payments/{payment.id}/refund", format="json")

    assert resp.status_code == 200
    assert resp.json()["status"] == "refund_initiated"
    # The DI-built refund task runs synchronously (local queue) → refunded.
    payment.refresh_from_db()
    assert payment.status == PaymentStatus.REFUNDED


@pytest.mark.django_db
def test_non_organizer_cannot_refund(api_client, payment_service, a_booking, buyer, token_for):
    from apps.payments.tests.conftest import signed_webhook

    body, sig = signed_webhook(
        event="payment.captured",
        order_id=a_booking.payment_order_id,
        payment_id="pay_refund_2",
        amount_minor=a_booking.total_amount_minor,
    )
    payment_service.handle_webhook(raw_body=body, signature=sig)
    payment = Payment.objects.get(rzp_order_id=a_booking.payment_order_id)

    # the buyer is not the organizer
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(buyer)}")
    resp = api_client.post(f"/api/v1/payments/{payment.id}/refund", format="json")

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_allowed_to_refund"
