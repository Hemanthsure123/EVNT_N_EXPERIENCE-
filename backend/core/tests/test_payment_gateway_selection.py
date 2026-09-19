"""Which gateways a checkout may offer, and which one it pre-selects.

`config.di.enabled_payment_gateways` is the ONE place that decides this, and
every rule in it exists because the alternative is a checkout that lies: a logo
for a gateway whose credentials are missing, a demo "pay nothing" option beside
a live one, or a pre-selected gateway whose button cannot work.

`@lru_cache` has to be cleared per test — it is a per-process cache of a
settings-derived answer, which is exactly right at runtime and exactly wrong
under `override_settings`.
"""

from __future__ import annotations

import pytest
from django.test import override_settings

from config.di import (
    enabled_payment_gateways,
    payment_port,
    resolve_payment_gateway,
    route_payment_port,
)

CASHFREE_CREDS = {"CASHFREE_APP_ID": "TEST_APP", "CASHFREE_SECRET_KEY": "TEST_SECRET"}
RAZORPAY_CREDS = {"RAZORPAY_KEY_ID": "rzp_test_x", "RAZORPAY_KEY_SECRET": "secret"}


@pytest.fixture(autouse=True)
def _clear_caches():
    enabled_payment_gateways.cache_clear()
    payment_port.cache_clear()
    route_payment_port.cache_clear()
    yield
    enabled_payment_gateways.cache_clear()
    payment_port.cache_clear()
    route_payment_port.cache_clear()


# --- rule 1: a fake default means a fake deployment, full stop ------------


@override_settings(
    PAYMENTS_BACKEND="fake",
    PAYMENTS_ENABLED_GATEWAYS=["cashfree", "razorpay"],
    PAYMENTS_DEFAULT_GATEWAY="cashfree",
    **CASHFREE_CREDS,
    **RAZORPAY_CREDS,
)
def test_a_fake_backend_offers_only_the_fake_whatever_else_is_listed():
    """Offering a choice between a real gateway and a simulated payment on the
    same screen is offering a pay-nothing button. `PaymentSection` already
    refuses to render provider branding in demo mode for the same reason."""
    assert enabled_payment_gateways() == (("fake",), "fake")


# --- rule 2: unconfigured gateways are dropped, not displayed -------------


@override_settings(
    PAYMENTS_BACKEND="razorpay",
    PAYMENTS_ENABLED_GATEWAYS=["cashfree"],
    PAYMENTS_DEFAULT_GATEWAY="cashfree",
    CASHFREE_APP_ID="",
    CASHFREE_SECRET_KEY="",
    **RAZORPAY_CREDS,
)
def test_a_gateway_without_credentials_is_not_offered():
    """It would render a logo, take the press, and fail when the order call got
    a 401 — a control that lies about what pressing it does, on the checkout."""
    names, default = enabled_payment_gateways()
    assert "cashfree" not in names
    assert default == "razorpay"


@override_settings(
    PAYMENTS_BACKEND="razorpay",
    PAYMENTS_ENABLED_GATEWAYS=["cashfree"],
    CASHFREE_APP_ID="TEST_APP",
    CASHFREE_SECRET_KEY="",
    **RAZORPAY_CREDS,
)
def test_half_configured_is_not_configured():
    names, _default = enabled_payment_gateways()
    assert "cashfree" not in names


# --- rule 3: PAYMENTS_BACKEND is always in the set ------------------------


@override_settings(
    PAYMENTS_BACKEND="razorpay",
    PAYMENTS_ENABLED_GATEWAYS=["cashfree"],
    PAYMENTS_DEFAULT_GATEWAY="cashfree",
    **CASHFREE_CREDS,
    **RAZORPAY_CREDS,
)
def test_the_backend_is_always_offered_even_when_not_listed():
    """It is the provider the rest of the platform is built around — refunds
    and settlements go through it whatever the checkout offers."""
    names, default = enabled_payment_gateways()
    assert set(names) == {"razorpay", "cashfree"}
    assert default == "cashfree"


# --- rule 4: the default must be offerable --------------------------------


@override_settings(
    PAYMENTS_BACKEND="razorpay",
    PAYMENTS_ENABLED_GATEWAYS=["cashfree"],
    PAYMENTS_DEFAULT_GATEWAY="cashfree",
    CASHFREE_APP_ID="",
    CASHFREE_SECRET_KEY="",
    **RAZORPAY_CREDS,
)
def test_an_unusable_default_falls_back_to_one_that_works():
    """Pre-selecting a gateway whose button cannot work is worse than
    pre-selecting the other one."""
    _names, default = enabled_payment_gateways()
    assert default == "razorpay"


@override_settings(
    PAYMENTS_BACKEND="razorpay",
    PAYMENTS_ENABLED_GATEWAYS=["cashfree"],
    PAYMENTS_DEFAULT_GATEWAY="",
    **CASHFREE_CREDS,
    **RAZORPAY_CREDS,
)
def test_with_no_stated_default_the_backend_wins():
    _names, default = enabled_payment_gateways()
    assert default == "razorpay"


# --- the single-gateway deployment is untouched ---------------------------


