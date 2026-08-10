"""The HTML email layer.

Almost none of what makes an HTML email good is testable here — whether it
renders in Outlook 2019 is answered by sending one, not by asserting on a
string. What IS testable is the part that is a security boundary, the part
that is a contract, and the small set of structural rules that separate
"bulletproof email HTML" from "web HTML pasted into a message". Those are
what this file covers, and it covers them for EVERY email type rather than
for whichever one was convenient — a layout regression that only reaches the
payout email is a layout regression nobody sees for a month.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from apps.notifications import email_layout as ui
from apps.notifications.models import NotificationChannel, NotificationType
from apps.notifications.templates import CHANNEL_BY_TYPE, TemplateService

SITE = "https://curatix.test"

# One representative context per email type. Heterogeneous by nature (strings
# beside a list of ticket dicts), so annotated — left to inference the values
# collapse to a common supertype and indexing a ticket stops type-checking.
CONTEXTS: dict[str, dict[str, Any]] = {
    NotificationType.WELCOME: {"name": "Asha Rao", "email": "asha@example.com"},
    # The buyer forwarding their RECEIPT to whoever they booked for. No code,
    # no account link — see `apps.booking.receipt_pdf` for why that is a
    # security decision rather than a content preference.
    NotificationType.BOOKING_RECEIPT_SHARED: {
        "booker_name": "Asha Rao",
        "event_title": "Sunburn Jazz Night",
        "event_when": "Sat 23 Aug 2026, 20:10 IST",
        "event_where": "Phoenix Arena, Mumbai",
        "booking_reference": "3f1d9c22-0000-4000-8000-000000000001",
        "total_display": "₹2,400.00",
        "note": "See you there!",
        # A real (tiny) base64 payload, so the attachment branch is exercised
        # rather than skipped — that branch is the whole point of this type.
        "receipt_pdf_b64": "JVBERi0xLjQK",
    },
    NotificationType.TICKET_DELIVERY: {
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
            "paid_at": "Fri 01 Aug 2026, 11:04 IST",
            "status_label": "Paid",
        },
        "tickets": [
            {"ticket_type": "Gold", "qr_token": "v1.aaa.bbb"},
            {"ticket_type": "Gold", "qr_token": "v1.ccc.ddd"},
            {"ticket_type": "Basic", "qr_token": "v1.eee.fff"},
        ],
    },
    # A guest the buyer named. No payment block and no other guest's token —
    # the deliberate difference from TICKET_DELIVERY above, which is what the
    # dedicated content assertions further down check.
    NotificationType.ATTENDEE_TICKET: {
        "attendee_name": "Ravi Menon",
        "booked_by": "Asha Rao",
        "event_title": "Sunburn Jazz Night",
        "event_when": "Sat 23 Aug 2026, 20:10 IST",
        "event_where": "Phoenix Arena, Mumbai",
        "ticket_type": "Gold",
        "qr_token": "v1.ggg.hhh",
    },
    NotificationType.REFUND_CONFIRMATION: {
        "name": "Asha Rao",
        "event_title": "Sunburn Jazz Night",
        "booking_reference": "bk-1",
        "amount_display": "₹2,400.00",
    },
    NotificationType.EMAIL_VERIFICATION: {
        "full_name": "Asha Rao",
        "code": "482913",
        "ttl_minutes": 10,
    },
    NotificationType.EVENT_REMINDER: {
        "name": "Asha Rao",
        "event_title": "Sunburn Jazz Night",
        "event_when": "Sat 23 Aug 2026, 20:10 IST",
        "event_where": "Phoenix Arena, Mumbai",
    },
    NotificationType.PAYOUT_RELEASED: {
        "event_title": "Sunburn Jazz Night",
        "amount_display": "₹1,84,320.00",
        "provider_ref": "trf_QwErTy123456",
    },
    # ── The refund REQUEST lifecycle ────────────────────────────────────
    # Three types, three audiences. The organiser is told somebody is waiting;
    # the customer is told what was decided. None of them says "you have been
    # refunded" — that is REFUND_CONFIRMATION, which fires only once money has
    # actually moved.
    NotificationType.REFUND_REQUEST_RECEIVED: {
        "customer_email": "asha@example.com",
        "customer_name": "Asha Rao",
        "event_title": "Sunburn Jazz Night",
        "booking_reference": "44444444-4444-4444-8444-444444444444",
        "amount_display": "₹2,500.00",
        "reason": "The headline act was replaced and I only bought for them.",
    },
    NotificationType.REFUND_REQUEST_APPROVED: {
        "name": "Asha Rao",
        "event_title": "Sunburn Jazz Night",
        "booking_reference": "44444444-4444-4444-8444-444444444444",
        "amount_display": "₹2,500.00",
        # Optional on an approval — the block is simply omitted without one.
        "note": "Sorry about the line-up change.",
    },
    NotificationType.REFUND_REQUEST_REJECTED: {
        "name": "Asha Rao",
        "event_title": "Sunburn Jazz Night",
        "booking_reference": "44444444-4444-4444-8444-444444444444",
        # REQUIRED. The service refuses a rejection without one, so a context
        # here that omitted it would be testing a message that cannot be sent.
        "note": "The support act changed, not the headliner. Tickets stay valid.",
    },
    # An operator removed an event. Two audiences, two messages — the attendee
    # is told their booking is cancelled and their money is coming back; the
    # organiser is told their event was removed and why.
    NotificationType.EVENT_CANCELLED_ATTENDEE: {
        "name": "Asha Rao",
        "event_title": "Sunburn Jazz Night",
        "booking_reference": "55555555-5555-4555-8555-555555555555",
    },
    NotificationType.EVENT_DELETED_ORGANIZER: {
        "event_title": "Sunburn Jazz Night",
        # REQUIRED by the service, so a context without it would be testing a
        # message that cannot be sent.
        "reason": "Could not produce a venue licence for this date.",
        "refunded_bookings": 12,
    },
    NotificationType.ADMIN_EVENT_REVIEW: {
        "event_id": "11111111-1111-4111-8111-111111111111",
        "event_title": "Sunburn Jazz Night",
        "submitted_by": "organiser@example.com",
    },
    NotificationType.ADMIN_ORG_VERIFICATION: {
        "organization_id": "22222222-2222-4222-8222-222222222222",
        "organization_name": "Phoenix Live Pvt Ltd",
        "submitted_by": "organiser@example.com",
    },
    NotificationType.ADMIN_PERFORMER_REVIEW: {
        "performer_id": "33333333-3333-4333-8333-333333333333",
        "stage_name": "The Bombay Brass",
        "submitted_by": "organiser@example.com",
    },
    # The hire desk. Two audiences, two messages: the operator gets the
    # contact details (the alert IS the delivery mechanism — nothing is
    # matched automatically), the customer gets an acknowledgement with no
    # timeframe in it.
    NotificationType.ADMIN_HIRE_ENQUIRY: {
        "performer_type": "Band",
        "city": "Mumbai",
        "event_date": "2026-12-01",
        "contact_name": "Asha Rao",
        "contact_phone": "+91 98765 43210",
        "contact_email": "asha@example.com",
        "budget": "₹50,000.00 - ₹80,000.00",
    },
    NotificationType.HIRE_ENQUIRY_RECEIVED: {
        "performer_type": "Band",
        "city": "Mumbai",
        "event_date": "2026-12-01",
        "contact_name": "Asha Rao",
    },
}

EMAIL_TYPES = sorted(
    kind for kind, channel in CHANNEL_BY_TYPE.items() if channel == NotificationChannel.EMAIL
)


@pytest.fixture
def templates() -> TemplateService:
    return TemplateService()


@pytest.fixture(autouse=True)
def _site(settings):
    """Every structural test runs with a configured site, because that is the
    shape with the most in it — the button, the links, the full message."""
    settings.PUBLIC_SITE_URL = SITE


def render(kind: str) -> Any:
    return TemplateService().render(
        notification_type=kind,
        channel=NotificationChannel.EMAIL,
        context=dict(CONTEXTS[kind]),
    )


def test_every_email_type_has_a_context_here():
    """A new email type must arrive with a rendering test, not without one.
    This is the assertion that makes the parametrised tests below complete
    rather than merely long."""
    assert set(EMAIL_TYPES) == set(CONTEXTS)


# ── the structural contract, for every type ──────────────────────────────


@pytest.mark.parametrize("kind", EMAIL_TYPES)
class TestEveryEmailIsBulletproof:
    """Email is not the web, and these are the rules that differ.

    Each one has a client behind it: a `<link>` is stripped by Gmail, a flex
    container is ignored by Word, a message over ~102KB is clipped by Gmail
    behind a "view entire message" link.
    """

    def test_the_layout_is_tables(self, kind):
        html = render(kind).html
        assert html.count("<table") >= 4
        # The three things Word cannot lay out. A single one of these is a
        # message that renders as one long unstyled column in Outlook.
        assert "display:flex" not in html
        assert "display:grid" not in html
        assert "position:absolute" not in html

    def test_nothing_is_loaded_from_another_host(self, kind):
        """A stylesheet, a web font or a tracking image is a request a mail
        client either blocks or strips. Everything must already be in the
        message."""
        html = render(kind).html
        assert "<link" not in html
        assert "@import" not in html
        assert "fonts.googleapis" not in html
        assert "<script" not in html
        # No images at all — so nothing depends on image loading and nothing
        # needs an `alt` that could be forgotten.
        assert "<img" not in html

    def test_styles_are_inlined_on_the_elements(self, kind):
        """The `<style>` block is polish; every load-bearing declaration is
        also inline, because Gmail strips `<head>` styles in some clients and
        Yahoo rewrites class names."""
        html = render(kind).html
        assert html.count('style="') > 25

    def test_it_carries_the_brand_mark(self, kind):
        """The wordmark, the accent full stop and the monogram from
        `frontend/components/shell/brand-mark.tsx`. An email that does not
        look like the app is an email that looks like a phishing attempt."""
        html = render(kind).html
        assert ui.PRODUCT_NAME in html
        assert f'<span style="color:{ui.BRAND_LIFT};">.</span>' in html
        assert ">CX<" in html

    def test_it_has_a_preheader(self, kind):
        """The inbox preview line. Unset, clients scrape the greeting."""
        html = render(kind).html
        assert "mso-hide:all" in html
        preview = html.split("mso-hide:all", 1)[1][:400]
        assert re.search(r">[^<]{6,}", preview)

    def test_there_is_at_most_one_call_to_action(self, kind):
        """ONE primary action per message. Two buttons is a message that has
        not decided what it wants somebody to do, and the second is always the
        one that gets pressed by mistake."""
        html = render(kind).html
        assert html.count("<a href") <= 1

    def test_a_button_is_bulletproof_not_a_styled_anchor(self, kind):
        """Word gives an inline `<a>` no background and no padding, so a
        styled anchor collapses to blue underlined text there. Every anchor
        must be paired with exactly one VML rectangle, and the two are
        mutually exclusive by conditional comment."""
        html = render(kind).html
        assert html.count("<a href") == html.count("<v:roundrect")
        if "<v:roundrect" in html:
            assert 'xmlns:v="urn:schemas-microsoft-com:vml"' in html
            assert "<w:anchorlock/>" in html
            assert "<!--[if mso]>" in html
            assert "<!--[if !mso]><!-->" in html

    def test_the_plain_text_alternative_is_complete(self, kind):
        """`body` is always sent; `html` is the enhancement. A text part that
        went missing would be invisible until somebody with a text-only client
        complained."""
        rendered = render(kind)
        assert len(rendered.body.strip()) > 40
        assert "<" not in rendered.body  # genuinely plain, not markup
        assert rendered.subject.strip()

    def test_it_is_a_600px_column_that_collapses_on_a_phone(self, kind):
        html = render(kind).html
        assert 'width="600"' in html
        assert "max-width:600px" in html
        assert "@media only screen and (max-width:620px)" in html

    def test_it_stays_well_under_gmails_clipping_threshold(self, kind):
        """Gmail clips at ~102KB and hides everything after it behind a "View
        entire message" link — which for a code email would hide the code."""
        assert len(render(kind).html.encode()) < 40_000

    def test_layout_tables_are_not_announced_as_data(self, kind):
        """A screen reader reads an unmarked layout table cell by cell. Every
        table here is layout."""
        html = render(kind).html
        assert html.count('role="presentation"') >= html.count("<table") - 1


