"""Boundary DTOs for the organizer dashboard.

Money stays in integer **minor units** everywhere, exactly as the rest of the
API does. Percentages are `allow_null` on purpose — a rate whose denominator
is zero is reported as `null` and rendered as a dash, never as 0%. "0%
conversion" on an event nobody has opened yet is a false statement; a dash is
the truthful one.
"""

from __future__ import annotations

from rest_framework import serializers


class OrganizerOverviewSerializer(serializers.Serializer):
    """The six KPI tiles. Each `*_change_pct` compares today with the SAME
    length of yesterday, and is null when yesterday was zero."""

    revenue_today_minor = serializers.IntegerField()
    revenue_change_pct = serializers.FloatField(allow_null=True)
    bookings_today = serializers.IntegerField()
    bookings_change_pct = serializers.FloatField(allow_null=True)
    tickets_sold_today = serializers.IntegerField()
    tickets_change_pct = serializers.FloatField(allow_null=True)
    events_upcoming = serializers.IntegerField()
    refunds_today = serializers.IntegerField()
    refunds_today_minor = serializers.IntegerField()
    checkins_today = serializers.IntegerField()
    conversion_pct = serializers.FloatField(allow_null=True)
    conversion_change_pct = serializers.FloatField(allow_null=True)
    generated_at = serializers.CharField()


class SeriesPointSerializer(serializers.Serializer):
    date = serializers.CharField()
    value = serializers.IntegerField()


class TimeseriesSerializer(serializers.Serializer):
    metric = serializers.CharField()
    days = serializers.IntegerField()
    points = SeriesPointSerializer(many=True)


class LabelValueSerializer(serializers.Serializer):
    # See the identical note in `apps/console/schemas.py`: `label` collides
    # with an attribute DRF's `Field` already defines, so mypy reads it as a
    # bad override. The wire name is what the dashboard reads; it stays.
    label = serializers.CharField()  # type: ignore[assignment]
    value = serializers.IntegerField()


class BreakdownSerializer(serializers.Serializer):
    by = serializers.CharField()
    items = LabelValueSerializer(many=True)


class EventRowSerializer(serializers.Serializer):
    """One row of the dashboard's events table — identity plus the aggregates
    the table actually shows. `version` is included because the side panel
    edits through the optimistic-lock endpoint and needs the value it read."""

    id = serializers.UUIDField()
    title = serializers.CharField()
    status = serializers.CharField()
    venue = serializers.CharField()
    city = serializers.CharField()
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField(allow_null=True)
    poster_url = serializers.CharField(allow_blank=True)
    organization_id = serializers.UUIDField()
    organization_name = serializers.CharField()
    #: What the publish gate checks BEFORE any readiness check. Exposed so the
    #: table can disable Submit with the reason, rather than offering a button
    #: that is certain to be refused.
    organization_verified_level = serializers.CharField()
    #: Rows, not seats: the gate is "at least one ticket type", and a tier with
    #: quantity 0 satisfies it while contributing nothing to `capacity`.
    ticket_type_count = serializers.IntegerField()
    capacity = serializers.IntegerField()
    sold = serializers.IntegerField()
    revenue_minor = serializers.IntegerField()
    checkins = serializers.IntegerField()
    from_price_minor = serializers.IntegerField(allow_null=True)
    tickets_available = serializers.IntegerField(allow_null=True)
    version = serializers.IntegerField()
    created_at = serializers.DateTimeField()
    #: An operator's reason for sending the event back. Organizer-scoped
    #: endpoint only — never on the public detail payload.
    moderation_note = serializers.CharField(allow_blank=True)
    submitted_at = serializers.DateTimeField(allow_null=True)


class OrganizerBookingSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.CharField()
    total_amount_minor = serializers.IntegerField()
    platform_fee_minor = serializers.IntegerField()
    payment_ref = serializers.CharField(allow_blank=True)
    # The refundable payment's own id, or null. `payment_ref` is the VENDOR's
    # string and is not what the refund endpoint takes — a UI that guessed one
    # from the other would be refunding by a handle the API never promised.
    payment_id = serializers.UUIDField(allow_null=True)
    hold_expires_at = serializers.DateTimeField()
    created_at = serializers.DateTimeField()
    quantity = serializers.IntegerField()
    customer_id = serializers.UUIDField()
    customer_email = serializers.EmailField()
    customer_name = serializers.CharField(allow_blank=True)
    event_id = serializers.UUIDField()
    event_title = serializers.CharField()
    event_starts_at = serializers.DateTimeField()


class CustomerRowSerializer(serializers.Serializer):
    """Lifetime numbers are **with this organizer only** — grouped over their
    own events. An organizer has no business seeing platform-wide spend."""

    customer_id = serializers.UUIDField()
    email = serializers.EmailField()
    full_name = serializers.CharField(allow_blank=True)
    bookings = serializers.IntegerField()
    lifetime_value_minor = serializers.IntegerField()
    last_booked_at = serializers.DateTimeField()


class CustomerBookingSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.CharField()
    total_amount_minor = serializers.IntegerField()
    created_at = serializers.DateTimeField()
    event_id = serializers.UUIDField()
    event_title = serializers.CharField()
    event_starts_at = serializers.DateTimeField()


