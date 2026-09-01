from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.exceptions import NotBookingOwnerError
from apps.booking.models import Booking, BookingStatus, Ticket, TicketStatus
from apps.booking.qr import verify_ticket_token
from apps.booking.repositories import BookingRepository
from apps.payments.exceptions import (
    BookingNotPayableError,
    InvalidWebhookSignatureError,
    SimulatedPaymentUnavailableError,
)
from apps.payments.models import Payment, PaymentStatus, ProcessedWebhook, Refund
from apps.payments.repositories import (
    PaymentRepository,
    ProcessedWebhookRepository,
    RefundRepository,
)
from apps.payments.services import PaymentService
from apps.payments.tests.conftest import WEBHOOK_SECRET, signed_webhook
from core.adapters.local.fake_payment import FakePaymentAdapter
from core.models import OutboxEvent
from core.ports.payment_port import OrderTransfer, PaymentPort


def _captured(booking, *, amount=None, payment_id="pay_test_1"):
    return signed_webhook(
        event="payment.captured",
        order_id=booking.payment_order_id,
        payment_id=payment_id,
        amount_minor=amount if amount is not None else booking.total_amount_minor,
    )


# --- signature: the only source of truth -----------------------------------


@pytest.mark.django_db
def test_valid_signed_webhook_confirms_and_issues_tickets(payment_service, a_booking):
    body, sig = _captured(a_booking)

    outcome = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert outcome.status == "confirmed"
    payment = Payment.objects.get(rzp_order_id=a_booking.payment_order_id)
    assert payment.status == PaymentStatus.PAID
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.PAID
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert OutboxEvent.objects.filter(event_type="payments.payment_confirmed").exists()


@pytest.mark.django_db
def test_badly_signed_webhook_is_rejected_and_does_nothing(payment_service, a_booking):
    body, _good = _captured(a_booking)

    with pytest.raises(InvalidWebhookSignatureError):
        payment_service.handle_webhook(raw_body=body, signature="deadbeefbadsignature")

    # Nothing recorded, nothing confirmed.
    assert Payment.objects.count() == 0
    assert ProcessedWebhook.objects.count() == 0
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED


@pytest.mark.django_db
def test_missing_signature_is_rejected(payment_service, a_booking):
    body, _ = _captured(a_booking)
    with pytest.raises(InvalidWebhookSignatureError):
        payment_service.handle_webhook(raw_body=body, signature="")


# --- idempotency -----------------------------------------------------------


@pytest.mark.django_db
def test_duplicate_webhook_is_processed_once(payment_service, a_booking):
    body, sig = _captured(a_booking)

    first = payment_service.handle_webhook(raw_body=body, signature=sig)
    second = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert first.status == "confirmed"
    assert second.status == "duplicate"
    # Tickets issued exactly once despite two deliveries.
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert ProcessedWebhook.objects.count() == 1


# --- amount tampering ------------------------------------------------------


@pytest.mark.django_db
def test_amount_mismatch_is_not_confirmed_and_schedules_a_refund(
    payment_service, task_queue, a_booking, django_capture_on_commit_callbacks
):
    # Signed correctly, but the captured amount is wrong (tampered / underpaid).
    body, sig = _captured(a_booking, amount=1)

    with django_capture_on_commit_callbacks(execute=True):
        outcome = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert outcome.status == "amount_mismatch"
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED  # NOT confirmed
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    # A refund was scheduled (money never kept without a ticket).
    assert any(name == "payments.process_refund" for name, _ in task_queue.enqueued)


# --- hold expired: money never kept without a ticket -----------------------


@pytest.mark.django_db
def test_hold_expired_does_not_issue_tickets_and_schedules_refund(
    payment_service, task_queue, a_booking, django_capture_on_commit_callbacks
):
    # The hold lapsed before payment arrived.
    Booking.objects.filter(pk=a_booking.id).update(
        hold_expires_at=timezone.now() - timedelta(minutes=1)
    )
    body, sig = _captured(a_booking)

    with django_capture_on_commit_callbacks(execute=True):
        outcome = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert outcome.status == "hold_expired_refunding"
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    refund_tasks = [p for name, p in task_queue.enqueued if name == "payments.process_refund"]
    assert len(refund_tasks) == 1


