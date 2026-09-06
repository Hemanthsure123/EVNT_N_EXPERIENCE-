import { describe, expect, it } from 'vitest';
import type { Coupon } from '@/lib/api/coupons';
import { couponStatus, describeTerms, describeUsage, validateDraft } from './coupons';

/**
 * How a code reads on the organizer's screen.
 *
 * Every case here is a boundary — a coupon that ends today, one whose last use
 * was just taken, one switched off while still inside its window — and none of
 * them is visible by looking at a table that renders. The status especially:
 * a "Live" pill on a code that has expired sends an organizer to hand somebody
 * a code that will be refused.
 */

const NOW = new Date('2026-06-01T12:00:00Z');

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c1',
    event_id: null,
    code: 'SUMMER20',
    kind: 'percent',
    value: 20,
    max_discount_minor: null,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    max_per_user: 1,
    visible_at_checkout: false,
    is_active: true,
    redeemed_count: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

describe('couponStatus', () => {
  it('is live with no bounds at all', () => {
    expect(couponStatus(coupon(), NOW)).toEqual({ label: 'Live', tone: 'success' });
  });

  it('SWITCHED OFF wins over everything', () => {
    // The only state the organizer chose, and the only one they can undo from
    // this screen — so it is what the row should say.
    const off = coupon({
      is_active: false,
      ends_at: '2020-01-01T00:00:00Z',
      max_redemptions: 1,
      redeemed_count: 5,
    });
    expect(couponStatus(off, NOW).label).toBe('Switched off');
  });

  it('expired beats fully claimed', () => {
    // A code past its date cannot be revived by raising a limit, so that is
    // the more useful thing to say.
    const dead = coupon({
      ends_at: '2026-05-01T00:00:00Z',
      max_redemptions: 1,
      redeemed_count: 1,
    });
    expect(couponStatus(dead, NOW).label).toBe('Expired');
  });

  it('reads the end as EXCLUSIVE, on the instant', () => {
    // "Until midnight" stops AT midnight, matching `window_is_open` on the
    // server — the two disagreeing by one instant is a code the dashboard
    // calls live and the checkout refuses.
    const atTheMoment = coupon({ ends_at: NOW.toISOString() });
    expect(couponStatus(atTheMoment, NOW).label).toBe('Expired');
  });

  it('is fully claimed once every use is taken', () => {
    expect(couponStatus(coupon({ max_redemptions: 50, redeemed_count: 50 }), NOW)).toEqual({
      label: 'Fully claimed',
      tone: 'warning',
    });
  });

  it('is still live one redemption short', () => {
    expect(couponStatus(coupon({ max_redemptions: 50, redeemed_count: 49 }), NOW).label).toBe(
      'Live',
    );
  });

  it('is scheduled before its window opens', () => {
    expect(couponStatus(coupon({ starts_at: '2026-07-01T00:00:00Z' }), NOW).label).toBe(
      'Scheduled',
    );
  });

  it('reads the start as INCLUSIVE, on the instant', () => {
    expect(couponStatus(coupon({ starts_at: NOW.toISOString() }), NOW).label).toBe('Live');
  });

  it('says fully claimed rather than scheduled for a full future code', () => {
    // It is genuinely gone; "starting soon" would be a promise nobody can keep.
    const full = coupon({
      starts_at: '2026-07-01T00:00:00Z',
      max_redemptions: 1,
      redeemed_count: 1,
    });
    expect(couponStatus(full, NOW).label).toBe('Fully claimed');
  });
});

describe('describeTerms', () => {
  it('states a percentage', () => {
    expect(describeTerms(coupon())).toBe('20% off');
  });

  it('names the CEILING in the same breath', () => {
    expect(describeTerms(coupon({ max_discount_minor: 5_000 }))).toBe('20% off, max ₹50');
  });

  it('states a fixed amount in rupees', () => {
    expect(describeTerms(coupon({ kind: 'fixed', value: 10_000 }))).toBe('₹100 off');
  });
});

describe('describeUsage', () => {
  it('has no denominator when there is no limit', () => {
    // "12 of ∞" is a fraction describing nothing.
    expect(describeUsage(coupon({ redeemed_count: 12 }))).toBe('12 used');
  });

  it('is a fraction when there is one', () => {
    expect(describeUsage(coupon({ redeemed_count: 12, max_redemptions: 50 }))).toBe('12 / 50');
  });
});

describe('validateDraft', () => {
  const draft = (overrides: Partial<Parameters<typeof validateDraft>[0]> = {}) =>
    validateDraft({
      code: 'SUMMER20',
      kind: 'percent',
      value: '20',
      cap: '',
      endsAt: '',
      maxRedemptions: '',
      maxPerUser: '1',
      visible: false,
      eventId: '',
      ...overrides,
    });

  it('accepts an ordinary code', () => {
    expect(draft()).toEqual([]);
  });

  it('refuses punctuation somebody would mistype', () => {
    expect(draft({ code: 'SUMMER 20' })).toHaveLength(1);
    expect(draft({ code: 'SUMMER!' })).toHaveLength(1);
  });

  it('refuses a code that is too short or too long', () => {
    expect(draft({ code: 'AB' })).toHaveLength(1);
    expect(draft({ code: 'A'.repeat(33) })).toHaveLength(1);
  });

  it('says nothing about an EMPTY code', () => {
    // The field is `required`, so the browser refuses it first. Two messages
    // for one empty box is noise.
    expect(draft({ code: '' })).toEqual([]);
  });

  it('refuses a percentage above 100', () => {
    expect(draft({ value: '150' })).toHaveLength(1);
  });

  it('allows a fixed amount above 100', () => {
    // ₹150 off is perfectly ordinary — the ceiling belongs to the PERCENTAGE.
    expect(draft({ kind: 'fixed', value: '150' })).toEqual([]);
  });

  it('refuses a fractional percentage', () => {
    // The column is an integer, so 12.5% would be silently rounded — a coupon
    // that does not do what its form said.
    expect(draft({ value: '12.5' })).toHaveLength(1);
  });

  it('allows a fractional fixed AMOUNT', () => {
    expect(draft({ kind: 'fixed', value: '99.50' })).toEqual([]);
  });

  it('refuses a discount of nothing', () => {
    expect(draft({ value: '0' })).toHaveLength(1);
  });

  it('refuses a cap of nothing', () => {
    expect(draft({ cap: '0' })).toHaveLength(1);
  });

  it('ignores a cap on a FIXED amount', () => {
    // The server refuses that against the merged row and says why; restating
    // the rule here would be two statements of one rule.
    expect(draft({ kind: 'fixed', value: '100', cap: '50' })).toEqual([]);
  });

  it('refuses zero or fractional use limits', () => {
    expect(draft({ maxRedemptions: '0' })).toHaveLength(1);
    expect(draft({ maxRedemptions: '1.5' })).toHaveLength(1);
    expect(draft({ maxPerUser: '0' })).toHaveLength(1);
  });

  it('reads an empty total as unlimited rather than as zero', () => {
    expect(draft({ maxRedemptions: '' })).toEqual([]);
  });
});