# ── the client-specific hacks, asserted once ─────────────────────────────


class TestTheOutlookPath:
    def test_word_is_given_a_font_it_actually_has(self):
        """Word falls back to Times New Roman for any stack it does not
        recognise, which is all of them. Without this the entire message is
        serif in Outlook for Windows."""
        html = render(NotificationType.WELCOME).html
        assert "Arial, Helvetica, sans-serif !important" in html
        assert "<o:AllowPNG/>" in html

    def test_tables_carry_words_spacing_hints(self):
        """Word adds its own spacing around tables unless told not to."""
        html = render(NotificationType.TICKET_DELIVERY).html
        assert "mso-table-lspace:0pt" in html


class TestDarkMode:
    def test_it_declares_both_colour_schemes(self):
        """Without `color-scheme`, Apple Mail and Outlook auto-invert the
        whole message, which turns a white card into muddy grey and the
        masthead into a colour we never chose."""
        html = render(NotificationType.WELCOME).html
        assert 'name="color-scheme" content="light dark"' in html
        assert 'name="supported-color-schemes" content="light dark"' in html

    def test_outlook_com_gets_its_own_selectors(self):
        """It rewrites the message and prefixes `[data-ogsc]` rather than
        supporting the media query."""
        html = render(NotificationType.WELCOME).html
        assert "@media (prefers-color-scheme: dark)" in html
        assert "[data-ogsc]" in html