# --- failed payment --------------------------------------------------------


@pytest.mark.django_db
def test_failed_webhook_marks_payment_failed(payment_service, a_booking):
    body, sig = signed_webhook(
        event="payment.failed",
        order_id=a_booking.payment_order_id,
        payment_id="pay_failed_1",
        amount_minor=a_booking.total_amount_minor,
    )

    outcome = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert outcome.status == "failed"
    payment = Payment.objects.get(rzp_order_id=a_booking.payment_order_id)
    assert payment.status == PaymentStatus.FAILED
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    assert OutboxEvent.objects.filter(event_type="payments.payment_failed").exists()


# --- the Route split -------------------------------------------------------


@pytest.mark.django_db
def test_create_order_carries_the_route_split(a_booking, fake_payment):
    # a_booking was created through booking_service using this fake adapter, so
    # the recorded order shows the split: organizer share on hold, fee retained.
    order = fake_payment.orders[a_booking.payment_order_id]
    transfers = order["transfers"]

    assert len(transfers) == 1
    transfer = transfers[0]
    assert isinstance(transfer, OrderTransfer)
    assert transfer.account_id == "fake_linked_account_test"
    # organizer share = total (100000) - platform fee (20)
    assert (
        transfer.amount_minor
        == a_booking.total_amount_minor
        - a_booking.platform_fee_minor
        - a_booking.donation_amount_minor
    )
    # The ticket subtotal exactly: 2 x 50000. The customer paid 101000, of which
    # the platform's 1% stays behind. Before the fee moved on top this was
    # 99980 — the organizer absorbing a deduction they now don't.
    assert transfer.amount_minor == 100000
    assert transfer.on_hold is True  # held until settlements releases it after the event


# --- refunds ---------------------------------------------------------------


def _make_paid_payment(booking) -> Payment:
    return Payment.objects.create(
        booking_id=booking.id,
        rzp_order_id=booking.payment_order_id,
        rzp_payment_id="pay_paid_1",
        amount_minor=booking.total_amount_minor,
        status=PaymentStatus.PAID,
    )


@pytest.mark.django_db
def test_refund_is_idempotent_never_double_refunds(payment_service, fake_payment, a_booking):
    payment = _make_paid_payment(a_booking)

    first = payment_service.execute_refund(payment_id=payment.id, reason="hold_expired")
    second = payment_service.execute_refund(payment_id=payment.id, reason="hold_expired")

    assert first is True
    assert second is False  # already refunded — no-op
    payment.refresh_from_db()
    assert payment.status == PaymentStatus.REFUNDED
    # Exactly one refund recorded, and the vendor was asked once (same idem key).
    assert Refund.objects.filter(payment_id=payment.id).count() == 1
    assert len(fake_payment.refunds_by_key) == 1
    assert OutboxEvent.objects.filter(event_type="payments.payment_refunded").exists()


@pytest.mark.django_db
def test_refund_voids_the_bookings_tickets(payment_service, booking_service, a_booking):
    # Confirm the booking so real tickets are issued, then refund it.
    result = booking_service.confirm_booking(booking_id=a_booking.id, payment_ref="pay_paid_1")
    assert result.issued is True
    assert Ticket.objects.filter(booking_id=a_booking.id, status=TicketStatus.ACTIVE).count() == 2

    payment = _make_paid_payment(a_booking)
    assert payment_service.execute_refund(payment_id=payment.id, reason="organizer_refund") is True

    # A refunded ticket can't enter the gate: every active ticket is now void
    # (checkin then denies by status — defense in depth).
    assert Ticket.objects.filter(booking_id=a_booking.id, status=TicketStatus.ACTIVE).count() == 0
    assert Ticket.objects.filter(booking_id=a_booking.id, status=TicketStatus.VOID).count() == 2


