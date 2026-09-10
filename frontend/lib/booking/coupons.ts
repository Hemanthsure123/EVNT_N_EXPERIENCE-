import type { PublicOffer } from '@/lib/api/types';
import { formatMoney } from '@/lib/discovery/format';

/**
 * What an advertised coupon is worth on THIS order, before anybody presses it.
 *
 * ── THIS MIRRORS A MONEY RULE, AND SAYS SO ────────────────────────────────
 *
 * The authority is `discount_on` in `apps/coupons/discounts.py`, decided under
 * the coupon's row lock when the code is applied. This is the DISPLAY half, and
 * it exists because a coupon card that says "Save ₹531 on this order!" is the
 * reason to press it — a number the offers endpoint cannot carry, since it
 * depends on the order and the endpoint is edge-cached for everybody.
 *
 * It is a second implementation of a money rule in TypeScript, which this
 * codebase allows only when the rule is trivial and mirrored case for case in
 * a test (`coupons.test.ts`), exactly as `PLATFORM_FEE_BPS` and group pricing
 * are. The CHARGE never reads it: applying still sends only the code, and the
 * total on screen moves to whatever the server decided.
 *
 * The rule, verbatim:
 *
 *   - a percentage is taken off the ticket subtotal and ROUNDED DOWN — the
 *     coupon is never worth more than it says, not even by a paise;
 *   - `max_discount_minor` caps it;
 *   - and the discount never exceeds the subtotal, or the total goes negative.
 */
export function discountOn(
  offer: Pick<PublicOffer, 'kind' | 'value' | 'max_discount_minor'>,
  subtotalMinor: number,
): number {
  if (subtotalMinor <= 0) return 0;

  let raw: number;
  if (offer.kind === 'percent') {
    const percent = Math.max(0, Math.min(Math.trunc(offer.value), MAX_PERCENT));
    // `Math.floor` over non-negative integers is Python's `//` exactly.
    raw = Math.floor((subtotalMinor * percent) / 100);
  } else {
    raw = Math.max(0, Math.trunc(offer.value));
  }

  if (offer.max_discount_minor !== null && offer.max_discount_minor !== undefined) {
    raw = Math.min(raw, Math.max(0, Math.trunc(offer.max_discount_minor)));
  }

  return Math.min(raw, subtotalMinor);
}

/** Mirrors `MAX_PERCENT` in `apps/coupons/discounts.py`. */
const MAX_PERCENT = 100;

/**
 * Mirrors `MIN_PAYABLE_TOTAL_MINOR` — Razorpay's ₹1 floor.
 *
 * A code that would take the order under it is refused by the server with
 * `coupon_leaves_nothing_to_charge`, so the card says so BEFORE the press
 * rather than offering a button that can only come back refused.
 */
export const MIN_PAYABLE_TOTAL_MINOR = 100;

/**
 * Mirrors `MIN_CODE_LENGTH` / `MAX_CODE_LENGTH` in `apps/coupons/services.py`.
 *
 * Not a security boundary and never to be mistaken for one — the server
 * validates every code it is sent. This is here so the field can refuse to
 * submit something that cannot succeed.
 */
export const MIN_CODE_LENGTH = 3;
export const MAX_CODE_LENGTH = 32;

export type OfferOutcome =
  /** It takes `amount` off this order. */
  | { kind: 'saves'; amount: number }
  /** Nothing to take anything off — a free order, or a code worth zero. */
  | { kind: 'nothing' }
  /** It would take the order under the provider's floor. */
  | { kind: 'leaves_nothing' };

/**
 * What pressing this coupon would do, decided the way the server will decide it.
 *
 * The platform fee is deliberately left out of the floor check, as it is on the
 * server (`_check_leaves_something_to_charge`): it only ever ADDS to the total,
 * so leaving it out can refuse a hair early and never lets through an order the
 * provider would decline.
 */
export function offerOutcome(
  offer: Pick<PublicOffer, 'kind' | 'value' | 'max_discount_minor'>,
  { subtotalMinor, donationMinor }: { subtotalMinor: number; donationMinor: number },
): OfferOutcome {
  const amount = discountOn(offer, subtotalMinor);
  if (amount <= 0) return { kind: 'nothing' };
  if (subtotalMinor - amount + donationMinor < MIN_PAYABLE_TOTAL_MINOR) {
    return { kind: 'leaves_nothing' };
  }
  return { kind: 'saves', amount };
}

/**
 * The short label on a coupon's coloured edge — "15% OFF", "₹100 OFF".
 *
 * The TERMS rather than the saving: this is what the organiser advertised, and
 * it stays true however the order changes. The saving, which does move, is the
 * line underneath.
 */
export function offerBadge(offer: Pick<PublicOffer, 'kind' | 'value'>): string {
  if (offer.kind === 'percent') return `${Math.trunc(offer.value)}% OFF`;
  return `${formatMoney(Math.trunc(offer.value))} OFF`;
}
