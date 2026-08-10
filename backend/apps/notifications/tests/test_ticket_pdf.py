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
from datetime import datetime
from datetime import timezone as dt_timezone
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
# Built by `handlers._directions_url`, which builds it the same way
# frontend/lib/api/maps.ts does — asserted here as a literal so a change to
# either side of that pair has to be made deliberately.
MAPS_URL = "https://www.google.com/maps/search/?api=1&query=Phoenix%20Arena%2C%20Mumbai"
ISSUED = "Fri 01 Aug 2026, 11:04 IST"

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


def uris(pdf: bytes) -> set[bytes]:
    """Every URL the file is actually clickable to.

    A SET, and that matters: this used to be compared against one URI repeated
    once per page, which is an assertion about how many links the document has
    rather than which — so adding the directions link broke a test that was
    checking the ticket link. The property is "these addresses are reachable".
    """
    return set(re.findall(rb"/URI\s*\(([^)]*)\)", pdf))


class TestTheViewEventTicketButton:
    def test_it_is_a_real_link_annotation_not_a_drawn_rectangle(self, placed):
        pdf = build(payment=FULL_PAYMENT, site_url=SITE, maps_url=MAPS_URL)

        assert "View Event Ticket" in texts(placed)
        # `/URI` is the annotation; a picture of a button has none.
        assert uris(pdf) == {b"https://curatix.test/account/tickets", MAPS_URL.encode()}

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


# ── the way to the venue ─────────────────────────────────────────────────


class TestTheDirectionsLink:
    def test_it_is_a_real_annotation_with_the_address_printed_beside_it(self, placed):
        pdf = build(payment=FULL_PAYMENT, site_url=SITE, maps_url=MAPS_URL)

        assert "Get directions" in texts(placed)
        assert MAPS_URL.encode() in uris(pdf)
        # Printed as well as linked: a PDF gets printed, and an outlined box on
        # paper is not a route.
        assert MAPS_URL in texts(placed)

    def test_it_is_on_every_page(self, placed):
        """A party of four splits up, and the person holding page 2 is as likely
        to be the one who does not know the venue."""
        build(payment=FULL_PAYMENT, site_url=SITE, maps_url=MAPS_URL)

        assert texts(placed).count("Get directions") == 2

    def test_no_maps_url_draws_nothing_at_all(self, placed):
        """The same rule the ticket button follows: a control that opens an empty
        map reads as the product being broken."""
        pdf = build(payment=FULL_PAYMENT, site_url=SITE, maps_url="")

        assert "Get directions" not in page(placed)
        assert uris(pdf) == {b"https://curatix.test/account/tickets"}


# ── who is presenting it, and when it was issued ─────────────────────────


class TestTheBookingBlock:
    def test_the_organizer_is_named_when_the_caller_has_one(self, placed):
        """The counterparty of the purchase — the name a dispute is opened
        against, which a receipt without it cannot answer."""
        build(payment=FULL_PAYMENT, site_url=SITE, organizer="Notify Demo Co")

        printed = page(placed)
        assert "Organizer" in printed
        assert "Notify Demo Co" in printed

    def test_no_organizer_draws_no_row(self, placed):
        build(payment=FULL_PAYMENT, site_url=SITE)

        assert "Organizer" not in page(placed)

    def test_the_issue_date_appears_only_when_supplied(self, placed):
        build(booking=PdfBooking(reference="ref-1"), site_url=SITE)
        assert "Issued" not in page(placed)

        placed.clear()
        build(booking=PdfBooking(reference="ref-1", issued_at=ISSUED), site_url=SITE)
        printed = page(placed)
        assert "Issued" in printed
        assert ISSUED in printed

    def test_a_full_block_carries_every_fact_and_still_fits(self, placed):
        """The maximal page: a three-line title, every booking row, every payment
        row, both links and the terms. MEASURED, not assumed — the geometry here
        is the whole reason this file records positions."""
        build_ticket_pdf(
            event_title="The " + ("Extraordinarily Long Festival Of Things " * 4),
            event_when=str(CONTEXT["event_when"]),
            event_where="A venue with an implausibly long name, " * 3,
            booking_reference=str(CONTEXT["booking_reference"]),
            tickets=[PdfTicket("Gold — Early bird — INR 300.00 each", attendee="Asha Rao")],
            booking=PdfBooking(reference="ref-1", issued_at=ISSUED, attendee="Ravi Kumar"),
            payment=FULL_PAYMENT,
            site_url=SITE,
            organizer="An Organisation With A Very Long Trading Name Indeed Pvt Ltd",
            maps_url=MAPS_URL,
        )

        printed = page(placed)
        for fact in ("Organizer", "Issued", "Attendee", "Get directions", "ENTRY TERMS"):
            assert fact in printed
        for item in placed:
            assert item.left >= MARGIN - 1, item
            assert item.right <= PAGE_W - MARGIN + 1, item
        # Nothing has been pushed into the footer, which is where an added block
        # goes to become invisible.
        assert min(item.y for item in placed) >= MARGIN


# ── the entry terms ──────────────────────────────────────────────────────


