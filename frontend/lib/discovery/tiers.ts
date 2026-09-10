import type { TicketTier } from '@/lib/api/types';
import { formatEventDate, formatEventDateTime } from './format';

/**
 * What the ticket tiers add up to.
 *
 * Everything here is arithmetic over `quantity`, `sold` and `available` —
 * columns the `ticketing` module maintains under a per-tier row lock. Nothing
 * is estimated, weighted or invented, which is why the numbers this produces
 * are safe to put next to a price.
 *
 * IMPORTANT: these are DISPLAY values. The authoritative availability check
 * happens at reserve time under that row lock (the repo's "cache-for-display,
 * decide-under-lock" rule), so "3 left" is a nudge and the booking flow
 * re-checks. That is also why the fetch is `no-store` — a cached inventory
 * number is how you tell someone an event is sold out when it isn't.
 */

/**
 * What ONE ticket of this tier costs RIGHT NOW, in minor units.
 *
 * `effective_price` is the backend's own answer, computed by the same pure rule
 * (`apps/ticketing/pricing.py`) the locked reserve uses to decide what to
 * charge — so this is the number to render as "the price" wherever a buyer is
 * being quoted, and `price` is only ever the face price a phase is off.
 *
 * The `?? price` fallback is not belt-and-braces: `TicketTier` is a
 * hand-written type, a backend that predates sale phases sends no
 * `effective_price` at all, and `undefined * quantity` is `NaN` on the money
 * path — an order total reading "₹NaN" at checkout.
 */
export const unitPriceFor = (tier: TicketTier): number => tier.effective_price ?? tier.price;

/**
 * What ONE ticket costs at a given ORDER SIZE — the group-pricing answer.
 *
 * ── THIS MIRRORS A MONEY RULE, AND SAYS SO ────────────────────────────────
 *
 * The authority is `decide_unit_price` in `apps/ticketing/pricing.py`, decided
 * under the per-tier row lock. This is the DISPLAY half, and it exists because
 * `effective_price` cannot express a group price: that is one number and a
 * group price depends on the order size, which the server does not know when it
 * serves the tier.
 *
 * It is a second implementation of a money rule in TypeScript, which this
 * codebase does exactly once elsewhere (`PLATFORM_FEE_BPS`) and flags there for
 * the same reason: the two can silently disagree. Kept safe by being trivial
 * and by mirroring the Python case for case in `tiers.test.ts`. If it ever
 * needs to be cleverer than this, it belongs behind an endpoint instead.
 *
 * ── THE COMPOSITION: THE LOWER OF PHASE AND BAND ──────────────────────────
 *
 * Both are advertised before the press, so charging the higher of two visible
 * discounts is overcharging against what was on screen. `Math.min` is the
 * server's rule verbatim, and it means nobody loses a discount by qualifying
 * for a second one.
 *
 * ── THE SAME FLOOR THE CHARGE PATH APPLIES ────────────────────────────────
 *
 * A band above the face price and a band at one ticket are both IGNORED, per
 * `_eligible_bands`. Without it a corrupt row would quote somebody MORE than
 * the face price on the screen where they decide to buy.
 */
export function unitPriceAt(tier: TicketTier, quantity: number): number {
  const phasePrice = unitPriceFor(tier);
  const band = groupBandAt(tier, quantity);
  return band === null ? phasePrice : Math.min(phasePrice, band.price_minor);
}

/**
 * The band an order of this size qualifies for — the LARGEST it reaches.
 *
 * Largest rather than first: bands are thresholds on party size, so an order
 * of 6 against bands at 2 and 4 gets the 4+ price. Taking the first would
 * withhold the better one the organiser advertised.
 *
 * Returned rather than folded into `unitPriceAt` so the picker can NAME it —
 * "₹400 each for 4+" is what makes the discount visible before somebody has
 * added the fourth ticket.
 */
