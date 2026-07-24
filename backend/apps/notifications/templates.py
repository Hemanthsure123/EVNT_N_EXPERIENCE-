"""Rendering (the 'render' half of render-vs-dispatch-vs-orchestrate).

`TemplateService.render(type, channel, context)` turns a notification type +
context into a `RenderedMessage(subject, body)` — a Factory over per-type
template functions. A missing template raises `TemplateMissingError` loudly at
render time, never a silent no-send.

The channel and (for SMS) the DLT-approved template id are both DERIVED from the
type, so callers never hard-code either:
- `channel_for_type` — email vs SMS.
- `dlt_template_id_for_type` — India DLT requires a distinct approved template
  id per message type. The mapping lives here (type -> id via
  `settings.NOTIFICATION_SMS_DLT_TEMPLATE_IDS`, falling back to the single
  configured `SMS_DLT_TEMPLATE_ID`), so real SMS is compliant the moment the
  provider is switched on — dev/console just logs the id.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from django.conf import settings

from .exceptions import TemplateMissingError, UnknownNotificationTypeError
from .models import NotificationChannel, NotificationType


def format_when(dt: datetime) -> str:
    """One place that formats an event's start time for human-readable copy, so
    every template/handler renders it the same way."""
    return dt.strftime("%a %d %b %Y, %H:%M UTC")


@dataclass(frozen=True)
class RenderedMessage:
    subject: str  # blank for SMS
    body: str


# Which channel each type is delivered on. The single source of truth for
# routing — the service reads channel straight off the type.
CHANNEL_BY_TYPE: dict[str, str] = {
    NotificationType.WELCOME: NotificationChannel.EMAIL,
    NotificationType.TICKET_DELIVERY: NotificationChannel.EMAIL,
    NotificationType.BOOKING_CONFIRMATION_SMS: NotificationChannel.SMS,
    NotificationType.REFUND_CONFIRMATION: NotificationChannel.EMAIL,
    NotificationType.REFUND_CONFIRMATION_SMS: NotificationChannel.SMS,
    NotificationType.OTP: NotificationChannel.SMS,
    NotificationType.EVENT_REMINDER: NotificationChannel.EMAIL,
    NotificationType.PAYOUT_RELEASED: NotificationChannel.EMAIL,
}


def channel_for_type(notification_type: str) -> str:
    try:
        return CHANNEL_BY_TYPE[notification_type]
    except KeyError as exc:
        raise UnknownNotificationTypeError(notification_type) from exc


def dlt_template_id_for_type(notification_type: str) -> str:
    """The India-DLT-approved template id for an SMS type. Ops can assign a
    distinct approved id per type via NOTIFICATION_SMS_DLT_TEMPLATE_IDS; every
    unmapped type falls back to the single configured SMS_DLT_TEMPLATE_ID."""
    overrides: dict[str, str] = getattr(settings, "NOTIFICATION_SMS_DLT_TEMPLATE_IDS", {})
    return overrides.get(notification_type, settings.SMS_DLT_TEMPLATE_ID)


# --- per-type templates (pure functions of the context) --------------------


def _welcome(ctx: dict) -> RenderedMessage:
    name = ctx.get("name") or ctx["email"]
    return RenderedMessage(
        subject="Welcome to Event & Experience Platform",
        body=f"Hi {name}, your account is ready. Discover events and book your first ticket.",
    )


def _ticket_delivery(ctx: dict) -> RenderedMessage:
    lines = [
        f"Hi {ctx.get('name') or 'there'}, your tickets are confirmed!",
        "",
        f"Event: {ctx['event_title']}",
        f"When:  {ctx['event_when']}",
        f"Where: {ctx['event_where']}",
        f"Booking reference: {ctx['booking_reference']}",
        "",
        "Show these QR codes at the gate (one scan admits one person):",
    ]
    for i, ticket in enumerate(ctx["tickets"], start=1):
        lines.append(f"  {i}. {ticket['ticket_type']} — QR: {ticket['qr_token']}")
    return RenderedMessage(subject=f"Your tickets for {ctx['event_title']}", body="\n".join(lines))


def _booking_confirmation_sms(ctx: dict) -> RenderedMessage:
    return RenderedMessage(
        subject="",
        body=(
            f"Your booking {ctx['booking_reference']} for {ctx['event_title']} is confirmed "
            f"({ctx['ticket_count']} ticket(s)). Check your email for tickets."
        ),
    )


def _refund_confirmation(ctx: dict) -> RenderedMessage:
    return RenderedMessage(
        subject=f"Refund processed for {ctx['event_title']}",
        body=(
            f"Hi {ctx.get('name') or 'there'}, your refund of {ctx['amount_display']} for "
            f"booking {ctx['booking_reference']} ({ctx['event_title']}) has been processed."
        ),
    )


def _refund_confirmation_sms(ctx: dict) -> RenderedMessage:
    return RenderedMessage(
        subject="",
        body=(
            f"Refund of {ctx['amount_display']} for booking {ctx['booking_reference']} "
            f"has been processed."
        ),
    )


def _otp(ctx: dict) -> RenderedMessage:
    return RenderedMessage(
        subject="",
        body=(
            f"{ctx['code']} is your verification code. "
            f"It is valid for {ctx['ttl_minutes']} minutes."
        ),
    )


def _event_reminder(ctx: dict) -> RenderedMessage:
    return RenderedMessage(
        subject=f"Reminder: {ctx['event_title']} is coming up",
        body=(
            f"Hi {ctx.get('name') or 'there'}, this is a reminder that {ctx['event_title']} "
            f"is on {ctx['event_when']} at {ctx['event_where']}. See you there!"
        ),
    )


def _payout_released(ctx: dict) -> RenderedMessage:
    return RenderedMessage(
        subject=f"You've been paid out for {ctx['event_title']}",
        body=(
            f"Hi {ctx.get('name') or 'there'}, your payout of {ctx['amount_display']} for "
            f"{ctx['event_title']} has been released to your linked account "
            f"(reference {ctx['provider_ref']}). Thanks for hosting on the platform!"
        ),
    )


_TEMPLATES: dict[str, Callable[[dict], RenderedMessage]] = {
    NotificationType.WELCOME: _welcome,
    NotificationType.TICKET_DELIVERY: _ticket_delivery,
    NotificationType.BOOKING_CONFIRMATION_SMS: _booking_confirmation_sms,
    NotificationType.REFUND_CONFIRMATION: _refund_confirmation,
    NotificationType.REFUND_CONFIRMATION_SMS: _refund_confirmation_sms,
    NotificationType.OTP: _otp,
    NotificationType.PAYOUT_RELEASED: _payout_released,
    NotificationType.EVENT_REMINDER: _event_reminder,
}


class TemplateService:
    """Renders a notification's content. Pure and stateless — no I/O — so it's
    trivially testable and safe to call on the request path (the slow part is
    the send, which happens later)."""

    def render(self, *, notification_type: str, channel: str, context: dict) -> RenderedMessage:
        template = _TEMPLATES.get(notification_type)
        if template is None:
            raise TemplateMissingError(notification_type, channel)
        return template(context)
