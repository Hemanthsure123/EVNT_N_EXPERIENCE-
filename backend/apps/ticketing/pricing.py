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
- `decide_unit_price(...)` → what ONE unit of an order of this size costs,
  composing the sale phase with any group band. The ONE public answer to
  "what is charged"; `decide_phase_price` is the phase half of it.
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


@dataclass(frozen=True)
class GroupBand:
    """A cheaper per-unit price once an order reaches a size.

    `min_quantity` is a FLOOR on the order, not a cumulative tier count — it
    is "buy this many at once", which is a different question from
    `Phase.quantity` ("the first k seats of this tier"). Two orders of 4 both
    get the 4+ band; the second does not fall through because the first
    "used it up".
    """

    min_quantity: int
    price_minor: int


@dataclass(frozen=True)
class PricedUnit:
    """What ONE unit costs, and WHICH rule decided it.

    Two labels rather than one, because a phase and a band are different
    things and `BookingItem` records them in different columns. Collapsing
    them into a single "why" string would put a band label in `phase_name`,
    which every consumer of that column reads as a sale phase.
    """

    price_minor: int
    #: The winning sale phase, or `None` at face price.
    phase_name: str | None = None
    #: The winning group band's `min_quantity`, or `None` when no band applied.
    group_min_quantity: int | None = None


def _eligible_bands(
    bands: list[GroupBand] | tuple[GroupBand, ...], price_minor: int
) -> list[GroupBand]:
    """Bands sorted by size, with anything that cannot honestly apply dropped.

    THE SAME DEFENSIVE FLOOR `_eligible` APPLIES TO PHASES, and for the same
    reason: this is a JSON column, so Postgres cannot express a CHECK
    comparing a band's price to the tier's own `price_minor`. The service's
    validation is the only writer-side guard, and a guard one writer honours
    is not defense in depth.

    Dropped here:
      · a band priced ABOVE the face price — a "discount" that overcharges
      · a band at `min_quantity <= 1`, which is just the face price wearing a
        label, and would apply to every single-ticket order
    """
    usable = [band for band in bands if band.min_quantity > 1 and band.price_minor <= price_minor]
    return sorted(usable, key=lambda band: band.min_quantity)


def group_bands_from_rows(rows: object) -> list[GroupBand]:
    """Read a stored JSON list into the pure rule's own type.

    DEFENSIVE, because the source is a JSON column: a hand-written migration, a
    raw UPDATE or a fixture can put anything in it, and this runs inside a row
    lock on the money path where a `TypeError` would abort a reserve mid-hold.
    Anything that is not a well-formed band is DROPPED rather than raised on —
    the worst outcome of ignoring a malformed row is that somebody pays the
    face price they were quoted, and the `_eligible_bands` floor above means
    that is the worst outcome of any bad row here.
    """
    if not isinstance(rows, list):
        return []
    bands: list[GroupBand] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        minimum = row.get("min_quantity")
        price = row.get("price_minor")
        # `bool` is an `int` subclass, so it has to be excluded explicitly or
        # `{"min_quantity": true}` reads as a band at 1.
        if isinstance(minimum, bool) or isinstance(price, bool):
            continue
        if not isinstance(minimum, int) or not isinstance(price, int):
            continue
        if minimum < 0 or price < 0:
            continue
        bands.append(GroupBand(min_quantity=minimum, price_minor=price))
    return bands


def band_for_quantity(
    bands: list[GroupBand] | tuple[GroupBand, ...], price_minor: int, quantity: int
) -> GroupBand | None:
    """The band an order of this size qualifies for — the LARGEST it reaches.

    Largest rather than first: bands are cumulative thresholds on party size,
    so an order of 6 against bands at 2 and 4 gets the 4+ price. Taking the
    first would give it the 2+ price and quietly withhold the better one the
    organiser advertised.
    """
    winner: GroupBand | None = None
    for band in _eligible_bands(bands, price_minor):
        if quantity >= band.min_quantity:
            winner = band
    return winner


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


def decide_phase_price(
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


def decide_unit_price(
    *,
    price_minor: int,
    phases: list[Phase] | tuple[Phase, ...],
    bands: list[GroupBand] | tuple[GroupBand, ...],
    quantity: int,
    sold: int,
    reserved: int,
    now: datetime,
) -> PricedUnit:
    """The CHARGED unit price, composing the sale phase and the group band.

    Called only from inside the per-tier row lock (see `strategies.py`), with
    `sold`/`reserved` from the freshly locked row and BEFORE the counters move.

    ── THE BUYER PAYS THE LOWER OF THE TWO ───────────────────────────────────

    Both a phase and a band are discounts off the face price, and both are
    ADVERTISED before the press — the tier payload carries the phase, and the
    picker shows the band's per-person price. Charging the higher of two
    visible discounts is overcharging relative to what was on screen, and this
    module's existing rule is explicit that a schedule "can make somebody pay
    LESS than the advertised price, never more". `min` is the only composition
    that keeps that true for both dimensions at once.

    It also gives the organiser the behaviour they would expect without having
    to reason about precedence: a group buying during early bird keeps the
    early-bird price if it is cheaper, and gets the group price if that is.
    Nobody loses a discount by qualifying for a second one.

    The straddle rule for phases is unchanged and still applies first: a phase
    whose cumulative threshold cannot cover the whole order is skipped, so the
    phase half of this decision is exactly what it was before bands existed.
    """
    phase_price, phase_name = decide_phase_price(
        price_minor=price_minor,
        phases=phases,
        quantity=quantity,
        sold=sold,
        reserved=reserved,
        now=now,
    )
    band = band_for_quantity(bands, price_minor, quantity)
    if band is None or band.price_minor >= phase_price:
        # No band, or the phase already beats it. Either way the phase's own
        # answer stands untouched — including its name, so a booking item still
        # records which phase priced it.
        return PricedUnit(price_minor=phase_price, phase_name=phase_name)
    # The band wins. `phase_name` is deliberately dropped: the phase did NOT
    # price this line, and recording it would make the receipt claim a
    # discount the buyer did not receive.
    return PricedUnit(price_minor=band.price_minor, group_min_quantity=band.min_quantity)
