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
    NotificationType.BOOKING_RECEIPT_SHARED: NotificationChannel.EMAIL,
    NotificationType.EVENT_CANCELLED_ATTENDEE: NotificationChannel.EMAIL,
    NotificationType.EVENT_DELETED_ORGANIZER: NotificationChannel.EMAIL,
    # All three refund-REQUEST messages are EMAIL, deliberately not SMS. Each
    # carries a reason somebody wrote in prose, and a DLT-approved 160-character
    # template cannot hold one. "Your refund request was rejected" with no
    # reason attached is worse than sending nothing.
    NotificationType.REFUND_REQUEST_RECEIVED: NotificationChannel.EMAIL,
    NotificationType.REFUND_REQUEST_APPROVED: NotificationChannel.EMAIL,
    NotificationType.REFUND_REQUEST_REJECTED: NotificationChannel.EMAIL,
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
    NotificationType.ADMIN_HIRE_ENQUIRY: NotificationChannel.EMAIL,
    NotificationType.HIRE_ENQUIRY_RECEIVED: NotificationChannel.EMAIL,
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


@dataclass(frozen=True, slots=True)
class _Payment:
    """What was charged, as the handler gathered it.

    This used to be `PdfPayment`, imported from the PDF generator, which made a
    receipt renderer the owner of a shape the EMAIL needed. The PDF is gone
    (see the note on `_ticket_delivery`) and the shape stayed, because the
    facts are the same either way — they just have one renderer now instead of
    two.
    """

    amount_display: str = ""
    platform_fee_display: str = ""
    reference: str = ""
    method: str = ""
    paid_at: str = ""
    status_label: str = ""

    def has_content(self) -> bool:
        return any(
            (
                self.amount_display,
                self.platform_fee_display,
                self.reference,
                self.method,
                self.paid_at,
                self.status_label,
            )
        )