@pytest.mark.django_db
def test_refund_no_ops_on_a_non_paid_payment(payment_service, a_booking):
    payment = Payment.objects.create(
        booking_id=a_booking.id,
        rzp_order_id=a_booking.payment_order_id,
        rzp_payment_id="pay_failed",
        amount_minor=a_booking.total_amount_minor,
        status=PaymentStatus.FAILED,
    )

    assert payment_service.execute_refund(payment_id=payment.id, reason="x") is False
    assert Refund.objects.count() == 0


# --- verify-on-demand: the same trust model, pulled instead of pushed -------
#
# These exist because a webhook needs a public HTTPS endpoint and a laptop has
# none. The property under test is that removing the INBOUND requirement does
# not remove the trust requirement: everything still comes from the provider,
# and the caller's payment id is a lookup key rather than a claim.


@pytest.mark.django_db
def test_verify_confirms_a_captured_payment_and_issues_tickets(
    payment_service, fake_payment, a_booking
):
    # The provider — not the caller — is what says this was captured.
    payment_id = fake_payment.capture(order_id=a_booking.payment_order_id)

    outcome = payment_service.verify_and_confirm(provider_payment_id=payment_id)

    assert outcome.status == "confirmed"
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.PAID
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert OutboxEvent.objects.filter(event_type="payments.payment_confirmed").exists()


@pytest.mark.django_db
def test_verify_ignores_a_payment_id_the_provider_has_never_heard_of(payment_service, a_booking):
    # The whole attack in one line: somebody posts an id they made up.
    outcome = payment_service.verify_and_confirm(provider_payment_id="pay_totally_invented")

    assert outcome.status == "ignored"
    assert Payment.objects.count() == 0
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0


@pytest.mark.django_db
def test_verify_refuses_an_authorized_but_uncaptured_payment(
    payment_service, fake_payment, a_booking
):
    """`authorized` means the bank RESERVED the money and has not handed it
    over. A ticket issued now is a ticket issued against money that may never
    arrive."""
    payment_id = fake_payment.capture(order_id=a_booking.payment_order_id)
    fake_payment.payments[payment_id]["status"] = "authorized"

    outcome = payment_service.verify_and_confirm(provider_payment_id=payment_id)

    assert outcome.status == "not_captured"
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0


@pytest.mark.django_db
def test_verify_is_idempotent_and_shares_the_webhook_ledger(
    payment_service, fake_payment, a_booking
):
    """The property that makes it safe to turn the webhook on later: both
    paths write the SAME `payment.captured:{id}` row, so whichever lands first
    does the work and the other cannot issue a second set of tickets."""
    payment_id = fake_payment.capture(order_id=a_booking.payment_order_id)

    first = payment_service.verify_and_confirm(provider_payment_id=payment_id)
    second = payment_service.verify_and_confirm(provider_payment_id=payment_id)
    # …and now the real webhook finally arrives for the same payment.
    body, sig = _captured(a_booking, payment_id=payment_id)
    third = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert first.status == "confirmed"
    assert second.status == "duplicate"
    assert third.status == "duplicate"
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert ProcessedWebhook.objects.filter(dedupe_key=f"payment.captured:{payment_id}").count() == 1


@pytest.mark.django_db
def test_verify_uses_the_providers_amount_not_the_bookings(
    payment_service, fake_payment, a_booking
):
    """A tampered amount is caught by the same check the webhook uses, because
    it is the same code path — and the figure compared is the PROVIDER's."""
    payment_id = fake_payment.capture(order_id=a_booking.payment_order_id)
    fake_payment.payments[payment_id]["amount_minor"] = a_booking.total_amount_minor - 1

    outcome = payment_service.verify_and_confirm(provider_payment_id=payment_id)

    assert outcome.status == "amount_mismatch"
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0


