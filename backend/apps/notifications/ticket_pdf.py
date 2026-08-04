"""The booking document — the paper record of a purchase, not the credential.

── WHAT THIS FILE IS NOW, AND WHAT IT USED TO BE ─────────────────────────

It used to draw the QR code into the page, on the reasoning that a gate is a
place with no signal: a PDF saved to a phone opens on a plane, an app needs a
session and a network. That rationale is gone by INSTRUCTION — the product
decision is that the scannable code lives in ONE place, the app, and this
document carries everything else: the event, the booking, the payment, and a
link back to `/account/tickets` where the code is shown.

The trade is real and worth stating in the file that makes it. A ticket
holder standing in a queue with no reception can no longer be admitted from
this PDF; they need the app to have loaded the code. What is gained is that a
forwarded or photographed attachment is no longer a working admission — the
credential stops travelling in an email attachment that can be screenshotted
out of an inbox that is not necessarily still the ticket holder's, and a
refunded booking's code stops working the moment it is refunded, which a
drawn QR never could. `apps/notifications/templates.py` keeps the signed
tokens in the PLAIN-TEXT part of the ticket email, so the tokens are still
recoverable without the app; that text part is now the offline fallback this
document used to be.

── SO WHAT IS IT FOR ─────────────────────────────────────────────────────

The thing people actually do with a ticket PDF nine times out of ten: file
it, forward it to whoever is paying, and pull the reference out of it when
something goes wrong. That is a RECEIPT. So it is laid out as one — the event
as the hero, then when/where/tier, then the booking block, then the payment
block with the platform fee shown as INCLUDED rather than added on top (the
backend takes the fee out of the total; showing it as a surcharge would be a
number the buyer was never charged).

── ONE PAGE PER TICKET, STILL ────────────────────────────────────────────

Each admission is still its own page carrying its own tier and the booking
reference, because a party of four still splits up: the person holding the
Gold tier needs a page that says Gold, and a sheet listing four tiers tells
each of them nothing about which one is theirs.

── REPORTLAB ONLY, AND THE STANDARD-FONT TRAP ────────────────────────────

No new dependency: plain `pdfgen` primitives, no Pillow, no HTML-to-PDF
engine. The one sharp edge is that reportlab's built-in Helvetica is
WinAnsi-encoded, and a character outside that encoding is not dropped — it is
substituted from a symbol font, which draws a FILLED BLACK SQUARE where the
letter should be. `₹` is outside WinAnsi, so the amount on a receipt is
exactly where that lands. `_pdf_text` maps the rupee sign to `INR` and
replaces anything else unencodable with `?`, because a question mark reads as
"this character could not be printed" and a black box reads as a corrupt
file.

── NEVER PRINT `None` ────────────────────────────────────────────────────

Every optional field — payment method, attendee, paid-at, organizer, the
directions link, even the whole payment block — is drawn only when it has a
value. A receipt that says "Method: None" is worse than one that does not
mention the method, and an empty "Organizer" row reads as a failed lookup.

── WHAT ELSE A FILED RECEIPT HAS TO ANSWER ───────────────────────────────

Three things were missing from a document somebody opens at a venue or
forwards to whoever is paying, and each is now on it: **who is presenting the
event** (the counterparty of the purchase, and the name a dispute is opened
against), **how to get to the venue** (a real link annotation, not a printed
address to retype), and **the four rules that decide whether they get in**.
None of the three is inferred: the organizer name comes from the booking's
own event row, the directions URL is built from the venue the event stores,
and the terms are the rules this codebase actually enforces — the scan
window's configured minutes are deliberately NOT printed, because that is a
deployment setting and a number this document invented is the one somebody
would plan their arrival around.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

# Mirrors `email_layout.py`, which mirrors frontend/styles/tokens.css — one
# product, three renderers. The warm ink scale, not slate.
BRAND = HexColor("#7C3AED")  # --violet-600
BRAND_DEEP = HexColor("#6D28D9")  # --violet-700, the accent full stop
BRAND_LIFT = HexColor("#A78BFA")  # --violet-400, the accent on ink
BRAND_WASH = HexColor("#F5F3FF")  # --violet-50
BRAND_EDGE = HexColor("#DDD6FE")  # --violet-200
INK = HexColor("#1C1B19")  # --ink-900
BODY_TEXT = HexColor("#57534D")  # --ink-700
SUBTLE = HexColor("#706B64")  # --ink-600 — 5.28:1, printable, unlike --ink-400
RULE = HexColor("#E7E4DE")  # --ink-200
WASH = HexColor("#F9F7F4")  # --ink-50
PAPER = HexColor("#FFFFFF")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
BAND_H = 26 * mm  # the ink masthead
CONTENT_W = PAGE_W - (2 * MARGIN)

PRODUCT_NAME = "Curatix"

#: The entry rules, in the order somebody at a gate needs them. STATIC, and
#: every line is a rule the backend actually enforces — one scan admits one
#: person is `checkin`'s per-ticket row lock, the ID check is what the gate does
#: with an assigned attendee name, and `payments.execute_refund` voids a
#: booking's still-active tickets in the same transaction as the refund record.
#: The scan window says "published for the event" rather than a number of
#: minutes: the window is a deployment setting
#: (`CHECKIN_WINDOW_OPENS_BEFORE_MINUTES`), so a figure printed here would be
#: one this document made up, on the line somebody plans their arrival around.
DEFAULT_TERMS: tuple[str, ...] = (
    "One scan admits one person. A ticket cannot be re-used, split or transferred "
    "once it has been scanned.",
    "Where a ticket names an attendee, bring photo ID matching that name. "
    "Otherwise bring ID matching the booking name.",
    "A refund voids every ticket on the booking immediately — a refunded ticket "
    "will not admit anybody.",
    "Entry is only within the scan window published for the event. Arrive inside "
    "it; the gate cannot admit you outside it.",
)

# Rupee is not in WinAnsi; see the module docstring. Curly quotes and the
# ellipsis ARE, but only via cp1252 — normalising them here keeps the mapping
# in one visible place rather than relying on the encoder's own choices.
_SUBSTITUTIONS = {
    ord("₹"): "INR ",  # ₹
    ord("‘"): "'",
    ord("’"): "'",
    ord("“"): '"',
    ord("”"): '"',
}


def _pdf_text(value: object) -> str:
    """Everything drawn on the page goes through here.

    Two jobs, both about not lying on a document somebody files: `None`
    becomes an empty string (callers then skip the row rather than printing
    the word), and any character the standard fonts cannot encode becomes `?`
    rather than reportlab's symbol-font substitution, which is a solid black
    square.
    """
    if value is None:
        return ""
    text = str(value).translate(_SUBSTITUTIONS)
    return text.encode("cp1252", "replace").decode("cp1252")


@dataclass(frozen=True)
class PdfTicket:
    """One admission.

    `qr_token` is accepted and DELIBERATELY NOT DRAWN — it stays in the
    signature because the caller has it and because dropping the parameter
    would silently change what an existing call site means. It is used only to
    reason about the ticket, never rendered; see the module docstring.

    `attendee` is a name assigned to this specific admission. No column backs
    it today (`booking.Ticket` has no holder field), so it is blank unless a
    caller supplies one — and a blank one prints nothing at all.
    """

    ticket_type: str
    qr_token: str = ""
    attendee: str = ""


@dataclass(frozen=True)
class PdfBooking:
    """The booking block. `reference` is the one required fact on the page.

    `issued_at` and `attendee` are optional strings ALREADY FORMATTED by the
    caller — this module does no date arithmetic, for the same reason
    `event_when` arrives pre-formatted: `templates.format_when` is the one
    place in the codebase that decides how a time is written, and a second
    formatter here would be a second answer to the same question.
    """

    reference: str
    issued_at: str = ""
    attendee: str = ""


@dataclass(frozen=True)
class PdfPayment:
    """The payment block, all display strings, all optional.

    Nothing is computed here. `platform_fee_display` is rendered as INCLUDED
    in `amount_display`, never added to it, because that is what the backend
    actually does — the fee is taken out of the total at settlement, so
    printing it as a surcharge would show a buyer a figure they were never
    charged.

    `method` has NO column behind it: this platform stores Razorpay reference
    ids and amounts and never card data, so unless a caller has the method
    from somewhere the row simply does not appear. It is not inferred.
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


