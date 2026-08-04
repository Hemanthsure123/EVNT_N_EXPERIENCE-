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

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings

from core.ports.email_port import EmailAttachment

from . import email_layout as ui
from .exceptions import TemplateMissingError, UnknownNotificationTypeError
from .models import NotificationChannel, NotificationType
from .ticket_pdf import PdfBooking, PdfPayment, PdfTicket, build_ticket_pdf

logger = logging.getLogger(__name__)


def _display_timezone() -> ZoneInfo:
    """The zone outbound copy renders times in — IST by default.

    An unknown zone name falls back to UTC rather than raising. This is called
    while rendering a ticket email; a typo in an env var must degrade the label
    on the message, never dead-letter the ticket somebody has paid for.
    """
    name = str(getattr(settings, "NOTIFICATION_DISPLAY_TIMEZONE", "") or "UTC")
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.error("notifications.display_timezone.unknown", extra={"timezone": name})
        return ZoneInfo("UTC")


def format_when(dt: datetime) -> str:
    """One place that formats an event's start time for human-readable copy, so
    every template/handler renders it the same way.

    ── IT RENDERS IN LOCAL TIME, NOT UTC ─────────────────────────────────────

    The database stores UTC and must keep storing UTC. A PERSON reads a start
    time, and the person reading this one is standing outside a venue in India
    holding a ticket. This used to print `%H:%M UTC`, which put the ticket
    email and the ticket PDF five and a half hours away from the event page
    they were bought from — on the two artifacts nobody can check against
    anything else.

    The zone label is printed (`%Z` -> "IST") rather than assumed. A time with
    no zone on a forwarded ticket is a time somebody has to guess at.

    A naive datetime is read as UTC, which is what `USE_TZ=False` code paths
    and hand-built test fixtures produce. Guessing local instead would silently
    shift a correct time.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=dt_timezone.utc)
    return dt.astimezone(_display_timezone()).strftime("%a %d %b %Y, %H:%M %Z")


@dataclass(frozen=True)
class RenderedMessage:
    subject: str  # blank for SMS; the TITLE for push
    body: str
    #: Where tapping this notification should land. Only push uses it — a
    #: notification with nowhere to go is a dead end, and the tray gives no
    #: second chance to explain. Email puts its links in the body instead, so
    #: this stays blank there rather than duplicating one of them.
    url: str = ""
    #: The HTML alternative, for email only. Blank on every other channel and
    #: on any email type that has not been given one — `body` is always sent,
    #: so a blank here is a plainer message, never a missing one.
    html: str = ""
    #: Files to send alongside. Email only, and only where the message is
    #: strictly better with them — currently just the ticket PDF. The message
    #: must always stand up without them (see `EmailPort.send`).
    attachments: tuple[EmailAttachment, ...] = ()


# Which channel each type is delivered on. The single source of truth for
# routing — the service reads channel straight off the type.
CHANNEL_BY_TYPE: dict[str, str] = {
    NotificationType.WELCOME: NotificationChannel.EMAIL,
    NotificationType.TICKET_DELIVERY: NotificationChannel.EMAIL,
    NotificationType.ATTENDEE_TICKET: NotificationChannel.EMAIL,
    NotificationType.BOOKING_CONFIRMATION_SMS: NotificationChannel.SMS,
    NotificationType.REFUND_CONFIRMATION: NotificationChannel.EMAIL,
    NotificationType.REFUND_CONFIRMATION_SMS: NotificationChannel.SMS,
    NotificationType.OTP: NotificationChannel.SMS,
    NotificationType.EMAIL_VERIFICATION: NotificationChannel.EMAIL,
    NotificationType.EVENT_REMINDER: NotificationChannel.EMAIL,
    NotificationType.EVENT_REMINDER_PUSH: NotificationChannel.PUSH,
    NotificationType.BOOKING_CONFIRMED_PUSH: NotificationChannel.PUSH,
    NotificationType.PAYOUT_RELEASED: NotificationChannel.EMAIL,
    # Operator alerts. EMAIL only, and deliberately not SMS or push: an
    # approval is desk work done in a console, so waking somebody's phone for
    # it is how an operations channel gets muted — and the message has to
    # carry a link, a name and an id that nobody types off a lock screen.
    NotificationType.ADMIN_EVENT_REVIEW: NotificationChannel.EMAIL,
    NotificationType.ADMIN_ORG_VERIFICATION: NotificationChannel.EMAIL,
    NotificationType.ADMIN_PERFORMER_REVIEW: NotificationChannel.EMAIL,
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


def _site_url() -> str:
    """The public site origin, or "" when it is not configured.

    Blank means the email simply omits its button rather than rendering one
    that points at nothing. A dead call-to-action in a transactional email is
    worse than no button: it reads as the product being broken.
    """
    return str(getattr(settings, "PUBLIC_SITE_URL", "") or "").rstrip("/")


#: The product name, matching frontend/lib/brand.ts BRAND_NAME. Subject lines
#: are the one place the brand is read before anything is rendered, so they
#: must not drift from the wordmark in the masthead — the welcome subject used
#: to say "Event & Experience Platform", which is a second product name.
BRAND_NAME = ui.PRODUCT_NAME


def _welcome(ctx: dict) -> RenderedMessage:
    name = ctx.get("name") or ctx["email"]
    site = _site_url()
    blocks = [
        ui.heading(f"Welcome, {name}."),
        ui.paragraph(
            f"Your {BRAND_NAME} account is ready. Browse what is on near you, book in a "
            f"few taps, and every ticket you buy stays in your account."
        ),
        # Three true statements about capabilities that exist. Nothing here is
        # a promise about a feature that has not been built.
        ui.items(
            [
                "Search by city, date or category to find what is on.",
                "Book tickets and pay securely — your seats are held while you do.",
                "Your tickets live in your account, ready to be scanned at the gate.",
            ],
            title="What you can do now",
        ),
    ]
    if site:
        blocks.append(ui.button("Discover events", f"{site}/events"))
    blocks.append(
        ui.callout(
            "We will email you a ticket the moment a booking is confirmed. Keep an eye "
            "on this address."
        )
    )
    return RenderedMessage(
        subject=f"Welcome to {BRAND_NAME}",
        body=(
            f"Hi {name},\n\n"
            f"Welcome to {BRAND_NAME} — your account is ready.\n\n"
            f"- Search by city, date or category to find what is on.\n"
            f"- Book tickets and pay securely.\n"
            f"- Your tickets live in your account, ready to be scanned at the gate.\n\n"
            + (f"Start here: {site}/events\n\n" if site else "")
            + "We will email you a ticket the moment a booking is confirmed."
        ),
        html=ui.render_email(
            title=f"Welcome to {BRAND_NAME}",
            preheader="Your account is ready — find something to go to.",
            masthead_label="Welcome",
            blocks=blocks,
        ),
    )


def _payment_block(ctx: dict) -> PdfPayment | None:
    """The payment facts, if the caller carried any.

    OPTIONAL by design. `handlers.handle_booking_confirmed` loads the booking
    and the user; it does not load the payment row, and this module must not
    reach across and do it — a handler gathers cross-module context, a
    template renders what it is given. Absent, the receipt simply has no
    payment block; nothing is invented to fill it.
    """
    raw = ctx.get("payment")
    if not isinstance(raw, dict):
        return None
    block = PdfPayment(
        amount_display=str(raw.get("amount_display") or ""),
        platform_fee_display=str(raw.get("platform_fee_display") or ""),
        reference=str(raw.get("reference") or ""),
        method=str(raw.get("method") or ""),
        paid_at=str(raw.get("paid_at") or ""),
        status_label=str(raw.get("status_label") or ""),
    )
    return block if block.has_content() else None


def _tier_label(ticket: dict) -> str:
    """ "Gold — Early bird — ₹300.00 each": the tier, the sale phase that priced
    it, and what that line was actually billed.

    ONE function for both renderers — the email lists these with a count in
    front and the PDF puts the same string in each page's "Ticket type" cell.
    Two builders would be two answers to "what is this seat called", on the two
    artifacts a buyer compares when a charge looks wrong.

    Phase and price are each OMITTED when absent rather than filled in: an item
    that billed at the tier's face price has no phase name (that is what NULL
    means on `BookingItem.phase_name`), and a caller that has not been updated
    carries no price. Neither is inferred.
    """
    label = str(ticket["ticket_type"])
    phase = str(ticket.get("phase_name") or "").strip()
    price = str(ticket.get("unit_price_display") or "").strip()
    if phase:
        label = f"{label} — {phase}"
    if price:
        label = f"{label} — {price} each"
    return label


def _tier_lines(tickets: list[dict]) -> list[str]:
    """ "2 × Gold — Early bird — ₹300.00 each" — counted, not enumerated.

    A numbered list of every admission is the same tier name printed four
    times; the fact somebody wants is how many of each they bought, and at what
    price. Insertion order is preserved so the list reads in the order the tiers
    were chosen.
    """
    counts: dict[str, int] = {}
    for ticket in tickets:
        label = _tier_label(ticket)
        counts[label] = counts.get(label, 0) + 1
    return [f"{count} × {label}" for label, count in counts.items()]


def _ticket_delivery(ctx: dict) -> RenderedMessage:
    name = ctx.get("name") or "there"
    tickets: list[dict] = list(ctx["tickets"])
    count = len(tickets)
    plural = "s" if count != 1 else ""
    reference = str(ctx["booking_reference"])
    site = _site_url()
    payment = _payment_block(ctx)

    # ── the plain-text part ─────────────────────────────────────────────
    #
    # It carries the signed tokens, and that matters MORE than it used to.
    # The PDF no longer draws a QR (see ticket_pdf.py), so this text part is
    # now the only copy of the credential that survives without the app.
    lines = [
        f"Hi {name}, your ticket{plural} for {ctx['event_title']} {'are' if count != 1 else 'is'}"
        " confirmed.",
        "",
        f"Event:   {ctx['event_title']}",
        f"When:    {ctx['event_when']}",
        f"Where:   {ctx['event_where']}",
        f"Booking: {reference}",
    ]
    if payment is not None and payment.amount_display:
        lines.append(f"Paid:    {payment.amount_display}")
    lines += [
        "",
        f"Your ticket{plural}:",
    ]
    for i, ticket in enumerate(tickets, start=1):
        lines.append(f"  {i}. {ticket['ticket_type']} — QR: {ticket['qr_token']}")
    lines += [
        "",
        "One scan admits one person. Show the code from your account at the gate;",
        "the codes above are your backup.",
    ]
    if site:
        lines += ["", f"Your tickets: {site}/account/tickets"]

    # ── the HTML part ───────────────────────────────────────────────────
    facts_rows = [
        ("Where", str(ctx["event_where"])),
        ("Booking reference", reference),
    ]
    if payment is not None and payment.amount_display:
        facts_rows.append(("Amount paid", payment.amount_display))

    blocks = [
        ui.heading(str(ctx["event_title"])),
        ui.paragraph(
            f"Hi {name}, you're going. {count} ticket{plural} confirmed — here is "
            f"everything you need."
        ),
        # ONE hero: the start time. It is the fact somebody has to act on, and
        # the only one on this page that has a deadline attached to it.
        ui.hero(label="Starts", value=str(ctx["event_when"])),
        ui.facts(facts_rows),
        ui.items(_tier_lines(tickets), title=f"{count} ticket{plural}"),
    ]
    if site:
        # The QR codes themselves are NOT in the HTML part, and are no longer
        # in the PDF either. An emailed QR is forwardable and screenshot-able,
        # and this inbox is not necessarily still the ticket holder's — the
        # account page is the copy that stops working when a booking is
        # refunded, which is the whole point of sending people to it.
        blocks.append(ui.button(f"View my ticket{plural}", f"{site}/account/tickets"))
    blocks.append(
        ui.callout(
            "One scan admits one person. Bring a photo ID that matches the booking "
            "name, and open your ticket before you reach the gate."
        )
    )

    # The PDF is built HERE, at render time, for exactly the reason the HTML
    # is: `dispatch` is a pure send of what was decided at claim time, so a
    # template change can never alter a message already claimed.
    #
    # A failure to build must NOT lose the email. The QR tokens are in `body`
    # and the account link is in the HTML, so a missing attachment degrades
    # this message; raising here would dead-letter the single most important
    # notification in the system over a layout bug.
    attachments: tuple[EmailAttachment, ...] = ()
    try:
        pdf = build_ticket_pdf(
            event_title=str(ctx["event_title"]),
            event_when=str(ctx["event_when"]),
            event_where=str(ctx["event_where"]),
            booking_reference=reference,
            tickets=[
                PdfTicket(
                    ticket_type=_tier_label(t),
                    qr_token=str(t.get("qr_token") or ""),
                    attendee=str(t.get("attendee") or ""),
                )
                for t in tickets
            ],
            booking=PdfBooking(
                reference=reference,
                issued_at=str(ctx.get("issued_at") or ""),
                attendee=str(ctx.get("attendee") or ""),
            ),
            payment=payment,
            site_url=site,
            # Both blank unless the handler carried them, and blank draws
            # nothing — the PDF omits a row rather than printing an empty one.
            organizer=str(ctx.get("organizer_name") or ""),
            maps_url=str(ctx.get("maps_url") or ""),
        )
    except Exception:  # noqa: BLE001 — deliberate: see the note above
        logger.exception(
            "notifications.ticket_pdf.failed",
            extra={"booking_reference": ctx.get("booking_reference")},
        )
    else:
        attachments = (
            EmailAttachment(
                filename=f"curatix-booking-{reference}.pdf",
                content=pdf,
                content_type="application/pdf",
            ),
        )
        blocks.append(
            ui.paragraph(
                "A PDF copy of this booking — event, reference and payment details — "
                "is attached. It is a receipt, not an entry pass: the scannable code "
                f"is in your {BRAND_NAME} account.",
                muted=True,
            )
        )

    return RenderedMessage(
        subject=f"Your ticket{plural} for {ctx['event_title']}",
        body="\n".join(lines),
        attachments=attachments,
        html=ui.render_email(
            title=f"Your ticket{plural}",
            preheader=f"{ctx['event_title']} — {ctx['event_when']}",
            masthead_label="E-ticket",
            blocks=blocks,
        ),
    )


def _attendee_ticket(ctx: dict) -> RenderedMessage:
    """ONE ticket, sent to the person it admits.

    ── WHY THIS IS NOT `_ticket_delivery` WITH A DIFFERENT ADDRESS ───────────

    The reader is a guest the buyer named. They very likely have no account
    here, they did not pay, and they are one of several people on one booking.
    So three things that belong in the buyer's email must NOT be in this one:

    - **The money.** They did not pay and the amount is not theirs to see. No
      payment block, no total, no fee line.
    - **The other guests' codes.** The buyer's email carries every token,
      which is correct for the person who bought them and wrong for everybody
      else — forwarding one guest a mail containing nine other admissions is
      precisely the leak this whole feature exists to remove.
    - **The booking's management links.** There is nothing here for them to
      manage; a link to an account page they cannot sign into is a dead end.

    What they get instead is exactly what they need at a gate: which event,
    when, where, who the ticket is for, and their own signed token. No PDF
    either — the attachment is a RECEIPT, and a receipt is the buyer's
    document.
    """
    attendee = str(ctx.get("attendee_name") or "there")
    booked_by = str(ctx.get("booked_by") or "").strip()
    title = str(ctx["event_title"])
    token = str(ctx.get("qr_token") or "")

    intro = (
        f"{booked_by} has booked you a ticket for {title}."
        if booked_by
        else f"You have a ticket for {title}."
    )

    lines = [
        f"Hi {attendee}, {intro}",
        "",
        f"Event: {title}",
        f"When:  {ctx['event_when']}",
        f"Where: {ctx['event_where']}",
        f"Ticket: {ctx.get('ticket_type') or 'Admission'}",
        "",
        "Show this code at the gate — it admits one person, once:",
        f"  {token}",
        "",
        "You do not need an account to use it.",
    ]

    blocks = [
        ui.heading(title),
        ui.paragraph(f"Hi {attendee}, {intro} Here is everything you need to get in."),
        ui.hero(label="Starts", value=str(ctx["event_when"])),
        ui.facts(
            [
                ("Where", str(ctx["event_where"])),
                ("Ticket", str(ctx.get("ticket_type") or "Admission")),
                ("Admits", attendee),
            ]
        ),
        # The token as a list entry, NOT `code_panel`: that primitive is built
        # for a six-digit code at 36px with letter-spacing, and a signed ticket
        # token is ~180 characters — it would render as an unreadable wall.
        #
        # For THIS reader it is the only copy that exists. The buyer can open
        # their account and show a rendered QR; a guest who has never signed in
        # cannot, so the text token is their entry, and the gate scanner accepts
        # it either way (the code encodes exactly this string).
        ui.items([token], title="Your entry code"),
        ui.callout(
            "One scan admits one person. Bring a photo ID. You do not need an "
            "account — this code is your entry."
        ),
    ]

    return RenderedMessage(
        subject=f"Your ticket for {title}",
        body="\n".join(lines),
        html=ui.render_email(
            title="Your ticket",
            preheader=f"{title} — {ctx['event_when']}",
            masthead_label="E-ticket",
            blocks=blocks,
        ),
    )


def _booking_confirmation_sms(ctx: dict) -> RenderedMessage:
    return RenderedMessage(
        subject="",
        body=(
            f"Your booking {ctx['booking_reference']} for {ctx['event_title']} is confirmed "
            f"({ctx['ticket_count']} ticket(s)). Check your email for tickets."
        ),
    )


def _refund_confirmation(ctx: dict) -> RenderedMessage:
    name = ctx.get("name") or "there"
    site = _site_url()
    blocks = [
        ui.heading("Your refund is on its way"),
        ui.paragraph(
            f"Hi {name}, we have sent this refund back to the card or account you "
            f"paid with. Nothing else is needed from you."
        ),
        # ONE hero: the amount. It is the only number anybody opens a refund
        # email to check.
        ui.hero(
            label="Refund amount",
            value=str(ctx["amount_display"]),
            sub="Returned to your original payment method",
        ),
        ui.facts(
            [
                ("Event", str(ctx["event_title"])),
                ("Booking reference", str(ctx["booking_reference"])),
            ]
        ),
    ]
    if site:
        blocks.append(ui.button("View your bookings", f"{site}/account/tickets"))
    blocks.append(
        # Says the bank's part out loud. "Where is my money" is the single most
        # common support ticket after a refund, and the answer is almost always
        # that the bank has not posted it yet.
        ui.callout(
            "Banks usually post a refund within 5-7 working days. It will appear on "
            "the card or account you paid with, and any tickets on this booking are "
            "no longer valid for entry."
        )
    )
    return RenderedMessage(
        subject=f"Refund processed for {ctx['event_title']}",
        body=(
            f"Hi {name},\n\n"
            f"Your refund of {ctx['amount_display']} has been processed.\n\n"
            f"Event:   {ctx['event_title']}\n"
            f"Booking: {ctx['booking_reference']}\n\n"
            f"It goes back to the card or account you paid with, and banks usually "
            f"post it within 5-7 working days. Any tickets on this booking are no "
            f"longer valid for entry."
        ),
        html=ui.render_email(
            title="Refund processed",
            preheader=f"{ctx['amount_display']} is on its way back to you.",
            masthead_label="Refund",
            blocks=blocks,
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


def _email_verification(ctx: dict) -> RenderedMessage:
    """The code that proves an address at registration.

    The code is in the SUBJECT as well as the body on purpose: most phone mail
    clients show enough of the subject in the notification to read it without
    opening the message, which removes an app switch from the slowest step of
    signing up.

    No link. A verification LINK in email is phishable — it trains people to
    click whatever arrives claiming to be us — and it cannot be completed on a
    different device from the one that started the sign-up. A code the user
    types works in both cases and teaches nothing dangerous.
    """
    code = str(ctx["code"])
    ttl = ctx["ttl_minutes"]
    return RenderedMessage(
        subject=f"{code} is your {BRAND_NAME} verification code",
        body=(
            f"Hi {ctx['full_name']},\n\n"
            f"Your verification code is {code}.\n"
            f"It expires in {ttl} minutes.\n\n"
            f"Never share this code with anyone — we will never ask you for it.\n\n"
            f"If you did not create a {BRAND_NAME} account, you can ignore this "
            f"email; nothing has been activated."
        ),
        html=ui.render_email(
            title="Verify your email",
            # The code, in the preview line. Somebody on a phone can read it
            # from the notification without opening the message at all — which
            # removes an app switch from the slowest step of signing up.
            preheader=f"{code} — expires in {ttl} minutes.",
            masthead_label="Verify",
            blocks=[
                ui.heading("Confirm your email address"),
                ui.paragraph(
                    f"Hi {ctx['full_name']}, enter this code to finish setting up your "
                    f"account. There is no link to click — and there never will be."
                ),
                # The code IS the hero here, so it gets the panel rather than a
                # `hero()` block: it is read digit by digit and typed, which
                # wants monospace and letter-spacing, not a headline.
                ui.code_panel(code, caption=f"Expires in {ttl} minutes"),
                ui.callout(
                    f"Never share this code with anyone — {BRAND_NAME} will never ask "
                    f"you for it. If you did not create an account, you can ignore "
                    f"this email; nothing has been activated."
                ),
            ],
        ),
    )


def _event_reminder(ctx: dict) -> RenderedMessage:
    name = ctx.get("name") or "there"
    site = _site_url()
    blocks = [
        ui.heading(str(ctx["event_title"])),
        ui.paragraph(f"Hi {name}, this is your reminder — it is nearly here."),
        # ONE hero: when it starts. A reminder that buries the time under a
        # greeting is a reminder somebody has to read to use.
        ui.hero(label="Starts", value=str(ctx["event_when"]), sub=str(ctx["event_where"])),
    ]
    if site:
        blocks.append(ui.button("View my ticket", f"{site}/account/tickets"))
    blocks.append(
        ui.callout(
            "Open your ticket before you reach the gate — the scannable code is in "
            "your account, and the queue is a bad place to discover you have no signal."
        )
    )
    return RenderedMessage(
        subject=f"Reminder: {ctx['event_title']} is coming up",
        body=(
            f"Hi {name},\n\n"
            f"{ctx['event_title']} is nearly here.\n\n"
            f"When:  {ctx['event_when']}\n"
            f"Where: {ctx['event_where']}\n\n"
            + (f"Your ticket: {site}/account/tickets\n\n" if site else "")
            + "Open your ticket before you reach the gate. See you there."
        ),
        html=ui.render_email(
            title="Coming up",
            preheader=f"{ctx['event_when']} · {ctx['event_where']}",
            masthead_label="Reminder",
            blocks=blocks,
        ),
    )


def _booking_confirmed_push(ctx: dict) -> RenderedMessage:
    """ "Your tickets are ready", on a lock screen, the moment payment clears.

    This is the one notification somebody is actively WAITING for — they have
    just pressed pay and are watching a spinner — so it exists to end that
    wait, not to describe the booking. Which event, how many tickets, and a
    tap that lands on the tickets themselves.

    The `url` is the point of a push. A notification with nowhere to go is a
    dead end, and the tray gives no second chance to explain.
    """
    count = int(ctx.get("ticket_count") or 0)
    return RenderedMessage(
        subject=f"{count} ticket{'s' if count != 1 else ''} confirmed",
        body=f"{ctx['event_title']} — tap to open your QR ticket{'s' if count != 1 else ''}.",
        url=ctx.get("url", ""),
    )


def _event_reminder_push(ctx: dict) -> RenderedMessage:
    """The same reminder, sized for a notification tray.

    A push is read on a lock screen in about a second, so it says the one
    thing that makes somebody act — which event, and when — and nothing else.
    The email version can afford the greeting and the venue; this cannot, and
    padding it out is how a useful notification becomes one people turn off.

    `subject` carries the push TITLE. The field is named for email because
    email came first; the alternative was a second rendered-message shape for
    one extra channel.
    """
    return RenderedMessage(
        subject=ctx["event_title"],
        body=f"Starts {ctx['event_when']} · {ctx['event_where']}",
        url=ctx.get("url", ""),
    )


def _payout_released(ctx: dict) -> RenderedMessage:
    name = ctx.get("name") or "there"
    site = _site_url()
    blocks = [
        ui.heading("Your payout has been released"),
        ui.paragraph(
            f"Hi {name}, the funds for this event are on their way to the account you "
            f"linked. This is the full amount owed after the platform fee and any "
            f"refunds — nothing further is held back."
        ),
        # ONE hero: the amount released. An organizer opens this to check one
        # number against their own arithmetic.
        ui.hero(
            label="Amount released",
            value=str(ctx["amount_display"]),
            sub="To your linked payout account",
        ),
        ui.facts(
            [
                ("Event", str(ctx["event_title"])),
                ("Payout reference", str(ctx["provider_ref"])),
            ]
        ),
    ]
    if site:
        blocks.append(ui.button("Open your payouts", f"{site}/dashboard/payouts"))
    blocks.append(ui.paragraph(f"Thanks for hosting on {BRAND_NAME}.", muted=True))
    return RenderedMessage(
        subject=f"You've been paid out for {ctx['event_title']}",
        body=(
            f"Hi {name},\n\n"
            f"Your payout of {ctx['amount_display']} has been released to your linked "
            f"account.\n\n"
            f"Event:     {ctx['event_title']}\n"
            f"Reference: {ctx['provider_ref']}\n\n"
            f"This is the full amount owed after the platform fee and any refunds.\n"
            + (f"\nYour payouts: {site}/dashboard/payouts\n" if site else "")
            + f"\nThanks for hosting on {BRAND_NAME}."
        ),
        html=ui.render_email(
            title="Payout released",
            preheader=f"{ctx['amount_display']} released for {ctx['event_title']}.",
            masthead_label="Payout",
            blocks=blocks,
        ),
    )


# --- operator alerts -------------------------------------------------------
#
# All three say the same four things — what is waiting, who submitted it, which
# row it is, and one link to the queue where it is decided — so they are built
# from one function rather than three near-copies that drift apart.
#
# ── WHAT THESE MAY CARRY ─────────────────────────────────────────────────
#
# The recipient is a platform operator, and the alert carries only what the
# decision needs: the thing's title, the submitter's address, its id, and the
# link. That is a strict subset of what the console already shows them on the
# row they are about to open, so the email adds no exposure — but it is also a
# message that gets forwarded, so it deliberately holds no buyer, ticket or
# money data, none of which an approval decision uses.


def _admin_alert(
    *,
    subject: str,
    preheader: str,
    heading_text: str,
    lead: str,
    facts_rows: list[tuple[str, str]],
    queue_label: str,
    queue_path: str,
    note: str,
) -> RenderedMessage:
    site = _site_url()
    text_lines = [lead, ""]
    text_lines += [f"{label}: {value}" for label, value in facts_rows]
    if site:
        text_lines += ["", f"{queue_label}: {site}{queue_path}"]
    text_lines += ["", note]

    blocks = [
        # The eyebrow is the whole point of an operations alert in a busy
        # mailbox: it says this one needs a person before the subject line has
        # been read properly.
        ui.eyebrow("Action required"),
        ui.heading(heading_text),
        ui.paragraph(lead),
        # ONE hero: what is waiting, by name. `facts_rows[0]` is the thing
        # itself on all three alerts (the event, the organization, the act) —
        # the id and the submitter are lookups, not the headline.
        ui.hero(label=facts_rows[0][0], value=facts_rows[0][1]),
        ui.facts(facts_rows[1:]) if len(facts_rows) > 1 else "",
    ]
    if site:
        # No button when PUBLIC_SITE_URL is unset — the same rule the welcome
        # email follows. An operations alert whose one action points at nothing
        # is worse than one that just states the facts and lets somebody open
        # the console themselves.
        blocks.append(ui.button(queue_label, f"{site}{queue_path}"))
    blocks.append(ui.callout(note))

    return RenderedMessage(
        subject=subject,
        body="\n".join(text_lines),
        html=ui.render_email(
            title=heading_text,
            preheader=preheader,
            masthead_label="Operations",
            blocks=[block for block in blocks if block],
        ),
    )


def _admin_event_review(ctx: dict) -> RenderedMessage:
    title = str(ctx["event_title"])
    rows = [("Event", title)]
    if ctx.get("submitted_by"):
        rows.append(("Submitted by", str(ctx["submitted_by"])))
    rows.append(("Event ID", str(ctx["event_id"])))
    return _admin_alert(
        subject=f"Review needed: {title}",
        preheader=f"An organiser submitted {title} for review.",
        heading_text="An event is waiting for review",
        lead=(
            "An organiser has submitted an event. It stays invisible to buyers "
            "until somebody approves it."
        ),
        facts_rows=rows,
        queue_label="Open the moderation queue",
        queue_path="/admin/moderation",
        note=(
            "Approving puts the event on sale. Sending it back requires a reason, "
            "which the organiser sees."
        ),
    )


def _admin_org_verification(ctx: dict) -> RenderedMessage:
    name = str(ctx["organization_name"])
    rows = [("Organization", name)]
    if ctx.get("submitted_by"):
        rows.append(("Requested by", str(ctx["submitted_by"])))
    rows.append(("Organization ID", str(ctx["organization_id"])))
    return _admin_alert(
        subject=f"Verification requested: {name}",
        preheader=f"{name} has asked to be verified.",
        heading_text="An organization is waiting for verification",
        lead=(
            "An organizer has asked for their organization to be verified. Until "
            "somebody decides, they cannot put an event on sale."
        ),
        facts_rows=rows,
        queue_label="Open the verification queue",
        queue_path="/admin/verifications",
        note=(
            "Verifying an organization is what lets it take money from buyers. "
            "Check the details against the documents before approving."
        ),
    )


def _admin_performer_review(ctx: dict) -> RenderedMessage:
    name = str(ctx["stage_name"])
    rows = [("Act", name)]
    if ctx.get("submitted_by"):
        rows.append(("Submitted by", str(ctx["submitted_by"])))
    rows.append(("Performer ID", str(ctx["performer_id"])))
    return _admin_alert(
        subject=f"Review needed: {name}",
        preheader=f"{name} has been submitted to the marketplace.",
        heading_text="A performer profile is waiting for review",
        lead=(
            "An act has been submitted to the marketplace. It stays invisible to "
            "customers, and receives no leads, until somebody approves it."
        ),
        facts_rows=rows,
        queue_label="Open the performer queue",
        queue_path="/admin/performers",
        note=(
            "Approving lists the act publicly and starts matching it to briefs. "
            "Sending it back requires a reason, which the owner sees."
        ),
    )


_TEMPLATES: dict[str, Callable[[dict], RenderedMessage]] = {
    NotificationType.WELCOME: _welcome,
    NotificationType.TICKET_DELIVERY: _ticket_delivery,
    NotificationType.ATTENDEE_TICKET: _attendee_ticket,
    NotificationType.BOOKING_CONFIRMATION_SMS: _booking_confirmation_sms,
    NotificationType.REFUND_CONFIRMATION: _refund_confirmation,
    NotificationType.REFUND_CONFIRMATION_SMS: _refund_confirmation_sms,
    NotificationType.OTP: _otp,
    NotificationType.EMAIL_VERIFICATION: _email_verification,
    NotificationType.PAYOUT_RELEASED: _payout_released,
    NotificationType.EVENT_REMINDER: _event_reminder,
    NotificationType.EVENT_REMINDER_PUSH: _event_reminder_push,
    NotificationType.BOOKING_CONFIRMED_PUSH: _booking_confirmed_push,
    NotificationType.ADMIN_EVENT_REVIEW: _admin_event_review,
    NotificationType.ADMIN_ORG_VERIFICATION: _admin_org_verification,
    NotificationType.ADMIN_PERFORMER_REVIEW: _admin_performer_review,
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
