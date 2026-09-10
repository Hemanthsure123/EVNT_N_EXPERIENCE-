import { describe, expect, it } from 'vitest';
import type { PublicOffer } from '@/lib/api/types';
import { discountOn, MIN_PAYABLE_TOTAL_MINOR, offerBadge, offerOutcome } from './coupons';

/**
 * The display half of a money rule, mirrored case for case from
 * `backend/apps/coupons/tests/test_discounts.py`. If one of these fails, the
 * Python is the authority — "Save ₹X on this order!" is a promise, and a card
 * that promises a different number from the one the total then moves by is
 * the specific failure a quote beside a charge exists to prevent.
 */

const FACE = 50_000; // ₹500

const percent = (value: number, cap: number | null = null) =>
  ({ kind: 'percent', value, max_discount_minor: cap }) as const;
const fixed = (value: number) => ({ kind: 'fixed', value, max_discount_minor: null }) as const;

describe('discountOn — percentages', () => {
  it('takes the stated share', () => {
    expect(discountOn(percent(20), FACE)).toBe(10_000);
  });

  it('a hundred percent is the whole order', () => {
    expect(discountOn(percent(100), FACE)).toBe(FACE);
  });

  it('rounds a fraction of a paise DOWN', () => {
    // 15% of 333 is 49.95. Up would spend a paise the organiser never offered.
    expect(discountOn(percent(15), 333)).toBe(49);
  });

  it('cannot exceed the order above a hundred percent', () => {
    expect(discountOn(percent(150), FACE)).toBe(FACE);
    expect(discountOn(percent(101), FACE)).toBe(FACE);
  });

  it('is bounded by a cap', () => {
    expect(discountOn(percent(20, 5_000), FACE)).toBe(5_000);
  });

  it('is unchanged by a cap above the discount', () => {
    expect(discountOn(percent(20, 100_000), FACE)).toBe(10_000);
  });
});

describe('discountOn — fixed amounts', () => {
  it('takes the stated amount', () => {
    expect(discountOn(fixed(10_000), FACE)).toBe(10_000);
  });

  it('NEVER exceeds the subtotal', () => {
    expect(discountOn(fixed(FACE), 30_000)).toBe(30_000);
    expect(discountOn(fixed(999_999), 1)).toBe(1);
  });
});

describe('discountOn — degenerate inputs', () => {
  it.each([0, -1, -50_000])('is worth nothing on a subtotal of %i', (subtotal) => {
    expect(discountOn(percent(50), subtotal)).toBe(0);
    expect(discountOn(fixed(1_000), subtotal)).toBe(0);
  });

  it('reads a negative value as nothing rather than as an ADDITION', () => {
    expect(discountOn(fixed(-5_000), FACE)).toBe(0);
    expect(discountOn(percent(-20), FACE)).toBe(0);
  });

  it('reads a negative cap as disabling the discount', () => {
    expect(discountOn(percent(20, -100), FACE)).toBe(0);
  });
});

describe('offerOutcome', () => {
  const order = { subtotalMinor: FACE, donationMinor: 0 };

  it('names what it saves on this order', () => {
    expect(offerOutcome(percent(15), order)).toEqual({ kind: 'saves', amount: 7_500 });
  });

  it('says a free order has nothing to take off', () => {
    expect(offerOutcome(percent(15), { subtotalMinor: 0, donationMinor: 0 })).toEqual({
      kind: 'nothing',
    });
  });

  it('refuses, before the press, a code that would leave less than ₹1 to pay', () => {
    // The server's `coupon_leaves_nothing_to_charge`. A 100% code on a ticket
    // order with no donation leaves zero — a Pay button that can only fail.
    expect(offerOutcome(percent(100), order)).toEqual({ kind: 'leaves_nothing' });
    expect(
      offerOutcome(fixed(FACE - MIN_PAYABLE_TOTAL_MINOR + 1), order),
    ).toEqual({ kind: 'leaves_nothing' });
  });

  it('counts a donation toward what is left, as the server does', () => {
    expect(offerOutcome(percent(100), { subtotalMinor: FACE, donationMinor: 1_500 })).toEqual({
      kind: 'saves',
      amount: FACE,
    });
  });

  it('allows exactly the floor', () => {
    expect(offerOutcome(fixed(FACE - MIN_PAYABLE_TOTAL_MINOR), order)).toEqual({
      kind: 'saves',
      amount: FACE - MIN_PAYABLE_TOTAL_MINOR,
    });
  });
});

describe('offerBadge', () => {
  const base: Pick<PublicOffer, 'kind' | 'value'> = { kind: 'percent', value: 15 };

  it('states a percentage', () => {
    expect(offerBadge(base)).toBe('15% OFF');
  });

  it('states a fixed amount in rupees, not paise', () => {
    expect(offerBadge({ kind: 'fixed', value: 10_000 })).toBe('₹100 OFF');
  });
});
