"""The sale-phase rule — ONE pure implementation, evaluated in two places.

A tier's price can move through named phases ("Early bird", "Phase 1", …),
each bounded by a deadline and/or a CUMULATIVE seat threshold. A phase
changes what a customer is CHARGED, so it is a money path and the module's
governing rule applies unchanged (CLAUDE.md, "cache-for-display,
decide-under-lock"):

> The DISPLAY price may be cached and fast. The CHARGED price may not — it is
> decided under the same per-tier row lock that decides availability.

Both callers (the locked reserve decision in `strategies.py`, and the tier
display payload in `schemas.py`) go through the functions here, so the rule
cannot drift between what a buyer is quoted and what they are billed. The
module is deliberately pure — no ORM, no clock of its own (`now` is passed
in) — because its edge cases are boundaries (a deadline instant, the last
seat of a threshold, an order straddling that seat) and those are only
testable cheaply if the rule is a function.

TWO different questions, and they have different answers on purpose:

- `evaluate_phases(...)` → which phase is live *right now*, what it charges,
  and what comes after it. This is the DISPLAY question: the ACTIVE phase is
  the first (by position) whose deadline is in the future (or unset) AND
  whose cumulative threshold (`sold + reserved < quantity`, or unset) is not
  exhausted.
- `decide_unit_price(...)` → what ONE unit of an order of this size costs.
  This is the CHARGE question, and it additionally requires the WHOLE order
  to fit inside the phase's cumulative threshold.

Why the charge question is stricter: a booking item carries ONE unit price
for its whole quantity, so a mixed order (2 seats at the phase price, 1 at
the next) is not representable downstream. Given that, an order for 3 when a
single phase seat remains has two possible honest answers — hand out 3
phase-priced seats when the organizer allocated 1, or bill the whole order
at the NEXT price. We take the second: `quantity` is a cumulative "this many
seats sold-or-held before this phase closes", and exceeding it costs the
organizer real money on every straddling order. A straddling order therefore
falls through to the first LATER phase (or the face price) that can cover it
whole — never split. The tier payload exposes `current_phase.remaining` for
exactly this reason: the frontend can show how many are left rather than
letting a buyer discover the boundary at checkout.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Phase:
    """One row of the schedule, as the pure rule sees it.

    `quantity` is CUMULATIVE: the phase is exhausted once the tier's
    `sold + reserved` reaches it — "the first k seats of this tier", not
    "k seats that were sold at this price". Tickets sell in order, so those
    are the same set in practice, and it is the definition that needs no
    bookkeeping: a lapsed hold releasing its seat returns it to the phase
    automatically, and a hold taken after the threshold is already past it.
    """

    name: str
    price_minor: int
    ends_at: datetime | None
    quantity: int | None
    position: int


@dataclass(frozen=True)
class PhaseState:
    """What the tier's pricing looks like right now.

    `effective_price_minor` is the ONLY number to show as "the price".
    `remaining` is `None` when the active phase has no seat threshold (or no
    phase is active at all) — an unbounded-by-seats phase has no count to
    report, and this codebase does not invent a number to put on a screen.
    `next_price_minor` is what the price becomes once the active phase ends
    or exhausts — the first later phase that could still apply, else the face
    price; `None` when no phase is active (there is no "next" after the face
    price).
    """

    effective_price_minor: int
    phase_name: str | None
    remaining: int | None
    ends_at: datetime | None
    next_price_minor: int | None


def _sorted(phases: list[Phase] | tuple[Phase, ...]) -> list[Phase]:
    return sorted(phases, key=lambda p: p.position)


def _eligible(phases: list[Phase] | tuple[Phase, ...], price_minor: int) -> list[Phase]:
    """Schedule order, with any phase priced ABOVE the tier's face price
    dropped — it can neither price an order nor be advertised as what comes
    next.

    THIS RULE REPLACES A DATABASE CONSTRAINT, which is why it lives at the
    bottom of the pure module both the display and the charge path go through.
    When the discount was a single column on the tier, `early_bird_price_minor
    <= price_minor` was a same-row CHECK and Postgres itself refused an
    overpriced "discount". A named schedule lives in a child table and Postgres
    cannot express a CHECK across two tables, so the service's validation
    became the only writer-side guard — and a guard that only one writer
    honours is not defense in depth.

    A phase above face price can therefore only arrive by a raw write or data
    corruption, and the invariant that matters to a buyer is that neither can
    ever overcharge them: a schedule can make somebody pay LESS than the
    advertised price, never more. Ignoring the row keeps that true at the money
    path itself rather than trusting every future writer.
    """
    return [p for p in _sorted(phases) if p.price_minor <= price_minor]


def _time_live(phase: Phase, now: datetime) -> bool:
    # `ends_at` is exclusive: at exactly the deadline the phase has ended.
    return phase.ends_at is None or now < phase.ends_at


def _seats_left(phase: Phase, committed: int) -> int | None:
    """Seats still inside the phase's cumulative threshold — `None` when the
    phase has no threshold. Clamped at 0 so a threshold edit that lands below
    the committed count can't read negative."""
    return None if phase.quantity is None else max(0, phase.quantity - committed)