class CustomerProfileSerializer(serializers.Serializer):
    customer_id = serializers.UUIDField()
    email = serializers.CharField(allow_blank=True)
    bookings = serializers.IntegerField()
    lifetime_value_minor = serializers.IntegerField()
    refunds = serializers.IntegerField()
    refunded_minor = serializers.IntegerField()
    tickets_issued = serializers.IntegerField()
    tickets_attended = serializers.IntegerField()
    recent_bookings = CustomerBookingSerializer(many=True)
    top_cities = LabelValueSerializer(many=True)


class TierAnalyticsSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    price_minor = serializers.IntegerField()
    quantity = serializers.IntegerField()
    sold = serializers.IntegerField()
    reserved = serializers.IntegerField()
    revenue_minor = serializers.IntegerField()


class EventAnalyticsHeaderSerializer(serializers.Serializer):
    """The event itself, so an analytics page is one request rather than two."""

    id = serializers.CharField()
    title = serializers.CharField()
    status = serializers.CharField()
    starts_at = serializers.CharField()
    ends_at = serializers.CharField(allow_null=True)
    venue = serializers.CharField(allow_blank=True)
    city = serializers.CharField(allow_blank=True)


class EventAnalyticsSerializer(serializers.Serializer):
    event_id = serializers.CharField()
    event = EventAnalyticsHeaderSerializer(allow_null=True)
    revenue_minor = serializers.IntegerField()
    refunded_minor = serializers.IntegerField()
    refunded_count = serializers.IntegerField()
    capacity = serializers.IntegerField()
    sold = serializers.IntegerField()
    checkins = serializers.IntegerField()
    sell_through_pct = serializers.FloatField(allow_null=True)
    conversion_pct = serializers.FloatField(allow_null=True)
    abandonment_pct = serializers.FloatField(allow_null=True)
    attendance_pct = serializers.FloatField(allow_null=True)
    bookings_by_status = LabelValueSerializer(many=True)
    scans_by_result = LabelValueSerializer(many=True)
    tiers = TierAnalyticsSerializer(many=True)
    sales_timeline = SeriesPointSerializer(many=True)


class ActivitySerializer(serializers.Serializer):
    id = serializers.CharField()
    type = serializers.CharField()
    customer = serializers.CharField()
    event_id = serializers.CharField()
    event_title = serializers.CharField()
    amount_minor = serializers.IntegerField()
    created_at = serializers.CharField()


class UnifiedActivitySerializer(serializers.Serializer):
    """One row of the unified feed, whichever module it came from.

    `severity` exists so the client does not have to re-derive importance from
    a string match on `type` — a feed where a failed payout renders like a
    ticket sale buries the one entry that needed a human.
    """

    id = serializers.CharField()
    #: booking | refund | checkin | payout | publishing
    kind = serializers.CharField()
    #: The originating domain event, e.g. `booking.paid`, `payout.failed`.
    type = serializers.CharField()
    title = serializers.CharField()
    detail = serializers.CharField(allow_blank=True)
    event_id = serializers.CharField()
    event_title = serializers.CharField()
    amount_minor = serializers.IntegerField()
    #: info | success | warning | critical
    severity = serializers.CharField()
    at = serializers.CharField()


class OrganizerRefundSerializer(serializers.Serializer):
    """A refund RECORD — money already returned, not a request awaiting a
    decision. There is deliberately no `status`: `payments.execute_refund`
    writes this row only after the vendor call succeeded, so every row here is
    completed. An approval workflow needs its own model."""

    id = serializers.CharField()
    provider_ref = serializers.CharField(allow_blank=True)
    amount_minor = serializers.IntegerField()
    reason = serializers.CharField(allow_blank=True)
    created_at = serializers.CharField()
    payment_id = serializers.CharField()
    payment_ref = serializers.CharField(allow_blank=True)
    payment_amount_minor = serializers.IntegerField()
    is_partial = serializers.BooleanField()
    booking_id = serializers.CharField()
    event_id = serializers.CharField()
    event_title = serializers.CharField()


class AudienceSerializer(serializers.Serializer):
    customers = serializers.IntegerField()
    repeat_customers = serializers.IntegerField()
    repeat_pct = serializers.FloatField(allow_null=True)


class OrganizerReviewSerializer(serializers.Serializer):
    """One published review on the organizer's own event.

    The reviewer is named, not anonymised: they chose to publish this against
    an event the organizer ran, and an organizer reading "somebody rated you 2"
    with no way to tell repeat customers from first-timers cannot act on it.
    The email is NOT here — naming is enough to recognise a regular, and an
    address invites contact outside the platform, where no record of it exists.
    """

    id = serializers.UUIDField()
    rating = serializers.IntegerField()
    body = serializers.CharField(allow_blank=True)
    verified_attendee = serializers.BooleanField()
    created_at = serializers.DateTimeField()
    event_id = serializers.UUIDField(source="event.id")
    event_title = serializers.CharField(source="event.title")
    reviewer_name = serializers.SerializerMethodField()

    def get_reviewer_name(self, review) -> str:
        # The FK is PROTECT, so a reviewer always exists — but `full_name` is
        # `blank=True`, and somebody who never set one would otherwise render
        # as an empty cell that reads like a rendering fault.
        user = getattr(review, "user", None)
        return (getattr(user, "full_name", "") or "").strip() or "A guest"
