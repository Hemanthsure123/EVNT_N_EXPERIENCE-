import type { TicketTier } from '@/lib/api/types';

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

/** At or below this, name the exact number — it's the honest kind of urgency. */
export const FEW_LEFT = 10;
/** At or below this, it's genuinely moving. Above it, say nothing. */
export const SELLING_FAST = 50;

export type AvailabilityState =
  | { kind: 'unknown' }
  | { kind: 'not_on_sale' }
  | { kind: 'sold_out' }
  | { kind: 'few_left'; left: number }
  | { kind: 'selling_fast'; left: number }
  | { kind: 'available'; left: number };

export type TierSummary = {
  /** Tiers in price order, cheapest first — how people compare them. */
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

export function summariseTiers(tiers: TicketTier[] | null | undefined): TierSummary {
  if (!tiers) {
    return { tiers: [], available: 0, sold: 0, fromPrice: null, state: { kind: 'unknown' } };
  }

  // Sorted on FACE price, which is the tier ladder the organiser built — Basic
  // under Gold under Premium — and what `tierRank` reads for elevation. A phase
  // discount changes what a tier costs today, not where it sits in that ladder.
  const ordered = [...tiers].sort((a, b) => a.price - b.price);
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
  if (!tiers.some((tier) => tier.is_on_sale)) return { kind: 'not_on_sale' };
  if (left <= FEW_LEFT) return { kind: 'few_left', left };
  if (left <= SELLING_FAST) return { kind: 'selling_fast', left };
  // Healthy stock says so plainly. Manufacturing pressure here is the whole
  // thing the brief rules out, and it's the fastest way to stop being believed.
  return { kind: 'available', left };
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
      return 'Sales not open yet';
    default:
      return null;
  }
}

/** Whether a state should be styled as pressure rather than as information. */
export const isUrgent = (state: AvailabilityState) =>
  state.kind === 'few_left' || state.kind === 'selling_fast';

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