@dataclass
class _Cursor:
    """A y position that only ever moves down the page.

    Passing a float through fifteen drawing helpers and remembering to
    reassign it every time is how one block ends up overlapping another. A
    tiny mutable holder is less machinery than a layout engine and removes
    that whole class of mistake.
    """

    y: float

    def down(self, amount: float) -> None:
        self.y -= amount


@dataclass
class _Metrics:
    """Font metrics, so wrapping measures the actual string rather than
    counting characters. `_wrap` used to take a character limit, which makes
    "WWWWWWWW" and "iiiiiiii" the same width — they differ by a factor of
    four, and the wide one ran off the page."""

    font: str
    size: float
    _cache: dict[str, float] = field(default_factory=dict)

    def width(self, text: str) -> float:
        cached = self._cache.get(text)
        if cached is None:
            cached = pdfmetrics.stringWidth(text, self.font, self.size)
            self._cache[text] = cached
        return cached


def _wrap(text: str, *, font: str, size: float, max_width: float) -> list[str]:
    """Greedy wrap against real font metrics.

    reportlab has a paragraph engine (`platypus`), but pulling in flowables
    and frames to lay out a venue name would be more machinery than this page
    needs — every string here is a line or two long.
    """
    metrics = _Metrics(font, size)
    words = _pdf_text(text).split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if metrics.width(candidate) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _truncate(text: str, *, font: str, size: float, max_width: float) -> str:
    """One line, ellipsised. For the places where wrapping would push the
    layout down the page — a table cell, the masthead label."""
    value = _pdf_text(text)
    if not value or pdfmetrics.stringWidth(value, font, size) <= max_width:
        return value
    while value and pdfmetrics.stringWidth(f"{value}...", font, size) > max_width:
        value = value[:-1]
    return f"{value}..." if value else ""


