"""Boundary DTOs. All money fields are integer **minor units** (paise),
consistent with events/ticketing. `qr_token` is the signed, PII-free ticket
token (checkin verifies it later)."""

from __future__ import annotations

from rest_framework import serializers

from .models import Booking, BookingItem, Ticket


class BookingItemRequestSerializer(serializers.Serializer):
    ticket_type_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1)


class CreateBookingRequestSerializer(serializers.Serializer):
    event_id = serializers.UUIDField()
    items = BookingItemRequestSerializer(many=True, allow_empty=False)
    # An optional donation, in minor units, added to what the customer pays.
    # `min_value=0` here and a configured ceiling in the service: the boundary
    # rejects the nonsensical, the service owns the policy — a maximum that
    # lives in settings does not belong in a serializer that cannot read it.
    donation_minor = serializers.IntegerField(min_value=0, required=False, default=0)


class SetDonationRequestSerializer(serializers.Serializer):
    """The donation on a live hold, in minor units. `0` clears it.

    The ceiling is enforced in the service, not here: a maximum that lives in
    settings does not belong in a serializer that cannot read it, and stating
    the same bound in two places is how the two eventually disagree.
    """

    donation_minor = serializers.IntegerField(min_value=0)


class AttendeeAssignmentSerializer(serializers.Serializer):
    """One ticket and the person it admits. Blank name + blank email clears the
    assignment back to "the buyer is going" — the default, which stays valid
    forever. The both-or-neither rule is enforced in the service, where it can
    be stated once alongside the rest of the assignment rules."""

    ticket_id = serializers.UUIDField()
    name = serializers.CharField(max_length=120, allow_blank=True, default="")
    email = serializers.EmailField(allow_blank=True, default="")


class AssignAttendeesRequestSerializer(serializers.Serializer):
    assignments = AttendeeAssignmentSerializer(many=True, allow_empty=False)


class BookingItemSerializer(serializers.ModelSerializer):
    """One line of the order, at the price it was actually billed.

    `phase_name` is the sale phase that priced it, `null` when it billed at the
    tier's face price — so the funnel can label the line "Gold — Early bird"
    rather than leaving a buyer to wonder why the number is lower than the one
    on the tier. It's the label they were shown at checkout, recorded at
    purchase time; the phase row itself may be gone by the time this is read.
    """

    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True)
    unit_price = serializers.IntegerField(source="unit_price_minor", read_only=True)

    class Meta:
        model = BookingItem
        fields = ["ticket_type_id", "ticket_type_name", "quantity", "unit_price", "phase_name"]
        read_only_fields = fields


class BookingSummarySerializer(serializers.ModelSerializer):
    total_amount = serializers.IntegerField(source="total_amount_minor", read_only=True)
    platform_fee = serializers.IntegerField(source="platform_fee_minor", read_only=True)
    donation = serializers.IntegerField(source="donation_amount_minor", read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "event_id",
            "status",
            "total_amount",
            "platform_fee",
            "donation",
            "hold_expires_at",
            "payment_order_id",
            "created_at",
        ]
        read_only_fields = fields


class BookingTicketSerializer(serializers.ModelSerializer):
    """A ticket as it appears inside its own booking: which tier, and who it
    admits. No `qr_token` — the booking screen names attendees, and the codes
    themselves are served by GET /me/tickets (and emailed), so repeating them
    here would put a wallet's worth of live credentials in a response that
    doesn't render them."""

    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True)

    class Meta:
        model = Ticket
        fields = [
            "id",
            "ticket_type_id",
            "ticket_type_name",
            "status",
            "attendee_name",
            "attendee_email",
        ]
        read_only_fields = fields


class BookingDetailSerializer(serializers.ModelSerializer):
    event_title = serializers.CharField(source="event.title", read_only=True)
    total_amount = serializers.IntegerField(source="total_amount_minor", read_only=True)
    platform_fee = serializers.IntegerField(source="platform_fee_minor", read_only=True)
    donation = serializers.IntegerField(source="donation_amount_minor", read_only=True)
    items = BookingItemSerializer(many=True, read_only=True)
    # Empty until the booking is paid — tickets don't exist before that.
    tickets = BookingTicketSerializer(many=True, read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "event_id",
            "event_title",
            "status",
            "total_amount",
            "platform_fee",
            "donation",
            "hold_expires_at",
            "payment_order_id",
            "items",
            "tickets",
            "created_at",
        ]
        read_only_fields = fields


