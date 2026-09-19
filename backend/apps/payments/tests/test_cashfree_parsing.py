"""Cashfree's delivery shape, flattened into this module's own vocabulary.

No database and no network: `_parse_delivery` is a pure function, and it is the
ONLY thing that differs between providers. Everything after it — the ledger
key, the amount check, the idempotent confirm, the auto-refund on a lapsed
hold — is one code path for every gateway, which is the rule `_process_captured`
already enforces for the webhook, `verify_and_confirm` and `reconcile_pending`:
no entry point gets to be the lenient one.

So these tests are the seam. If the parser is right, a Cashfree payment is
fulfilled by exactly the code a Razorpay payment is.
"""

from __future__ import annotations

import pytest

from apps.payments.services import PaymentService

parse = PaymentService._parse_delivery


def _success(order_id: str = "bk-1_abcd1234", amount: object = 1010.00) -> dict:
    """A PAYMENT_SUCCESS_WEBHOOK body, in Cashfree's PG v3 shape."""
    return {
        "type": "PAYMENT_SUCCESS_WEBHOOK",
        "data": {
            "order": {"order_id": order_id, "order_amount": amount, "order_currency": "INR"},
            "payment": {
                "cf_payment_id": "1234567890",
                "payment_status": "SUCCESS",
                "payment_amount": amount,
                "payment_currency": "INR",
            },
        },
    }


# --- the captured case ----------------------------------------------------


def test_a_success_delivery_maps_onto_the_shared_captured_path():
    event_type, entity = parse("cashfree", _success())

    # The SAME event type the Razorpay webhook produces, because the same
    # `_process_captured` has to run for both.
    assert event_type == "payment.captured"
    assert entity["id"] == "1234567890"
    assert entity["order_id"] == "bk-1_abcd1234"


def test_the_amount_arrives_in_paise_not_rupees():
    """The amount check downstream compares for EXACT equality against
    `booking.total_amount_minor`, which is paise. Cashfree reports rupees. Get
    this wrong by a factor of 100 and every payment is an `amount_mismatch`
    that auto-refunds a customer who did nothing wrong."""
    _event_type, entity = parse("cashfree", _success(amount=1010.00))
    assert entity["amount"] == 101000


@pytest.mark.parametrize(
    ("reported", "expected_minor"),
    [
        (19.99, 1999),
        (0.01, 1),
        ("1010.00", 101000),
        (1234567.89, 123456789),
        # The exact float-precision case: 19.99 has no binary representation,
        # so a provider that serialises it can hand back its nearest neighbour.
        (19.989999999999998, 1999),
    ],
)
def test_amounts_convert_without_a_float_rounding_error(reported, expected_minor):
    _event_type, entity = parse("cashfree", _success(amount=reported))
    assert entity["amount"] == expected_minor


def test_the_order_amount_is_used_when_the_payment_carries_none():
    body = _success()
    del body["data"]["payment"]["payment_amount"]
    _event_type, entity = parse("cashfree", body)
    assert entity["amount"] == 101000


# --- the failure and ignored cases ----------------------------------------


@pytest.mark.parametrize(
    "delivery_type", ["PAYMENT_FAILED_WEBHOOK", "PAYMENT_USER_DROPPED_WEBHOOK"]
)
def test_a_failed_or_dropped_delivery_maps_onto_the_shared_failed_path(delivery_type):
    body = _success()
    body["type"] = delivery_type
    body["data"]["payment"]["payment_status"] = "FAILED"

    event_type, _entity = parse("cashfree", body)
    assert event_type == "payment.failed"


def test_an_unhandled_delivery_type_is_passed_through_to_be_ignored():
    """It still gets WRITTEN to the ledger by the caller, so a provider
    retrying a refund-status delivery forever does not reprocess anything —
    but it must not be mistaken for a capture."""
    body = _success()
    body["type"] = "REFUND_STATUS_WEBHOOK"
    body["data"]["payment"]["payment_status"] = "PENDING"

    event_type, _entity = parse("cashfree", body)
    assert event_type not in {"payment.captured", "payment.failed"}


def test_a_pending_payment_is_not_treated_as_captured():
    """PENDING is money that has left the customer and not arrived — Cashfree's
    analogue of Razorpay's `authorized`. Issuing a ticket for it would issue one
    against money that may never land."""
    body = _success()
    body["type"] = "PAYMENT_STATUS_WEBHOOK"
    body["data"]["payment"]["payment_status"] = "PENDING"

    event_type, _entity = parse("cashfree", body)
    assert event_type != "payment.captured"


def test_a_success_status_is_enough_even_when_the_type_is_unfamiliar():
    """Belt and braces: the provider has renamed delivery types before, and a
    capture that arrived under a new name must still be fulfilled rather than
    silently ignored while the customer waits for a ticket."""
    body = _success()
    body["type"] = "PAYMENT_SUCCESS_WEBHOOK_V2"

    event_type, _entity = parse("cashfree", body)
    assert event_type == "payment.captured"


# --- malformed bodies -----------------------------------------------------


@pytest.mark.parametrize("body", [{}, {"data": {}}, {"data": {"payment": {}, "order": {}}}])
def test_an_empty_body_yields_no_payment_id_rather_than_raising(body):
    """`handle_webhook` returns `ignored` on an empty id. Raising here would
    instead 500 the endpoint, and Cashfree would retry a delivery that could
    never succeed."""
    _event_type, entity = parse("cashfree", body)
    assert entity["id"] == ""


def test_an_unparseable_amount_becomes_zero_which_fails_the_amount_check():
    _event_type, entity = parse("cashfree", _success(amount="not-a-number"))
    assert entity["amount"] == 0


# --- the razorpay path is untouched ---------------------------------------


def test_the_razorpay_shape_still_parses_exactly_as_before():
    """The second gateway must be a second PARSER and nothing more."""
    body = {
        "event": "payment.captured",
        "payload": {"entity": {}, "payment": {"entity": {"id": "pay_1", "order_id": "order_1"}}},
    }
    event_type, entity = parse("razorpay", body)

    assert event_type == "payment.captured"
    assert entity == {"id": "pay_1", "order_id": "order_1"}


def test_an_unnamed_gateway_is_treated_as_razorpay():
    """`handle_webhook` defaults `gateway or "razorpay"`, so a caller that
    predates the second gateway keeps working unchanged."""
    body = {"event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_9"}}}}
    event_type, entity = parse("", body)

    assert event_type == "payment.captured"
    assert entity["id"] == "pay_9"
