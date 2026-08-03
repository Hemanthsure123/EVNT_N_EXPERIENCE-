"""The booking PDF.

Three things this file has to prove, and one it has to keep proving.

1. **The QR is gone.** The document is a receipt now, not a credential; the
   scannable code lives in the app. A test that only checked the page count
   would pass with a QR silently reintroduced, so this asserts on what is
   actually DRAWN.
2. **It survives every optional field being absent.** Payment, method,
   attendee, issued-at and the site URL are all optional, and a receipt that
   prints "Method: None" is worse than one that omits the row.
3. **Nothing overprints anything else.** reportlab draws exactly where it is
   told and never warns, so two strings on the same line are found by a person
   opening the file — or not found at all. The footer's sentence and the
   booking reference DID overlap; the geometry capture below is what caught
   it, and is what will catch the next one.

And the one it keeps: this PDF must never be the reason a ticket email fails
to arrive.
"""

from __future__ import annotations

import re
from typing import Any, NamedTuple

import pytest
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas as pdf_canvas

from apps.notifications.models import NotificationType
from apps.notifications.templates import TemplateService
from apps.notifications.ticket_pdf import (
    CONTENT_W,
    MARGIN,
    PAGE_W,
    PdfBooking,
    PdfPayment,
    PdfTicket,
    build_ticket_pdf,
)

SITE = "https://curatix.test"

# Annotated because a render context is heterogeneous by nature — strings
# alongside a list of ticket dicts. Left to inference the values collapse to a
# common supertype and indexing a ticket stops type-checking.
CONTEXT: dict[str, Any] = {
    "name": "Asha Rao",
    "event_title": "Sunburn Jazz Night",
    "event_when": "Sat 23 Aug 2026, 20:10 IST",
    "event_where": "Phoenix Arena, Mumbai",
    "booking_reference": "3f1d9c22-0000-4000-8000-000000000001",
    "issued_at": "Fri 01 Aug 2026, 11:04 IST",
    "payment": {
        "amount_display": "₹2,400.00",
        "platform_fee_display": "₹120.00",
        "reference": "pay_QwErTy123456",
        "method": "UPI",
        "paid_at": "Fri 01 Aug 2026, 11:04 IST",
        "status_label": "Paid",
    },
    "tickets": [
        {"ticket_type": "Gold", "qr_token": "v1.eyJ0IjoiYSJ9.deadbeef"},
        {"ticket_type": "Basic", "qr_token": "v1.eyJ0IjoiYiJ9.cafebabe"},
    ],
}

FULL_PAYMENT = PdfPayment(
    amount_display="₹2,400.00",
    platform_fee_display="₹120.00",
    reference="pay_QwErTy123456",
    method="UPI",
    paid_at="Fri 01 Aug 2026, 11:04 IST",
    status_label="Paid",
)


class Placed(NamedTuple):
    """One drawn string, with everything needed to work out where it landed."""

    page: int
    how: str  # "left" | "centre" | "right"
    x: float
    y: float
    text: str
    font: str
    size: float

    @property
    def width(self) -> float:
        return pdfmetrics.stringWidth(self.text, self.font, self.size)

    @property
    def left(self) -> float:
        if self.how == "right":
            return self.x - self.width
        if self.how == "centre":
            return self.x - (self.width / 2)
        return self.x

    @property
    def right(self) -> float:
        return self.left + self.width


@pytest.fixture
def placed(monkeypatch) -> list[Placed]:
    """Every string the builder puts on a page, with its position and font.

    Asserting on the PDF BYTES is close to useless — reportlab compresses the
    content streams — and asserting only on the file's shape cannot tell a
    receipt from a receipt with a QR stamped on it. Recording the draw calls
    is the only view of what a reader would actually see; recording the
    GEOMETRY turns "does it say the right thing" into "does it say it
    somewhere legible".
    """
    captured: list[Placed] = []
    modes = {"drawString": "left", "drawCentredString": "centre", "drawRightString": "right"}
    # A page number, so an overlap check does not compare page 1's masthead
    # with page 2's. Same y, different sheet of paper.
    page_no = [1]

    def record(name, original):
        def wrapper(self, x, y, text, *args, **kwargs):
            captured.append(
                Placed(page_no[0], modes[name], x, y, text, self._fontname, self._fontsize)
            )
            return original(self, x, y, text, *args, **kwargs)

        return wrapper

    for name in modes:
        monkeypatch.setattr(pdf_canvas.Canvas, name, record(name, getattr(pdf_canvas.Canvas, name)))

    show_page = pdf_canvas.Canvas.showPage

    def counted_show_page(self, *args, **kwargs):
        page_no[0] += 1
        return show_page(self, *args, **kwargs)

    monkeypatch.setattr(pdf_canvas.Canvas, "showPage", counted_show_page)
    return captured


