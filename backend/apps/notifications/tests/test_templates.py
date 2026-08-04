"""TemplateService + routing + DLT mapping (pure, no DB)."""

from __future__ import annotations

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest

from apps.notifications.exceptions import TemplateMissingError, UnknownNotificationTypeError
from apps.notifications.models import NotificationChannel, NotificationType
from apps.notifications.templates import (
    TemplateService,
    _tier_label,
    _tier_lines,
    channel_for_type,
    dlt_template_id_for_type,
    format_when,
)


def test_channel_is_derived_from_type():
    assert channel_for_type(NotificationType.WELCOME) == NotificationChannel.EMAIL
    assert channel_for_type(NotificationType.OTP) == NotificationChannel.SMS
    with pytest.raises(UnknownNotificationTypeError):
        channel_for_type("nope")


def test_ticket_email_renders_event_reference_and_every_qr():
    rendered = TemplateService().render(
        notification_type=NotificationType.TICKET_DELIVERY,
        channel=NotificationChannel.EMAIL,
        context={
            "name": "Bill",
            "event_title": "Notify Fest",
            "event_when": "Sat 01 Aug 2026, 19:00 UTC",
            "event_where": "Grand Arena, Mumbai",
            "booking_reference": "bk-123",
            "tickets": [
                {"ticket_type": "GA", "qr_token": "v1.aaa.bbb"},
                {"ticket_type": "VIP", "qr_token": "v1.ccc.ddd"},
            ],
        },
    )

    assert "Notify Fest" in rendered.subject
    assert "bk-123" in rendered.body  # booking reference
    assert "Grand Arena, Mumbai" in rendered.body  # venue
    assert "v1.aaa.bbb" in rendered.body and "v1.ccc.ddd" in rendered.body  # every QR


def test_a_tier_label_carries_the_phase_and_the_price_that_was_billed():
    assert (
        _tier_label(
            {"ticket_type": "Gold", "phase_name": "Early bird", "unit_price_display": "₹300.00"}
        )
        == "Gold — Early bird — ₹300.00 each"
    )


def test_a_tier_label_omits_what_it_was_not_given_rather_than_filling_it_in():
    """A NULL `BookingItem.phase_name` means the line billed at the tier's face
    price, and a caller that has not been updated carries no price at all.
    Neither is inferred — the label just gets shorter."""
    assert _tier_label({"ticket_type": "Basic"}) == "Basic"
    assert _tier_label({"ticket_type": "Basic", "phase_name": ""}) == "Basic"
    assert (
        _tier_label({"ticket_type": "Basic", "unit_price_display": "₹300.00"})
        == "Basic — ₹300.00 each"
    )


def test_tier_lines_count_identical_labels_and_keep_the_order_they_were_chosen():
    lines = _tier_lines(
        [
            {"ticket_type": "Gold", "phase_name": "Early bird", "unit_price_display": "₹300.00"},
            {"ticket_type": "Gold", "phase_name": "Early bird", "unit_price_display": "₹300.00"},
            {"ticket_type": "Basic"},
        ]
    )

    assert lines == ["2 × Gold — Early bird — ₹300.00 each", "1 × Basic"]


def test_otp_template_has_no_subject_and_carries_the_code():
    rendered = TemplateService().render(
        notification_type=NotificationType.OTP,
        channel=NotificationChannel.SMS,
        context={"code": "482913", "ttl_minutes": 5},
    )
    assert rendered.subject == ""
    assert "482913" in rendered.body


def test_missing_template_raises():
    with pytest.raises(TemplateMissingError):
        TemplateService().render(notification_type="does_not_exist", channel="email", context={})


def test_event_times_are_rendered_in_local_time_like_the_site(settings):
    """The email and the ticket PDF must say the same time as the event page
    the ticket was bought from.

    frontend/lib/discovery/format.ts renders Asia/Kolkata. This used to render
    UTC, which put the two artifacts nobody can cross-check — the ticket email
    and the PDF taken to the gate — five and a half hours apart from the page.
    """
    settings.NOTIFICATION_DISPLAY_TIMEZONE = "Asia/Kolkata"
    # The instant the event page renders as "Sun 19 Jul 2026, 23:29".
    instant = datetime(2026, 7, 19, 17, 59, 21, tzinfo=dt_timezone.utc)

    assert format_when(instant) == "Sun 19 Jul 2026, 23:29 IST"


def test_a_naive_datetime_is_read_as_utc_not_as_local(settings):
    """Guessing local for a naive value would silently shift a correct time."""
    settings.NOTIFICATION_DISPLAY_TIMEZONE = "Asia/Kolkata"

    assert format_when(datetime(2026, 7, 19, 17, 59, 21)) == "Sun 19 Jul 2026, 23:29 IST"


def test_an_unknown_timezone_degrades_the_label_rather_than_the_ticket(settings):
    """A typo in an env var must not dead-letter a ticket somebody paid for."""
    settings.NOTIFICATION_DISPLAY_TIMEZONE = "Mars/Olympus_Mons"

    assert format_when(datetime(2026, 7, 19, 17, 59, 21, tzinfo=dt_timezone.utc)).endswith("UTC")


def test_dlt_mapping_falls_back_then_honours_overrides(settings):
    settings.SMS_DLT_TEMPLATE_ID = "base-dlt"
    settings.NOTIFICATION_SMS_DLT_TEMPLATE_IDS = {}
    # Unmapped type -> the single configured default.
    assert dlt_template_id_for_type(NotificationType.OTP) == "base-dlt"
    # A per-type override wins.
    settings.NOTIFICATION_SMS_DLT_TEMPLATE_IDS = {NotificationType.OTP: "otp-dlt"}
    assert dlt_template_id_for_type(NotificationType.OTP) == "otp-dlt"
    assert dlt_template_id_for_type(NotificationType.BOOKING_CONFIRMATION_SMS) == "base-dlt"
