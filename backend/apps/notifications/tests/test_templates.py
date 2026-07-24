"""TemplateService + routing + DLT mapping (pure, no DB)."""

from __future__ import annotations

import pytest

from apps.notifications.exceptions import TemplateMissingError, UnknownNotificationTypeError
from apps.notifications.models import NotificationChannel, NotificationType
from apps.notifications.templates import (
    TemplateService,
    channel_for_type,
    dlt_template_id_for_type,
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


def test_dlt_mapping_falls_back_then_honours_overrides(settings):
    settings.SMS_DLT_TEMPLATE_ID = "base-dlt"
    settings.NOTIFICATION_SMS_DLT_TEMPLATE_IDS = {}
    # Unmapped type -> the single configured default.
    assert dlt_template_id_for_type(NotificationType.OTP) == "base-dlt"
    # A per-type override wins.
    settings.NOTIFICATION_SMS_DLT_TEMPLATE_IDS = {NotificationType.OTP: "otp-dlt"}
    assert dlt_template_id_for_type(NotificationType.OTP) == "otp-dlt"
    assert dlt_template_id_for_type(NotificationType.BOOKING_CONFIRMATION_SMS) == "base-dlt"
