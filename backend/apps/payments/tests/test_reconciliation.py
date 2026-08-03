"""The backstop that makes fulfilment independent of the customer's browser.

── WHAT WAS BROKEN, AND WHY NO TEST SAW IT ───────────────────────────────

`verify_and_confirm` was reached from exactly one place: the Razorpay success
handler, called as `void verifyPayment(...).catch(() => {})`. Un-awaited,
un-retried, and silently swallowed on failure. On a deployment with no public
HTTPS endpoint — which is every deployment before its DNS is cut over — that
browser call was the ONLY thing standing between a captured payment and a
customer with nothing.

Close the tab, lose signal, or let the access token lapse during a long
checkout, and the money was taken at the provider while this system never
learned of it. The booking then expired on schedule and the inventory came
back, so every counter reconciled and every log line looked normal. The
customer had no ticket and no refund, permanently, and nothing anywhere had
failed.

Every existing test passed because they all called the confirm path directly.
These start one step earlier: the payment is captured at the provider and
NOBODY TELLS THE PLATFORM. That is the actual failure, and it is what each
test below reproduces before asserting the recovery.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.models import Booking, BookingStatus, Ticket
from apps.payments.models import Payment, PaymentStatus


def _age(booking, *, seconds: int) -> None:
    """Backdate `created_at` past the min-age guard.

    `created_at` is `auto_now_add`, so it cannot be set on the instance — and
    the guard is deliberately real rather than mocked out, because a job that
    reconciles a checkout still in progress is a job that races the customer.
    """
    Booking.objects.filter(pk=booking.id).update(
        created_at=timezone.now() - timedelta(seconds=seconds)
    )


def _pay_at_provider_only(fake_payment, booking) -> str:
    """The money leaves the customer's account and NOTHING tells the platform.

    This is the whole bug in one function: `capture` is what the provider does
    when the customer completes checkout. `verify_and_confirm` — the browser's
    follow-up call — is deliberately not made.
    """
    return fake_payment.capture(
        order_id=booking.payment_order_id, amount_minor=booking.total_amount_minor
    )


@pytest.mark.django_db
def test_a_captured_payment_is_fulfilled_even_though_no_browser_call_arrived(
    payment_service, fake_payment, a_booking
):
    _pay_at_provider_only(fake_payment, a_booking)
    _age(a_booking, seconds=120)

    # Nothing has happened yet — this is the broken state, asserted so the test
    # cannot pass by the booking having been confirmed some other way.
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    assert Booking.objects.get(pk=a_booking.id).status == BookingStatus.RESERVED

    stats = payment_service.reconcile_pending()

    assert stats["captured"] == 1
    assert stats["confirmed"] == 1
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.PAID
    # Two seats were reserved, so two admissions are owed.
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert Payment.objects.filter(booking_id=a_booking.id, status=PaymentStatus.PAID).count() == 1


@pytest.mark.django_db
def test_the_recovered_tickets_carry_real_scannable_tokens(
    payment_service, fake_payment, a_booking
):
    """A ticket recovered by the backstop must be the SAME artifact the normal
    path issues — signed, verifiable, and admissible at the gate. A recovery
    that produced a row without a valid token would look fixed in the database
    and fail at the door, which is worse than not recovering at all."""
    from apps.booking.qr import verify_ticket_token

    _pay_at_provider_only(fake_payment, a_booking)
    _age(a_booking, seconds=120)

    payment_service.reconcile_pending()

    tickets = list(Ticket.objects.filter(booking_id=a_booking.id))
    assert len(tickets) == 2
    for ticket in tickets:
        assert ticket.qr_token
        verified = verify_ticket_token(ticket.qr_token, secret="pay-test-qr-secret")
        assert verified is not None
        assert str(verified.ticket_id) == str(ticket.id)


@pytest.mark.django_db
def test_a_booking_nobody_paid_for_is_left_entirely_alone(payment_service, a_booking):
    """The ordinary case, and the one that must stay cheap and inert. An
    abandoned checkout is not a payment problem — the sweeper owns it."""
    _age(a_booking, seconds=120)

    stats = payment_service.reconcile_pending()

    assert stats["checked"] == 1
    assert stats["captured"] == 0
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    assert Payment.objects.filter(booking_id=a_booking.id).count() == 0


@pytest.mark.django_db
def test_a_checkout_that_only_just_started_is_not_asked_about(
    payment_service, fake_payment, a_booking
):
    """The min-age guard. The customer may be mid-payment and the browser's own
    verify call has not had its chance yet; asking now spends a provider call to
    learn something that is about to be told to us anyway."""
    _pay_at_provider_only(fake_payment, a_booking)
    # Deliberately NOT aged — created seconds ago.

    stats = payment_service.reconcile_pending()

    assert stats["checked"] == 0
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0


@pytest.mark.django_db
def test_money_captured_against_a_lapsed_hold_is_refunded_not_ticketed(
    payment_service, fake_payment, task_queue, a_booking, django_capture_on_commit_callbacks
):
    """The second half of why this job exists.

    If the sweeper released the inventory first, the tickets are genuinely gone
    — somebody else may already have bought the seats. The obligation does not
    disappear with them: the money must come back. Without reconciliation this
    booking is the permanent "paid, no ticket, no refund" state, because the
    auto-refund branch is only ever reached by a webhook or a browser call, and
    on this deployment neither arrives.
    """
    _pay_at_provider_only(fake_payment, a_booking)
    _age(a_booking, seconds=600)
    # What `booking.release_expired` does when the hold lapses.
    Booking.objects.filter(pk=a_booking.id).update(
        status=BookingStatus.EXPIRED, hold_expires_at=timezone.now() - timedelta(minutes=5)
    )

    # The refund is enqueued in `transaction.on_commit`, so without this the
    # queue stays empty for a reason that looks exactly like "no refund was
    # scheduled" and is not.
    with django_capture_on_commit_callbacks(execute=True):
        stats = payment_service.reconcile_pending()

    assert stats["captured"] == 1
    assert stats["refunding"] == 1
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    assert [name for name, _ in task_queue.enqueued] == ["payments.process_refund"]
    # The payment is still RECORDED — the platform took money and must be able
    # to account for it, refunded or not.
    assert Payment.objects.filter(booking_id=a_booking.id).count() == 1


@pytest.mark.django_db
def test_a_booking_settled_long_ago_is_no_longer_asked_about(
    payment_service, fake_payment, a_booking
):
    """The grace window is bounded on purpose.

    Every abandoned checkout leaves an order id behind forever. Without a bound,
    the job's work list grows without limit and the platform spends one provider
    call per abandoned checkout, on every tick, for the life of the deployment.
    """
    _pay_at_provider_only(fake_payment, a_booking)
    _age(a_booking, seconds=600)
    Booking.objects.filter(pk=a_booking.id).update(
        status=BookingStatus.EXPIRED,
        hold_expires_at=timezone.now() - timedelta(days=30),
    )

    stats = payment_service.reconcile_pending()

    assert stats["checked"] == 0


@pytest.mark.django_db
def test_running_it_twice_issues_one_set_of_tickets(payment_service, fake_payment, a_booking):
    """The scheduler fires this every two minutes, and a queue may deliver the
    same tick twice. It converges on `verify_and_confirm`, so the
    `payment.captured:{id}` ledger row is the same one the webhook writes."""
    _pay_at_provider_only(fake_payment, a_booking)
    _age(a_booking, seconds=120)

    payment_service.reconcile_pending()
    second = payment_service.reconcile_pending()

    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2
    assert Payment.objects.filter(booking_id=a_booking.id).count() == 1
    # The booking is `paid` now, so it is not even a candidate on the second run.
    assert second["checked"] == 0


@pytest.mark.django_db
def test_a_webhook_that_arrives_after_reconciliation_issues_nothing_further(
    payment_service, fake_payment, a_booking
):
    """The two paths are not alternatives — a deployment can gain a webhook URL
    while bookings recovered by the backstop are still in flight. Whichever is
    first does the work; the other must be a no-op, not a second ticket."""
    from apps.payments.tests.conftest import signed_webhook

    payment_id = _pay_at_provider_only(fake_payment, a_booking)
    _age(a_booking, seconds=120)

    payment_service.reconcile_pending()

    body, signature = signed_webhook(
        event="payment.captured",
        order_id=a_booking.payment_order_id,
        payment_id=payment_id,
        amount_minor=a_booking.total_amount_minor,
    )
    outcome = payment_service.handle_webhook(raw_body=body, signature=signature)

    assert outcome.status == "duplicate"
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 2


@pytest.mark.django_db
def test_a_lookup_failure_does_not_stop_the_rest_of_the_batch(
    payment_service, fake_payment, booking_service, buyer, event, tier, a_booking
):
    """One unreachable provider call must not strand every other booking behind
    it. The failed candidate stays in the window and the next tick retries it."""
    other = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    ).booking
    _pay_at_provider_only(fake_payment, other)
    _age(a_booking, seconds=300)
    _age(other, seconds=120)

    original = fake_payment.captured_payment_for_order
    failing_order = a_booking.payment_order_id

    def flaky(*, order_id: str):
        if order_id == failing_order:
            raise ConnectionError("provider unreachable")
        return original(order_id=order_id)

    fake_payment.captured_payment_for_order = flaky

    stats = payment_service.reconcile_pending()

    assert stats["checked"] == 2
    assert stats["confirmed"] == 1
    assert Ticket.objects.filter(booking_id=other.id).count() == 1


@pytest.mark.django_db
def test_an_authorized_but_uncaptured_payment_issues_nothing(
    payment_service, fake_payment, a_booking
):
    """`authorized` is money the bank has RESERVED and not handed over. A ticket
    issued against it is a ticket issued against money that may never arrive."""
    payment_id = _pay_at_provider_only(fake_payment, a_booking)
    fake_payment.payments[payment_id]["status"] = "authorized"
    _age(a_booking, seconds=120)

    stats = payment_service.reconcile_pending()

    assert stats["captured"] == 0
    assert Ticket.objects.filter(booking_id=a_booking.id).count() == 0
    a_booking.refresh_from_db()
    assert a_booking.status == BookingStatus.RESERVED


def test_the_job_is_actually_scheduled():
    """The bug this whole module exists to prevent, in its own domain: a task
    that is registered, tested, documented as periodic — and fired by nothing.
    `core/scheduling.py` is what makes "runs every two minutes" a fact."""
    from core.scheduling import SCHEDULE
    from core.tasks import _registry

    job = next((j for j in SCHEDULE if j.task_name == "payments.reconcile_pending"), None)
    assert job is not None, "reconciliation is scheduled by nothing"
    # Faster than the hold window, so a captured payment is normally found while
    # the hold is still alive and the customer gets the ticket, not a refund.
    assert job.interval_seconds <= 300
    assert "payments.reconcile_pending" in _registry
