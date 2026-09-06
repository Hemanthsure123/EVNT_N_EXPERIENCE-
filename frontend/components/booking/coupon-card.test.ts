import { describe, expect, it } from 'vitest';
import type { PublicOffer } from '@/lib/api/types';
import { offerTerms } from './coupon-card';

/**
 * What an advertised code PROMISES, in one line.
 *
 * The ceiling is the part worth testing. "20% off" that silently becomes ₹50 on
 * a large order is exactly the surprise `max_discount_minor` exists to let an
 * organizer set — and a customer who reads only the first half reads the total
 * as an error and abandons the checkout.
 */

function offer(overrides: Partial<PublicOffer> = {}): PublicOffer {
  return {
    id: 'c1',
    code: 'SAVE20',
    kind: 'percent',
    value: 20,
    max_discount_minor: null,
    expires_at: null,
    ...overrides,
  };
}

describe('offerTerms', () => {
  it('states an uncapped percentage', () => {
    expect(offerTerms(offer())).toBe('20% off');
  });

  it('states the CEILING in the same breath as the percentage', () => {
    expect(offerTerms(offer({ max_discount_minor: 5_000 }))).toBe('20% off, up to ₹50');
  });

  it('states a fixed amount in rupees, not paise', () => {
    expect(offerTerms(offer({ kind: 'fixed', value: 10_000 }))).toBe('₹100 off');
  });

  it('ignores a ceiling on a fixed amount', () => {
    // The server refuses to store one, so this only guards against a payload
    // that predates that rule — a fixed coupon reading "₹100 off, up to ₹50"
    // would be a contradiction on the screen where somebody decides.
    expect(offerTerms(offer({ kind: 'fixed', value: 10_000, max_discount_minor: 5_000 }))).toBe(
      '₹100 off',
    );
  });
});
