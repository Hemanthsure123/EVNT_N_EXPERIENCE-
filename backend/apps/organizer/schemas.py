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
    #: People waiting for this event to have tickets again. A COUNT, never a
    #: rate — a rate would need a denominator that is zero for an event with no
    #: tiers, and this module's rule is that such a rate is null rather than 0.
    waitlist = serializers.IntegerField()
    from_price_minor = serializers.IntegerField(allow_null=True)
    tickets_available = serializers.IntegerField(allow_null=True)
    version = serializers.IntegerField()
    created_at = serializers.DateTimeField()
    #: An operator's reason for sending the event back. Organizer-scoped
    #: endpoint only — never on the public detail payload.
    moderation_note = serializers.CharField(allow_blank=True)
    submitted_at = serializers.DateTimeField(allow_null=True)


class AttendeeRowSerializer(serializers.Serializer):
    """One TICKET, as the door list reads it.

    ── THE HOLDER IS NOT ALWAYS THE BUYER ───────────────────────────────────

    `Ticket.attendee_name`/`attendee_email` are set when somebody who booked
    six seats names the other five people. `holder_*` is therefore the
    resolved answer to "who does this admit", and `buyer_*` is kept beside it
    because the organizer's other question — who paid for this — has no other
    way to be asked once a ticket has been re-addressed.

    ── AND THE PHONE NUMBER BELONGS TO THE BUYER ────────────────────────────

    Nothing stores an assigned attendee's phone; only a name and an email are
    collected. So `phone` is blank on a re-addressed ticket rather than
    carrying the buyer's number under somebody else's name, which would be the
    quietest possible way for a steward to ring the wrong person.
    """

    ticket_id = serializers.UUIDField()
    holder_name = serializers.CharField(allow_blank=True)
    holder_email = serializers.CharField(allow_blank=True)
    #: True when this ticket was addressed to somebody other than the buyer.
    is_reassigned = serializers.BooleanField()
    buyer_name = serializers.CharField(allow_blank=True)
    buyer_email = serializers.CharField(allow_blank=True)
    #: The BUYER's, and only when they are the one being admitted. See above.
    phone = serializers.CharField(allow_blank=True)
    ticket_type_id = serializers.UUIDField()
    ticket_type = serializers.CharField(allow_blank=True)
    #: `active` (expected), `used` (admitted), `void` (refunded or cancelled).
    status = serializers.CharField()
    used_at = serializers.DateTimeField(allow_null=True)
    gate = serializers.CharField(allow_blank=True)
    booking_id = serializers.UUIDField()
    created_at = serializers.DateTimeField()


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
    #: Sold x LIST price — the old figure, kept for the operator console.
    revenue_minor = serializers.IntegerField()
    #: Paid orders that contain this tier.
    orders = serializers.IntegerField()
    #: Seats in those orders.
    seats = serializers.IntegerField()
    #: What those seats were BILLED — early-bird and group prices included.
    charged_minor = serializers.IntegerField()
    #: `charged_minor / seats`. Null when nothing has sold.
    per_person_minor = serializers.IntegerField(allow_null=True)
    #: Withdrawn, or its sale window has closed.
    is_past = serializers.BooleanField()
    is_deleted = serializers.BooleanField()


class EventAnalyticsHeaderSerializer(serializers.Serializer):
    """The event itself, so an analytics page is one request rather than two."""

    id = serializers.CharField()
    title = serializers.CharField()
    status = serializers.CharField()
    starts_at = serializers.CharField()
    ends_at = serializers.CharField(allow_null=True)
    venue = serializers.CharField(allow_blank=True)
    city = serializers.CharField(allow_blank=True)
    created_at = serializers.CharField()


class EngagementSerializer(serializers.Serializer):
    """Views, impressions and click-through, from `events.EventEngagementDay`.

    Every figure is NULL for an event with no recorded day — "nothing was
    recorded", which is not "nobody looked". `tracked_since` is the first day
    recorded, and both rates are computed over that window only.
    """

    tracked_since = serializers.CharField(allow_null=True)
    views = serializers.IntegerField(allow_null=True)
    impressions = serializers.IntegerField(allow_null=True)
    feed_views = serializers.IntegerField(allow_null=True)
    located_views = serializers.IntegerField(allow_null=True)
    local_views = serializers.IntegerField(allow_null=True)
    view_cvr_pct = serializers.FloatField(allow_null=True)
    ctr_pct = serializers.FloatField(allow_null=True)
    local_pct = serializers.FloatField(allow_null=True)