# --- the demo path: a completable payment with no real provider -------------
#
# `simulate_capture` is the only way a booking gets paid on a deployment with
# no payment provider at all. What these tests protect is that it is a demo OF
# the real fulfilment path rather than a shortcut PAST it — same ledger, same
# amount check, same `confirm_booking`. Three properties carry the weight: it
# issues exactly one set of tickets, a replay issues none, and a payment the
# provider has not captured issues none. The last is the one that would
# otherwise turn a demo button into a free ticket.


class _RealishPaymentAdapter(PaymentPort):
    """A provider that is NOT a `SimulatedPaymentPort` — what Razorpay looks
    like from the service's point of view. It has no `capture` at all, which is
    the property under test: the demo path cannot be reached by an adapter
    happening to have a method of that name, only by one declaring the
    capability."""

    def create_linked_account(self, *, reference_id: str, name: str, email: str) -> str:
        return "acc_real"

    def create_order(self, *, amount_minor, currency, receipt, notes, transfers=None) -> str:
        return "order_real"

    def verify_webhook_signature(self, *, payload: bytes, signature: str) -> bool:
        return False

    def fetch_payment(self, *, payment_id: str):
        return None

    def captured_payment_for_order(self, *, order_id: str):
        return None

    def refund(self, *, payment_id: str, amount_minor: int, idempotency_key: str) -> str:
        return "rfnd_real"

    def split_transfer(
        self, *, payment_id, organizer_account_id, organizer_amount_minor, platform_fee_minor
    ):
        raise NotImplementedError

    def release_payout(self, *, account_id: str, amount_minor: int, idempotency_key: str) -> str:
        return "pout_real"


class _AuthorizesButNeverCapturesAdapter(FakePaymentAdapter):
    """A provider where the bank RESERVED the money and never handed it over,
    which Razorpay reports as `authorized`."""

    def capture(self, *, order_id: str, amount_minor: int | None = None) -> str:
        payment_id = super().capture(order_id=order_id, amount_minor=amount_minor)
        self.payments[payment_id]["status"] = "authorized"
        return payment_id


def _service_with_port(port, *, task_queue, booking_service) -> PaymentService:
    return PaymentService(
        payments=PaymentRepository(),
        refunds=RefundRepository(),
        webhooks=ProcessedWebhookRepository(),
        bookings=BookingRepository(),
        booking_service=booking_service,
        payments_port=port,
        task_queue=task_queue,
    )


@pytest.mark.django_db
def test_a_simulated_payment_issues_exactly_one_set_of_tickets(payment_service, a_booking, buyer):
    outcome = payment_service.simulate_capture(booking_id=a_booking.id, actor_id=buyer.id)

    assert outcome.status == "confirmed"
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.PAID
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    # One payment record, one ledger row: the demo went THROUGH the ordinary
    # bookkeeping, not around it.
    assert Payment.objects.filter(booking_id=a_booking.id).count() == 1
    assert Payment.objects.get(booking_id=a_booking.id).status == PaymentStatus.PAID
    assert ProcessedWebhook.objects.count() == 1
    assert OutboxEvent.objects.filter(event_type="payments.payment_confirmed").exists()


@pytest.mark.django_db
def test_replaying_a_simulated_payment_issues_no_further_tickets(payment_service, a_booking, buyer):
    """A double-tapped demo button, or a retried request. The second call
    captures nothing and confirms nothing — and writes no second `Payment`,
    which is what `settlements` recomputes an organizer's gross from."""
    first = payment_service.simulate_capture(booking_id=a_booking.id, actor_id=buyer.id)
    second = payment_service.simulate_capture(booking_id=a_booking.id, actor_id=buyer.id)

    assert first.status == "confirmed"
    assert second.status == "already_confirmed"
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert Payment.objects.filter(booking_id=a_booking.id).count() == 1
    assert ProcessedWebhook.objects.count() == 1