class TestAccessibility:
    def test_the_document_declares_a_language_and_a_title(self):
        html = render(NotificationType.REFUND_CONFIRMATION).html
        assert 'lang="en"' in html
        assert "<title>" in html

    def test_the_monogram_is_hidden_from_screen_readers(self):
        """It sits directly beside the wordmark. Announced, the product name
        is read twice — "C X Curatix"."""
        html = render(NotificationType.WELCOME).html
        badge = html.split(">CX<", 1)[0]
        assert 'aria-hidden="true"' in badge[-400:]

    def test_the_body_text_colours_are_the_checked_ones(self):
        """Contrast is a property of the constants, so it is asserted on the
        constants. 7.64:1, 5.28:1 and 17.2:1 on white; the ratios are recorded
        beside them in `email_layout.py`."""
        assert (ui.INK, ui.BODY_TEXT, ui.SUBTLE_TEXT) == ("#1C1B19", "#57534D", "#706B64")


# ── security: user-controlled strings land inside markup ─────────────────


class TestEscaping:
    """A display name lands inside markup in a message we send in OUR name.
    Unescaped, that is HTML injection into a trusted email — a phishing
    primitive, not a cosmetic bug."""

    def test_a_name_containing_markup_is_escaped(self, templates):
        rendered = templates.render(
            notification_type=NotificationType.EMAIL_VERIFICATION,
            channel=NotificationChannel.EMAIL,
            context={
                "full_name": "<img src=x onerror=alert(1)>",
                "code": "123456",
                "ttl_minutes": 10,
            },
        )

        assert "<img src=x" not in rendered.html
        assert "&lt;img src=x" in rendered.html

    def test_a_link_label_cannot_break_out_of_its_attribute(self):
        html = ui.button("Go", 'https://x.test/"><script>alert(1)</script>')

        assert "<script>" not in html
        assert "&quot;" in html or "&#x27;" in html

    def test_the_vml_href_is_escaped_too(self):
        """Two hrefs now, not one. The Outlook half is a separate attribute in
        a separate element and would be a separate injection point."""
        html = ui.button("Go", 'https://x.test/"onmouseover="alert(1)')

        assert 'onmouseover="alert(1)' not in html
        assert html.count("&quot;") >= 2

    def test_fact_values_are_escaped(self):
        html = ui.facts([("Event", "<b>bold</b>")])

        assert "<b>bold</b>" not in html
        assert "&lt;b&gt;" in html

    def test_an_event_title_cannot_inject_through_the_hero(self):
        html = ui.hero(label="When", value="<b>x</b>", sub="<i>y</i>")

        assert "<b>x</b>" not in html and "<i>y</i>" not in html


