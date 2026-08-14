import { describe, expect, it } from 'vitest';
import { formatFromPrice, formatMoney } from './format';

/**
 * Money formatting, pinned.
 *
 * The bug this exists for: a settlement of 60980 paise rendered as "₹609.8" on
 * the organizer's own payout tile. `toFixed(2)` returned the string "609.80",
 * `Number()` parsed it straight back to 609.8, and the trailing zero was gone
 * before the locale formatter ever ran. One decimal place on a money figure
 * reads as a typo on the screen where somebody is checking what they are owed.
 */
describe('formatMoney', () => {
  it('shows two decimal places when there are paise', () => {
    expect(formatMoney(60_980)).toBe('₹609.80');
    expect(formatMoney(60_981)).toBe('₹609.81');
    expect(formatMoney(5)).toBe('₹0.05');
  });

  it('keeps whole rupees whole', () => {
    // ₹500.00 on a ticket price is noise; the decision comes from the value.
    expect(formatMoney(50_000)).toBe('₹500');
    expect(formatMoney(0)).toBe('₹0');
  });

  it('groups thousands the Indian way', () => {
    // en-IN is 2,2,3 — ₹1,23,456 rather than ₹123,456.
    expect(formatMoney(12_345_600)).toBe('₹1,23,456');
  });

  it('renders an em dash for an absent amount, never ₹0', () => {
    // "Not reported" and "nothing" are different facts about money.
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });

  it('is negative-safe, for a refund that exceeds its capture', () => {
    expect(formatMoney(-60_980)).toBe('-₹609.80');
  });
});

describe('formatFromPrice', () => {
  it('calls zero Free, which formatMoney deliberately does not', () => {
    expect(formatFromPrice(0)).toBe('Free');
    expect(formatMoney(0)).toBe('₹0');
  });

  it('shares the same paise handling', () => {
    expect(formatFromPrice(60_980)).toBe('₹609.80');
    expect(formatFromPrice(50_000)).toBe('₹500');
  });

  it('returns null when there is no price to show', () => {
    expect(formatFromPrice(null)).toBeNull();
    expect(formatFromPrice(undefined)).toBeNull();
  });
});
