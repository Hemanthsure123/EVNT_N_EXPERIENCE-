"""Sharing a booking receipt.

The tests that matter here are about what the document does NOT contain. A
receipt that leaks a scannable code is not a smaller bug than one that fails to
render — it is somebody else walking through the gate.
"""

from __future__ import annotations

import base64
import re
import zlib
from datetime import datetime, timezone

import pytest

from apps.booking.receipt_pdf import MAX_LINE_ITEMS, Receipt, ReceiptLine, build_receipt_pdf
from core.errors import InvalidInputError, NotFoundError

pytestmark = pytest.mark.django_db


def pdf_text(pdf: bytes) -> str:
    """The visible text of the page, decoded.

    reportlab writes its content stream through TWO filters — ASCII85 then
    Flate — so neither a raw byte search nor a plain `zlib.decompress` finds
    anything in it. Both were tried here first. The byte search failed loudly;
    the zlib one silently returned an empty string, which made the "no ticket
    token" assertion below pass while checking nothing. That is the worse of
    the two failures, and it is why this helper exists rather than a substring
    test on the raw bytes.
    """
    out = []
    for match in re.finditer(rb"stream\r?\n(.*?)endstream", pdf, re.S):
        chunk = match.group(1).strip()
        # reportlab terminates its ASCII85 with `~>` but writes no `<~` opener,
        # so neither `adobe=True` nor `adobe=False` accepts it as-is. Stripping
        # the terminator is what makes the standard decoder work — without it
        # every chunk raised, fell back to the raw bytes, failed to inflate,
        # and this function returned "".
        if chunk.endswith(b"~>"):
            chunk = chunk[:-2]
        try:
            decoded = base64.a85decode(chunk, adobe=False, ignorechars=b" \t\r\n")
        except ValueError:
            decoded = chunk
        try:
            out.append(zlib.decompress(decoded).decode("latin-1"))
        except zlib.error:
            continue
    return "\n".join(out)


def receipt(lines: int = 2, title: str = "Techie Summit") -> Receipt:
    return Receipt(
        booking_reference="b940fa21-8c0b-4324-91e7-bfe92c13bd44",
        booked_by="Hemanth Sure",
        booked_on=datetime(2026, 8, 9, 14, 30, tzinfo=timezone.utc),
        event_title=title,
        event_starts_at=datetime(2026, 8, 12, 19, 17, tzinfo=timezone.utc),
        venue="Convention Center",
        city="Pune",
        lines=tuple(
            ReceiptLine(description=f"Tier {n}", quantity=n + 1, amount_minor=5000 * (n + 1))
            for n in range(lines)
        ),
        total_minor=123456,
        payment_reference="pay_RxYz123",
    )


class TestTheDocument:
    def test_the_decoder_these_tests_depend_on_actually_works(self):
        # Guards the helper above. Without it, a change to reportlab's filter
        # chain would turn every content assertion in this class vacuous rather
        # than failing — which is exactly what happened while writing them.
        assert "Techie Summit" in pdf_text(build_receipt_pdf(receipt()))

    def test_it_renders_a_pdf(self):
        assert build_receipt_pdf(receipt()).startswith(b"%PDF-")

    def test_it_is_ONE_page_even_with_more_lines_than_it_shows(self):
        # A booking with forty tiers must summarise rather than spill, and
        # `build_receipt_pdf` raises if it ever does.
        pdf = build_receipt_pdf(receipt(lines=MAX_LINE_ITEMS + 20))
        assert b"/Count 1" in pdf  # the page-tree count in the PDF catalogue

    def test_a_long_title_does_not_raise(self):
        build_receipt_pdf(receipt(title="A " + "very " * 60 + "long festival name"))

    def test_it_says_on_its_face_that_it_is_not_a_ticket(self):
        # Somebody forwarded a booking document assumes it admits them. The
        # cheap place to correct that is the document; the expensive place is
        # the gate.
        assert "receipt, not a ticket" in pdf_text(build_receipt_pdf(receipt()))

    def test_it_carries_no_qr_code_and_no_ticket_token(self):
        """The security property this whole document exists around.

        A PDF is forwardable by everyone it reaches, so a code on it admits
        whoever opens the mail next. Ticketmaster emails a claim link and
        reissues the QR on acceptance; DICE never lets it leave the app.
        """
        pdf = build_receipt_pdf(receipt())
        # `v1.` prefixes every signed ticket token (see apps.booking.qr).
        assert "v1." not in pdf_text(pdf)
        # A drawn image is an XObject with this subtype. Checking for `/Image`
        # alone does not work — reportlab writes `/ImageB /ImageC /ImageI` into
        # every page's ProcSet whether one is used or not, so that assertion
        # failed on a document containing no images at all.
        assert b"/Subtype /Image" not in pdf

    def test_amounts_use_indian_digit_grouping(self):
        from apps.booking.receipt_pdf import _rupees

        # A lakh groups as 1,00,000, which is what `f"{x:,}"` gets wrong on
        # every receipt in the country this platform sells in.
        assert _rupees(123456) == "₹1,234.56"
        assert _rupees(10000000) == "₹1,00,000.00"


