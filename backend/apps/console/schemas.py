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
    date_joined = serializers.DateTimeField()


class SuspendUserSerializer(serializers.Serializer):
    suspended = serializers.BooleanField()
    #: Recorded on the audit row. Optional, because an operator acting on an
    #: obvious abuse case should not be blocked by a required text box — but
    #: it is the first thing the next operator will look for.
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