# ── page furniture ───────────────────────────────────────────────────────


def _masthead(pdf: canvas.Canvas, *, page_no: int, page_count: int) -> float:
    """The ink band, carrying the same lockup the emails and the app carry: a
    "CX" monogram badge, the wordmark, and the accent full stop.

    Returns the y to continue drawing from.
    """
    top = PAGE_H - BAND_H
    pdf.setFillColor(INK)
    pdf.rect(0, top, PAGE_W, BAND_H, stroke=0, fill=1)

    centre = top + (BAND_H / 2)

    # The monogram badge: a white rounded square with the two letters the
    # app's SVG mark draws. Same reasoning as the email masthead — the mark is
    # set as type so it needs no asset and cannot fail to load.
    badge = 9.5 * mm
    badge_x = MARGIN
    badge_y = centre - (badge / 2)
    pdf.setFillColor(PAPER)
    pdf.roundRect(badge_x, badge_y, badge, badge, 2.6 * mm, stroke=0, fill=1)
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawCentredString(badge_x + (badge / 2), centre - 3.9, "CX")

    word_x = badge_x + badge + (3.5 * mm)
    pdf.setFillColor(PAPER)
    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawString(word_x, centre - 6, PRODUCT_NAME)
    pdf.setFillColor(BRAND_LIFT)
    pdf.drawString(word_x + pdf.stringWidth(PRODUCT_NAME, "Helvetica-Bold", 17), centre - 6, ".")

    pdf.setFillColor(HexColor("#B8B2A8"))
    pdf.setFont("Helvetica-Bold", 8)
    label = "BOOKING CONFIRMATION"
    if page_count > 1:
        label = f"{label}  •  TICKET {page_no} OF {page_count}"
    pdf.drawRightString(PAGE_W - MARGIN, centre - 3, label)

    return top - (13 * mm)


def _footer(pdf: canvas.Canvas, reference: str) -> None:
    """The line at the bottom of every page. It says where the scannable code
    is, because this document no longer carries one and somebody who has only
    ever been handed a QR will look for it here first."""
    pdf.setStrokeColor(RULE)
    pdf.setLineWidth(0.8)
    pdf.line(MARGIN, MARGIN + 24, PAGE_W - MARGIN, MARGIN + 24)

    # TWO lines, not one. The sentence and the reference share the first line
    # and together measure ~544pt against 493pt of content width, so a
    # single-line footer silently overprints the reference — which is the one
    # string on the page somebody reads out to support.
    pdf.setFillColor(SUBTLE)
    pdf.setFont("Helvetica", 7.5)
    pdf.drawString(MARGIN, MARGIN + 12, "This document is your receipt, not your entry pass.")
    pdf.drawRightString(
        PAGE_W - MARGIN,
        MARGIN + 12,
        _truncate(f"Booking {reference}", font="Helvetica", size=7.5, max_width=CONTENT_W * 0.5),
    )
    pdf.drawString(
        MARGIN,
        MARGIN + 2,
        f"Open your ticket in the {PRODUCT_NAME} app to be scanned at the gate. "
        "Bring photo ID matching the booking name.",
    )