# ── the multipart contract ───────────────────────────────────────────────


class TestTheMultipartContract:
    def test_the_text_and_html_carry_the_same_code(self, templates):
        """They are built from one set of facts. Two renderings that disagree
        is a user typing the code from whichever part their client showed."""
        rendered = templates.render(
            notification_type=NotificationType.EMAIL_VERIFICATION,
            channel=NotificationChannel.EMAIL,
            context={"full_name": "Ada", "code": "778899", "ttl_minutes": 10},
        )

        assert "778899" in rendered.body
        assert "778899" in rendered.html
        assert "778899" in rendered.subject

    def test_sms_gets_no_html(self, templates):
        """The field exists for email. An SMS with an HTML alternative would
        be a rendering nobody asked for and a column nobody reads."""
        rendered = templates.render(
            notification_type=NotificationType.OTP,
            channel=NotificationChannel.SMS,
            context={"code": "123456", "ttl_minutes": 10},
        )

        assert rendered.html == ""

    def test_the_preheader_carries_the_code(self, templates):
        """It becomes the inbox preview line. Left unset, clients scrape the
        greeting instead — wasting the one place the code could be read
        without opening the message."""
        rendered = templates.render(
            notification_type=NotificationType.EMAIL_VERIFICATION,
            channel=NotificationChannel.EMAIL,
            context={"full_name": "Ada", "code": "445566", "ttl_minutes": 10},
        )

        preheader = rendered.html.split("mso-hide:all", 1)[1][:200]
        assert "445566" in preheader

    def test_the_verification_email_carries_no_link_at_all(self):
        """A verification LINK trains people to click whatever arrives
        claiming to be us, and cannot be completed on a different device from
        the one that started the sign-up. The code is the whole mechanism —
        which means the footer must not quietly reintroduce a link either."""
        rendered = render(NotificationType.EMAIL_VERIFICATION)

        assert "<a href" not in rendered.html
        assert "http" not in rendered.body


