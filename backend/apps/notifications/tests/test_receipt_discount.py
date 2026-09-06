"""The discount row on the ticket-delivery receipt.

The RENDERING half of the seam. The other half — that a real booking's coupon
is found at all, and found without a query — is proved in
`apps/booking/tests/test_coupon_on_booking.py`, where the fixtures for a
booking with a code applied already live.
"""

from __future__ import annotations

import pytest

from apps.notifications.models import NotificationChannel, NotificationType
from apps.notifications.templates import TemplateService

BASE = {
    "name": "Asha Rao",
    "event_title": "Sunburn Jazz Night",
    "event_when": "Sat 23 Aug 2026, 20:10 IST",
    "event_where": "Phoenix Arena, Mumbai",
    "booking_reference": "3f1d9c22-0000-4000-8000-000000000001",
    "issued_at": "Fri 01 Aug 2026, 11:04 IST",
    "tickets": [{"ticket_type": "Gold", "qr_token": "v1.aaa.bbb"}],
}


def render(payment: dict) -> str:
    return (
        TemplateService()
        .render(
            notification_type=NotificationType.TICKET_DELIVERY,
            channel=NotificationChannel.EMAIL,
            context={**BASE, "payment": payment},
        )
        .html
    )


@pytest.fixture
def paid() -> dict:
    return {
        "amount_display": "₹404.00",
        "platform_fee_display": "₹4.00",
        "reference": "pay_QwErTy123456",
        "paid_at": "Fri 01 Aug 2026, 11:04 IST",
        "status_label": "Paid",
    }


def test_a_discount_is_named_with_the_code_that_produced_it(paid):
    """ "Discount applied: ₹100" leaves somebody wondering which of the three
    codes they were sent actually worked."""
    html = render({**paid, "discount_display": "SAVE20 · -₹100.00"})

    assert "Discount applied" in html
    assert "SAVE20" in html


def test_a_receipt_with_no_code_has_no_discount_row(paid):
    """ABSENT, not a zero. A row reading "Discount ₹0.00" invites the reader to
    work out what went wrong with a discount they never had."""
    assert "Discount applied" not in render(paid)


def test_the_amount_paid_is_still_the_charged_total(paid):
    """The discount line says WHY the total is what it is; it is never a figure
    to subtract from it. `amount_display` is already the discounted charge."""
    html = render({**paid, "discount_display": "SAVE20 · -₹100.00"})

    assert "₹404.00" in html


def test_a_payment_block_carrying_ONLY_a_discount_still_renders(paid):
    """`has_content` decides whether the block appears at all. A discount alone
    is content — the branch exists because the no-payment-row path builds a
    context from the booking, and dropping the block there would lose the
    amount as well."""
    html = render({"discount_display": "SAVE20 · -₹100.00"})

    assert "Discount applied" in html