export function groupBandAt(
  tier: TicketTier,
  quantity: number,
): { min_quantity: number; price_minor: number } | null {
  let winner: { min_quantity: number; price_minor: number } | null = null;
  for (const band of eligibleBands(tier)) {
    if (quantity >= band.min_quantity) winner = band;
  }
  return winner;
}

/** Every band that could honestly apply, smallest group first. */
export function eligibleBands(tier: TicketTier): { min_quantity: number; price_minor: number }[] {
  return (tier.group_bands ?? [])
    .filter((band) => band.min_quantity > 1 && band.price_minor <= tier.price)
    .slice()
    .sort((a, b) => a.min_quantity - b.min_quantity);
}

/**
 * The NEXT group price a buyer has not reached yet, if there is one.
 *
 * The whole point of showing bands: "add 2 more for ₹400 each" is a reason to
 * buy another ticket, where a discount only revealed once you qualify is a
 * discount most people never find.
 */
export function nextGroupBand(
  tier: TicketTier,
  quantity: number,
): { min_quantity: number; price_minor: number } | null {
  const current = groupBandAt(tier, quantity);
  for (const band of eligibleBands(tier)) {
    if (band.min_quantity <= quantity) continue;
    // Only worth naming if it actually beats what they would pay now.
    if (band.price_minor < (current?.price_minor ?? unitPriceFor(tier))) return band;
  }
  return null;
}

/** At or below this, name the exact number — it's the honest kind of urgency. */
export const FEW_LEFT = 10;
/** At or below this, it's genuinely moving. Above it, say nothing. */
export const SELLING_FAST = 50;

export type AvailabilityState =
  | { kind: 'unknown' }
  /**
   * Nothing is buyable YET — every tier's window opens in the future.
   *
   * `opensAt` is the soonest of those windows, carried on the state rather
   * than re-derived by each caller, because three surfaces render it and a
   * fourth (the funnel) refuses on it. It is null when the tiers carry no
   * `sale_start` at all, which is a real case: a tier can be off sale
   * because its window CLOSED, and inventing an opening date for that
   * would be the fabrication this codebase refuses everywhere else.
   */
  | { kind: 'not_on_sale'; opensAt: string | null }
  | { kind: 'sold_out' }
  | { kind: 'few_left'; left: number }
  | { kind: 'selling_fast'; left: number }
  | { kind: 'available'; left: number };

export type TierSummary = {
  /** Tiers in the organiser's own order — what `position` on the server means. */
  tiers: TicketTier[];
  available: number;
  /** Real bookings across all tiers. Zero is a perfectly good answer. */
  sold: number;
  /**
   * The cheapest ticket somebody can actually buy right now, in minor units;
   * null when nothing is on sale.
   *
   * It is the lowest EFFECTIVE price, not the lowest face price — the sticky
   * booking bar reads this while the panel beside it renders the live phase
   * price, and "from ₹999" over a ₹799 Early bird is the same screen
   * contradicting itself. Taken as a minimum across the on-sale tiers rather
   * than off the first one, so it stays correct even when a phase discounts a
   * higher tier below a cheaper one's face price.
   */
  fromPrice: number | null;
  state: AvailabilityState;
};

/**
 * The tiers a buyer should actually SEE.
 *
 * A tier whose sale has not opened is a row you cannot press, priced at a
 * number you cannot pay — on the screen where somebody is deciding. Four of
 * them on a long festival is most of the panel spent on things that are not
 * for sale, which is what the ticket card looked like.
 *
 * So: while ANY tier is on sale, only the on-sale ones are shown. Sold-out
 * tiers stay — "Gold: sold out" is a real answer to "can I buy Gold", and
 * hiding it would make the tier look like it never existed.
 *
 * When NOTHING is on sale the full ladder comes back, because then the upcoming
 * prices are the only information the panel has, and an empty card would read
 * as "this event has no tickets" — a different and wrong fact.
 */
export function sellableTiers(tiers: TicketTier[]): TicketTier[] {
  const onSale = tiers.filter((tier) => tier.is_on_sale);
  return onSale.length ? onSale : tiers;
}

