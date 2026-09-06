"""What a coupon is worth on an order — the pure rule, and nothing else.

No ORM, no Django, no clock it was not handed. Like `ticketing.pricing`, this
module exists so the arithmetic that decides a charged amount can be tested
exhaustively without a database, and so there is exactly ONE statement of it:
the checkout's preview and the locked decision at reserve both call this
function, so a quote and a charge cannot disagree about what a code is worth.

── EVERY NUMBER IS INTEGER PAISE ────────────────────────────────────────────

`value` is a whole percent or whole paise, never a rate. `0.2` in a float is
not 20%, and money is the one place in this codebase where that difference
reaches somebody's card. The same reason `PLATFORM_FEE_BPS` is basis points.

── ROUNDING GOES DOWN, ALWAYS ───────────────────────────────────────────────

`(subtotal * percent) // 100` truncates. Rounding up would occasionally spend a
paise of the ORGANIZER's money that the percentage they advertised does not
cover, and a discount that can exceed its own stated rate — even by one paise —
is a rule nobody can reason about. Down, and the coupon is always worth at most
what it says.
"""

from __future__ import annotations

from dataclasses import dataclass

#: The smallest total a payment provider will accept, in minor units.
#:
#: Razorpay's floor is ₹1. It lives here rather than in `payments` because this
#: is the only module that can push a total DOWN, and a booking whose total
#: lands under the floor is one whose Pay button can only ever fail — see
#: `CouponLeavesNothingToChargeError`. A different provider with a different
#: floor changes this constant and nothing else.
MIN_PAYABLE_TOTAL_MINOR = 100

#: Percentages are bounded at 100 because 100% is the whole order. Above it the
#: cap below would silently absorb the excess, which makes "150% off" and "100%
#: off" the same coupon while reading as two different promises.
MAX_PERCENT = 100


@dataclass(frozen=True)
class CouponTerms:
    """Just enough of a `Coupon` to price it.

    A dataclass rather than the model, so this module never imports one — the
    rule is the same whether the terms came from a row, a test table, or a
    preview of terms an organizer has typed but not saved.
    """

    kind: str
    value: int
    max_discount_minor: int | None = None


def discount_on(terms: CouponTerms, *, subtotal_minor: int) -> int:
    """What comes off a subtotal of `subtotal_minor`, in minor units.

    Never negative, never more than the subtotal itself. That second cap is the
    one that matters: a ₹500 code on a ₹300 order takes ₹300 off, and without
    the cap it would take ₹500 off and produce a NEGATIVE total — an amount
    that would be sent to a payment provider as a charge.

    A subtotal of zero returns zero rather than raising: a free tier is already
    possible today, and a coupon on one is pointless, not erroneous.
    """
    if subtotal_minor <= 0:
        return 0

    if terms.kind == "percent":
        percent = max(0, min(int(terms.value), MAX_PERCENT))
        raw = (subtotal_minor * percent) // 100
    else:
        raw = max(0, int(terms.value))

    if terms.max_discount_minor is not None:
        raw = min(raw, max(0, int(terms.max_discount_minor)))

    return min(raw, subtotal_minor)


# There is deliberately no `platform_fee_on` here. The fee follows the discount
# — it is charged on the DISCOUNTED subtotal, which is the whole reason a
# coupon touches it — but `BookingService._platform_fee_for` is the one
# statement of that arithmetic, and a second copy in this module would be a
# second place for the platform's own revenue to be rounded differently.
