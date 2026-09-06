"""Boundary DTOs for coupons.

Money is integer minor units end-to-end, exactly as `ticketing.schemas` does
it: `value` is a whole percent or whole paise, and `max_discount_minor` is
paise. No serializer here ever sees a float — a rate expressed as `0.2` is the
one place a rounding error reaches somebody's card.

WHAT THESE VALIDATE AND WHAT THEY DO NOT. Bounds a field can be judged on
alone live here (a percent is 1–100, a code is 3–32 characters). Every rule
that needs the OTHER fields — a percentage cap on a fixed-amount coupon, an
end before a start — lives in `services.validate_terms`, which sees the MERGED
row. A serializer validating a PATCH can only see what arrived, and half these
fields are independently editable.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import CouponKind
from .services import MAX_CODE_LENGTH, MIN_CODE_LENGTH


class CouponSerializer(serializers.Serializer):
    """One coupon, as its owner reads it.

    `redeemed_count` is attached by the view from a single aggregate over the
    whole page, never resolved per row — see `CouponRepository.usage_by_coupon`.
    It is a plain field rather than a `SerializerMethodField` for exactly that
    reason: a method field is where an N+1 gets written next.
    """

    id = serializers.UUIDField(read_only=True)
    event_id = serializers.UUIDField(read_only=True, allow_null=True)
    code = serializers.CharField(read_only=True)
    kind = serializers.CharField(read_only=True)
    value = serializers.IntegerField(read_only=True)
    max_discount_minor = serializers.IntegerField(read_only=True, allow_null=True)
    starts_at = serializers.DateTimeField(read_only=True, allow_null=True)
    ends_at = serializers.DateTimeField(read_only=True, allow_null=True)
    max_redemptions = serializers.IntegerField(read_only=True, allow_null=True)
    max_per_user = serializers.IntegerField(read_only=True)
    visible_at_checkout = serializers.BooleanField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    redeemed_count = serializers.IntegerField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class CreateCouponRequestSerializer(serializers.Serializer):
    code = serializers.CharField(min_length=MIN_CODE_LENGTH, max_length=MAX_CODE_LENGTH)
    kind = serializers.ChoiceField(choices=CouponKind.choices)
    #: Only a lower bound here: the upper one is not knowable from this
    #: field alone — 100 for a percentage, but a
    #: fixed-amount coupon of 50,000 paise is perfectly ordinary. The
    #: kind-specific ceiling lives in `validate_terms`.
    value = serializers.IntegerField(min_value=1)
    max_discount_minor = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    max_redemptions = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    max_per_user = serializers.IntegerField(min_value=1, default=1)
    visible_at_checkout = serializers.BooleanField(default=False)
    #: Null (or absent) means every event this organization runs. The id is
    #: checked against the organization in the service — a cross-tenant check
    #: on a value that arrives from a browser, so it cannot live here.
    event_id = serializers.UUIDField(required=False, allow_null=True)


class UpdateCouponRequestSerializer(serializers.Serializer):
    """Every field optional, and NO defaults.

    A default on a partial serializer is how an untouched field gets written
    back with a value nobody chose — `visible_at_checkout` would silently
    revert to False on any edit that did not mention it.
    """

    code = serializers.CharField(
        min_length=MIN_CODE_LENGTH, max_length=MAX_CODE_LENGTH, required=False
    )
    kind = serializers.ChoiceField(choices=CouponKind.choices, required=False)
    value = serializers.IntegerField(min_value=1, required=False)
    max_discount_minor = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    max_redemptions = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    max_per_user = serializers.IntegerField(min_value=1, required=False)
    visible_at_checkout = serializers.BooleanField(required=False)
    is_active = serializers.BooleanField(required=False)
    event_id = serializers.UUIDField(required=False, allow_null=True)


class ApplyCouponRequestSerializer(serializers.Serializer):
    """One field. The booking is in the URL and the amount is on the row.

    Nothing about the money arrives from the client — not the subtotal, not the
    discount, not the total. The booking's line items were priced under the
    tier locks when the hold was taken, and the discount is decided from those.
    """

    code = serializers.CharField(min_length=MIN_CODE_LENGTH, max_length=MAX_CODE_LENGTH)


class PublicOfferSerializer(serializers.Serializer):
    """An advertised code on the checkout.

    Carries the terms and NOT the limits: `max_redemptions` and `max_per_user`
    are the organizer's business, and publishing "3 left" on a public read
    turns a promotion into a race.
    """

    id = serializers.UUIDField(read_only=True)
    code = serializers.CharField(read_only=True)
    kind = serializers.CharField(read_only=True)
    value = serializers.IntegerField(read_only=True)
    max_discount_minor = serializers.IntegerField(read_only=True, allow_null=True)
    expires_at = serializers.DateTimeField(read_only=True, allow_null=True)


class AppliedCouponSerializer(serializers.Serializer):
    """What a booking carries once a code is on it.

    `discount_minor` is the amount RECORDED at redemption, not a figure
    recomputed from today's terms — the organizer can edit the coupon
    afterwards, and a receipt that moved with them would tell somebody they
    paid a price they did not pay.
    """

    code = serializers.CharField(read_only=True)
    kind = serializers.CharField(read_only=True)
    discount_minor = serializers.IntegerField(read_only=True)


__all__ = [
    "ApplyCouponRequestSerializer",
    "AppliedCouponSerializer",
    "CouponSerializer",
    "CreateCouponRequestSerializer",
    "PublicOfferSerializer",
    "UpdateCouponRequestSerializer",
]