def _section_label(pdf: canvas.Canvas, cursor: _Cursor, text: str) -> None:
    pdf.setFillColor(BRAND_DEEP)
    pdf.setFont("Helvetica-Bold", 7.5)
    pdf.drawString(MARGIN, cursor.y, _pdf_text(text).upper())
    cursor.down(14)


def _panel(
    pdf: canvas.Canvas,
    cursor: _Cursor,
    *,
    height: float,
    accent: bool = False,
) -> float:
    """Draw a rounded card and return the y of its top inner edge."""
    top = cursor.y
    pdf.setFillColor(BRAND_WASH if accent else WASH)
    pdf.setStrokeColor(BRAND_EDGE if accent else RULE)
    pdf.setLineWidth(0.8)
    pdf.roundRect(MARGIN, top - height, CONTENT_W, height, 3 * mm, stroke=1, fill=1)
    cursor.down(height + 10)
    return top


def _pair(pdf: canvas.Canvas, x: float, y: float, label: str, value: str, width: float) -> None:
    """One label-over-value cell. The label is the small grey capital line and
    the value sits under it — a grid of these is the whole details block."""
    pdf.setFillColor(SUBTLE)
    pdf.setFont("Helvetica-Bold", 7)
    pdf.drawString(x, y, _pdf_text(label).upper())
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica", 10.5)
    line_y = y - 13
    for line in _wrap(value, font="Helvetica", size=10.5, max_width=width)[:2]:
        pdf.drawString(x, line_y, line)
        line_y -= 12.5


def _row(pdf: canvas.Canvas, y: float, label: str, value: str, *, bold: bool = False) -> None:
    """One label-left / value-right receipt row, inside a panel."""
    pdf.setFillColor(SUBTLE)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(MARGIN + 16, y, _pdf_text(label))
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica-Bold" if bold else "Helvetica", 10.5 if bold else 9.5)
    pdf.drawRightString(
        PAGE_W - MARGIN - 16,
        y,
        _truncate(
            value,
            font="Helvetica-Bold" if bold else "Helvetica",
            size=10.5 if bold else 9.5,
            max_width=CONTENT_W * 0.6,
        ),
    )


def _link_button(
    pdf: canvas.Canvas, cursor: _Cursor, *, label: str, url: str, primary: bool = True
) -> None:
    """The "View Event Ticket" button — a drawn rectangle PLUS a real PDF link
    annotation over it (`linkURL`), because a rounded rectangle with white
    text in it is a picture of a button until something makes it clickable.

    `primary=False` draws the SAME control outlined rather than filled, and is
    what "Get directions" uses. Two filled violet buttons on one page are two
    primaries competing for the same press, and the one this document is about
    is the ticket; the outline keeps directions recognisably the same
    affordance — same geometry, same annotation, same printed URL — without
    claiming to be the page's action.
    """
    height = 11 * mm
    width = min(CONTENT_W, pdf.stringWidth(label, "Helvetica-Bold", 11) + (26 * mm))
    x = MARGIN
    y = cursor.y - height

    pdf.setFillColor(BRAND if primary else PAPER)
    pdf.setStrokeColor(BRAND_EDGE)
    pdf.setLineWidth(0.9)
    pdf.roundRect(x, y, width, height, 2.6 * mm, stroke=0 if primary else 1, fill=1)
    pdf.setFillColor(PAPER if primary else BRAND_DEEP)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawCentredString(x + (width / 2), y + (height / 2) - 4, _pdf_text(label))

    # relative=0: the rect is in absolute page coordinates, which is what we
    # just drew in. thickness=0 so no viewer draws its own border on top.
    pdf.linkURL(url, (x, y, x + width, y + height), relative=0, thickness=0)

    pdf.setFillColor(SUBTLE)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(
        x + width + (6 * mm),
        y + (height / 2) - 3,
        _truncate(url, font="Helvetica", size=8, max_width=CONTENT_W - width - (8 * mm)),
    )
    cursor.down(height + 14)