@override_settings(
    PAYMENTS_BACKEND="razorpay",
    PAYMENTS_ENABLED_GATEWAYS=[],
    PAYMENTS_DEFAULT_GATEWAY="",
    **RAZORPAY_CREDS,
)
def test_an_unset_list_behaves_exactly_as_before_cashfree_existed():
    """No selector, no second webhook, nothing to configure. The frontend draws
    plain text for a single option, which is what `PayUsing` always was."""
    assert enabled_payment_gateways() == (("razorpay",), "razorpay")


@override_settings(
    PAYMENTS_BACKEND="razorpay",
    PAYMENTS_ENABLED_GATEWAYS=[],
    RAZORPAY_KEY_ID="",
    RAZORPAY_KEY_SECRET="",
)
def test_a_wholly_unconfigured_deployment_still_names_its_backend():
    """Returning nothing would 500 the reserve. The booking is still made and
    the checkout renders its "payment provider not configured" notice, which is
    a far better outcome than a crash on the money path."""
    names, default = enabled_payment_gateways()
    assert names == ("razorpay",)
    assert default == "razorpay"


# --- what a client may ask for --------------------------------------------


@override_settings(
    PAYMENTS_BACKEND="razorpay",
    PAYMENTS_ENABLED_GATEWAYS=["cashfree"],
    PAYMENTS_DEFAULT_GATEWAY="cashfree",
    **CASHFREE_CREDS,
    **RAZORPAY_CREDS,
)
@pytest.mark.parametrize(
    ("requested", "expected"),
    [
        ("cashfree", "cashfree"),
        ("razorpay", "razorpay"),
        ("CASHFREE", "cashfree"),  # case is not a reason to refuse a sale
        (" razorpay ", "razorpay"),
        # Anything not on offer falls back rather than raising: a stale value
        # in a cached tab must never refuse a sale over a presentational
        # detail the customer cannot see and did not choose.
        ("stripe", "cashfree"),
        ("", "cashfree"),
        ("fake", "cashfree"),
    ],
)
def test_a_requested_gateway_is_a_request_and_never_an_instruction(requested, expected):
    assert resolve_payment_gateway(requested) == expected


# --- the registry builds the right adapter --------------------------------


@override_settings(PAYMENTS_BACKEND="razorpay", **CASHFREE_CREDS, **RAZORPAY_CREDS)
def test_each_gateway_name_resolves_to_its_own_adapter():
    """One instance per gateway per process — and crucially, asking for a
    gateway by name never returns the default. A refund resolved to the wrong
    adapter is money returned through a provider that never took it."""
    from core.adapters.cashfree.adapter import CashfreePaymentAdapter

    cashfree = payment_port("cashfree")
    assert isinstance(cashfree, CashfreePaymentAdapter)
    assert cashfree.name == "cashfree"
    # Cached: the same instance, not a new client per call.
    assert payment_port("cashfree") is cashfree


@override_settings(PAYMENTS_BACKEND="fake")
def test_no_argument_still_means_payments_backend():
    """The DEFAULT adapter, for the checkout paths that have no booking-specific
    gateway yet. `organizations` and `settlements` no longer call it this way —
    they use `route_payment_port()`, which is the point of that function."""
    assert payment_port().name == "fake"


@override_settings(PAYMENTS_BACKEND="razorpay", **RAZORPAY_CREDS)
def test_an_unknown_gateway_name_raises_rather_than_falling_back():
    """`resolve_payment_gateway` is where a stale client value is absorbed. By
    the time a name reaches the registry it has already been validated, so an
    unknown one here is a programming error and silently substituting the
    default would hide it."""
    with pytest.raises(ValueError):
        payment_port("stripe")


# --- who pays the organizer -----------------------------------------------
#
# A THIRD question, and the reason it is separate from the two above: taking a
# payment is a per-booking decision, paying an organizer is not.
# `organizations.payout_account_id` stores ONE vendor's account id, and only
# that vendor can settle against it.


@override_settings(PAYMENTS_BACKEND="razorpay", PAYMENTS_ROUTE_PROVIDER="", **RAZORPAY_CREDS)
def test_the_route_provider_defaults_to_the_backend():
    """Unset means unchanged, so no existing deployment has to think about it."""
    assert route_payment_port().name == "razorpay"


@override_settings(
    PAYMENTS_BACKEND="cashfree",
    PAYMENTS_ROUTE_PROVIDER="razorpay",
    **CASHFREE_CREDS,
    **RAZORPAY_CREDS,
)
def test_the_backend_can_be_cashfree_while_payouts_stay_on_razorpay():
    """The whole point of the setting. Before it, `organizations` and
    `settlements` were handed `payment_port()`, so flipping the default backend
    would have pointed `release_payout` at a provider that has never heard of
    the Razorpay linked-account id in our own database — and nothing would have
    said so until a settlement failed weeks after an event."""
    assert payment_port().name == "cashfree"
    assert route_payment_port().name == "razorpay"


@override_settings(PAYMENTS_BACKEND="razorpay", **RAZORPAY_CREDS, **CASHFREE_CREDS)
def test_an_adapter_declares_whether_it_can_pay_out():
    """Read as a DECLARED capability, never by calling `release_payout` to see
    whether it throws — on a real adapter that method is a live API request
    that creates a transfer, and a capability probe must not be able to move
    money or depend on a vendor being reachable."""
    assert payment_port("razorpay").supports_payouts is True
    assert payment_port("cashfree").supports_payouts is False