def evaluate_phases(
    *,
    price_minor: int,
    phases: list[Phase] | tuple[Phase, ...],
    sold: int,
    reserved: int,
    now: datetime,
) -> PhaseState:
    """The display half of the rule. Pure: every input is passed in,
    including `now`.

    Callers must pass `sold`/`reserved` as they stand — thresholds count
    seats already committed. `next_price_minor` skips phases that can no
    longer apply (deadline already passed, threshold already crossed): a
    "price goes up to X" hint pointing at a phase nobody can ever get would
    be a confident lie, which this codebase does not tell.
    """
    ordered = _eligible(phases, price_minor)
    committed = sold + reserved

    for index, phase in enumerate(ordered):
        left = _seats_left(phase, committed)
        if not _time_live(phase, now) or left == 0:
            continue
        # First live phase wins — later ones are what comes after it.
        next_price = price_minor
        for later in ordered[index + 1 :]:
            if _time_live(later, now) and _seats_left(later, committed) != 0:
                next_price = later.price_minor
                break
        return PhaseState(
            effective_price_minor=phase.price_minor,
            phase_name=phase.name,
            remaining=left,
            ends_at=phase.ends_at,
            next_price_minor=next_price,
        )

    # No phase is active: the face price, with nothing scheduled after it.
    return PhaseState(
        effective_price_minor=price_minor,
        phase_name=None,
        remaining=None,
        ends_at=None,
        next_price_minor=None,
    )


def decide_unit_price(
    *,
    price_minor: int,
    phases: list[Phase] | tuple[Phase, ...],
    quantity: int,
    sold: int,
    reserved: int,
    now: datetime,
) -> tuple[int, str | None]:
    """The CHARGED unit price for an order of `quantity` units, plus the name
    of the phase that priced it (`None` when it billed at face price).

    Called only from inside the per-tier row lock (see `strategies.py`) —
    `sold`/`reserved` must come from the freshly locked row, never from the
    display cache or a pre-lock read, and BEFORE the counters move (the
    threshold counts seats already committed, not this order's).

    The straddle rule: the winning phase is the first (by position) that is
    time-live AND whose cumulative threshold covers the WHOLE order. An order
    that straddles a threshold falls through to the next phase's price for
    the whole order — never split — and to the face price when nothing later
    can cover it either.

    A phase priced above the face price is ignored rather than billed (see
    `_eligible`) — the charge path never overcharges, whatever is in the table.
    """
    committed = sold + reserved
    for phase in _eligible(phases, price_minor):
        if not _time_live(phase, now):
            continue
        if phase.quantity is not None and committed + quantity > phase.quantity:
            continue
        return phase.price_minor, phase.name
    return price_minor, None