def _payment_block(ctx: dict) -> _Payment | None:
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
    block = _Payment(
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

    The email lists these with a count in front. It was shared with the PDF
    generator, which no longer exists.
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
    """The booking confirmation — one screen, no attachment.

    ── WHY THERE IS NO PDF ANY MORE ──────────────────────────────────────

    This message used to carry a generated PDF with ONE PAGE PER ADMISSION:
    four tickets meant a four-page attachment. Removed by product decision,
    and the decision matches what the category actually does — BookMyShow and
    District both put the booking in the message body and send you to the app
    for the code. Neither attaches a per-ticket document.

    Three things were wrong with the attachment beyond its length:

    1. **Nobody could be admitted with it.** The QR was deliberately not drawn
       (a forwarded attachment must not be a working entry pass), so the PDF
       was a receipt that looked like a ticket — the most confusing possible
       artifact to hand somebody walking to a gate.
    2. **It made the email a covering note.** The facts that matter were in
       the attachment, so the message itself had nothing to say and said it in
       two lines.
    3. **Attachments cost deliverability.** A ~40 KB binary on every booking is
       a spam signal on the one transactional message that must never land in
       a spam folder.

    So the EMAIL is the confirmation now. Everything a buyer needs to file,
    forward or act on is in the body, and one button goes to the place the
    scannable code lives. The plain-text part still carries the signed tokens,
    which is the offline copy the PDF never was.

    ── THE ORDER OF THE SCREEN ───────────────────────────────────────────

    Event, then when, then where, then what was bought, then what was paid,
    then the button. That is descending order of "what would I open this to
    find out", and it means the whole thing reads without scrolling on a
    phone — which is where a booking confirmation is opened.
    """
    name = ctx.get("name") or "there"
    tickets: list[dict] = list(ctx["tickets"])
    count = len(tickets)
    plural = "s" if count != 1 else ""
    reference = str(ctx["booking_reference"])
    site = _site_url()
    payment = _payment_block(ctx)
    organizer = str(ctx.get("organizer_name") or "")
    maps_url = str(ctx.get("maps_url") or "")

    # ── the plain-text part ─────────────────────────────────────────────
    #
    # It carries the signed tokens, and that matters MORE than it used to:
    # with the PDF gone this is the only copy of the credential that survives
    # without the app.
    lines = [
        f"Hi {name}, your ticket{plural} for {ctx['event_title']} "
        f"{'are' if count != 1 else 'is'} confirmed.",
        "",
        f"Event:    {ctx['event_title']}",
        f"When:     {ctx['event_when']}",
        f"Where:    {ctx['event_where']}",
    ]
    if organizer:
        lines.append(f"Hosted by: {organizer}")
    lines.append(f"Booking:  {reference}")
    if payment is not None and payment.amount_display:
        lines.append(f"Paid:     {payment.amount_display}")
    lines += ["", f"Your ticket{plural}:"]
    for i, ticket in enumerate(tickets, start=1):
        lines.append(f"  {i}. {ticket['ticket_type']} - QR: {ticket['qr_token']}")
    lines += [
        "",
        "One scan admits one person. Show the code from your account at the gate;",
        "the codes above are your backup.",
    ]
    if site:
        lines += ["", f"Your tickets: {site}/account/tickets"]
    if maps_url:
        lines += [f"Directions:   {maps_url}"]

    # ── the HTML part ───────────────────────────────────────────────────
    facts_rows = [("Where", str(ctx["event_where"]))]
    if organizer:
        # Who to chase if something is wrong on the day, and the name a card
        # dispute would be opened against. It was in the PDF and nowhere else.
        facts_rows.append(("Hosted by", organizer))
    facts_rows.append(("Booking reference", reference))
    if payment is not None and payment.amount_display:
        facts_rows.append(("Amount paid", payment.amount_display))
    if payment is not None and payment.platform_fee_display:
        # Shown as INCLUDED, never added. The backend takes the fee out of the
        # total, so presenting it as a surcharge would be a number the buyer
        # was never charged.
        facts_rows.append(("Includes platform fee", payment.platform_fee_display))
    if payment is not None and payment.method:
        facts_rows.append(("Paid by", payment.method))

    blocks = [
        ui.heading(str(ctx["event_title"])),
        ui.paragraph(
            f"Hi {name}, you're going. {count} ticket{plural} confirmed — everything "
            f"you need is below."
        ),
        # ONE hero: the start time. It is the fact somebody has to act on, and
        # the only one here with a deadline attached to it.
        ui.hero(label="Starts", value=str(ctx["event_when"])),
        ui.facts(facts_rows),
        ui.items(_tier_lines(tickets), title=f"{count} ticket{plural}"),
    ]
    if site:
        # The QR codes are NOT in the HTML part. An emailed QR is forwardable
        # and screenshot-able, and this inbox is not necessarily still the
        # ticket holder's — the account page is the copy that stops working
        # when a booking is refunded, which is the whole point of sending
        # people to it.
        blocks.append(ui.button(f"View my ticket{plural}", f"{site}/account/tickets"))
    if maps_url:
        # A second, quiet link. Not a button: two buttons is two primary
        # actions, and the one that matters is the ticket.
        blocks.append(ui.link_line(prefix="Getting there:", label="open directions", url=maps_url))
    blocks.append(
        ui.callout(
            "One scan admits one person. Bring a photo ID that matches the booking "
            "name, and open your ticket before you reach the gate."
        )
    )

    return RenderedMessage(
        subject=f"Booking confirmed: {ctx['event_title']}",
        body="\n".join(lines),
        html=ui.render_email(
            title=f"Your ticket{plural}",
            preheader=f"{ctx['event_title']} — {ctx['event_when']} — {reference}",
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


def _booking_receipt_shared(ctx: dict) -> RenderedMessage:
    """The covering note for a receipt somebody forwarded to a friend.

    ── WHAT THIS EMAIL MUST NOT CONTAIN ──────────────────────────────────────

    No QR code, no ticket token, and no link into the buyer's account. The
    reader is a friend or a relative who did not pay and is not the ticket
    holder; a code in this mail is a bearer credential handed to whoever the
    message is forwarded to next. Ticketmaster emails a claim link and reissues
    the code on acceptance; DICE will not leave the app at all. We send a
    receipt, which is the part of the transaction that is theirs to have.

    The buyer's name is in it because a mail from an unknown platform about a
    booking somebody did not make reads as a phishing attempt without it.
    """
    booker = str(ctx.get("booker_name") or "Someone")
    event = str(ctx["event_title"])
    blocks = [
        ui.heading("Your booking receipt"),
        ui.paragraph(
            f"{booker} booked {event} and asked us to send you the receipt. "
            f"It is attached as a PDF."
        ),
        ui.facts(
            [
                ("Event", event),
                ("When", str(ctx["event_when"])),
                ("Where", str(ctx["event_where"])),
                ("Booking ID", str(ctx["booking_reference"])),
                ("Total paid", str(ctx["total_display"])),
            ]
        ),
        # Said in the email as well as on the PDF. Somebody who is forwarded a
        # booking document reasonably assumes it gets them in, and finding out
        # otherwise at a gate is the expensive place to find out.
        ui.paragraph(
            "This is a receipt, not a ticket — it will not admit anyone. "
            f"{booker} holds the entry codes and will show them at the gate."
        ),
    ]
    if ctx.get("note"):
        blocks.insert(2, ui.paragraph(f"“{ctx['note']}”"))

    attachments: tuple[EmailAttachment, ...] = ()
    pdf = ctx.get("receipt_pdf_b64")
    if pdf:
        import base64

        attachments = (
            EmailAttachment(
                filename=f"receipt-{ctx['booking_reference']}.pdf",
                content=base64.b64decode(str(pdf)),
                content_type="application/pdf",
            ),
        )

    return RenderedMessage(
        subject=f"Receipt for {event}",
        body=(
            f"{booker} booked {event} and asked us to send you the receipt.\n\n"
            f"When: {ctx['event_when']}\n"
            f"Where: {ctx['event_where']}\n"
            f"Booking ID: {ctx['booking_reference']}\n"
            f"Total paid: {ctx['total_display']}\n\n"
            "The receipt is attached as a PDF. This is a receipt, not a ticket — "
            f"it will not admit anyone; {booker} holds the entry codes."
        ),
        html=ui.render_email(
            title=f"Receipt for {event}",
            preheader=f"{booker} sent you the receipt for {event}.",
            blocks=blocks,
        ),
        attachments=attachments,
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


def _admin_hire_enquiry(ctx: dict) -> RenderedMessage:
    """To the OPERATOR: somebody wants to hire an act, and only you can answer.

    This is the whole delivery mechanism, not a courtesy copy. There is no
    marketplace behind it — no listing gets matched, no performer is notified,
    nothing happens automatically. If this email is not sent or not read, the
    customer hears nothing at all.

    So it leads with the CONTACT DETAILS rather than the requirement. An
    operator reading it on a phone needs the number before they need the
    budget range, and everything else is in the queue.
    """
    rows = [
        ("Contact", str(ctx.get("contact_name") or "—")),
        ("Phone", str(ctx.get("contact_phone") or "—")),
        ("Email", str(ctx.get("contact_email") or "—")),
        ("Looking for", str(ctx["performer_type"])),
        ("City", str(ctx["city"])),
        ("Date", str(ctx["event_date"])),
    ]
    if ctx.get("budget"):
        rows.append(("Budget", str(ctx["budget"])))
    return _admin_alert(
        subject=f"Hire enquiry: {ctx['performer_type']} in {ctx['city']}",
        preheader="Somebody is waiting to hear back about hiring an act.",
        heading_text="A hire enquiry is waiting",
        lead=(
            "Somebody has asked about hiring an act. Nothing is matched or quoted "
            "automatically — they hear back when you get in touch."
        ),
        facts_rows=rows,
        queue_label="Open the enquiry queue",
        queue_path="/admin/enquiries",
        note=(
            "Mark it as being handled when you pick it up, so a colleague does not "
            "call the same person."
        ),
    )


def _hire_enquiry_received(ctx: dict) -> RenderedMessage:
    """To the CUSTOMER: we have it, and a person will reply.

    ── IT PROMISES NO TIMEFRAME ──────────────────────────────────────────

    "Within 24 hours" was considered and rejected for the same reason the
    refund copy refuses "within 48 hours": nothing here measures or enforces
    one, so it would be a number with nothing behind it — and the first person
    it disappoints is somebody who is already waiting.

    What it does promise is checkable: a human reads it, and the reply comes
    to the details they gave.
    """
    name = ctx.get("contact_name") or "there"
    site = _site_url()
    blocks = [
        ui.heading("We have your enquiry"),
        ui.paragraph(
            f"Hi {name}, thanks — this is with our team now. Somebody will read it and "
            f"get back to you on the details you gave us."
        ),
        ui.facts(
            [
                ("Looking for", str(ctx["performer_type"])),
                ("City", str(ctx["city"])),
                ("Date", str(ctx["event_date"])),
            ]
        ),
        ui.paragraph(
            "If anything changes, you can withdraw it from your account and we will "
            "stop working on it."
        ),
    ]
    if site:
        blocks.append(ui.button("See your enquiries", f"{site}/account/enquiries"))
    return RenderedMessage(
        subject="We have your hire enquiry",
        body=(
            f"Hi {name},\n\n"
            f"Thanks — your enquiry is with our team and somebody will get back to you "
            f"on the details you gave us.\n\n"
            f"Looking for: {ctx['performer_type']}\n"
            f"City: {ctx['city']}\n"
            f"Date: {ctx['event_date']}\n\n"
            f"If anything changes you can withdraw it from your account.\n"
            + (f"\n{site}/account/enquiries\n" if site else "")
        ),
        html=ui.render_email(
            title="Enquiry received",
            preheader="It is with our team, and somebody will get back to you.",
            masthead_label="Enquiry",
            blocks=blocks,
        ),
    )


def _refund_request_received(ctx: dict) -> RenderedMessage:
    """To the ORGANIZER: somebody is waiting on you.

    Without this, a request lands in a queue nobody knows to open — which is
    the exact failure the whole `RefundRequest` model was added to fix, simply
    moved one step later.

    The customer's own words are QUOTED rather than summarised. The organizer
    is deciding, and a paraphrase would be this module inventing the reason.
    """
    site = _site_url()
    who = ctx.get("customer_name") or ctx["customer_email"]
    blocks = [
        ui.eyebrow("Needs your decision"),
        ui.heading("A customer has asked for a refund"),
        ui.paragraph(
            f"{who} has requested a refund for their booking. Nothing has been refunded "
            f"— it is waiting on you."
        ),
        ui.hero(
            label="Amount requested",
            value=str(ctx["amount_display"]),
            sub=str(ctx["event_title"]),
        ),
        ui.facts(
            [
                ("Event", str(ctx["event_title"])),
                ("Booking", str(ctx["booking_reference"])),
                ("Customer", str(ctx["customer_email"])),
            ]
        ),
        ui.items([str(ctx["reason"])], title="Their reason"),
    ]
    if site:
        blocks.append(ui.button("Review the request", f"{site}/dashboard/refunds"))
    return RenderedMessage(
        subject=f"Refund requested for {ctx['event_title']}",
        body=(
            f"A customer has requested a refund.\n\n"
            f"Event:    {ctx['event_title']}\n"
            f"Booking:  {ctx['booking_reference']}\n"
            f"Customer: {ctx['customer_email']}\n"
            f"Amount:   {ctx['amount_display']}\n\n"
            f"Their reason:\n{ctx['reason']}\n\n"
            f"Nothing has been refunded yet - this is waiting on your decision.\n"
            + (f"\nReview it: {site}/dashboard/refunds\n" if site else "")
        ),
        html=ui.render_email(
            title="Refund requested",
            preheader="A customer is waiting on a refund decision.",
            masthead_label="Needs a decision",
            blocks=blocks,
        ),
    )


def _refund_request_approved(ctx: dict) -> RenderedMessage:
    """To the CUSTOMER: approved, and the money is on its way.

    It is careful NOT to say the refund is complete. Approval ENQUEUES the
    vendor call; the money arriving is a separate fact that gets its own
    `REFUND_CONFIRMATION` message once it has actually moved. Saying "refunded"
    before it is true is how a support queue fills with people asking where
    their money is — and it is the same distinction the model itself draws
    between a `RefundRequest` and a `Refund`.
    """
    name = ctx.get("name") or "there"
    site = _site_url()
    blocks = [
        ui.heading("Your refund has been approved"),
        ui.paragraph(
            f"Hi {name}, your refund for {ctx['event_title']} has been approved and is "
            f"being processed now. You will get a second email confirming it once the "
            f"money has actually left us."
        ),
        ui.hero(
            label="Amount",
            value=str(ctx["amount_display"]),
            sub="Back to your original payment method",
        ),
        ui.facts([("Event", str(ctx["event_title"])), ("Booking", str(ctx["booking_reference"]))]),
    ]
    if ctx.get("note"):
        blocks.append(ui.items([str(ctx["note"])], title="A note from the organiser"))
    blocks.append(
        ui.paragraph(
            "Banks take 5-7 working days for cards and 1-3 for UPI. That window is "
            "theirs rather than ours.",
            muted=True,
        )
    )
    if site:
        blocks.append(ui.button("View your requests", f"{site}/account/refunds"))
    return RenderedMessage(
        subject=f"Refund approved for {ctx['event_title']}",
        body=(
            f"Hi {name},\n\n"
            f"Your refund request for {ctx['event_title']} has been approved and is "
            f"being processed.\n\n"
            f"Amount:  {ctx['amount_display']}\n"
            f"Booking: {ctx['booking_reference']}\n\n"
            + (f"Note from the organiser:\n{ctx['note']}\n\n" if ctx.get("note") else "")
            + "You will get a second email once the money has actually left us. Banks "
            "take 5-7 working days for cards and 1-3 for UPI.\n"
            + (f"\nYour requests: {site}/account/refunds\n" if site else "")
        ),
        html=ui.render_email(
            title="Refund approved",
            preheader="Approved - the money is on its way.",
            masthead_label="Refund approved",
            blocks=blocks,
        ),
    )


def _refund_request_rejected(ctx: dict) -> RenderedMessage:
    """To the CUSTOMER: declined, and WHY.

    The note is not optional. `RefundRequestService.decide` refuses a rejection
    without one, because a refusal with no reason is what turns a declined
    refund into a chargeback — and it is the only part of a refusal anybody
    actually reads. It is rendered as the most prominent block for that reason.
    """
    name = ctx.get("name") or "there"
    site = _site_url()
    blocks = [
        ui.heading("Your refund request was declined"),
        ui.paragraph(
            f"Hi {name}, the organiser has reviewed your request for "
            f"{ctx['event_title']} and is not able to refund it."
        ),
        ui.items([str(ctx["note"])], title="Their reason"),
        ui.facts([("Event", str(ctx["event_title"])), ("Booking", str(ctx["booking_reference"]))]),
        ui.paragraph(
            "Your ticket is still valid and will still admit you. If you think this was "
            "decided in error, reply to this email and a person will look.",
            muted=True,
        ),
    ]
    if site:
        blocks.append(ui.button("View your tickets", f"{site}/account/tickets"))
    return RenderedMessage(
        subject=f"About your refund request for {ctx['event_title']}",
        body=(
            f"Hi {name},\n\n"
            f"The organiser has reviewed your refund request for {ctx['event_title']} "
            f"and is not able to refund it.\n\n"
            f"Their reason:\n{ctx['note']}\n\n"
            f"Booking: {ctx['booking_reference']}\n\n"
            f"Your ticket is still valid and will still admit you.\n"
            + (f"\nYour tickets: {site}/account/tickets\n" if site else "")
        ),
        html=ui.render_email(
            title="Refund request declined",
            preheader="Declined - with the organiser's reason.",
            masthead_label="Refund request",
            blocks=blocks,
        ),
    )


def _event_cancelled_attendee(ctx: dict) -> RenderedMessage:
    """To the ATTENDEE: the event is off and the money is coming back.

    The refund timing is the BANK's, not ours, and the copy says so. "Within 48
    hours" was considered and rejected: the platform issues the refund in
    seconds but card networks take 5-7 working days, so a 48-hour promise
    guarantees a support queue on day three — from people who are already
    annoyed that their event was cancelled.

    THE REASON IS INCLUDED WHEN THERE IS ONE, and it is the second thing on the
    page. "Cancelled" with no explanation is the single biggest generator of
    support mail this template exists to prevent — and when an organiser calls
    an event off the reason is required, so there almost always is one. It is
    omitted rather than replaced by filler when absent: an operator removing a
    fraudulent listing has a reason written for the ORGANISER, and forwarding
    that to a customer would publish an internal judgement.
    """
    name = ctx.get("name") or "there"
    site = _site_url()
    reason = str(ctx.get("attendee_reason") or "").strip()
    blocks = [
        ui.heading(f"{ctx['event_title']} has been cancelled"),
        ui.paragraph(
            f"Hi {name}, this event is no longer going ahead and your booking has been "
            f"cancelled. You do not need to do anything — your refund is already on its way."
        ),
        *([ui.paragraph(f"The organiser said: {reason}")] if reason else []),
        ui.callout(
            "Card refunds take 5-7 working days; UPI is usually 1-3. It goes back to the "
            "account you paid from."
        ),
        ui.facts([("Event", str(ctx["event_title"])), ("Booking", str(ctx["booking_reference"]))]),
    ]
    if site:
        blocks.append(ui.button("Find something else", f"{site}/events"))
    return RenderedMessage(
        subject=f"Cancelled: {ctx['event_title']}",
        body=(
            f"Hi {name},\n\n"
            f"{ctx['event_title']} has been cancelled and your booking has been "
            f"cancelled with it.\n\n"
            + (f"The organiser said: {reason}\n\n" if reason else "")
            + f"Booking: {ctx['booking_reference']}\n\n"
            f"Your refund is on its way back to the account you paid from. Card refunds "
            f"take 5-7 working days; UPI is usually 1-3.\n"
            + (f"\nBrowse what else is on: {site}/events\n" if site else "")
        ),
        html=ui.render_email(
            title="Event cancelled",
            preheader="Your booking is cancelled and your refund is on its way.",
            masthead_label="Cancelled",
            blocks=blocks,
        ),
    )


def _event_deleted_organizer(ctx: dict) -> RenderedMessage:
    """To the ORGANIZER: your event was removed, and here is exactly why.

    The reason is quoted verbatim and is required by the service. An organizer
    whose event vanished with no explanation has nothing to act on and no way
    to avoid a repeat.
    """
    site = _site_url()
    blocks = [
        ui.heading(f"{ctx['event_title']} has been removed"),
        ui.paragraph(
            "A platform operator has removed this event. It is no longer visible anywhere "
            "on the site, and any tickets sold have been refunded."
        ),
        ui.items([str(ctx["reason"])], title="Reason given"),
        ui.facts(
            [
                ("Event", str(ctx["event_title"])),
                ("Refunds started", str(ctx["refunded_bookings"])),
            ]
        ),
        ui.paragraph(
            "If you think this was a mistake, reply to this email and an operator will "
            "look at it.",
            muted=True,
        ),
    ]
    if site:
        blocks.append(ui.button("Open your dashboard", f"{site}/dashboard/events"))
    return RenderedMessage(
        subject=f"Your event was removed: {ctx['event_title']}",
        body=(
            f"A platform operator has removed {ctx['event_title']}.\n\n"
            f"Reason:\n{ctx['reason']}\n\n"
            f"Refunds started: {ctx['refunded_bookings']}\n\n"
            f"It is no longer visible anywhere on the site, and any tickets sold have been "
            f"refunded. If you think this was a mistake, reply to this email.\n"
            + (f"\nYour events: {site}/dashboard/events\n" if site else "")
        ),
        html=ui.render_email(
            title="Event removed",
            preheader="An operator removed your event.",
            masthead_label="Event removed",
            blocks=blocks,
        ),
    )


_TEMPLATES: dict[str, Callable[[dict], RenderedMessage]] = {
    NotificationType.WELCOME: _welcome,
    NotificationType.TICKET_DELIVERY: _ticket_delivery,
    NotificationType.ATTENDEE_TICKET: _attendee_ticket,
    NotificationType.BOOKING_CONFIRMATION_SMS: _booking_confirmation_sms,
    NotificationType.REFUND_CONFIRMATION: _refund_confirmation,
    NotificationType.BOOKING_RECEIPT_SHARED: _booking_receipt_shared,
    NotificationType.REFUND_CONFIRMATION_SMS: _refund_confirmation_sms,
    NotificationType.OTP: _otp,
    NotificationType.EMAIL_VERIFICATION: _email_verification,
    NotificationType.PAYOUT_RELEASED: _payout_released,
    NotificationType.EVENT_CANCELLED_ATTENDEE: _event_cancelled_attendee,
    NotificationType.EVENT_DELETED_ORGANIZER: _event_deleted_organizer,
    NotificationType.REFUND_REQUEST_RECEIVED: _refund_request_received,
    NotificationType.REFUND_REQUEST_APPROVED: _refund_request_approved,
    NotificationType.REFUND_REQUEST_REJECTED: _refund_request_rejected,
    NotificationType.EVENT_REMINDER: _event_reminder,
    NotificationType.EVENT_REMINDER_PUSH: _event_reminder_push,
    NotificationType.BOOKING_CONFIRMED_PUSH: _booking_confirmed_push,
    NotificationType.ADMIN_EVENT_REVIEW: _admin_event_review,
    NotificationType.ADMIN_ORG_VERIFICATION: _admin_org_verification,
    NotificationType.ADMIN_PERFORMER_REVIEW: _admin_performer_review,
    NotificationType.ADMIN_HIRE_ENQUIRY: _admin_hire_enquiry,
    NotificationType.HIRE_ENQUIRY_RECEIVED: _hire_enquiry_received,
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