class MyBookingSerializer(serializers.ModelSerializer):
    """One row of the customer's Bookings & Purchases list.

    ── IT CARRIES THE EVENT, AND THAT IS THE POINT ────────────────────────

    `TicketSerializer` returns a title and nothing else, so the account screen
    could name the event and could not say when it was, where it was, or what
    it cost. Every one of those is a column on a row this query has already
    joined — the comment in `components/account/tickets.tsx` calls widening
    this payload "one cheap join" and asks for it to be done before anybody
    reaches for a request per card. This is that join.

    ── THE COUNTS ARE ANNOTATIONS, NOT PYTHON ─────────────────────────────

    `ticket_count` / `active_ticket_count` / `used_ticket_count` come from
    conditional aggregates in `list_for_user`. They are declared with a default
    so this serializer is still usable against a plain `Booking` (a test, a
    single row) without exploding on a missing attribute.

    ── NO REFUND FIELDS HERE, DELIBERATELY ────────────────────────────────

    Whether a refund was asked for lives in `payments`, and `booking` must not
    import it — dependencies point one way. The client already reads
    `/me/refund-requests` and joins by `booking_id`; that join is one request
    for the whole screen, not one per row.
    """

    event_title = serializers.CharField(source="event.title", read_only=True)
    event_slug = serializers.CharField(source="event.slug", read_only=True)
    event_starts_at = serializers.DateTimeField(source="event.starts_at", read_only=True)
    event_ends_at = serializers.DateTimeField(source="event.ends_at", read_only=True)
    event_venue = serializers.CharField(source="event.venue", read_only=True)
    event_city = serializers.CharField(source="event.city", read_only=True)
    event_poster_url = serializers.CharField(source="event.poster_url", read_only=True)
    event_status = serializers.CharField(source="event.status", read_only=True)

    total_amount = serializers.IntegerField(source="total_amount_minor", read_only=True)
    platform_fee = serializers.IntegerField(source="platform_fee_minor", read_only=True)
    donation = serializers.IntegerField(source="donation_amount_minor", read_only=True)

    #: Annotated by `BookingRepository.list_for_user`. `default=0` keeps the
    #: serializer total against a row loaded without the annotation.
    ticket_count = serializers.IntegerField(read_only=True, default=0)
    active_ticket_count = serializers.IntegerField(read_only=True, default=0)
    used_ticket_count = serializers.IntegerField(read_only=True, default=0)

    items = BookingItemSerializer(many=True, read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "status",
            "created_at",
            "hold_expires_at",
            "payment_order_id",
            "total_amount",
            "platform_fee",
            "donation",
            "event_id",
            "event_title",
            "event_slug",
            "event_starts_at",
            "event_ends_at",
            "event_venue",
            "event_city",
            "event_poster_url",
            "event_status",
            "ticket_count",
            "active_ticket_count",
            "used_ticket_count",
            "items",
        ]
        read_only_fields = fields


class TicketSerializer(serializers.ModelSerializer):
    event_id = serializers.UUIDField(source="booking.event_id", read_only=True)
    event_title = serializers.CharField(source="booking.event.title", read_only=True)
    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True)

    class Meta:
        model = Ticket
        fields = [
            "id",
            # Which booking issued it. A LOCAL column on the ticket row, so it
            # costs no extra query and no join — and it is what lets the
            # confirmation screen show the tickets belonging to the booking that
            # was just paid for, rather than the whole account's tickets. Without
            # it the buyer's only route from "paid" to "here is your QR" is the
            # email, which is the one artifact nobody can be sure arrived.
            "booking_id",
            "event_id",
            "event_title",
            "ticket_type_id",
            "ticket_type_name",
            "status",
            # Who this ticket admits, blank when that's the buyer themselves.
            "attendee_name",
            "attendee_email",
            "qr_token",
            "created_at",
        ]
        read_only_fields = fields


class ShareReceiptRequestSerializer(serializers.Serializer):
    """Who to send the receipt to, and an optional line from the sender.

    `EmailField` per entry rather than one comma-separated string: the browser
    collects them as chips, and splitting a string server-side means guessing
    at a delimiter somebody typed.

    The list is bounded HERE as well as in the service. The service bound is
    the real one — it is what a non-HTTP caller would hit — and this one exists
    so an oversized request is refused before it is parsed into a thousand
    validated addresses.
    """

    emails = serializers.ListField(
        child=serializers.EmailField(),
        allow_empty=False,
        max_length=10,
    )
    #: A short line the sender can add. Capped, and it goes into an email body,
    #: so the renderer escapes it — see `email_layout.paragraph`.
    note = serializers.CharField(required=False, allow_blank=True, max_length=280)


class ShareReceiptResponseSerializer(serializers.Serializer):
    #: How many messages were QUEUED, not delivered. The send is async by
    #: design, so claiming delivery here would be a claim this endpoint cannot
    #: make.
    queued = serializers.IntegerField()
