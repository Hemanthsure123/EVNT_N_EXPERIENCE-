"""Observers that turn other modules' domain events into notifications.

Wired in apps.py AppConfig.ready(); they run after commit, off the request
path (via the outbox -> event bus). Each handler GATHERS the cross-module
context it needs (user, booking, event, tickets) and calls the ONE entry point,
`NotificationService.notify`, which owns rendering, dedupe, claim and dispatch.

Notifications is the downstream consumer of the money path, so reading booking/
payment/event rows here is a permitted one-way dependency (notifications ->
those modules, never the reverse).
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone

from .models import NotificationType
from .templates import _site_url, format_when

if TYPE_CHECKING:  # pragma: no cover — annotation only; the runtime import is lazy
    from apps.events.models import Event

logger = logging.getLogger(__name__)


def _amount_display(minor: int) -> str:
    return f"₹{minor / 100:.2f}"


def _directions_url(event: Event) -> str:
    """A Google Maps link to the venue, built exactly the way the site builds it
    (`frontend/lib/api/maps.ts` `directionsUrl`) — same path, same `api=1`, same
    percent-encoding. One product, two renderers: a directions link on a ticket
    that lands somewhere other than the one on the event page is a link somebody
    stops trusting at the point they are already late.

    Coordinates win when the event has them, because a venue name is ambiguous
    and a lat/lng is not. They are never INVENTED — `Event.latitude`/`longitude`
    are nullable and (0, 0) is a real place in the Atlantic, so an event with no
    pin falls back to the venue text rather than to a default marker.

    Returns "" when there is nothing to point at, which draws no link at all
    rather than a button that opens an empty map.
    """
    if event.latitude is not None and event.longitude is not None:
        destination = f"{event.latitude},{event.longitude}"
    else:
        destination = ", ".join(part for part in (event.venue, event.city) if part)
    if not destination:
        return ""
    return f"https://www.google.com/maps/search/?api=1&query={quote(destination, safe='')}"


def handle_user_registered(payload: dict) -> None:
    """USER_REGISTERED -> welcome email. (Consolidated here from accounts.)"""
    from config.di import build_notification_service

    email = payload["email"]
    build_notification_service().notify(
        notification_type=NotificationType.WELCOME,
        recipient=email,
        context={"name": payload.get("full_name"), "email": email},
        dedupe_key=f"welcome:{payload['user_id']}:email:{email}",
    )


def handle_booking_confirmed(payload: dict) -> None:
    """BOOKING_CONFIRMED -> the ticket delivery email (event + reference + QR),
    an SMS confirmation, and a push. The most important message in the system.

    THREE LOGICAL MESSAGES, NOT ONE IN THREE PLACES. Each has its own type,
    channel, template and dedupe key, so a missing phone number or an
    unsubscribed browser changes nothing about the others — the email is
    always the complete message, and the other two are shortcuts to it.
    """
    from apps.accounts.repositories import UserRepository
    from apps.booking.repositories import BookingRepository, TicketRepository
    from apps.payments.repositories import PaymentRepository
    from config.di import build_notification_service

    booking_id = payload["booking_id"]
    user = UserRepository().get_by_id(payload["user_id"])
    booking = BookingRepository().get_detail(booking_id)
    if user is None or booking is None:
        logger.warning("notifications.booking_confirmed.missing", extra={"booking_id": booking_id})
        return

    # WHAT EACH LINE WAS BILLED, by tier. `booking.items` is already prefetched
    # by `get_detail`, so this costs no query — and the price is read off the
    # ITEM, never off the tier: `BookingItem.unit_price_minor` is what this order
    # was actually charged, so a later re-price (or a sale phase closing) cannot
    # rewrite an invoice somebody has already filed.
    items_by_tier = {item.ticket_type_id: item for item in booking.items.all()}
    tickets: list[dict] = []
    for t in TicketRepository().list_for_booking(booking_id):
        item = items_by_tier.get(t.ticket_type_id)
        tickets.append(
            {
                "ticket_type": t.ticket_type.name,
                "qr_token": t.qr_token,
                # WHO THIS ONE ADMITS, when the buyer named somebody. Blank stays
                # blank — the document omits the row rather than printing the
                # buyer's name on a seat they gave away.
                "attendee": t.attendee_name,
                # Which sale phase priced it. NULL on the column means it billed
                # at the tier's face price, so "" here and the label omits it.
                "phase_name": (item.phase_name or "") if item is not None else "",
                "unit_price_display": (
                    _amount_display(item.unit_price_minor) if item is not None else ""
                ),
            }
        )
    event = booking.event
    reference = str(booking.id)
    service = build_notification_service()

    # WHAT THEY PAID, for the receipt half of the PDF.
    #
    # Loaded HERE rather than in the template, because that is the split this
    # module exists for: a handler gathers cross-module context, a template
    # renders what it is handed. `payment_order_id` is stored on the booking and
    # `rzp_order_id` is UNIQUE, so this is one indexed lookup — and it is a
    # permitted one-way dependency (notifications -> payments, never back).
    #
    # There is deliberately NO payment "method". This platform stores Razorpay
    # reference ids and amounts and never card data, so there is no column to
    # read one from; the PDF omits the row rather than printing a guess.
    payment = (
        PaymentRepository().get_by_order_id(booking.payment_order_id)
        if booking.payment_order_id
        else None
    )
    if payment is not None:
        payment_context: dict[str, str] = {
            "amount_display": _amount_display(payment.amount_minor),
            # PART OF the amount above, not a second charge beside it. The fee
            # is now added to what the customer pays (1% of the ticket
            # subtotal), so a receipt listing it as its own line would look
            # like a figure to add on — the label says "Includes" for that
            # reason, and the two numbers must never be summed.
            "platform_fee_display": _amount_display(booking.platform_fee_minor),
            "reference": payment.rzp_payment_id,
            "paid_at": format_when(payment.updated_at),
            "status_label": payment.get_status_display(),
        }
    else:
        # NO PAYMENT ROW, BUT THE BOOKING IS PAID. `confirm_booking` is what
        # published the event this handler consumes, so the money moved — the row
        # can simply be unresolvable here (a booking confirmed without a Razorpay
        # order has a blank `payment_order_id`, and there is nothing to look up).
        #
        # The AMOUNT is still known: `total_amount_minor` is what the booking was
        # reserved at and the exact figure payments' webhook amount-checks
        # against, so it is the charged total rather than a guess. It goes through
        # `_amount_display` like every other figure here, so the `₹` -> `INR `
        # WinAnsi mapping in the PDF applies to it too.
        #
        # NOTHING else is filled in. There is no provider reference, no
        # captured-at and no provider status to print, and a receipt that
        # invented any of the three would be a receipt that lies about where the
        # money is — so those rows are simply absent.
        payment_context = {
            "amount_display": _amount_display(booking.total_amount_minor),
            "platform_fee_display": _amount_display(booking.platform_fee_minor),
        }

    # The ticket delivery email — event details + booking reference + the QR(s).
    service.notify(
        notification_type=NotificationType.TICKET_DELIVERY,
        recipient=user.email,
        context={
            "name": user.full_name,
            "event_title": event.title,
            "event_when": format_when(event.starts_at),
            "event_where": f"{event.venue}, {event.city}",
            "booking_reference": reference,
            # WHEN IT WAS ISSUED. `confirm_booking` marks the booking paid and
            # issues its tickets in ONE transaction, so the booking's
            # `updated_at` is the issue instant — there is no separate column,
            # and adding one would be a second answer to the same question.
            "issued_at": format_when(booking.updated_at),
            # WHO IS PRESENTING IT — the counterparty of the purchase, and the
            # name a dispute is opened against. Joined by `get_detail`, so
            # reading it here is no extra statement on the money path.
            "organizer_name": event.organization.name,
            "maps_url": _directions_url(event),
            "tickets": tickets,
            "payment": payment_context,
        },
        dedupe_key=f"ticket_delivery:{booking_id}:email:{user.email}",
    )
    # An SMS confirmation — skipped cleanly if the user has no phone on file.
    service.notify(
        notification_type=NotificationType.BOOKING_CONFIRMATION_SMS,
        recipient=user.phone,
        context={
            "booking_reference": reference,
            "event_title": event.title,
            "ticket_count": len(tickets),
        },
        dedupe_key=f"booking_sms:{booking_id}:sms:{user.phone}",
    )
    # And the lock screen. A THIRD logical message, not a third copy: its own
    # type, channel, template and dedupe key, so a device that is not
    # subscribed changes nothing about the email or the SMS.
    #
    # This is the notification somebody is actually waiting for — they pressed
    # pay a second ago — which is why it is sent here, on confirmation, rather
    # than being folded into the reminder job.
    #
    # Keyed on the USER, not the device: two phones should show one
    # notification each, not two logical messages. `_send_push` fans out.
    service.notify(
        notification_type=NotificationType.BOOKING_CONFIRMED_PUSH,
        recipient=str(user.id),
        context={
            "event_title": event.title,
            "ticket_count": len(tickets),
            "url": f"{_site_url()}/account/tickets" if _site_url() else "",
        },
        dedupe_key=f"booking_push:{booking_id}:push:{user.id}",
    )


def handle_ticket_assigned(payload: dict) -> None:
    """TICKET_ASSIGNED -> send the named guest THEIR ticket, and only theirs.

    ── WHY THIS IS A SEPARATE MESSAGE AND NOT A CC ──────────────────────────

    Somebody buying ten seats used to have exactly one option: forward the
    confirmation mail. That mail contains every one of the ten signed tokens,
    so forwarding it hands each guest nine admissions that are not theirs —
    and hands them to whoever the mail is forwarded to next. One message per
    ticket, addressed to the person it admits, is the only shape that does not
    leak the rest of the party.

    The recipient is very likely not a user here. They get the event, the time,
    the place, their tier and their own token — no booking total, no payment
    block, no other tokens, and no link to an account they cannot sign into.
    """
    from apps.booking.repositories import TicketRepository
    from config.di import build_notification_service

    ticket_id = payload["ticket_id"]
    email = (payload.get("attendee_email") or "").strip()
    if not email:
        # A clearing or a name-only correction should never have published;
        # this is belt and braces, and it must not raise.
        return

    ticket = TicketRepository().get_by_id(ticket_id)
    if ticket is None:
        logger.warning("notifications.ticket_assigned.missing", extra={"ticket_id": ticket_id})
        return

    # THE TOKEN IS READ HERE, NOT CARRIED IN THE PAYLOAD. An outbox row is a
    # long-lived record that operators and the activity feed can see; a ticket
    # token is a live credential. Fetching it at send time keeps the credential
    # out of the durable event log.
    booking = ticket.booking
    event = booking.event

    build_notification_service().notify(
        notification_type=NotificationType.ATTENDEE_TICKET,
        recipient=email,
        context={
            "attendee_name": payload.get("attendee_name") or "",
            "booked_by": (booking.user.full_name or "").strip(),
            "event_title": event.title,
            "event_when": format_when(event.starts_at),
            "event_where": f"{event.venue}, {event.city}",
            "ticket_type": payload.get("ticket_type_name") or ticket.ticket_type.name,
            "qr_token": ticket.qr_token,
        },
        # Keyed on ticket AND address: re-assigning to a NEW person is a new
        # message, while a redelivery of the same event is not.
        dedupe_key=f"attendee_ticket:{ticket_id}:email:{email}",
    )


def handle_payment_refunded(payload: dict) -> None:
    """PAYMENT_REFUNDED -> refund confirmation (email + SMS if a phone is set)."""
    from apps.payments.repositories import PaymentRepository
    from config.di import build_notification_service

    payment_id = payload["payment_id"]
    payment = PaymentRepository().get_with_event_owner(payment_id)
    if payment is None:
        logger.warning("notifications.refund.payment_missing", extra={"payment_id": payment_id})
        return

    booking = payment.booking
    user = booking.user
    context = {
        "name": user.full_name,
        "event_title": booking.event.title,
        "booking_reference": str(booking.id),
        "amount_display": _amount_display(payment.amount_minor),
    }
    service = build_notification_service()
    service.notify(
        notification_type=NotificationType.REFUND_CONFIRMATION,
        recipient=user.email,
        context=context,
        dedupe_key=f"refund:{payment_id}:email:{user.email}",
    )
    service.notify(
        notification_type=NotificationType.REFUND_CONFIRMATION_SMS,
        recipient=user.phone,
        context=context,
        dedupe_key=f"refund_sms:{payment_id}:sms:{user.phone}",
    )


def handle_payout_released(payload: dict) -> None:
    """PAYOUT_RELEASED -> the organizer's payout confirmation email. Self-
    contained: settlements carries the owner email + title + amount in the
    event, so no cross-module load is needed here."""
    from config.di import build_notification_service

    owner_email = payload.get("owner_email", "")
    build_notification_service().notify(
        notification_type=NotificationType.PAYOUT_RELEASED,
        recipient=owner_email,
        context={
            "event_title": payload["event_title"],
            "amount_display": _amount_display(payload["amount_minor"]),
            "provider_ref": payload["provider_ref"],
        },
        dedupe_key=f"payout_released:{payload['settlement_id']}:email:{owner_email}",
    )


# --- operator alerts: something is waiting for a human decision ------------
#
# Every event type below is subscribed in apps.py from the ONE declaration in
# core/events.py. This module used to carry its own literal copy of
# `ORGANIZATION_VERIFICATION_SUBMITTED` as a getattr fallback, because at the
# time `organizations` did not publish it; that module now does, the constant
# is declared, and the copy is gone. Subscription is by STRING and the event
# bus swallows nothing it was never handed — so two spellings of one event name
# is a wiring failure with no exception and no failing test behind it.


def _platform_admin_emails() -> list[str]:
    """The operations mailboxes an approval alert goes to.

    Blank entries are dropped: `PLATFORM_ADMIN_EMAILS=` in an env file parses
    to `['']`, and an empty recipient would otherwise be a skipped send that
    looks exactly like a configured one.
    """
    configured = getattr(settings, "PLATFORM_ADMIN_EMAILS", None) or []
    return [address.strip() for address in configured if address and address.strip()]


def _no_operator_configured(waiting_on: str) -> bool:
    """True when nobody is configured to receive approval alerts.

    Checked FIRST, before a handler reads anything: on a platform with no ops
    mailbox this makes the whole feature cost zero queries per submission
    rather than loading rows to build a message nothing will send.

    Unconfigured is a supported state, not an error. It logs a WARNING —
    because "no operator was told" is worth seeing — and returns, because an
    organiser must never have a submission fail on account of nobody having
    set up an ops mailbox.
    """
    if _platform_admin_emails():
        return False
    logger.warning("notifications.admin_alert.no_recipient", extra={"waiting_on": waiting_on})
    return True


def _alert_admins(*, notification_type: str, context: dict, dedupe_scope: str) -> int:
    """Fan one operator alert out to every configured ops address.

    ONE LOG ROW PER ADDRESS, not one per alert: `notify` takes a single
    recipient and the dedupe ledger is keyed by `(message, recipient)`, so a
    second operator being added later gets their own claim rather than being
    swallowed by a key the first one already used.

    An empty list is a silent no-op here — the handlers call
    `_no_operator_configured` first, which is where that case is reported.
    """
    recipients = _platform_admin_emails()
    if not recipients:
        return 0

    from config.di import build_notification_service

    service = build_notification_service()
    for address in recipients:
        service.notify(
            notification_type=notification_type,
            recipient=address,
            context=context,
            dedupe_key=f"{dedupe_scope}:email:{address}",
        )
    return len(recipients)


def handle_event_submitted_for_review(payload: dict) -> None:
    """EVENT_SUBMITTED_FOR_REVIEW -> tell the platform operator an event is
    waiting. Nothing else consumes this event, so before this handler a
    submission could sit in the queue indefinitely with nobody aware of it.

    ── WHY THE EVENT IS LOADED FOR A DEDUPE KEY ─────────────────────────────

    A RESUBMISSION after a rejection republishes the same aggregate. Keyed on
    the event id alone, the ledger would treat the second submission as a
    duplicate of the first and silently send nothing — the exact failure this
    handler exists to prevent, applied to the organiser who most needs an
    answer. `submit_for_review_if_draft` bumps `version` on every submission,
    which makes it the per-submission discriminator; the payload does not carry
    it, so it is read from the row.

    The load only SHARPENS the key. Every word of the message comes from the
    payload, so an event that has since been deleted degrades to one alert per
    event rather than to no alert at all.
    """
    if _no_operator_configured("event_review"):
        return

    from apps.events.repositories import EventRepository

    event_id = str(payload["event_id"])
    # `get_active_for_write` rather than `get_active_by_id`: it is the lean
    # field set that actually carries `version`, so this is one indexed PK read
    # and not a deferred second query for one integer.
    event = EventRepository().get_active_for_write(event_id)
    version = getattr(event, "version", None) if event is not None else None
    scope = f"admin_event_review:{event_id}"
    if version is not None:
        scope = f"{scope}:v{version}"

    _alert_admins(
        notification_type=NotificationType.ADMIN_EVENT_REVIEW,
        context={
            "event_id": event_id,
            "event_title": payload.get("title") or "Untitled event",
            "submitted_by": payload.get("owner_email") or "",
        },
        dedupe_scope=scope,
    )


def handle_organization_verification_submitted(payload: dict) -> None:
    """ORGANIZATION_VERIFICATION_SUBMITTED -> tell the platform operator an
    organization has asked to be verified.

    The payload contract this consumes: `organization_id` (required), plus
    `verification_id`, `name` and `owner_email` when the publisher has them.
    `verification_id` is the dedupe discriminator — one row per submission by
    construction, so a re-application after a rejection alerts again while a
    redelivered outbox event does not.
    """
    if _no_operator_configured("organization_verification"):
        return

    from apps.accounts.repositories import UserRepository
    from apps.organizations.repositories import OrganizationRepository

    organization_id = str(payload["organization_id"])
    name = payload.get("name") or ""
    submitted_by = payload.get("owner_email") or ""
    if not name or not submitted_by:
        # Only to fill in what the publisher did not carry. A missing row is
        # not a reason to stay silent — an operator can still open the queue.
        organization = OrganizationRepository().get_active_by_id(organization_id)
        if organization is not None:
            name = name or organization.name
            if not submitted_by:
                owner = UserRepository().get_by_id(organization.owner_id)
                submitted_by = owner.email if owner is not None else ""

    verification_id = str(payload.get("verification_id") or "")
    scope = f"admin_org_verification:{verification_id or organization_id}"

    _alert_admins(
        notification_type=NotificationType.ADMIN_ORG_VERIFICATION,
        context={
            "organization_id": organization_id,
            "organization_name": name or "Unnamed organization",
            "submitted_by": submitted_by,
        },
        dedupe_scope=scope,
    )


def handle_performer_submitted_for_review(payload: dict) -> None:
    """PERFORMER_SUBMITTED_FOR_REVIEW -> tell the platform operator an act is
    waiting. The same queue, the same silence before this handler existed.

    `version` is the per-submission discriminator for the same reason it is on
    events: `submit_for_review` bumps it, and a resubmitted act must alert
    again rather than being deduped against its first attempt.
    """
    if _no_operator_configured("performer_review"):
        return

    from apps.accounts.repositories import UserRepository
    from apps.performers.repositories import PerformerRepository

    performer_id = str(payload["performer_id"])
    performer = PerformerRepository().get_active_for_write(performer_id)
    version = getattr(performer, "version", None) if performer is not None else None
    scope = f"admin_performer_review:{performer_id}"
    if version is not None:
        scope = f"{scope}:v{version}"

    submitted_by = ""
    if performer is not None:
        owner = UserRepository().get_by_id(performer.organization.owner_id)
        submitted_by = owner.email if owner is not None else ""

    _alert_admins(
        notification_type=NotificationType.ADMIN_PERFORMER_REVIEW,
        context={
            "performer_id": performer_id,
            "stage_name": payload.get("stage_name") or "Untitled act",
            "submitted_by": submitted_by,
        },
        dedupe_scope=scope,
    )


def handle_event_published(payload: dict) -> None:
    """EVENT_PUBLISHED -> SCHEDULE the reminder job for a configurable time
    before the event, via TaskQueuePort (Cloud Tasks fires it near event time
    in prod; the sync dev queue runs it at once, harmlessly, since there are no
    ticket holders yet). The job itself fans out to holders idempotently."""
    from apps.events.repositories import EventRepository
    from apps.notifications.services import EVENT_REMINDER_TASK
    from config.di import task_queue_port

    event = EventRepository().get_active_by_id(payload["event_id"])
    if event is None:
        return
    lead = timedelta(hours=settings.NOTIFICATION_EVENT_REMINDER_HOURS_BEFORE)
    delay = max(0, int((event.starts_at - lead - timezone.now()).total_seconds()))
    task_queue_port().enqueue(EVENT_REMINDER_TASK, {"event_id": str(event.id)}, delay_seconds=delay)
    logger.info(
        "notifications.reminder_scheduled",
        extra={"event_id": str(event.id), "delay_seconds": delay},
    )


# --- the refund REQUEST lifecycle ------------------------------------------
#
# Three handlers, three audiences. None of them says "your refund happened" —
# that is `handle_payment_refunded` above, which fires on PAYMENT_REFUNDED once
# money has ACTUALLY moved. A request is a conversation; a refund is a fact, and
# conflating them is how a customer is told their money is back before it is.


def _refund_request_context(request) -> dict:
    """The facts all three messages are rendered from, read once."""
    booking = request.booking
    return {
        "name": booking.user.full_name,
        "customer_email": booking.user.email,
        "customer_name": request.requested_by.full_name,
        "event_title": booking.event.title,
        "booking_reference": str(booking.id),
        "amount_display": _amount_display(booking.total_amount_minor),
        "reason": request.reason,
        "note": request.decision_note,
    }


def _load_request(refund_request_id: str, log_key: str):
    from apps.payments.repositories import RefundRequestRepository

    request = RefundRequestRepository().get_for_decision(refund_request_id)
    if request is None:
        logger.warning(log_key, extra={"refund_request_id": refund_request_id})
    return request


def handle_refund_requested(payload: dict) -> None:
    """REFUND_REQUESTED -> tell the ORGANIZER somebody is waiting.

    Sent to the organization's owner, resolved from the event rather than taken
    from the payload: the payload's `organizer_id` is a convenience for
    consumers that only need an id, and re-reading here means one source of
    truth for who actually owns the event today.
    """
    from config.di import build_notification_service

    request_id = payload["refund_request_id"]
    request = _load_request(request_id, "notifications.refund_request.missing")
    if request is None:
        return

    owner = request.booking.event.organization.owner
    build_notification_service().notify(
        notification_type=NotificationType.REFUND_REQUEST_RECEIVED,
        recipient=owner.email,
        context=_refund_request_context(request),
        # Keyed on the REQUEST id, which is unique by construction — never on a
        # timestamp. A key that includes "now" collides for two requests in the
        # same second and gets one of them swallowed by the idempotency ledger,
        # which is exactly the bug the email-verification flow hit once.
        dedupe_key=f"refundreq:{request_id}:email:{owner.email}",
    )


def handle_refund_request_approved(payload: dict) -> None:
    """REFUND_REQUEST_APPROVED -> tell the CUSTOMER it is being processed.

    Deliberately NOT "you have been refunded". Approval enqueues the vendor
    call; `PAYMENT_REFUNDED` fires the confirmation once the money has moved.
    """
    from config.di import build_notification_service

    request_id = payload["refund_request_id"]
    request = _load_request(request_id, "notifications.refund_request_approved.missing")
    if request is None:
        return

    recipient = request.requested_by.email
    build_notification_service().notify(
        notification_type=NotificationType.REFUND_REQUEST_APPROVED,
        recipient=recipient,
        context=_refund_request_context(request),
        dedupe_key=f"refundreq_approved:{request_id}:email:{recipient}",
    )


def handle_refund_request_rejected(payload: dict) -> None:
    """REFUND_REQUEST_REJECTED -> tell the CUSTOMER, with the reason.

    The reason is the whole message. The service refuses a rejection without
    one, so `decision_note` is always populated by the time this runs.
    """
    from config.di import build_notification_service

    request_id = payload["refund_request_id"]
    request = _load_request(request_id, "notifications.refund_request_rejected.missing")
    if request is None:
        return

    recipient = request.requested_by.email
    build_notification_service().notify(
        notification_type=NotificationType.REFUND_REQUEST_REJECTED,
        recipient=recipient,
        context=_refund_request_context(request),
        dedupe_key=f"refundreq_rejected:{request_id}:email:{recipient}",
    )


def handle_event_deleted_by_operator(payload: dict) -> None:
    """EVENT_DELETED_BY_OPERATOR -> tell the attendees AND the organizer.

    Two audiences, two messages, and neither is the other's with a word
    changed. The ATTENDEE is told their event is off and their money is coming
    back; the ORGANIZER is told their event was removed and why.

    The attendee list rides on the PAYLOAD rather than being re-queried,
    because by the time this runs the event is already soft-deleted — every
    read in `EventRepository` filters `deleted_at__isnull=True`, so a re-query
    here would find nothing and silently email nobody.

    Deduped per (event, recipient), so re-running a deletion — or a queue
    redelivery — cannot send somebody a second cancellation for the same event.
    """
    from config.di import build_notification_service

    service = build_notification_service()
    event_id = payload["event_id"]
    context = {
        "event_title": payload.get("title", ""),
        "reason": payload.get("reason", ""),
        "refunded_bookings": payload.get("refunded_bookings", 0),
        "booking_reference": "",
    }

    for email in payload.get("attendee_emails", []) or []:
        service.notify(
            notification_type=NotificationType.EVENT_CANCELLED_ATTENDEE,
            recipient=email,
            context={**context, "name": ""},
            dedupe_key=f"event_cancelled:{event_id}:email:{email}",
        )

    owner_email = payload.get("owner_email", "")
    if owner_email:
        service.notify(
            notification_type=NotificationType.EVENT_DELETED_ORGANIZER,
            recipient=owner_email,
            context=context,
            dedupe_key=f"event_deleted:{event_id}:email:{owner_email}",
        )


def handle_event_cancelled_by_organizer(payload: dict) -> None:
    """EVENT_CANCELLED_BY_ORGANIZER -> tell the attendees.

    The SAME message an operator deletion sends them, deliberately. From a
    ticket holder's side the two are one fact — the event is off and their
    money is coming back — and two differently-worded cancellation emails for
    the same outcome is how one of them ends up out of date about the refund
    timing, which is the line people actually read.

    No organizer email here, unlike the deletion path: they are the ones who
    just pressed the button. Telling somebody what they did a second later is
    the kind of message that trains people to ignore the sender.

    Deduped per (event, recipient), so a queue redelivery cannot send a second
    cancellation for the same event.
    """
    from config.di import build_notification_service

    service = build_notification_service()
    event_id = payload["event_id"]

    for email in payload.get("attendee_emails", []) or []:
        service.notify(
            notification_type=NotificationType.EVENT_CANCELLED_ATTENDEE,
            recipient=email,
            context={
                "event_title": payload.get("title", ""),
                "reason": payload.get("reason", ""),
                "refunded_bookings": payload.get("refunded_bookings", 0),
                "booking_reference": "",
                "name": "",
                # The organiser wrote this FOR the attendees — the endpoint
                # requires it and says so on the form — so it is forwarded.
                # The operator-deletion path deliberately does not set it: an
                # operator's note is written for the ORGANISER, and passing it
                # on would publish an internal judgement to a customer.
                "attendee_reason": payload.get("reason", ""),
            },
            # The SAME key shape the deletion path uses. An event that is
            # cancelled and then deleted must not email everybody twice for
            # what is, to them, one event being called off.
            dedupe_key=f"event_cancelled:{event_id}:email:{email}",
        )


def handle_hire_enquiry_created(payload: dict) -> None:
    """PERFORMER_REQUEST_CREATED -> tell the operator, and acknowledge to the customer.

    ── THIS IS THE DELIVERY MECHANISM, NOT A NOTIFICATION ABOUT ONE ──────

    When this was a marketplace, a brief was matched to listed acts and the
    performers were the ones who acted on it; an operator alert would have been
    a courtesy. There is no supply side now, so this email IS how the enquiry
    reaches anybody. If it is not sent, or the ops mailbox is unset, the
    customer hears nothing at all — which is why the operator half runs first
    and logs loudly when there is nowhere to send it.

    The customer's acknowledgement is second and is not conditional on the
    first: an unset ops mailbox is an operator's problem, and it must not also
    leave the customer wondering whether the form worked.
    """
    from apps.performers.repositories import BookingRequestRepository

    request_id = str(payload["request_id"])
    enquiry = BookingRequestRepository().get_by_id(request_id)
    if enquiry is None:
        logger.warning("notifications.hire_enquiry.missing", extra={"request_id": request_id})
        return

    context = {
        "performer_type": enquiry.get_performer_type_display(),
        "city": enquiry.city,
        "event_date": enquiry.event_date.isoformat(),
        "contact_name": enquiry.contact_name,
        "contact_phone": enquiry.contact_phone,
        "contact_email": enquiry.contact_email,
        "budget": (
            f"{_amount_display(enquiry.budget_min_minor)} - "
            f"{_amount_display(enquiry.budget_max_minor)}"
        ),
    }

    if not _no_operator_configured("hire_enquiry"):
        _alert_admins(
            notification_type=NotificationType.ADMIN_HIRE_ENQUIRY,
            context=context,
            dedupe_scope=f"hire_enquiry:{request_id}",
        )

    # The address they asked to be contacted on, which is not always the
    # account's — the bride's account, the planner's inbox.
    recipient = enquiry.contact_email or (enquiry.customer.email if enquiry.customer_id else "")
    if recipient:
        from config.di import build_notification_service

        build_notification_service().notify(
            notification_type=NotificationType.HIRE_ENQUIRY_RECEIVED,
            recipient=recipient,
            context=context,
            dedupe_key=f"hire_enquiry_ack:{request_id}:email:{recipient}",
        )


def handle_booking_receipt_shared(payload: dict) -> None:
    """Mail the buyer's receipt to each person they named.

    One `notify` per recipient, each with its own dedupe key, so a redelivered
    outbox event cannot send anybody a second copy — and so one bad address
    cannot stop the others going out.
    """
    from config.di import build_notification_service

    service = build_notification_service()
    booking_id = payload["booking_id"]
    for email in payload.get("recipients", []):
        service.notify(
            notification_type=NotificationType.BOOKING_RECEIPT_SHARED,
            recipient=email,
            context={
                "booker_name": payload.get("booker_name") or "Someone",
                "event_title": payload["event_title"],
                "event_when": _when_display(payload["event_when"]),
                "event_where": payload["event_where"],
                "booking_reference": payload["booking_reference"],
                "total_display": _amount_display(int(payload["total_minor"])),
                "note": payload.get("note") or "",
                "receipt_pdf_b64": payload.get("receipt_pdf_b64") or "",
            },
            dedupe_key=f"receipt_shared:{booking_id}:email:{email}",
        )


def _when_display(iso: str) -> str:
    """The event's start, in words. Falls back to the raw value rather than
    raising: a malformed timestamp should cost a nicely formatted date, not the
    whole receipt."""
    from datetime import datetime

    try:
        return datetime.fromisoformat(iso).strftime("%a, %d %b %Y at %I:%M %p").replace(" 0", " ")
    except (TypeError, ValueError):
        return str(iso)