def texts(placed: list[Placed]) -> list[str]:
    return [item.text for item in placed]


def page(placed: list[Placed]) -> str:
    """Everything the page says, as one string, for substring assertions."""
    return "\n".join(texts(placed))


def build(**overrides) -> bytes:
    kwargs: dict[str, Any] = {
        "event_title": str(CONTEXT["event_title"]),
        "event_when": str(CONTEXT["event_when"]),
        "event_where": str(CONTEXT["event_where"]),
        "booking_reference": str(CONTEXT["booking_reference"]),
        "tickets": [PdfTicket(t["ticket_type"], t["qr_token"]) for t in CONTEXT["tickets"]],
    }
    kwargs.update(overrides)
    return build_ticket_pdf(**kwargs)


def _page_count(pdf: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page[^s]", pdf))


# ── the file itself ──────────────────────────────────────────────────────


def test_it_is_a_real_pdf_with_one_page_per_ticket():
    pdf = build(payment=FULL_PAYMENT, site_url=SITE)

    # A PDF, not an empty buffer or an HTML error page.
    assert pdf.startswith(b"%PDF-")
    assert pdf.rstrip().endswith(b"%%EOF")
    # One page per ticket: a party of four splits up, and the person holding
    # Gold needs a page that says Gold.
    assert _page_count(pdf) == 2
    assert len(pdf) > 1000


def test_each_page_carries_its_own_tier_and_the_booking_reference(placed):
    build(payment=FULL_PAYMENT, site_url=SITE)

    assert "Gold" in texts(placed) and "Basic" in texts(placed)
    reference = str(CONTEXT["booking_reference"])
    # Once in the booking block and once in the footer, on each of two pages.
    assert sum(1 for text in texts(placed) if reference in text) == 4


def test_the_masthead_carries_the_same_mark_the_emails_do(placed):
    """ "CX", the wordmark and the accent full stop. Three renderers, one
    product — an invoice in a different brand is an invoice people query."""
    build(site_url=SITE)

    assert "CX" in texts(placed)
    assert "Curatix" in texts(placed)
    assert "." in texts(placed)


# ── nothing overprints anything else ─────────────────────────────────────


class TestTheLayoutFitsThePage:
    def test_no_string_runs_past_a_margin(self, placed):
        build(payment=FULL_PAYMENT, site_url=SITE)

        for item in placed:
            assert item.left >= MARGIN - 1, item
            assert item.right <= PAGE_W - MARGIN + 1, item

    def test_the_footers_two_halves_do_not_collide(self, placed):
        """They shared one line and measured ~544pt against 493pt of content
        width, so the sentence overprinted the booking reference — the one
        string on the page somebody reads out to support."""
        build(payment=FULL_PAYMENT, site_url=SITE)

        by_line: dict[tuple[int, float], list[Placed]] = {}
        for item in placed:
            by_line.setdefault((item.page, round(item.y, 1)), []).append(item)
        for line in by_line.values():
            ordered = sorted(line, key=lambda item: item.left)
            for earlier, later in zip(ordered, ordered[1:], strict=False):
                assert earlier.right <= later.left + 1, (earlier, later)

    def test_a_very_long_title_and_venue_still_fit(self, placed):
        build_ticket_pdf(
            event_title="The " + ("Extraordinarily Long Festival Of Things " * 4),
            event_when="Sat 23 Aug 2026, 20:10 IST",
            event_where="A venue with an implausibly long name, " * 3,
            booking_reference="ref-1",
            tickets=[PdfTicket("Gold")],
            payment=FULL_PAYMENT,
            site_url=SITE,
        )

        for item in placed:
            assert item.right <= PAGE_W - MARGIN + 1, item
            assert item.width <= CONTENT_W + 1, item

    def test_nothing_is_drawn_below_the_footer_rule(self, placed):
        """A page that spills past the bottom margin is a page whose last block
        is invisible."""
        build(payment=FULL_PAYMENT, site_url=SITE)

        assert min(item.y for item in placed) >= MARGIN


# ── the QR is gone, and stays gone ───────────────────────────────────────


class TestTheCodeIsNotInTheDocument:
    """The inversion this module was rewritten for. The scannable code lives
    in the app; a forwarded attachment must not admit anybody."""

    def test_no_signed_token_is_ever_drawn(self, placed):
        build(payment=FULL_PAYMENT, site_url=SITE)

        for token in ("v1.eyJ0IjoiYSJ9.deadbeef", "v1.eyJ0IjoiYiJ9.cafebabe"):
            assert token not in page(placed)

    def test_nothing_constructs_a_qr_widget(self, monkeypatch):
        """The strongest available proof: make constructing one an error and
        watch the build succeed anyway. A page-count assertion would pass with
        a QR quietly re-added; this cannot."""
        from reportlab.graphics.barcode import qr

        def explode(*args, **kwargs):
            raise AssertionError("the ticket PDF must not draw a QR code")

        monkeypatch.setattr(qr, "QrCodeWidget", explode)

        assert build(payment=FULL_PAYMENT, site_url=SITE).startswith(b"%PDF-")

    def test_the_reader_is_told_where_the_code_actually_is(self, placed):
        """Somebody who has only ever been handed a QR will look for one here
        first. Saying nothing would read as a broken document."""
        build(payment=FULL_PAYMENT, site_url=SITE)

        assert "receipt, not your entry pass" in page(placed)
        assert "app to be scanned at the gate" in page(placed)


# ── the link back to the app ─────────────────────────────────────────────


class TestTheViewEventTicketButton:
    def test_it_is_a_real_link_annotation_not_a_drawn_rectangle(self, placed):
        pdf = build(payment=FULL_PAYMENT, site_url=SITE)

        assert "View Event Ticket" in texts(placed)
        # `/URI` is the annotation; a picture of a button has none.
        assert (
            re.findall(rb"/URI\s*\(([^)]*)\)", pdf) == [b"https://curatix.test/account/tickets"] * 2
        )

    def test_the_url_is_printed_as_well_as_linked(self, placed):
        """A PDF gets printed, and a printed button is a coloured box. The
        address beside it is what makes the page usable on paper."""
        build(payment=FULL_PAYMENT, site_url=SITE)

        assert f"{SITE}/account/tickets" in texts(placed)

    def test_no_site_url_draws_no_button_and_no_dead_link(self, placed):
        pdf = build(payment=FULL_PAYMENT)

        assert b"/URI" not in pdf
        assert "View Event Ticket" not in texts(placed)
        # …and the sentence that replaces it still says what to do.
        assert "app to be scanned at the gate" in page(placed)


# ── the payment block ────────────────────────────────────────────────────


class TestThePaymentBlock:
    def test_it_carries_the_figures(self, placed):
        build(payment=FULL_PAYMENT, site_url=SITE)

        printed = page(placed)
        assert "Amount paid" in printed
        assert "2,400.00" in printed
        assert "pay_QwErTy123456" in printed
        assert "UPI" in printed
        assert "Fri 01 Aug 2026, 11:04 IST" in printed

    def test_the_platform_fee_is_shown_as_included_never_added(self, placed):
        """The backend takes the fee OUT of the total. Presenting it as a
        surcharge would show a buyer a figure they were never charged, and the
        frontend holds the same line."""
        build(payment=FULL_PAYMENT, site_url=SITE)

        printed = page(placed)
        assert "Includes platform fee" in printed
        assert "120.00" in printed
        # The total is unchanged by the fee line.
        assert "INR 2,400.00" in printed

    def test_the_rupee_sign_never_becomes_a_black_box(self, placed):
        """reportlab's built-in Helvetica is WinAnsi; a character outside it is
        substituted from a symbol font, which draws a filled square. `₹` is
        outside it, so the amount on a receipt is exactly where that lands."""
        build(payment=FULL_PAYMENT, site_url=SITE)

        assert "₹" not in page(placed)
        assert "INR 2,400.00" in page(placed)

    def test_an_absent_payment_omits_the_whole_block(self, placed):
        build(site_url=SITE)

        printed = page(placed)
        assert "Amount paid" not in printed
        assert "Payment reference" not in printed
        # The rest of the receipt is intact.
        assert "Booking reference" in printed

    def test_an_empty_payment_is_the_same_as_no_payment(self, placed):
        """A `PdfPayment()` with nothing set must not draw an empty card. On a
        receipt that reads as a failed lookup."""
        build(payment=PdfPayment(), site_url=SITE)

        assert "Amount paid" not in page(placed)

    def test_a_partial_payment_draws_only_the_rows_it_has(self, placed):
        build(payment=PdfPayment(amount_display="₹500.00"), site_url=SITE)

        printed = page(placed)
        assert "INR 500.00" in printed
        assert "Method" not in printed
        assert "Payment reference" not in printed


# ── everything optional, absent ──────────────────────────────────────────


class TestNothingOptionalIsRequired:
    def test_the_minimum_call_still_produces_a_document(self, placed):
        """The signature the existing caller in `handlers.py` uses today. It
        must keep working until that caller is updated."""
        pdf = build_ticket_pdf(
            event_title="Gig",
            event_when="Sat",
            event_where="Venue, City",
            booking_reference="ref-1",
            tickets=[PdfTicket("Gold", "v1.abc.def")],
        )

        assert pdf.startswith(b"%PDF-")
        assert _page_count(pdf) == 1
        assert "ref-1" in page(placed)

    def test_the_word_none_is_never_printed(self, placed):
        build_ticket_pdf(
            event_title="Gig",
            event_when="Sat",
            event_where="Venue",
            booking_reference="ref-1",
            tickets=[PdfTicket(ticket_type="Gold")],
            booking=PdfBooking(reference="ref-1"),
            payment=PdfPayment(),
        )

        assert "None" not in page(placed)

    def test_an_attendee_appears_only_when_assigned(self, placed):
        build(booking=PdfBooking(reference="ref-1"), site_url=SITE)
        assert "Attendee" not in page(placed)

        placed.clear()
        build(booking=PdfBooking(reference="ref-1", attendee="Asha Rao"), site_url=SITE)
        assert "Attendee" in page(placed)
        assert "Asha Rao" in page(placed)

    def test_a_per_ticket_attendee_wins_over_the_booking_wide_one(self, placed):
        """If a specific admission has been assigned to somebody, that is who
        that page is for."""
        build_ticket_pdf(
            event_title="Gig",
            event_when="Sat",
            event_where="Venue",
            booking_reference="ref-1",
            tickets=[PdfTicket("Gold", attendee="Ravi")],
            booking=PdfBooking(reference="ref-1", attendee="Asha"),
        )

        assert "Ravi" in texts(placed)
        assert "Asha" not in texts(placed)

    def test_no_tickets_still_produces_an_openable_file(self, placed):
        """A zero-page PDF is a file some viewers refuse to open. It should not
        happen; if it does the right output is the receipt without a tier."""
        pdf = build_ticket_pdf(
            event_title="Gig",
            event_when="Sat",
            event_where="Venue",
            booking_reference="ref-1",
            tickets=[],
        )

        assert pdf.startswith(b"%PDF-")
        assert _page_count(pdf) == 1
        # …and no empty "TICKET TYPE" label sitting over nothing.
        assert "TICKET TYPE" not in page(placed)


# ── the attachment contract ──────────────────────────────────────────────


def test_the_email_carries_the_pdf_as_an_attachment():
    rendered = TemplateService().render(
        notification_type=NotificationType.TICKET_DELIVERY,
        channel="email",
        context=dict(CONTEXT),
    )

    assert len(rendered.attachments) == 1
    attachment = rendered.attachments[0]
    assert attachment.content_type == "application/pdf"
    assert attachment.filename.endswith(".pdf")
    assert str(CONTEXT["booking_reference"]) in attachment.filename
    assert attachment.content.startswith(b"%PDF-")


def test_the_email_context_reaches_the_payment_block(placed):
    """The handler passes payment facts through the notification context; a
    template that dropped them would leave a receipt with no receipt on it."""
    TemplateService().render(
        notification_type=NotificationType.TICKET_DELIVERY,
        channel="email",
        context=dict(CONTEXT),
    )

    assert "INR 2,400.00" in page(placed)
    assert "pay_QwErTy123456" in page(placed)


def test_a_broken_pdf_never_costs_the_email(monkeypatch):
    """The property this whole try/except exists for.

    The signed tokens live in the text body and the account link in the HTML,
    so a failed attachment must degrade the message — never dead-letter the
    single most important notification in the system.
    """
    monkeypatch.setattr(
        "apps.notifications.templates.build_ticket_pdf",
        lambda **_: (_ for _ in ()).throw(RuntimeError("font subsystem exploded")),
    )

    rendered = TemplateService().render(
        notification_type=NotificationType.TICKET_DELIVERY,
        channel="email",
        context=dict(CONTEXT),
    )

    assert rendered.attachments == ()
    # Still a complete, actionable message.
    assert rendered.subject
    assert "v1.eyJ0IjoiYSJ9.deadbeef" in rendered.body
    assert str(CONTEXT["booking_reference"]) in rendered.body
