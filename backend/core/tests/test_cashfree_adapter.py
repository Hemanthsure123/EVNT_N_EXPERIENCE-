"""The Cashfree adapter's pure logic — no network, no database.

Everything here is computation the money path depends on and that a vendor
sandbox cannot be relied on to exercise: the signature verifier (which decides
whether money is real), the paise/rupees crossings (which decide whether the
amount check passes), and the refund id (which is the vendor's idempotency key
and therefore the thing standing between a retry and a double refund).

`verify_webhook_signature` is tested against a signature built here by hand,
the same way `FakePaymentAdapter`'s Razorpay-shaped one is: the HMAC is pure
computation, so the test can construct a genuinely-valid delivery and a
genuinely-invalid one without any Cashfree credentials.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

import pytest

from core.adapters.cashfree.adapter import CashfreePaymentAdapter
from core.ports.payment_port import PaymentProviderUnavailable

SECRET = "test_cashfree_secret_key"


def _adapter(environment: str = "sandbox") -> CashfreePaymentAdapter:
    return CashfreePaymentAdapter(app_id="TEST_APP_ID", secret_key=SECRET, environment=environment)


def _sign(timestamp: str, body: bytes, secret: str = SECRET) -> str:
    """Exactly what Cashfree does: base64(HMAC-SHA256(timestamp + rawBody))."""
    return base64.b64encode(
        hmac.new(secret.encode(), timestamp.encode() + body, hashlib.sha256).digest()
    ).decode()


# --- the signature: the only proof a payment is real ----------------------


def test_a_correctly_signed_delivery_is_accepted():
    adapter = _adapter()
    body = b'{"type":"PAYMENT_SUCCESS_WEBHOOK"}'
    timestamp = "1700000000"

    assert adapter.verify_webhook_signature(
        payload=body, signature=_sign(timestamp, body), timestamp=timestamp
    )


def test_a_forged_signature_is_rejected():
    adapter = _adapter()
    body = b'{"type":"PAYMENT_SUCCESS_WEBHOOK"}'

    assert not adapter.verify_webhook_signature(
        payload=body, signature="not-a-signature", timestamp="1700000000"
    )


def test_a_signature_from_a_different_secret_is_rejected():
    adapter = _adapter()
    body = b'{"type":"PAYMENT_SUCCESS_WEBHOOK"}'
    timestamp = "1700000000"

    assert not adapter.verify_webhook_signature(
        payload=body,
        signature=_sign(timestamp, body, secret="somebody_elses_secret"),
        timestamp=timestamp,
    )


def test_the_timestamp_is_part_of_the_signed_material():
    """A valid signature replayed under a DIFFERENT timestamp must fail.

    This is the difference from Razorpay that silently breaks verification if
    it is got wrong — sign the body alone and every genuine Cashfree delivery
    is refused; ignore the timestamp when comparing and a captured delivery can
    be replayed forever.
    """
    adapter = _adapter()
    body = b'{"type":"PAYMENT_SUCCESS_WEBHOOK"}'
    signature = _sign("1700000000", body)

    assert not adapter.verify_webhook_signature(
        payload=body, signature=signature, timestamp="1700009999"
    )


def test_a_missing_timestamp_is_refused_rather_than_ignored():
    """There is no lenient mode for the check that decides whether money is
    real. Without a timestamp the signed material cannot be reconstructed, so
    the only safe answer is no."""
    adapter = _adapter()
    body = b'{"type":"PAYMENT_SUCCESS_WEBHOOK"}'

    assert not adapter.verify_webhook_signature(
        payload=body, signature=_sign("1700000000", body), timestamp=""
    )


def test_a_changed_body_invalidates_the_signature():
    adapter = _adapter()
    timestamp = "1700000000"
    signature = _sign(timestamp, b'{"amount":100}')

    assert not adapter.verify_webhook_signature(
        payload=b'{"amount":999}', signature=signature, timestamp=timestamp
    )


# --- money: paise here, rupees there --------------------------------------


@pytest.mark.parametrize(
    ("minor", "rupees"),
    [
        (1999, 19.99),
        (100, 1.0),
        (1, 0.01),
        (0, 0.0),
        (101000, 1010.0),
        (123456789, 1234567.89),
    ],
)
def test_paise_convert_to_the_exact_decimal_rupees(minor, rupees):
    assert CashfreePaymentAdapter._to_rupees(minor) == pytest.approx(rupees)


@pytest.mark.parametrize("minor", [0, 1, 99, 100, 1999, 101000, 123456789])
def test_the_conversion_round_trips_exactly(minor):
    """The webhook's amount check compares for EXACT equality against
    `booking.total_amount_minor`. A float round trip that turned 1999 into 1998
    would refuse a correct payment and auto-refund a customer who did nothing
    wrong — so this is the property that matters, not the formatting."""
    assert CashfreePaymentAdapter._to_minor(CashfreePaymentAdapter._to_rupees(minor)) == minor


def test_a_float_that_arrived_imprecise_still_lands_on_the_right_paise():
    # The exact shape of the bug this guards: 19.99 does not exist in binary
    # floating point, and a provider that serialises it can hand back its
    # nearest neighbour.
    assert CashfreePaymentAdapter._to_minor(19.989999999999998) == 1999


@pytest.mark.parametrize("value", [None, "", "abc", {}])
def test_an_unparseable_amount_is_zero_rather_than_an_exception(value):
    """Zero fails the amount check and triggers the refund path. Raising here
    would instead take down the webhook handler, and Cashfree would retry a
    delivery that could never succeed."""
    assert CashfreePaymentAdapter._to_minor(value) == 0


# --- the refund id IS the idempotency key ---------------------------------


def test_a_short_key_is_sanitised_but_kept_recognisable():
    # ":" is rejected by Cashfree; the uuid must survive so a human can still
    # trace the refund back to a payment row.
    assert CashfreePaymentAdapter._refund_id("refund:abc123") == "refund_abc123"


def test_the_same_key_always_produces_the_same_refund_id():
    """The whole point. A retried or concurrent refund must resolve to one
    vendor refund, and Cashfree dedupes on this value."""
    key = "refund:11111111-2222-3333-4444-555555555555"
    assert CashfreePaymentAdapter._refund_id(key) == CashfreePaymentAdapter._refund_id(key)


def test_an_over_long_key_is_hashed_rather_than_truncated():
    """Truncating is what would break this: two keys sharing a 40-character
    prefix would collide into ONE refund id, and the second refund — a
    different customer's — would silently return the first one's result and
    never be paid."""
    a = "settlement:11111111-2222-3333-4444-555555555555"
    b = "settlement:11111111-2222-3333-4444-666666666666"

    id_a = CashfreePaymentAdapter._refund_id(a)
    id_b = CashfreePaymentAdapter._refund_id(b)

    assert len(a) > 40 and len(b) > 40  # both would have been truncated
    assert id_a != id_b
    assert len(id_a) <= 40
    assert id_a.startswith("rf_")


def test_every_refund_id_is_within_cashfrees_character_set():
    for key in ("refund:abc", "settlement:" + "9" * 60, "weird key/with?chars"):
        value = CashfreePaymentAdapter._refund_id(key)
        assert len(value) <= 40
        assert all(c.isalnum() or c in "-_" for c in value)


def test_a_refund_without_an_order_id_raises_rather_than_inventing_one():
    """Returning a fabricated refund id would record a refund in this system's
    ledger for money that was never returned — the worst lie a payments module
    can tell. Cashfree refunds are order-scoped, so with no order there is no
    call to make."""
    with pytest.raises(PaymentProviderUnavailable):
        _adapter().refund(payment_id="pay_1", amount_minor=100, idempotency_key="refund:1")


# --- capability flags and environment -------------------------------------


def test_it_declares_that_it_cannot_do_an_order_time_split():
    """`booking` reads this to decide whether to build a Route transfer at all.
    A split this adapter accepted and dropped would be an organizer's share
    silently never held, with a clean log."""
    assert _adapter().supports_order_time_split is False


def test_it_declares_that_it_needs_customer_details():
    assert _adapter().requires_customer_details is True


def test_it_names_itself_so_a_booking_row_can_record_the_gateway():
    assert _adapter().name == "cashfree"


@pytest.mark.parametrize(
    ("configured", "expected_host"),
    [
        ("sandbox", "https://sandbox.cashfree.com/pg"),
        ("production", "https://api.cashfree.com/pg"),
        # Anything unrecognised falls back to SANDBOX, never production: the
        # two failure modes are not symmetrical. A typo that pointed live
        # credentials at the sandbox fails visibly before money moves; one that
        # pointed test credentials at production is the one discovered late.
        ("", "https://sandbox.cashfree.com/pg"),
        ("staging", "https://sandbox.cashfree.com/pg"),
    ],
)
def test_the_environment_selects_the_host(configured, expected_host):
    assert _adapter(configured)._base_url == expected_host


# --- the three Route-shaped calls it refuses ------------------------------


def test_the_route_shaped_calls_refuse_rather_than_returning_a_plausible_id():
    """`organizations.payout_account_id` holds a RAZORPAY linked-account id,
    which Cashfree has never heard of. An adapter that answered these with a
    plausible-looking value would leave an organizer's payout in a state where
    nothing failed and no money moved."""
    adapter = _adapter()

    with pytest.raises(NotImplementedError):
        adapter.create_linked_account(reference_id="org-1", name="X", email="x@example.com")

    with pytest.raises(NotImplementedError):
        adapter.release_payout(account_id="acc_1", amount_minor=100, idempotency_key="k")

    with pytest.raises(NotImplementedError):
        adapter.split_transfer(
            payment_id="pay_1",
            organizer_account_id="acc_1",
            organizer_amount_minor=100,
            platform_fee_minor=1,
        )
