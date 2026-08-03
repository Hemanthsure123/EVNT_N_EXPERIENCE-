"""The early-bird rule — ONE pure implementation, evaluated in two places.

Early bird changes what a customer is CHARGED, so it is a money path and the
module's governing rule applies unchanged (CLAUDE.md, "cache-for-display,
decide-under-lock"):

> The DISPLAY price may be cached and fast. The CHARGED price may not — it is
> decided under the same per-tier row lock that decides availability.

Both callers (the locked reserve decision in `strategies.py`, and the tier
display payload in `schemas.py`) go through the functions here, so the rule
cannot drift between what a buyer is quoted and what they are billed. The
module is deliberately pure — no ORM, no clock of its own (`now` is passed
in) — because its edge cases are boundaries (the deadline instant, the last
allocated seat, an order straddling that seat) and those are only testable
cheaply if the rule is a function.

TWO different questions, and they have different answers on purpose:

- `evaluate_early_bird(...)` → is the discount live *at all*, and how many
  seats are left at it. This is the DISPLAY question (and it is exactly the
  rule as specified: set, AND not past its deadline, AND
  `sold + reserved < early_bird_quantity`).
- `decide_unit_price(state, quantity=...)` → what ONE unit of an order of
  this size costs. This is the CHARGE question, and it additionally requires
  the WHOLE order to fit inside the remaining allocation.

Why the charge question is stricter: a booking item carries ONE unit price
for its whole quantity, so a mixed order (2 seats at the early price, 1 at
full) is not representable downstream. Given that, an order for 3 when a
single early-bird seat remains has two possible honest answers — hand out 3
discounted seats when the organizer allocated 1, or charge all 3 at the
normal price. We take the second: `early_bird_quantity` means "this many
seats at this price", and exceeding it costs the organizer real money on
every straddling order. The tier payload exposes `early_bird_remaining` for
exactly this reason — the frontend can show how many are left rather than
letting a buyer discover the boundary at checkout.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class EarlyBirdState:
    """What the tier's pricing looks like right now.

    `effective_price_minor` is the ONLY number to show as "the price".
    `remaining` is `None` when there is no seat cap (or no early bird at
    all) — a null cap means unlimited until the deadline, and this codebase
    does not invent a number to put on a screen. When a cap IS set, the
    count is the number of units that will still be sold at the early-bird
    price, so it is 0 once the deadline has passed.
    """

    price_minor: int
    effective_price_minor: int
    is_active: bool
    remaining: int | None
    ends_at: datetime | None


def evaluate_early_bird(
    *,
    price_minor: int,
    early_bird_price_minor: int | None,
    early_bird_ends_at: datetime | None,
    early_bird_quantity: int | None,
    sold: int,
    reserved: int,
    now: datetime,
) -> EarlyBirdState:
    """The early-bird rule. Pure: every input is passed in, including `now`.

    `early_bird_quantity` is measured against `sold + reserved` — i.e. it is
    "the first k seats of this tier", not "k seats that were discounted".
    Tickets sell in order, so those are the same set in practice, and it is
    the definition that needs no bookkeeping: a lapsed hold releasing its seat
    returns it to the allocation automatically, and a full-price hold taken
    after the allocation ran out is already outside it.

    Callers must pass `sold`/`reserved` as they stand BEFORE the reserve being
    priced — the allocation counts seats already committed, not the ones this
    order is about to take.
    """
    configured = early_bird_price_minor is not None
    within_deadline = early_bird_ends_at is None or now < early_bird_ends_at
    # None = uncapped (unlimited until the deadline). Clamped at 0 so a
    # quantity edit that lands below the committed count can't read negative.
    allocation_left = (
        None if early_bird_quantity is None else max(0, early_bird_quantity - sold - reserved)
    )

    is_active = configured and within_deadline and (allocation_left is None or allocation_left > 0)

    if not configured or allocation_left is None:
        remaining = None
    else:
        remaining = allocation_left if within_deadline else 0

    return EarlyBirdState(
        price_minor=price_minor,
        effective_price_minor=(
            early_bird_price_minor
            if is_active and early_bird_price_minor is not None
            else price_minor
        ),
        is_active=is_active,
        remaining=remaining,
        # An unconfigured tier reports no deadline even if a stray date sits
        # in the column: a countdown to a discount that does not exist is a
        # promise the platform can't keep.
        ends_at=early_bird_ends_at if configured else None,
    )


def decide_unit_price(state: EarlyBirdState, *, quantity: int) -> tuple[int, bool]:
    """The CHARGED unit price for an order of `quantity` units, plus whether
    the early-bird price was the one applied.

    Called only from inside the per-tier row lock (see `strategies.py`) —
    `state` must have been built from the freshly locked row, never from the
    display cache or a pre-lock read.
    """
    if not state.is_active:
        return state.price_minor, False
    # The whole order must fit in what's left of the allocation — see the
    # module docstring for why a straddling order is not split.
    if state.remaining is not None and quantity > state.remaining:
        return state.price_minor, False
    return state.effective_price_minor, True