export function summariseTiers(tiers: TicketTier[] | null | undefined): TierSummary {
  if (!tiers) {
    return { tiers: [], available: 0, sold: 0, fromPrice: null, state: { kind: 'unknown' } };
  }

  // ── THE SERVER'S ORDER IS THE ORGANISER'S ORDER. DO NOT RE-SORT. ───────
  //
  // This used to be `[...tiers].sort((a, b) => a.price - b.price)`, justified
  // as "the tier ladder the organiser built — Basic under Gold under Premium".
  // A price sort is a PROXY for that ladder, and it was the best available
  // when nothing carried the real one.
  //
  // Something does now. `TicketType.position` is the organiser's explicit
  // arrangement, it is the FIRST sort key the tiers endpoint orders by (after
  // the slot), and the ticket builder has drag-and-drop and arrow keys for
  // setting it. Re-sorting here threw all of that away at the last step: the
  // organiser dragged their weekend pass above the day tickets, the server
  // stored it, sent it in that order, and this line put it back under them —
  // which is precisely the case the backend note says a price sort cannot
  // express.
  //
  // `fromPrice` below is a `Math.min`, not the first element, so it is
  // unaffected. `tierRank` now reads the organiser's order rather than the
  // price order, which means its "entry" and "top" follow the list they
  // arranged — the intended behaviour of a merchandising control.
  const ordered = tiers;
  const available = ordered.reduce((sum, tier) => sum + Math.max(tier.available, 0), 0);
  const sold = ordered.reduce((sum, tier) => sum + Math.max(tier.sold, 0), 0);
  const onSale = ordered.filter((tier) => tier.is_on_sale);
  const fromPrice = onSale.length ? Math.min(...onSale.map(unitPriceFor)) : null;

  return { tiers: ordered, available, sold, fromPrice, state: availabilityState(ordered) };
}

function availabilityState(tiers: TicketTier[]): AvailabilityState {
  // No tiers at all means ticketing hasn't set this event up yet — which is
  // "we don't know", not "sold out". Those must never look the same.
  if (!tiers.length) return { kind: 'unknown' };

  const left = tiers.reduce((sum, tier) => sum + Math.max(tier.available, 0), 0);
  if (left <= 0) return { kind: 'sold_out' };
  // ── WHAT CAN BE BOUGHT NOW, NOT WHAT EXISTS ────────────────────────────
  //
  // This asked whether ANY tier was on sale, and counted stock across ALL of
  // them. So an event whose on-sale tier had sold out, beside a tier whose
  // window opens next week, read as `available` — and its Book button was
  // live, onto a picker where every row is disabled. Nothing had failed; the
  // flow should never have been enterable. Only stock in a tier on sale NOW
  // makes the event buyable, and only that stock is worth counting down.
  const buyable = tiers.reduce(
    (sum, tier) => sum + (tier.is_on_sale ? Math.max(tier.available, 0) : 0),
    0,
  );
  if (buyable <= 0) {
    return { kind: 'not_on_sale', opensAt: earliestSaleStart(tiers) };
  }
  if (buyable <= FEW_LEFT) return { kind: 'few_left', left: buyable };
  if (buyable <= SELLING_FAST) return { kind: 'selling_fast', left: buyable };
  // Healthy stock says so plainly. Manufacturing pressure here is the whole
  // thing the brief rules out, and it's the fastest way to stop being believed.
  return { kind: 'available', left: buyable };
}

export function availabilityLabel(state: AvailabilityState): string | null {
  switch (state.kind) {
    case 'sold_out':
      return 'Sold out';
    case 'few_left':
      return state.left === 1 ? 'Last ticket left' : `Only ${state.left} left`;
    case 'selling_fast':
      return 'Selling fast';
    case 'available':
      return 'Tickets available';
    case 'not_on_sale':
      // The TIME as well as the date: this line is the precise answer to
      // "when can I buy", where the button beside it only has room to say
      // that you cannot yet.
      return state.opensAt
        ? `Sales open ${formatEventDateTime(state.opensAt)}`
        : 'Sales not open yet';
    default:
      return null;
  }
}