class OrderSliceSerializer(serializers.Serializer):
    orders = serializers.IntegerField()
    revenue_minor = serializers.IntegerField()


class OrderSplitSerializer(serializers.Serializer):
    """Paid orders of exactly one seat, and of more than one — billed gross."""

    single = OrderSliceSerializer()
    multiple = OrderSliceSerializer()


class BookingInsightsSerializer(serializers.Serializer):
    first_booking_at = serializers.CharField(allow_null=True)
    last_booking_at = serializers.CharField(allow_null=True)
    period_days = serializers.IntegerField(allow_null=True)
    late_window_hours = serializers.IntegerField()
    #: Null until the event has started — the final window is not over yet.
    late_seats = serializers.IntegerField(allow_null=True)
    late_pct = serializers.FloatField(allow_null=True)


class BookingWindowDaySerializer(serializers.Serializer):
    date = serializers.CharField()
    orders = serializers.IntegerField()
    seats = serializers.IntegerField()


class PricePeriodSerializer(serializers.Serializer):
    tier_id = serializers.CharField()
    tier_name = serializers.CharField()
    price_minor = serializers.IntegerField()
    started_at = serializers.CharField()
    ended_at = serializers.CharField(allow_null=True)
    seats = serializers.IntegerField()
    revenue_minor = serializers.IntegerField()
    #: active | ended
    status = serializers.CharField()
    #: created | edited | baseline
    kind = serializers.CharField()


class UntrackedSalesSerializer(serializers.Serializer):
    """Sales a tier made before its price history began."""

    tier_id = serializers.CharField()
    tier_name = serializers.CharField()
    until = serializers.CharField(allow_null=True)
    seats = serializers.IntegerField()
    revenue_minor = serializers.IntegerField()


class FeaturePeriodSerializer(serializers.Serializer):
    tier_id = serializers.CharField()
    tier_name = serializers.CharField()
    #: early_bird | group_offers
    feature = serializers.CharField()
    #: Null when it was on since before the log could see.
    enabled_at = serializers.CharField(allow_null=True)
    disabled_at = serializers.CharField(allow_null=True)
    seats = serializers.IntegerField()
    #: enabled | disabled
    status = serializers.CharField()


class GroupBandSerializer(serializers.Serializer):
    min_quantity = serializers.IntegerField()
    orders = serializers.IntegerField()
    seats = serializers.IntegerField()
    revenue_minor = serializers.IntegerField()


class GroupOffersSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    orders = serializers.IntegerField()
    seats = serializers.IntegerField()
    revenue_minor = serializers.IntegerField()
    bands = GroupBandSerializer(many=True)


class CouponUsageSerializer(serializers.Serializer):
    orders = serializers.IntegerField()
    pct_of_orders = serializers.FloatField(allow_null=True)
    discount_minor = serializers.IntegerField()


class EventAudienceSerializer(serializers.Serializer):
    attendees = serializers.IntegerField()
    first_time = serializers.IntegerField()
    repeat = serializers.IntegerField()
    first_time_pct = serializers.FloatField(allow_null=True)
    repeat_pct = serializers.FloatField(allow_null=True)
    savers = serializers.IntegerField()
    saved_then_booked = serializers.IntegerField()
    interest_conversion_pct = serializers.FloatField(allow_null=True)
    located_views = serializers.IntegerField(allow_null=True)
    local_pct = serializers.FloatField(allow_null=True)


class RatingCountSerializer(serializers.Serializer):
    rating = serializers.IntegerField()
    count = serializers.IntegerField()


class EventFeedbackSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    average = serializers.FloatField(allow_null=True)
    breakdown = RatingCountSerializer(many=True)


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
    generated_at = serializers.CharField()
    #: Every booking ever started, lapsed holds included.
    add_to_cart = serializers.IntegerField()
    #: Paid bookings, and the seats in them.
    orders = serializers.IntegerField()
    seats = serializers.IntegerField()
    avg_per_attendee_minor = serializers.IntegerField(allow_null=True)
    #: Null until the event is over.
    no_shows = serializers.IntegerField(allow_null=True)
    event_ended = serializers.BooleanField()
    engagement = EngagementSerializer()
    order_split = OrderSplitSerializer()
    booking_insights = BookingInsightsSerializer()
    booking_window = BookingWindowDaySerializer(many=True)
    price_timeline = PricePeriodSerializer(many=True)
    untracked_sales = UntrackedSalesSerializer(many=True)
    feature_log = FeaturePeriodSerializer(many=True)
    history_truncated = serializers.BooleanField()
    group_offers = GroupOffersSerializer()
    coupons = CouponUsageSerializer()
    audience = EventAudienceSerializer()
    feedback = EventFeedbackSerializer()


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


class OrganizerEarningsSerializer(serializers.Serializer):
    """Lifetime and month-to-date money.

    `month_change_pct` compares this calendar month against the SAME NUMBER OF
    ELAPSED DAYS of last month (`comparison_days` says how many), never against
    the whole of it — a partial month measured against a complete one reads as
    a collapse every month until the 30th.
    """

    lifetime_revenue_minor = serializers.IntegerField()
    lifetime_tickets = serializers.IntegerField()
    lifetime_attendees = serializers.IntegerField()
    #: Lifetime revenue over the number of DISTINCT paying attendees. Null, not
    #: zero, when nobody has paid yet: "no attendees" and "attendees who paid
    #: nothing" are different facts and only one of them is true here.
    avg_revenue_per_attendee_minor = serializers.IntegerField(allow_null=True)
    month_revenue_minor = serializers.IntegerField()
    month_change_pct = serializers.FloatField(allow_null=True)
    #: Days of the month both sides of that comparison cover, today included.
    comparison_days = serializers.IntegerField()
    generated_at = serializers.CharField()


class OrganizerFunnelRowSerializer(serializers.Serializer):
    """One event's booking funnel, from real rows only.

    There is deliberately NO impressions, detail-views or click-through
    column. Views and impressions ARE recorded now — per event, from the day the
    browser began reporting them (`events.EventEngagementDay`) — and the event
    analytics page shows them. This LIST does not, because a column here has to
    be true for every row, and for every event that ended before counting began
    it would be an invented zero. The funnel starts at the first thing that
    exists for every event — a booking row.
    """

    id = serializers.UUIDField()
    title = serializers.CharField()
    status = serializers.CharField()
    starts_at = serializers.DateTimeField()
    #: EVERY booking row for the event, whatever its status. A reserved hold
    #: that lapsed is exactly the abandonment this measures.
    bookings_started = serializers.IntegerField()
    bookings_paid = serializers.IntegerField()
    conversion_pct = serializers.FloatField(allow_null=True)
    capacity = serializers.IntegerField()
    tickets_sold = serializers.IntegerField()
    quota_fill_pct = serializers.FloatField(allow_null=True)
    revenue_minor = serializers.IntegerField()
    #: The denominator of `repeat_attendee_pct`, published beside it: "50%
    #: repeat" reads very differently once you can see it is one of two people.
    paying_attendees = serializers.IntegerField()
    #: Of the distinct users who paid for THIS event, the share who have also
    #: paid for another event by this same organizer.
    repeat_attendee_pct = serializers.FloatField(allow_null=True)


class OrganizerInsightSerializer(serializers.Serializer):
    """One automated recommendation, with the evidence behind it.

    `sample_size` is not decoration — a recommendation without it is
    indistinguishable from a guess, and an endpoint that returns nothing at all
    when the sample is too thin is the other half of the same rule.
    """

    #: best_weekday | best_hour | best_category | best_city
    kind = serializers.CharField()
    #: paid_bookings | revenue_minor — what `value` counts.
    metric = serializers.CharField()
    #: The raw bucket: an ISO weekday (1–7, Monday-first), an hour (0–23), a
    #: category slug or a city name. For building a filter link or picking the
    #: artwork; `label` is what to render.
    key = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]
    value = serializers.IntegerField()
    #: Rows behind the whole ranking, not just the winner.
    sample_size = serializers.IntegerField()


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