@pytest.mark.django_db
def test_a_simulated_payment_and_a_late_webhook_cannot_both_issue(
    payment_service, fake_payment, a_booking, buyer
):
    """What keeps the demo path from becoming a second, competing source of
    truth: it writes the SAME `payment.captured:{id}` ledger row, so a webhook
    arriving afterwards for that payment is a duplicate rather than a reissue."""
    payment_service.simulate_capture(booking_id=a_booking.id, actor_id=buyer.id)
    provider_payment_id = next(iter(fake_payment.payments))

    body, sig = _captured(a_booking, payment_id=provider_payment_id)
    late_webhook = payment_service.handle_webhook(raw_body=body, signature=sig)

    assert late_webhook.status == "duplicate"
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert ProcessedWebhook.objects.count() == 1


@pytest.mark.django_db
def test_a_payment_the_provider_has_not_captured_issues_nothing(
    task_queue, booking_service, a_booking, buyer
):
    """`authorized` is money the bank reserved and never handed over. Going in
    through the demo button changes nothing: the ticket is issued off what the
    PROVIDER says, and it has not said captured."""
    service = _service_with_port(
        _AuthorizesButNeverCapturesAdapter(webhook_secret=WEBHOOK_SECRET),
        task_queue=task_queue,
        booking_service=booking_service,
    )

    outcome = service.simulate_capture(booking_id=a_booking.id, actor_id=buyer.id)

    assert outcome.status == "not_captured"
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    assert Payment.objects.count() == 0
    assert ProcessedWebhook.objects.count() == 0


@pytest.mark.django_db
def test_simulating_is_refused_outright_when_a_real_provider_is_configured(
    task_queue, booking_service, a_booking, buyer
):
    """The gate is the CONFIGURED port's type, not a setting the endpoint reads
    — so a deployment on Razorpay has no simulate path, whatever else is in its
    environment."""
    service = _service_with_port(
        _RealishPaymentAdapter(), task_queue=task_queue, booking_service=booking_service
    )

    with pytest.raises(SimulatedPaymentUnavailableError):
        service.simulate_capture(booking_id=a_booking.id, actor_id=buyer.id)

    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0


@pytest.mark.django_db
def test_simulating_somebody_elses_booking_is_refused(payment_service, a_booking, other_user):
    with pytest.raises(NotBookingOwnerError):
        payment_service.simulate_capture(booking_id=a_booking.id, actor_id=other_user.id)

    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0


@pytest.mark.django_db
def test_simulating_a_lapsed_hold_is_refused_rather_than_captured_and_refunded(
    payment_service, a_booking, buyer
):
    """Taking (fake) money for a hold that has gone, only to hand it straight
    back, is a real production flow — but reaching it deliberately from a demo
    button is only a confusing way to fail. The inventory is the sweeper's."""
    Booking.objects.filter(pk=a_booking.id).update(
        hold_expires_at=timezone.now() - timedelta(minutes=1), status=BookingStatus.EXPIRED
    )

    with pytest.raises(BookingNotPayableError):
        payment_service.simulate_capture(booking_id=a_booking.id, actor_id=buyer.id)

    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    assert Payment.objects.count() == 0


@pytest.mark.django_db
def test_tickets_issued_by_the_demo_path_carry_a_verifiable_qr_token(
    payment_service, a_booking, buyer
):
    """The whole point of a demo payment: it has to end with something a gate
    can actually read. Every token round-trips through the verifier `checkin`
    uses and carries that ticket's own ids."""
    payment_service.simulate_capture(booking_id=a_booking.id, actor_id=buyer.id)

    tickets = list(Ticket.objects.filter(booking_id=a_booking.id))
    assert len(tickets) == 2
    for ticket in tickets:
        payload = verify_ticket_token(ticket.qr_token, secret="pay-test-qr-secret")
        assert payload is not None, "a ticket nobody can scan is not a ticket"
        assert payload.ticket_id == str(ticket.id)
        assert payload.event_id == str(a_booking.event_id)
    # Two admissions, two DISTINCT tokens — one token admitting twice would be
    # the oversell bug wearing a different hat.
    assert len({ticket.qr_token for ticket in tickets}) == 2