class TestAMissingSiteUrl:
    def test_it_drops_the_button_rather_than_linking_nowhere(self, templates, settings):
        """A dead call-to-action reads as the product being broken."""
        settings.PUBLIC_SITE_URL = ""

        rendered = templates.render(
            notification_type=NotificationType.WELCOME,
            channel=NotificationChannel.EMAIL,
            context={"name": "Ada", "email": "ada@example.com"},
        )

        assert "<a href" not in rendered.html
        assert "<v:roundrect" not in rendered.html
        # …and the message still says everything it needed to.
        assert "your account is ready" in rendered.body

    def test_the_ticket_email_is_still_complete_without_one(self, settings):
        """The one message that must never degrade. Without a site URL it
        loses its button and keeps every fact, including the tokens."""
        settings.PUBLIC_SITE_URL = ""

        rendered = render(NotificationType.TICKET_DELIVERY)

        assert "<a href" not in rendered.html
        for fact in ("Sunburn Jazz Night", "Phoenix Arena, Mumbai", "3f1d9c22"):
            assert fact in rendered.html
        assert "v1.aaa.bbb" in rendered.body


class TestTheButtonWidth:
    """VML has no shrink-to-fit: Word draws the width it is given and clips
    the label. The estimate must err generous, and must stay bounded."""

    def test_a_longer_label_gets_a_wider_button(self):
        narrow = ui._button_width("Go")
        wide = ui._button_width("Open the moderation queue")
        assert wide > narrow

    def test_it_never_exceeds_the_column_or_collapses_to_nothing(self):
        assert ui._button_width("") >= 180
        assert ui._button_width("x" * 200) <= 420