def _terms_block(pdf: canvas.Canvas, cursor: _Cursor, terms: tuple[str, ...]) -> None:
    """The entry rules, as a bulleted list in the smallest type on the page that
    is still legible in print (`SUBTLE` is 5.28:1 on white, unlike --ink-400).

    Wrapped against real font metrics like everything else here, and indented so
    a wrapped second line lines up under the first rather than under the bullet
    — a rule that has to be re-read is a rule somebody argues with at the gate.
    """
    if not terms:
        return

    indent = 4.5 * mm
    _section_label(pdf, cursor, "Entry terms")
    for term in terms:
        lines = _wrap(term, font="Helvetica", size=8, max_width=CONTENT_W - indent)
        for offset, line in enumerate(lines):
            pdf.setFillColor(SUBTLE)
            pdf.setFont("Helvetica", 8)
            if offset == 0:
                pdf.drawString(MARGIN, cursor.y, _pdf_text("•"))
            pdf.drawString(MARGIN + indent, cursor.y, line)
            cursor.down(10.5)
        cursor.down(2)


# ── the document ─────────────────────────────────────────────────────────


def build_ticket_pdf(
    *,
    event_title: str,
    event_when: str,
    event_where: str,
    booking_reference: str,
    tickets: list[PdfTicket],
    booking: PdfBooking | None = None,
    payment: PdfPayment | None = None,
    site_url: str = "",
    organizer: str = "",
    maps_url: str = "",
    terms: tuple[str, ...] = DEFAULT_TERMS,
) -> bytes:
    """One page per ticket: event, booking, payment, directions, terms, and a
    link to the code.

    `booking_reference` stays a top-level required argument even though
    `PdfBooking` also carries a reference: it is the document's identity (it
    goes in the PDF metadata and on the footer of every page) and every
    existing call site already passes it. `booking` merely ADDS the issued
    date and an attendee when a caller has them.

    Every added parameter defaults to something that renders a smaller but
    complete page, so a caller that has not been updated yet still produces a
    valid document rather than a traceback. `terms` is the one whose default is
    CONTENT rather than an omission — the entry rules are true of every ticket
    this platform issues, so they are the document's own text, not something a
    caller supplies. `terms=()` drops the block for a caller that has its own.

    `site_url` blank means no button is drawn at all — the same rule the
    emails follow. A call to action pointing at nothing reads as the product
    being broken, which on the one artifact somebody files is worse than an
    omission. `maps_url` and `organizer` follow it: blank draws nothing.
    """
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    pdf.setTitle(_pdf_text(f"{event_title} — booking {booking_reference}"))
    pdf.setAuthor(PRODUCT_NAME)
    # `subject` is what a file manager shows in a preview pane.
    pdf.setSubject(_pdf_text(f"Booking {booking_reference}"))
    pdf.setCreator(PRODUCT_NAME)

    ticket_url = f"{site_url.rstrip('/')}/account/tickets" if site_url else ""
    # A zero-page PDF is a file some viewers refuse to open. A booking with no
    # ticket rows should not happen, but if it does the right output is the
    # receipt WITHOUT a tier — never a document that cannot be opened at all.
    rendered = tickets or [PdfTicket(ticket_type="")]
    total = len(rendered)

    for index, ticket in enumerate(rendered, start=1):
        cursor = _Cursor(_masthead(pdf, page_no=index, page_count=total))

        # ── the event, as the hero ───────────────────────────────────────
        _section_label(pdf, cursor, "Event")
        pdf.setFillColor(INK)
        pdf.setFont("Helvetica-Bold", 22)
        for line in _wrap(event_title, font="Helvetica-Bold", size=22, max_width=CONTENT_W)[:3]:
            pdf.drawString(MARGIN, cursor.y, line)
            cursor.down(27)
        cursor.down(6)

        # ── when / where / tier / admits ─────────────────────────────────
        # A 2x2 grid rather than four stacked rows: the four facts are read
        # together at a glance, and stacking them puts the tier — the one that
        # differs between the pages of one booking — furthest down the page.
        cells: list[tuple[str, str]] = [("When", event_when), ("Where", event_where)]
        if ticket.ticket_type:
            cells.append(("Ticket type", ticket.ticket_type))
        cells.append(
            ("Admits", f"1 person  •  ticket {index} of {total}" if total > 1 else "1 person")
        )

        column = (CONTENT_W - (8 * mm)) / 2
        grid_top = _panel(pdf, cursor, height=34 * mm)
        cell_w = column - 20
        for slot, (label, value) in enumerate(cells):
            _pair(
                pdf,
                MARGIN + 16 + (column * (slot % 2)),
                grid_top - 20 - (42 * (slot // 2)),
                label,
                value,
                cell_w,
            )

        # ── the booking block ────────────────────────────────────────────
        info = booking or PdfBooking(reference=booking_reference)
        booking_rows: list[tuple[str, str]] = [
            ("Booking reference", _pdf_text(info.reference or booking_reference))
        ]
        # WHO SOLD IT. It sits in the booking block rather than in the event
        # grid above because on a receipt the counterparty is a fact about the
        # transaction — it is the name somebody opens a dispute against, and the
        # grid is a fixed 2x2 whose fifth cell would cost 42pt of a page that
        # now also carries directions and terms.
        if organizer:
            booking_rows.append(("Organizer", _pdf_text(organizer)))
        if info.issued_at:
            booking_rows.append(("Issued", _pdf_text(info.issued_at)))
        # Per-ticket attendee wins over a booking-wide one: if a specific
        # admission has been assigned to somebody, that is who this page is
        # for. Nothing is printed when neither exists.
        attendee = ticket.attendee or info.attendee
        if attendee:
            booking_rows.append(("Attendee", _pdf_text(attendee)))

        _section_label(pdf, cursor, "Booking")
        rows_top = _panel(pdf, cursor, height=(len(booking_rows) * 18) + 16)
        row_y = rows_top - 22
        for label, value in booking_rows:
            _row(pdf, row_y, label, value)
            row_y -= 18

        # ── the payment block ────────────────────────────────────────────
        # Drawn only when there is something to say. An empty "Payment" card
        # on a receipt reads as a failed lookup.
        if payment is not None and payment.has_content():
            payment_rows: list[tuple[str, str, bool]] = []
            if payment.amount_display:
                payment_rows.append(("Amount paid", _pdf_text(payment.amount_display), True))
            if payment.platform_fee_display:
                # INCLUDED, never added. The backend takes the platform fee out
                # of the total rather than charging it on top, and the frontend
                # says so too — a receipt that presented it as a surcharge
                # would show a figure nobody was ever charged.
                payment_rows.append(
                    (
                        "Includes platform fee",
                        _pdf_text(payment.platform_fee_display),
                        False,
                    )
                )
            if payment.status_label:
                payment_rows.append(("Status", _pdf_text(payment.status_label), False))
            if payment.method:
                payment_rows.append(("Method", _pdf_text(payment.method), False))
            if payment.reference:
                payment_rows.append(("Payment reference", _pdf_text(payment.reference), False))
            if payment.paid_at:
                payment_rows.append(("Paid at", _pdf_text(payment.paid_at), False))

            _section_label(pdf, cursor, "Payment")
            pay_top = _panel(pdf, cursor, height=(len(payment_rows) * 18) + 18, accent=True)
            row_y = pay_top - 23
            for label, value, bold in payment_rows:
                _row(pdf, row_y, label, value, bold=bold)
                row_y -= 18

        # ── the way back to the scannable code ───────────────────────────
        if ticket_url:
            _link_button(pdf, cursor, label="View Event Ticket", url=ticket_url)
        else:
            pdf.setFillColor(BODY_TEXT)
            pdf.setFont("Helvetica", 9.5)
            pdf.drawString(
                MARGIN,
                cursor.y - 10,
                f"Open your ticket in the {PRODUCT_NAME} app to be scanned at the gate.",
            )
            cursor.down(24)

        # ── the way to the venue ─────────────────────────────────────────
        # A printed address is something to retype into a phone at the point
        # somebody is already late. A link annotation is one press.
        if maps_url:
            _link_button(pdf, cursor, label="Get directions", url=maps_url, primary=False)

        # ── the rules that decide whether they get in ────────────────────
        _terms_block(pdf, cursor, terms)

        _footer(pdf, booking_reference)
        pdf.showPage()

    pdf.save()
    return buffer.getvalue()
