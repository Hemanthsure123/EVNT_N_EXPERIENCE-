"""Boundary DTOs for the operator console.

Money stays in integer **minor units** everywhere, exactly as the rest of the
API does — the console is where money is looked at most, and it is the last
place to start dividing by 100 in three different files.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.organizations.models import Organization, VerificationRecord
from apps.settlements.models import Settlement


class OverviewSerializer(serializers.Serializer):
    """The headline tiles. Every field is a real count or sum — see
    `ConsoleRepository` for exactly what each one counts."""

    organizations = serializers.IntegerField()
    pending_verifications = serializers.IntegerField()
    revenue_today_minor = serializers.IntegerField()
    bookings_today = serializers.IntegerField()
    events_live = serializers.IntegerField()
    tickets_issued = serializers.IntegerField()
    checkins_today = serializers.IntegerField()
    failed_payouts = serializers.IntegerField()
    generated_at = serializers.CharField()


class SeriesPointSerializer(serializers.Serializer):
    date = serializers.CharField()
    value = serializers.IntegerField()


class TimeseriesSerializer(serializers.Serializer):
    metric = serializers.CharField()
    days = serializers.IntegerField()
    points = SeriesPointSerializer(many=True)


class BreakdownItemSerializer(serializers.Serializer):
    # `label` is also the name of an attribute on DRF's own `Field`, so mypy
    # reads this as an incompatible override rather than a field declaration.
    # The wire name is what the dashboard consumes, so the name stays and the
    # false positive is silenced here rather than in every caller.
    label = serializers.CharField()  # type: ignore[assignment]
    value = serializers.IntegerField()


class BreakdownSerializer(serializers.Serializer):
    by = serializers.CharField()
    items = BreakdownItemSerializer(many=True)


class ActivitySerializer(serializers.Serializer):
    id = serializers.CharField()
    type = serializers.CharField()
    aggregate_id = serializers.CharField()
    payload = serializers.JSONField()
    created_at = serializers.CharField()


class HealthCheckSerializer(serializers.Serializer):
    name = serializers.CharField()
    status = serializers.CharField()  # ok | degraded | unknown
    detail = serializers.CharField(allow_blank=True)


class HealthSerializer(serializers.Serializer):
    status = serializers.CharField()
    checks = HealthCheckSerializer(many=True)
    #: Whether vendors were actually CONTACTED for this response.
    #:
    #: On the wire so the UI can say which kind of answer it is showing. Without
    #: it, a shallow `unknown` tile and a deep one look identical, and an
    #: operator cannot tell "we did not check" from "we checked and it is fine"
    #: — which is the entire distinction this endpoint is built around.
    deep = serializers.BooleanField()


class AdminOrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = [
            "id",
            "owner_id",
            "name",
            "verified_level",
            "payout_account_id",
            "logo_url",
            "created_at",
        ]
        read_only_fields = fields


class AdminUserSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    email = serializers.EmailField()
    full_name = serializers.CharField()
    is_organizer = serializers.BooleanField()
    is_staff = serializers.BooleanField()
    #: `False` means SUSPENDED — `AuthService.authenticate` refuses an inactive
    #: account outright, so this is an access decision rather than a label.
    is_active = serializers.BooleanField()
    #: Whether the address has been PROVEN. A SEPARATE fact from `is_active`:
    #: conflating them would show every unverified sign-up as suspended, and
    #: reinstating somebody would silently re-assert an address nobody
    #: re-checked. The console needs both to say which of the two an account is
    #: blocked by.
    email_verified = serializers.BooleanField()
    #: The platform's PRIMARY account. Its operator role cannot be removed by
    #: anybody — there is no console path back from demoting the one account
    #: that can always restore access.
    #:
    #: Exposed for the same reason `is_staff` is: without it the console
    #: cannot tell which row to leave alone, and it would render a control
    #: whose only possible outcome is a 409. It is a role flag, not a secret;
    #: the API still enforces the refusal.
    is_superuser = serializers.BooleanField()
    date_joined = serializers.DateTimeField()


class SuspendUserSerializer(serializers.Serializer):
    suspended = serializers.BooleanField()
    #: Recorded on the audit row. Optional, because an operator acting on an
    #: obvious abuse case should not be blocked by a required text box — but
    #: it is the first thing the next operator will look for.
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500, default="")


class AdminEnquirySerializer(serializers.Serializer):
    """One hire enquiry, as the desk sees it.

    Carries the CONTACT DETAILS, which the marketplace version of this payload
    deliberately withheld: a performer seeing a lead was shown the job and not
    the person. The only reader now is an operator whose entire job is to get
    back to the customer, so withholding them would make the queue unworkable.
    """

    id = serializers.CharField()
    performer_type = serializers.CharField()
    performer_type_display = serializers.CharField()
    occasion = serializers.CharField()
    occasion_display = serializers.CharField()
    city = serializers.CharField()
    event_date = serializers.DateField()
    budget_min_minor = serializers.IntegerField()
    budget_max_minor = serializers.IntegerField()
    guests = serializers.IntegerField(allow_null=True)
    notes = serializers.CharField(allow_blank=True)

    contact_name = serializers.CharField(allow_blank=True)
    contact_phone = serializers.CharField(allow_blank=True)
    contact_email = serializers.CharField(allow_blank=True)
    customer_email = serializers.CharField()

    status = serializers.CharField()
    status_display = serializers.CharField()
    admin_note = serializers.CharField(allow_blank=True)
    handled_by_email = serializers.CharField(allow_blank=True)
    created_at = serializers.DateTimeField()


class DecideEnquirySerializer(serializers.Serializer):
    """Where an operator is moving it, and what they want the next one to know."""

    status = serializers.CharField(max_length=20)
    #: Optional. An operator acting on an obvious case should not be blocked by
    #: a text box — but it is the first thing the next operator looks for.
    admin_note = serializers.CharField(
        required=False, allow_blank=True, max_length=2000, default=""
    )


class PromoteUserSerializer(serializers.Serializer):
    """Grant or remove the operator role."""

    is_staff = serializers.BooleanField()
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500, default="")


class RevokeVerificationSerializer(serializers.Serializer):
    """Only a reason. There is no boolean, because there is no un-revoke: the
    way back is reinstating the account and having the person verify their
    address again, which is the point of having withdrawn the trust."""

    reason = serializers.CharField(required=False, allow_blank=True, max_length=500, default="")


class AdminPaymentSerializer(serializers.Serializer):
    """One captured (or attempted) payment.

    Carries the customer and the event because the transactions table shows
    both on every row — an operator chasing a charge has an email or a
    reference, not a booking id.
    """

    id = serializers.CharField()
    provider_order_id = serializers.CharField(allow_blank=True)
    provider_payment_id = serializers.CharField(allow_blank=True)
    amount_minor = serializers.IntegerField()
    status = serializers.CharField()
    created_at = serializers.CharField()
    booking_id = serializers.CharField()
    booking_total_minor = serializers.IntegerField()
    platform_fee_minor = serializers.IntegerField()
    customer_email = serializers.CharField(allow_blank=True)
    customer_name = serializers.CharField(allow_blank=True)
    event_id = serializers.CharField()
    event_title = serializers.CharField()


class AdminBookingSerializer(serializers.Serializer):
    """One booking, as the support desk's table renders it.

    `is_expired_hold` is computed rather than stored — a booking sitting in
    `reserved` past its `hold_expires_at` has not been swept yet, and telling
    that apart from a live hold is what decides whether an operator waits or
    acts.
    """

    id = serializers.CharField()
    status = serializers.CharField()
    #: Summed from `BookingItem` — there is no quantity column on Booking.
    quantity = serializers.IntegerField()
    #: On the LIST, not just the detail. "Were tickets actually issued?" is the
    #: question this whole surface exists for, and making an operator open each
    #: row to see it would defeat the search that got them here.
    tickets_issued = serializers.IntegerField()
    total_amount_minor = serializers.IntegerField()
    platform_fee_minor = serializers.IntegerField()
    payment_ref = serializers.CharField(allow_blank=True)
    payment_order_id = serializers.CharField(allow_blank=True)
    hold_expires_at = serializers.CharField(allow_null=True)
    is_expired_hold = serializers.BooleanField()
    created_at = serializers.CharField()
    customer_id = serializers.CharField()
    customer_email = serializers.CharField(allow_blank=True)
    customer_name = serializers.CharField(allow_blank=True)
    event_id = serializers.CharField()
    event_title = serializers.CharField()
    event_starts_at = serializers.CharField()


class AdminBookingItemSerializer(serializers.Serializer):
    ticket_type_id = serializers.CharField()
    ticket_type_name = serializers.CharField()
    quantity = serializers.IntegerField()
    unit_price_minor = serializers.IntegerField()


class AdminBookingTicketSerializer(serializers.Serializer):
    """A ticket on a booking — WITHOUT its QR token.

    The token is the credential that admits somebody. An operator answering
    "did my tickets get issued?" needs to know that they exist and whether they
    have been used; they never need the code itself, and including it would
    make every operator session a set of usable tickets. `POST /checkin/lookup`
    verifies a token the holder presents rather than handing one out.
    """

    id = serializers.CharField()
    ticket_type_name = serializers.CharField()
    status = serializers.CharField()
    used_at = serializers.CharField(allow_null=True)
    gate = serializers.CharField(allow_null=True)
    attendee_name = serializers.CharField(allow_null=True)


class AdminBookingDetailSerializer(AdminBookingSerializer):
    """The expanded booking an operator opens during a call."""

    items = AdminBookingItemSerializer(many=True)
    tickets = AdminBookingTicketSerializer(many=True)
    #: So the client can render "hold expired 4 minutes ago" against the
    #: SERVER's clock rather than the operator's, which may be minutes off.
    server_time = serializers.CharField()


class AdminRefundSerializer(serializers.Serializer):
    """A refund RECORD — money already returned.

    No `status` field, because there is none: `execute_refund` writes this row
    only after the vendor call succeeded. `is_partial` is COMPUTED from the
    refunded amount against the payment's, because partiality is a fact about
    the pair — storing it would let the flag and the amounts disagree.
    """

    id = serializers.CharField()
    provider_ref = serializers.CharField(allow_blank=True)
    amount_minor = serializers.IntegerField()
    reason = serializers.CharField(allow_blank=True)
    created_at = serializers.CharField()
    is_partial = serializers.BooleanField()
    payment_id = serializers.CharField()
    payment_ref = serializers.CharField(allow_blank=True)
    payment_amount_minor = serializers.IntegerField()
    booking_id = serializers.CharField()
    customer_email = serializers.CharField(allow_blank=True)
    event_id = serializers.CharField()
    event_title = serializers.CharField()


class AdminSettlementSerializer(serializers.ModelSerializer):
    event_title = serializers.CharField(source="event.title", read_only=True)

    class Meta:
        model = Settlement
        fields = [
            "id",
            "event_id",
            "event_title",
            "status",
            "gross",
            "platform_fee",
            "refunds",
            "net",
            "releasable_at",
            "payout_at",
            "attempts",
            "error",
            "created_at",
        ]
        read_only_fields = fields


class PendingVerificationSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    verified_level = serializers.CharField(source="organization.verified_level", read_only=True)

    class Meta:
        model = VerificationRecord
        fields = [
            "id",
            "organization_id",
            "organization_name",
            "verified_level",
            "status",
            "notes",
            "created_at",
        ]
        read_only_fields = fields


class ModerationQueueSerializer(serializers.Serializer):
    """One event awaiting a decision.

    Carries enough to decide WITHOUT opening the event: an operator reviewing
    a queue is scanning for the obvious rejections, and a round trip per row
    would make that unbearable. `verified_level` is here because an unverified
    organization's first event is the one worth reading properly.
    """

    id = serializers.UUIDField()
    title = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    venue = serializers.CharField()
    city = serializers.CharField()
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField(allow_null=True)
    poster_url = serializers.CharField(allow_blank=True)
    #: Present so the same payload serves the pending QUEUE and the record of
    #: past decisions — the console renders one list component either way.
    status = serializers.CharField()
    submitted_at = serializers.DateTimeField(allow_null=True)
    moderated_at = serializers.DateTimeField(allow_null=True)
    #: The LAST decision's reason. There is no history of previous notes —
    #: `submit_for_review_if_draft` clears it on resubmission, deliberately, so
    #: a stale rejection cannot be re-applied to a fixed event. A full reason
    #: history needs its own table (see BACKLOG).
    moderation_note = serializers.CharField(allow_blank=True)
    organization_id = serializers.UUIDField()
    organization_name = serializers.CharField()
    verified_level = serializers.CharField()
    created_at = serializers.DateTimeField()


class ModerationDecisionSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    note = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")


class AuditEntrySerializer(serializers.Serializer):
    """One administrative action. Append-only; there is no write endpoint."""

    id = serializers.UUIDField()
    actor_id = serializers.CharField(allow_blank=True)
    actor_email = serializers.CharField(allow_blank=True)
    action = serializers.CharField()
    target_type = serializers.CharField(allow_blank=True)
    target_id = serializers.CharField(allow_blank=True)
    metadata = serializers.JSONField()
    created_at = serializers.DateTimeField()


class OrganizerEventAnalyticsSerializer(serializers.Serializer):
    """One event's analytics, passed through from `apps.organizer`.

    Deliberately a PASS-THROUGH rather than a re-declaration of every field:
    the payload is built by that module's selector, and pinning its shape here
    too would mean two places to update whenever a metric is added — with the
    console silently dropping the new field until somebody noticed.
    """

    def to_representation(self, instance: dict) -> dict:
        return instance


class OrganizationAnalyticsSerializer(serializers.Serializer):
    """An organizer's own dashboard — KPI tiles plus a daily series."""

    def to_representation(self, instance: dict) -> dict:
        return instance


class DeleteEventResultSerializer(serializers.Serializer):
    """What the click actually did.

    A summary rather than a 204, because this action spends money: the operator
    needs to see how many refunds started and how many holds were freed.
    """

    event_id = serializers.CharField()
    title = serializers.CharField()
    refunds_enqueued = serializers.IntegerField()
    holds_released = serializers.IntegerField()
    attendees_notified = serializers.IntegerField()