@pytest.fixture
def booking(booking_service, event, buyer, make_tier):
    """A real reserved booking, through the real service."""
    tier = make_tier(name="Premium", quantity=50)
    return booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    ).booking


class TestWhoMayShare:
    def test_a_stranger_gets_not_found_rather_than_permission_denied(
        self, booking_service, other_user, booking
    ):
        booking_service.confirm_booking(booking_id=booking.id, payment_ref="pay_ok")
        # A distinct "not yours" would confirm the id names a real booking to
        # somebody guessing ids.
        with pytest.raises(NotFoundError):
            booking_service.share_receipt(
                booking_id=booking.id, actor_id=other_user.id, emails=["a@b.com"]
            )

    def test_an_unpaid_booking_has_no_receipt_to_send(self, booking_service, buyer, booking):
        with pytest.raises(InvalidInputError) as error:
            booking_service.share_receipt(
                booking_id=booking.id, actor_id=buyer.id, emails=["a@b.com"]
            )
        assert "not been paid" in str(error.value)

    def test_the_buyer_can_share_a_paid_booking(
        self, booking_service, buyer, booking, django_capture_on_commit_callbacks
    ):
        booking_service.confirm_booking(booking_id=booking.id, payment_ref="pay_ok")
        with django_capture_on_commit_callbacks(execute=True):
            queued = booking_service.share_receipt(
                booking_id=booking.id,
                actor_id=buyer.id,
                emails=["friend@example.com", "family@example.com"],
            )
        assert queued == 2

    def test_more_recipients_than_the_cap_is_refused(self, booking_service, buyer, booking):
        booking_service.confirm_booking(booking_id=booking.id, payment_ref="pay_ok")
        with pytest.raises(InvalidInputError):
            booking_service.share_receipt(
                booking_id=booking.id,
                actor_id=buyer.id,
                emails=[f"p{n}@example.com" for n in range(20)],
            )


class TestRecipients:
    def test_addresses_are_deduplicated_so_the_count_is_honest(self):
        from apps.booking.services import _clean_recipients

        # The notification ledger would swallow the second send silently, so
        # without this the caller is told it sent more mail than it did.
        assert _clean_recipients(["A@B.com", "a@b.com", " a@b.com "]) == ["a@b.com"]

    def test_a_malformed_address_is_named_in_the_refusal(self):
        from apps.booking.services import _clean_recipients

        with pytest.raises(InvalidInputError) as error:
            _clean_recipients(["fine@example.com", "not-an-email"])
        assert "not-an-email" in str(error.value)

    def test_empty_entries_are_skipped_rather_than_rejected(self):
        from apps.booking.services import _clean_recipients

        # A chip input leaves blanks behind. Refusing the whole send over one
        # is worse than ignoring it.
        assert _clean_recipients(["", "  ", "a@b.com"]) == ["a@b.com"]
