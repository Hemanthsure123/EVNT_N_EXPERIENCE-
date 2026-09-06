import { describe, expect, it } from 'vitest';
import type { TicketTier } from '@/lib/api/types';
import { SELECTION_PARAM, SESSION_PARAM, parseSelection, totalsFor } from './selection';

/**
 * The basket arithmetic, and the guard that stops one booking spanning two
 * evenings.
 *
 * `totalsFor` had NO test coverage at all before this file, which is how the
 * cross-session hole survived: it is not a bug in any one line, it is a fact
 * about two lines being allowed to coexist.
 */

function tier(overrides: Partial<TicketTier> & { id: string }): TicketTier {
  return {
    event_id: 'evt',
    slot_id: null,
    name: 'GA',
    description: '',
    perks: [],
    position: 0,
    price: 50_000,
    effective_price: 50_000,
    current_phase: null,
    next_price: null,
    phases: [],
    quantity: 100,
    sold: 0,
    available: 100,
    sale_start: null,
    sale_end: null,
    max_per_order: 10,
    is_on_sale: true,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('the two URL params are separate, and stay separate', () => {
  it('does not share a name', () => {
    // The session is NOT a field on `Selection`, and this is the cheapest
    // possible reminder of why: `selectionSignature` feeds `idempotencyKeyFor`
    // on the money path and is compared against a signature built from SERVER
    // items, which can never carry a slot. Folding them together makes every
    // live reservation compare as stale, which the review screen answers by
    // cancelling and re-reserving.
    expect(SELECTION_PARAM).not.toBe(SESSION_PARAM);
  });
});

describe('totalsFor', () => {
  it('sums the lines it can resolve and prices them at the effective price', () => {
    const tiers = [tier({ id: 'ga', effective_price: 40_000 })];
    const totals = totalsFor(parseSelection('ga:2'), tiers);

    expect(totals.ticketCount).toBe(2);
    expect(totals.total).toBe(80_000);
    expect(totals.lines).toHaveLength(1);
  });

  it('drops a tier that no longer exists rather than throwing', () => {
    // A tier can vanish between screens (an organiser retires it mid-checkout).
    // The basket thinning is the honest outcome; a crash is not.
    const totals = totalsFor(parseSelection('gone:2'), [tier({ id: 'ga' })]);

    expect(totals.lines).toHaveLength(0);
    expect(totals.ticketCount).toBe(0);
  });

  it('flags a quantity above what is left', () => {
    const totals = totalsFor(parseSelection('ga:5'), [tier({ id: 'ga', available: 3 })]);

    expect(totals.overAvailable).toBe(true);
  });

  describe('crossSession', () => {
    it('is false for an ordinary single-show event', () => {
      const tiers = [tier({ id: 'ga' }), tier({ id: 'vip' })];

      expect(totalsFor(parseSelection('ga:1,vip:1'), tiers).crossSession).toBe(false);
    });

    it('is false when every line belongs to the SAME session', () => {
      const tiers = [
        tier({ id: 'ga-6', slot_id: 'six' }),
        tier({ id: 'vip-6', slot_id: 'six' }),
      ];

      expect(totalsFor(parseSelection('ga-6:1,vip-6:1'), tiers).crossSession).toBe(false);
    });

    it('is TRUE when two lines belong to two different sessions', () => {
      // The reachable failure: switch showtime with a stale `tickets=` param in
      // the URL and this is the basket you get. `POST /bookings` receives tier
      // ids and nothing about slots, so the server cannot refuse it — one
      // booking would admit somebody to two evenings.
      const tiers = [
        tier({ id: 'ga-6', slot_id: 'six' }),
        tier({ id: 'ga-9', slot_id: 'nine' }),
      ];

      expect(totalsFor(parseSelection('ga-6:1,ga-9:1'), tiers).crossSession).toBe(true);
    });

    it('does not count an event-wide tier as a second session', () => {
      // `slot_id === null` admits to EVERY show, so it never conflicts. A
      // festival pass beside one night's ticket is a legitimate basket.
      const tiers = [
        tier({ id: 'pass', slot_id: null }),
        tier({ id: 'ga-6', slot_id: 'six' }),
      ];

      expect(totalsFor(parseSelection('pass:1,ga-6:1'), tiers).crossSession).toBe(false);
    });

    it('is false for a basket of only event-wide tiers', () => {
      const tiers = [tier({ id: 'pass' }), tier({ id: 'vip' })];

      expect(totalsFor(parseSelection('pass:1,vip:1'), tiers).crossSession).toBe(false);
    });
  });
});
