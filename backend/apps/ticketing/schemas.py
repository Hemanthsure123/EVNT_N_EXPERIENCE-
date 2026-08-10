"""Boundary DTOs for ticket tiers and their sale-phase schedules.

`price` is money in **minor units** (paise/cents) as an integer — the API
mirror of the model's `price_minor`, kept integer end-to-end to avoid float
money. `available` (quantity − sold − reserved) and `is_on_sale` are
computed for display; the authoritative availability decision is made under
a row lock at reserve time, not from these numbers.

The same split applies to the phase fields: `effective_price` is the number
to SHOW, computed from the same rule (`pricing.py`) the locked reserve uses
to decide what to CHARGE. It is display data — this payload is cached for a
few seconds, so a phase that lapses mid-TTL is briefly still on screen while
the next reserve already bills the next price. That gap is the module's
standing trade, and it errs the safe way: the buyer is never charged the
higher number without seeing it, because the funnel shows the booking's own
recorded price before payment.

On the write side, the `phases` array order IS position — the schedule is
submitted whole and replaced whole (see the service).
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from .models import SalePhase, TicketType
from .pricing import PhaseState, evaluate_phases


class SalePhaseWriteSerializer(serializers.Serializer):
    """One step of the schedule as submitted. `price` > 0 — a free phase is
    not a discount, it's a different product. `quantity` is the CUMULATIVE
    sold+reserved threshold, not a per-phase allocation. The cross-phase
    rules (non-decreasing prices, at-most-face, at least one bound each, max
    5) live in the service, where a non-HTTP caller gets them too."""

    name = serializers.CharField(max_length=40)
    price = serializers.IntegerField(min_value=1)  # minor units
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    quantity = serializers.IntegerField(min_value=1, required=False, allow_null=True)


def _reject_phase_above_price(attrs: dict) -> None:
    """Boundary check so an obvious data-entry error is a 400 with a field
    message rather than a 422 from deeper in. On an update, only the case
    where BOTH the price and the schedule are in the same request is decidable
    here; the merged check (against the stored row) lives in the service."""
    price = attrs.get("price")
    if price is None:
        return
    for phase in attrs.get("phases") or []:
        if phase["price"] > price:
            raise serializers.ValidationError(
                "A sale phase's price can't be higher than the normal price."
            )


#: How many perks one tier may list. Past this it is a brochure, and the panel
#: renders them all — a perk behind a "show more" is one a buyer will say they
#: were never promised.
MAX_PERKS = 8
PERK_MAX_LENGTH = 60


class PerkListField(serializers.ListField):
    """The "what is included" list.

    Blank entries are DROPPED rather than refused: an organiser who tabbed
    through an empty row should not have their tier save fail, and an empty
    tick on the panel is a rendering fault rather than a promise. Duplicates go
    too — the same perk twice reads as a bug.
    """

    def __init__(self, **kwargs) -> None:
        kwargs.setdefault(
            "child", serializers.CharField(max_length=PERK_MAX_LENGTH, allow_blank=True)
        )
        kwargs.setdefault("max_length", MAX_PERKS)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        cleaned: list[str] = []
        for perk in super().to_internal_value(data):
            text = perk.strip()
            if text and text not in cleaned:
                cleaned.append(text)
        return cleaned


class CreateTicketTypeRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    description = serializers.CharField(
        max_length=280, required=False, allow_blank=True, default=""
    )
    perks = PerkListField(required=False)
    position = serializers.IntegerField(required=False, min_value=0, default=0)
    #: Which session this tier sells, for an event that runs more than once.
    #: Null is the ordinary single-session event, and stays the default so
    #: every existing caller keeps working unchanged.
    slot_id = serializers.UUIDField(required=False, allow_null=True)
    price = serializers.IntegerField(min_value=0)  # minor units
    quantity = serializers.IntegerField(min_value=1)
    sale_start = serializers.DateTimeField(required=False, allow_null=True)
    sale_end = serializers.DateTimeField(required=False, allow_null=True)
    max_per_order = serializers.IntegerField(min_value=1, default=10)
    phases = SalePhaseWriteSerializer(many=True, required=False)

    def validate(self, attrs: dict) -> dict:
        start, end = attrs.get("sale_start"), attrs.get("sale_end")
        if start is not None and end is not None and end <= start:
            raise serializers.ValidationError("sale_end must be after sale_start.")
        _reject_phase_above_price(attrs)
        return attrs


class UpdateTicketTypeRequestSerializer(serializers.Serializer):
    # Optimistic-lock version the client last read; 409 if the tier changed since.
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=100, required=False)
    description = serializers.CharField(max_length=280, required=False, allow_blank=True)
    #: Replaced wholesale; an empty list CLEARS them.
    perks = PerkListField(required=False)
    position = serializers.IntegerField(required=False, min_value=0)
    price = serializers.IntegerField(min_value=0, required=False)  # minor units
    quantity = serializers.IntegerField(min_value=1, required=False)
    sale_start = serializers.DateTimeField(required=False, allow_null=True)
    sale_end = serializers.DateTimeField(required=False, allow_null=True)
    max_per_order = serializers.IntegerField(min_value=1, required=False)
    # The whole schedule, replaced wholesale; an empty list CLEARS it.
    phases = SalePhaseWriteSerializer(many=True, required=False)

    _EDITABLE = {
        "name",
        "description",
        "perks",
        "position",
        "price",
        "quantity",
        "sale_start",
        "sale_end",
        "max_per_order",
        "phases",
    }

    def validate(self, attrs: dict) -> dict:
        if not (self._EDITABLE & attrs.keys()):
            raise serializers.ValidationError("Provide at least one field to update.")
        start, end = attrs.get("sale_start"), attrs.get("sale_end")
        if start is not None and end is not None and end <= start:
            raise serializers.ValidationError("sale_end must be after sale_start.")
        _reject_phase_above_price(attrs)
        return attrs


class SalePhaseSerializer(serializers.ModelSerializer):
    price = serializers.IntegerField(source="price_minor", read_only=True)

    class Meta:
        model = SalePhase
        fields = ["id", "name", "price", "ends_at", "quantity", "position"]
        read_only_fields = fields


class TicketTypeSerializer(serializers.ModelSerializer):
    price = serializers.IntegerField(source="price_minor", read_only=True)
    available = serializers.SerializerMethodField()
    is_on_sale = serializers.SerializerMethodField()
    # `effective_price` is what a buyer pays right now; `price` is the face
    # price, kept alongside it so a UI can show what the phase is off. A
    # client that renders only one number should render this one.
    effective_price = serializers.SerializerMethodField()
    current_phase = serializers.SerializerMethodField()
    next_price = serializers.SerializerMethodField()
    # The full schedule, ascending position (SalePhase's Meta ordering) — the
    # tier read prefetches it, so this never queries per tier.
    phases = SalePhaseSerializer(many=True, read_only=True)

    class Meta:
        model = TicketType
        fields = [
            "id",
            "event_id",
            "slot_id",
            "name",
            "description",
            "perks",
            "position",
            "price",
            "effective_price",
            "current_phase",
            "next_price",
            "phases",
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

    def _state(self, obj: TicketType) -> PhaseState:
        """One evaluation per object, shared by the three fields below — the
        rule walks the schedule and there is no reason to walk it three
        times."""
        cached = getattr(obj, "_phase_state_cache", None)
        if cached is None:
            cached = evaluate_phases(
                price_minor=obj.price_minor,
                phases=obj.pricing_phases(),
                sold=obj.sold,
                reserved=obj.reserved,
                now=timezone.now(),
            )
            obj._phase_state_cache = cached  # type: ignore[attr-defined]
        return cached

    def get_available(self, obj: TicketType) -> int:
        return obj.available

    def get_effective_price(self, obj: TicketType) -> int:
        return self._state(obj).effective_price_minor

    def get_current_phase(self, obj: TicketType) -> dict | None:
        """The live phase — `null` when the tier is at face price. `remaining`
        is how many seats are still inside the phase's threshold, `null` when
        the phase has no threshold: an unbounded-by-seats phase has no count
        to report and the platform does not invent one; the deadline is what
        bounds it."""
        state = self._state(obj)
        if state.phase_name is None:
            return None
        return {
            "name": state.phase_name,
            # Rendered explicitly rather than returned raw: this payload is
            # cached as JSON, and the cache encoder's `isoformat()` would
            # differ from DRF's own representation — so cold and warm reads
            # would disagree on the format of the same timestamp.
            "ends_at": (
                None
                if state.ends_at is None
                else serializers.DateTimeField().to_representation(state.ends_at)
            ),
            "remaining": state.remaining,
        }

    def get_next_price(self, obj: TicketType) -> int | None:
        """What the price becomes once the current phase ends or exhausts —
        the next phase that could still apply, else the face price. `null`
        when no phase is active (there is nothing after the face price)."""
        return self._state(obj).next_price_minor

    def get_is_on_sale(self, obj: TicketType) -> bool:
        if obj.available <= 0:
            return False
        now = timezone.now()
        if obj.sale_start is not None and now < obj.sale_start:
            return False
        return not (obj.sale_end is not None and now > obj.sale_end)