class TestTheEntryTerms:
    def test_the_four_rules_are_printed_by_default(self, placed):
        """The default is CONTENT, not an omission: these are true of every
        ticket this platform issues, so they are the document's own text rather
        than something a caller has to remember to pass."""
        build_ticket_pdf(
            event_title="Gig",
            event_when="Sat",
            event_where="Venue, City",
            booking_reference="ref-1",
            tickets=[PdfTicket("Gold")],
        )

        printed = page(placed)
        assert "ENTRY TERMS" in printed
        assert "One scan admits one person" in printed
        assert "bring photo ID matching that name" in printed
        assert "A refund voids every ticket" in printed
        assert "Entry is only within the scan window" in printed

    def test_the_scan_window_is_never_given_a_number(self, placed):
        """The window is a deployment setting
        (`CHECKIN_WINDOW_OPENS_BEFORE_MINUTES`). A figure printed here would be
        one this document invented, on the line somebody plans their arrival
        around."""
        build(payment=FULL_PAYMENT, site_url=SITE)

        window_line = next(line for line in texts(placed) if "scan window" in line)
        assert not re.search(r"\d", window_line)

    def test_they_are_on_every_page(self, placed):
        build(payment=FULL_PAYMENT, site_url=SITE)

        assert texts(placed).count("ENTRY TERMS") == 2

    def test_a_caller_with_its_own_terms_can_drop_the_block(self, placed):
        build(payment=FULL_PAYMENT, site_url=SITE, terms=())

        assert "ENTRY TERMS" not in page(placed)


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


# ── THE ATTACHMENT CONTRACT, AS THE PRODUCT NOW DEFINES IT ───────────────
#
# These four tests used to assert that the booking-confirmation email carried
# a `ticket_pdf` attachment with one page per ticket. That behaviour was
# removed by an explicit product decision: a party of twelve received a
# twelve-page PDF, and the codes now live in the app with the email carrying
# the confirmation.
#
# They are REWRITTEN rather than deleted, and they are stronger than what they
# replaced: they pin the rule that produced the change — exactly ONE PDF per
# booking, never one per ticket — and they test `ticket_pdf` as the isolated,
# still-working module it now is.


def test_the_booking_confirmation_carries_NO_attachment():
    """The email is the confirmation; the codes are in the app.

    This is the inverse of the assertion that used to live here, and it is the
    product decision itself: attaching a document per booking email is what
    produced the twelve-page PDF.
    """
    rendered = TemplateService().render(
        notification_type=NotificationType.TICKET_DELIVERY,
        channel="email",
        context=dict(CONTEXT),
    )
    assert rendered.attachments == ()
    # The email must still be complete without it.
    assert CONTEXT["booking_reference"] in rendered.body


def test_exactly_ONE_pdf_per_booking_however_many_tickets():
    """The rule, asserted on the ACTIVE path.

    `receipt_pdf` is what a booking produces now, and a booking of twelve
    tickets must produce ONE document — not twelve, and not one per ticket.
    """
    import base64

    from apps.booking.receipt_pdf import Receipt, ReceiptLine, build_receipt_pdf

    twelve = Receipt(
        booking_reference="b940fa21-8c0b-4324-91e7-bfe92c13bd44",
        booked_by="Asha Rao",
        booked_on=datetime(2026, 8, 9, 14, 30, tzinfo=dt_timezone.utc),
        event_title="Sunburn Jazz Night",
        event_starts_at=datetime(2026, 8, 12, 19, 17, tzinfo=dt_timezone.utc),
        venue="Phoenix Arena",
        city="Mumbai",
        lines=(ReceiptLine(description="General", quantity=12, amount_minor=240000),),
        total_minor=240000,
        payment_reference="pay_RxYz123",
    )
    pdf = build_receipt_pdf(twelve)
    assert pdf.startswith(b"%PDF-")

    rendered = TemplateService().render(
        notification_type=NotificationType.BOOKING_RECEIPT_SHARED,
        channel="email",
        context={
            "booker_name": "Asha Rao",
            "event_title": "Sunburn Jazz Night",
            "event_when": "Wed, 12 Aug 2026 at 7:17 pm",
            "event_where": "Phoenix Arena, Mumbai",
            "booking_reference": "b940fa21-8c0b-4324-91e7-bfe92c13bd44",
            "total_display": "₹2,400.00",
            "note": "",
            "receipt_pdf_b64": base64.b64encode(pdf).decode("ascii"),
        },
    )
    # ONE attachment for twelve tickets. This is the whole requirement.
    assert len(rendered.attachments) == 1
    assert rendered.attachments[0].content_type == "application/pdf"


def test_ticket_pdf_still_works_as_an_isolated_module():
    """It is off the email path, not broken.

    Kept in the tree as a working PDF builder rather than deleted, so it can
    be reused (an operator export, a support attachment) without being
    rewritten. A module retained but never exercised rots silently; this is
    what stops that.
    """
    pdf = build(payment=FULL_PAYMENT, site_url=SITE)
    assert pdf.startswith(b"%PDF-")
    assert pdf.rstrip().endswith(b"%%EOF")
    # It is ONE document. Its internal page count is a layout detail of this
    # module; what the product rule constrains is the number of ATTACHMENTS,
    # which the test above pins at one.
    assert _page_count(pdf) == len(CONTEXT["tickets"])


def test_a_broken_pdf_builder_can_never_cost_the_email():
    """The email must survive a PDF failure.

    It does so absolutely now: the confirmation carries no attachment at all,
    so a raising PDF builder cannot reach it. Asserted rather than assumed,
    because the guarantee moved from a try/except to an architectural fact and
    that is exactly the kind of change that quietly stops being true.
    """
    import apps.notifications.ticket_pdf as module

    original = module.build_ticket_pdf
    try:
        module.build_ticket_pdf = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
        rendered = TemplateService().render(
            notification_type=NotificationType.TICKET_DELIVERY,
            channel="email",
            context=dict(CONTEXT),
        )
        assert rendered.subject
        assert rendered.attachments == ()
    finally:
        module.build_ticket_pdf = original
