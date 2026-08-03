import { describe, expect, it } from 'vitest';
import { availabilityBadge, isSoldOut } from './availability';

describe('availabilityBadge', () => {
  it('shows nothing when ticketing has not written the denormals yet', () => {
    expect(availabilityBadge({ tickets_available: null, from_price: null })).toBeNull();
  });

  it('does NOT treat a null count as sold out', () => {
    expect(isSoldOut({ tickets_available: null })).toBe(false);
    expect(isSoldOut({ tickets_available: 0 })).toBe(true);
  });

  it('escalates scarcity in order', () => {
    expect(availabilityBadge({ tickets_available: 0, from_price: 100 })?.label).toBe('Sold out');
    expect(availabilityBadge({ tickets_available: 4, from_price: 100 })?.label).toBe('Few left');
    expect(availabilityBadge({ tickets_available: 40, from_price: 100 })?.label).toBe(
      'Selling fast',
    );
    expect(availabilityBadge({ tickets_available: 400, from_price: 100 })).toBeNull();
  });

  it('lets scarcity outrank "Free" — the more urgent fact wins', () => {
    expect(availabilityBadge({ tickets_available: 0, from_price: 0 })?.label).toBe('Sold out');
    expect(availabilityBadge({ tickets_available: 500, from_price: 0 })?.label).toBe('Free');
  });

  it('gives a screen reader the number, not just "Few left"', () => {
    expect(availabilityBadge({ tickets_available: 3, from_price: 100 })?.srLabel).toBe(
      'Only 3 tickets left',
    );
  });
});
