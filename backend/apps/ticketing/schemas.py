"""Boundary DTOs for ticket tiers.

`price` is money in **minor units** (paise/cents) as an integer — the API
mirror of the model's `price_minor`, kept integer end-to-end to avoid float
money. `available` (quantity − sold − reserved) and `is_on_sale` are
computed for display; the authoritative availability decision is made under
a row lock at reserve time, not from these numbers.

The same split applies to the early-bird fields: `effective_price` is the
number to SHOW, computed from the same rule (`pricing.py`) the locked reserve
uses to decide what to CHARGE. It is display data — this payload is cached
for a few seconds, so a discount that lapses mid-TTL is briefly still on
screen while the next reserve already bills the normal price. That gap is the
module's standing trade, and it errs the safe way: the buyer is never charged
the higher number without seeing it, because the funnel shows the booking's
own recorded price before payment.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from .models import TicketType
from .pricing import EarlyBirdState

# `allow_null` on the three early-bird write fields is deliberate: null is how
# an organizer CLEARS an early bird, and clearing the price alone is enough —
# the bounds go inert and stop being reported (see `EarlyBirdState.ends_at`).


def _reject_early_bird_above_price(attrs: dict) -> None:
    """Boundary check so an obvious data-entry error is a 400 with a field
    message rather than the DB CHECK's IntegrityError. On an update, only the
    case where BOTH prices are in the same request is decidable here; the
    merged check (against the stored row) lives in the service."""
    price, early = attrs.get("price"), attrs.get("early_bird_price")
    if price is not None and early is not None and early > price:
        raise serializers.ValidationError("early_bird_price can't be higher than the normal price.")


class CreateTicketTypeRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    price = serializers.IntegerField(min_value=0)  # minor units
    quantity = serializers.IntegerField(min_value=1)
    sale_start = serializers.DateTimeField(required=False, allow_null=True)
    sale_end = serializers.DateTimeField(required=False, allow_null=True)
    max_per_order = serializers.IntegerField(min_value=1, default=10)
    early_bird_price = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    early_bird_ends_at = serializers.DateTimeField(required=False, allow_null=True)
    early_bird_quantity = serializers.IntegerField(min_value=1, required=False, allow_null=True)

    def validate(self, attrs: dict) -> dict:
        start, end = attrs.get("sale_start"), attrs.get("sale_end")
        if start is not None and end is not None and end <= start:
            raise serializers.ValidationError("sale_end must be after sale_start.")
        _reject_early_bird_above_price(attrs)
        return attrs


class UpdateTicketTypeRequestSerializer(serializers.Serializer):
    # Optimistic-lock version the client last read; 409 if the tier changed since.
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=100, required=False)
    price = serializers.IntegerField(min_value=0, required=False)  # minor units
    quantity = serializers.IntegerField(min_value=1, required=False)
    sale_start = serializers.DateTimeField(required=False, allow_null=True)
    sale_end = serializers.DateTimeField(required=False, allow_null=True)
    max_per_order = serializers.IntegerField(min_value=1, required=False)
    early_bird_price = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    early_bird_ends_at = serializers.DateTimeField(required=False, allow_null=True)
    early_bird_quantity = serializers.IntegerField(min_value=1, required=False, allow_null=True)

    _EDITABLE = {
        "name",
        "price",
        "quantity",
        "sale_start",
        "sale_end",
        "max_per_order",
        "early_bird_price",
        "early_bird_ends_at",
        "early_bird_quantity",
    }

    def validate(self, attrs: dict) -> dict:
        if not (self._EDITABLE & attrs.keys()):
            raise serializers.ValidationError("Provide at least one field to update.")
        start, end = attrs.get("sale_start"), attrs.get("sale_end")
        if start is not None and end is not None and end <= start:
            raise serializers.ValidationError("sale_end must be after sale_start.")
        _reject_early_bird_above_price(attrs)
        return attrs


class TicketTypeSerializer(serializers.ModelSerializer):
    price = serializers.IntegerField(source="price_minor", read_only=True)
    available = serializers.SerializerMethodField()
    is_on_sale = serializers.SerializerMethodField()
    # `effective_price` is what a buyer pays right now; `price` is the normal
    # price, kept alongside it so a UI can show what the discount is off. A
    # client that renders only one number should render this one.
    effective_price = serializers.SerializerMethodField()
    early_bird_price = serializers.SerializerMethodField()
    early_bird_active = serializers.SerializerMethodField()
    early_bird_remaining = serializers.SerializerMethodField()
    early_bird_ends_at = serializers.SerializerMethodField()

    class Meta:
        model = TicketType
        fields = [
            "id",
            "event_id",
            "name",
            "price",
            "effective_price",
            "early_bird_price",
            "early_bird_active",
            "early_bird_remaining",
            "early_bird_ends_at",
            "quantity",
            "sold",
            "available",
            "sale_start",
            "sale_end",
            "max_per_order",
            "is_on_sale",
            "version",
            "created_at",
        ]
        read_only_fields = fields

    def _state(self, obj: TicketType) -> EarlyBirdState:
        """One evaluation per object, shared by the five fields below — the
        rule reads six columns and there is no reason to run it five times."""
        cached = getattr(obj, "_early_bird_state_cache", None)
        if cached is None:
            cached = obj.early_bird_state()
            obj._early_bird_state_cache = cached  # type: ignore[attr-defined]
        return cached

    def get_available(self, obj: TicketType) -> int:
        return obj.available

    def get_effective_price(self, obj: TicketType) -> int:
        return self._state(obj).effective_price_minor

    def get_early_bird_price(self, obj: TicketType) -> int | None:
        return obj.early_bird_price_minor

    def get_early_bird_active(self, obj: TicketType) -> bool:
        return self._state(obj).is_active

    def get_early_bird_remaining(self, obj: TicketType) -> int | None:
        """How many seats are still going at the early-bird price — `null`
        when no cap is set. An uncapped early bird has no number to report and
        this codebase does not invent one; the deadline is what bounds it."""
        return self._state(obj).remaining

    def get_early_bird_ends_at(self, obj: TicketType) -> str | None:
        ends_at = self._state(obj).ends_at
        # Rendered explicitly rather than returned raw: this payload is cached
        # as JSON, and the cache encoder's `isoformat()` would differ from
        # DRF's own representation — so cold and warm reads would disagree on
        # the format of the same timestamp.
        return None if ends_at is None else serializers.DateTimeField().to_representation(ends_at)

    def get_is_on_sale(self, obj: TicketType) -> bool:
        if obj.available <= 0:
            return False
        now = timezone.now()
        if obj.sale_start is not None and now < obj.sale_start:
            return False
        return not (obj.sale_end is not None and now > obj.sale_end)