/** Whether a state should be styled as pressure rather than as information. */
export const isUrgent = (state: AvailabilityState) =>
  state.kind === 'few_left' || state.kind === 'selling_fast';

/**
 * The soonest moment any of these tiers goes on sale, or null.
 *
 * Only tiers that are BOTH off sale and still have stock count. A sold-out
 * tier with a future window is not something anybody is waiting for, and
 * letting it win the minimum would advertise an opening date for tickets
 * that will not exist.
 *
 * Compared through `Date.parse`, never by sorting the strings: the backend
 * emits ISO-8601 with an offset, and `+05:30` and `Z` do not sort into the
 * order they actually occur in.
 */
export function earliestSaleStart(tiers: TicketTier[]): string | null {
  let winner: string | null = null;
  let winnerMs = Infinity;
  for (const tier of tiers) {
    if (tier.is_on_sale || Math.max(tier.available, 0) <= 0) continue;
    if (!tier.sale_start) continue;
    const ms = Date.parse(tier.sale_start);
    if (Number.isNaN(ms) || ms >= winnerMs) continue;
    winnerMs = ms;
    winner = tier.sale_start;
  }
  return winner;
}

/**
 * MAY THE BOOKING FLOW BE ENTERED AT ALL.
 *
 * ── THE BUG THIS EXISTS TO MAKE IMPOSSIBLE ────────────────────────────
 *
 * `not_on_sale` used to reach the same black "Book tickets" pill as an
 * event selling normally. Pressing it opened the picker, where every row is
 * disabled — honest, and already a dead screen — and a URL carrying a
 * `?tickets=` selection skipped even that: the funnel reserved, the tier's
 * window had not opened, `reserve` refused under the row lock with
 * `sale_not_started`, and the customer landed on "We could not hold your
 * tickets. An unexpected error occurred." for an event that is simply not
 * on sale yet.
 *
 * Nothing had failed. The flow should never have been enterable.
 *
 * ── `unknown` IS DELIBERATELY ALLOWED THROUGH ─────────────────────────
 *
 * It means there are no tiers to reason about — ticketing has not set the
 * event up, or the tiers fetch blipped. Refusing on it would make a
 * perfectly sellable event unbookable because one request failed, which is
 * a worse outcome than the picker saying there is nothing to pick. The two
 * must never be confused, exactly as the waiting list already insists.
 */
export const canStartBooking = (state: AvailabilityState): boolean =>
  state.kind !== 'sold_out' && state.kind !== 'not_on_sale';

/**
 * What the one button on the event page should SAY.
 *
 * A disabled control has to explain itself or it reads as broken, and
 * "Book tickets", greyed, is indistinguishable from a page that failed to
 * load. The date is the whole answer — somebody who knows when it opens can
 * come back, where somebody told only "unavailable" cannot.
 *
 * The DATE only, not the time: this is a pill beside a price, and the line
 * above it already carries the exact moment via `availabilityLabel`.
 */
export function bookingCtaLabel(state: AvailabilityState): string {
  if (state.kind === 'sold_out') return 'Sold out';
  if (state.kind === 'not_on_sale') {
    return state.opensAt
      ? `Booking opens ${formatEventDate(state.opensAt)}`
      : 'Booking not open yet';
  }
  return 'Book tickets';
}

/**
 * A tier's standing relative to its siblings, for the "each tier should feel
 * different" requirement — resolved from PRICE ORDER, not from a name.
 * `Basic`/`Gold`/`Premium` are one organiser's vocabulary; the next one will
 * use `Early bird`/`Regular`, and this still has to work.
 */
export type TierRank = 'entry' | 'mid' | 'top';

export function tierRank(index: number, total: number): TierRank {
  if (total <= 1) return 'entry';
  if (index === 0) return 'entry';
  if (index === total - 1) return 'top';
  return 'mid';
}
