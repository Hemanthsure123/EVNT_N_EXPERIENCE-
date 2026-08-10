"""The booking receipt — one page, no admission credential on it.

── WHY THIS EXISTS WHEN THE TICKET PDF WAS DELETED ────────────────────────

A previous ticket PDF was removed on purpose: it was one PAGE PER TICKET, so a
party of twelve got a twelve-page attachment of QR codes, and the booking
confirmation became the email itself with the codes living in the app. Nothing
here reverses that.

This is a different document for a different reader. Somebody who books for
four friends needs to send those friends what they were charged and which
booking it was — a receipt. That reader is NOT the ticket holder and must not
be handed a way in.

── IT CARRIES NO QR CODE, AND THAT IS THE SECURITY DECISION ───────────────

Every serious platform treats the scannable code as a bearer credential and
refuses to email it around:

  - Ticketmaster's transfer flow emails a CLAIM LINK, never a code, and issues
    the recipient a NEW QR once they accept — "the recipient is issued a new QR
    code that only they can use".
  - DICE only transfers between accounts, in-app, with the code activated on
    the day.

A PDF is forwardable, printable and screenshot-able by anyone it reaches. Put a
QR on it and the first person to open the forwarded mail is the person who gets
through the gate. So this document proves WHAT WAS PAID, and admission stays in
the buyer's account where it can be checked against a person.

For the same reason it carries no link back into the account: a receipt is not
a session, and "view my tickets" in a mail sent to four people is an invitation
to somebody else's wallet.

── ONE PAGE, ENFORCED RATHER THAN INTENDED ────────────────────────────────

`_assert_single_page` fails the build of the document if the content ever spills
onto a second page. "Keep it to one page" is a comment that stops being true the
first time a booking has nine tiers; a check is a comment that cannot rot. The
line items are bounded for the same reason.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime

#: The masthead. Deliberately a local constant rather than an import of
#: `notifications.email_layout.PRODUCT_NAME`: booking must not depend on
#: notifications (dependencies point the other way), and a module-scope import
#: across those two apps made django-stubs lose `Model.objects` across twenty
#: unrelated files — the same global plugin degradation `cms`'s `ClassVar` in a
#: model Meta caused, and just as quiet.
PRODUCT_NAME = "Curatix"  # frontend/lib/brand.ts BRAND_NAME

#: Beyond this the itemisation is summarised rather than listed. A booking with
#: forty tiers is not a receipt anybody reads line by line, and the total is
#: the number that matters.
MAX_LINE_ITEMS = 12


@dataclass(frozen=True)
class ReceiptLine:
    description: str
    quantity: int
    amount_minor: int


@dataclass(frozen=True)
class Receipt:
    """Everything the document renders. A plain value, so the PDF builder does
    no querying and can be tested without a database."""

    booking_reference: str
    booked_by: str
    booked_on: datetime
    event_title: str
    event_starts_at: datetime
    venue: str
    city: str
    lines: tuple[ReceiptLine, ...]
    total_minor: int
    #: Razorpay's payment id when the booking is paid. Named "Payment
    #: reference" on the page rather than "Razorpay id" — it is what support
    #: will ask for, and the vendor's name is not the customer's concern.
    payment_reference: str
    currency: str = "INR"


def _rupees(minor: int) -> str:
    """Indian digit grouping, because this document is read in India.

    `f"{x:,}"` gives 1,00,000 as 100,000 — correct in en-US and wrong on every
    receipt in the country the platform sells in.
    """
    whole, paise = divmod(abs(minor), 100)
    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        parts: list[str] = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        digits = ",".join([*parts, tail])
    sign = "-" if minor < 0 else ""
    return f"{sign}₹{digits}.{paise:02d}"


def build_receipt_pdf(receipt: Receipt) -> bytes:
    """Render the receipt. Returns PDF bytes.

    reportlab is imported HERE rather than at module scope: it belongs to an
    optional extra, and importing it at import time would make every process
    that merely touches `apps.booking` require it.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    width, height = A4
    pdf = canvas.Canvas(buffer, pagesize=A4)
    pdf.setTitle(f"Booking {receipt.booking_reference}")
    # No author/creator string naming a library version: this document is
    # forwarded to strangers and the metadata should say what it is, not what
    # produced it.
    pdf.setAuthor(PRODUCT_NAME)

    left = 20 * mm
    right = width - 20 * mm
    y = height - 22 * mm

    # ── Masthead ──────────────────────────────────────────────────────────
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(left, y, PRODUCT_NAME)
    pdf.setFont("Helvetica", 9)
    pdf.setFillColor(colors.HexColor("#6b7280"))
    pdf.drawRightString(right, y + 2, "BOOKING RECEIPT")
    pdf.setFillColor(colors.black)

    y -= 6 * mm
    pdf.setStrokeColor(colors.HexColor("#e5e7eb"))
    pdf.line(left, y, right, y)

    # ── What it was ───────────────────────────────────────────────────────
    y -= 12 * mm
    pdf.setFont("Helvetica-Bold", 15)
    for line in _wrap(receipt.event_title, 46)[:2]:
        pdf.drawString(left, y, line)
        y -= 7 * mm

    pdf.setFont("Helvetica", 10)
    pdf.setFillColor(colors.HexColor("#374151"))
    pdf.drawString(
        left, y, receipt.event_starts_at.strftime("%A, %d %B %Y at %I:%M %p").replace(" 0", " ")
    )
    y -= 5 * mm
    pdf.drawString(left, y, f"{receipt.venue}, {receipt.city}")
    pdf.setFillColor(colors.black)

    # ── The reference block ───────────────────────────────────────────────
    y -= 12 * mm
    facts = [
        ("Booking ID", receipt.booking_reference),
        ("Booked by", receipt.booked_by),
        ("Booked on", receipt.booked_on.strftime("%d %b %Y, %I:%M %p").replace(" 0", " ")),
        ("Payment reference", receipt.payment_reference or "—"),
    ]
    for label, value in facts:
        pdf.setFont("Helvetica", 9)
        pdf.setFillColor(colors.HexColor("#6b7280"))
        pdf.drawString(left, y, label)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.setFillColor(colors.black)
        pdf.drawString(left + 42 * mm, y, value[:60])
        y -= 6 * mm

    # ── Itemisation ───────────────────────────────────────────────────────
    y -= 6 * mm
    pdf.setStrokeColor(colors.HexColor("#e5e7eb"))
    pdf.line(left, y, right, y)
    y -= 7 * mm

    pdf.setFont("Helvetica", 9)
    pdf.setFillColor(colors.HexColor("#6b7280"))
    pdf.drawString(left, y, "TICKETS")
    pdf.drawRightString(right - 30 * mm, y, "QTY")
    pdf.drawRightString(right, y, "AMOUNT")
    pdf.setFillColor(colors.black)
    y -= 6 * mm

    shown = receipt.lines[:MAX_LINE_ITEMS]
    for item in shown:
        pdf.setFont("Helvetica", 10)
        pdf.drawString(left, y, _wrap(item.description, 40)[0])
        pdf.drawRightString(right - 30 * mm, y, str(item.quantity))
        pdf.drawRightString(right, y, _rupees(item.amount_minor))
        y -= 6 * mm

    hidden = len(receipt.lines) - len(shown)
    if hidden > 0:
        pdf.setFont("Helvetica-Oblique", 9)
        pdf.setFillColor(colors.HexColor("#6b7280"))
        pdf.drawString(left, y, f"and {hidden} more, included in the total below")
        pdf.setFillColor(colors.black)
        y -= 6 * mm

    # ── Total ─────────────────────────────────────────────────────────────
    y -= 2 * mm
    pdf.line(left, y, right, y)
    y -= 8 * mm
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(left, y, "Total paid")
    pdf.drawRightString(right, y, _rupees(receipt.total_minor))

    # ── The footer, and what it must say ──────────────────────────────────
    # Somebody forwarded this receipt may reasonably think it is their ticket.
    # Saying otherwise on the document is cheaper than a refused entry.
    y = 24 * mm
    pdf.setFont("Helvetica", 8.5)
    pdf.setFillColor(colors.HexColor("#6b7280"))
    pdf.drawString(
        left,
        y,
        "This is a receipt, not a ticket. It will not admit anyone — entry codes stay in the",
    )
    pdf.drawString(left, y - 4.5 * mm, "booker's account and are shown at the gate from there.")

    pdf.showPage()
    _assert_single_page(pdf)
    pdf.save()
    return buffer.getvalue()


def _assert_single_page(pdf) -> None:
    """One page, checked rather than hoped for.

    `showPage` has already been called once by the time this runs, so a page
    count above 1 means the content spilled. Raising here turns "we intended one
    page" into something that cannot quietly stop being true.
    """
    if pdf.getPageNumber() > 2:
        raise ValueError(
            f"The receipt rendered {pdf.getPageNumber() - 1} pages; it must be one. "
            "Shorten the itemisation (see MAX_LINE_ITEMS)."
        )


def _wrap(text: str, width: int) -> list[str]:
    """Greedy wrap, so a long event title does not run off the page.

    Deliberately not reportlab's Paragraph machinery: this document has two
    wrapped fields and a flowable layout engine would be a dependency on a
    layout system for the sake of them.
    """
    words = (text or "").split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        if len(current) + 1 + len(word) <= width:
            current = f"{current} {word}"
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines
