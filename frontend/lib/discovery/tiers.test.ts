import { describe, expect, it } from 'vitest';
import type { TicketTier } from '@/lib/api/types';
import { eligibleBands, groupBandAt, nextGroupBand, unitPriceAt, unitPriceFor } from './tiers';

/**
 * The group-pricing resolver — a DISPLAY mirror of a money rule.
 *
 * The authority is `decide_unit_price` in `apps/ticketing/pricing.py`, decided
 * under the per-tier row lock. These cases mirror
 * `apps/ticketing/tests/test_group_pricing.py` deliberately and case for case:
 * the two implementations can silently disagree, and the only thing keeping
 * them honest is that both are tested against the same table of examples.
 *
 * A disagreement here is not cosmetic. It shows a buyer one per-ticket price
 * on the screen where they decide, and charges another on the screen after it.
 */

const FACE = 50_000; // ₹500

function tier(overrides: Partial<TicketTier> = {}): TicketTier {
  return {
    id: 'ga',
    event_id: 'evt',
    slot_id: null,
    name: 'General',
    description: '',
    perks: [],
    position: 0,
    price: FACE,
    effective_price: FACE,
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

describe('unitPriceAt', () => {
  it('is the phase price when there are no bands', () => {
    expect(unitPriceAt(tier(), 4)).toBe(FACE);
    expect(unitPriceAt(tier({ effective_price: 30_000 }), 4)).toBe(30_000);
  });

  it('reads a missing group_bands as no bands', () => {
    // A backend that predates the column sends nothing, and `undefined.filter`
    // on the money path is a crashed checkout.
    const legacy = tier();
    delete (legacy as { group_bands?: unknown }).group_bands;
    expect(unitPriceAt(legacy, 4)).toBe(FACE);
  });

  it('applies a band once the order reaches it, inclusively', () => {
    const withBand = tier({ group_bands: [{ min_quantity: 4, price_minor: 40_000 }] });
    expect(unitPriceAt(withBand, 3)).toBe(FACE);
    expect(unitPriceAt(withBand, 4)).toBe(40_000);
  });

  it('takes the LARGEST band the order reaches', () => {
    const withBands = tier({
      group_bands: [
        { min_quantity: 2, price_minor: 45_000 },
        { min_quantity: 4, price_minor: 40_000 },
      ],
    });
    expect(unitPriceAt(withBands, 6)).toBe(40_000);
  });

  it('reads bands in size order however they arrived', () => {
    // The column is JSON; nothing guarantees the array is sorted.
    const withBands = tier({
      group_bands: [
        { min_quantity: 6, price_minor: 35_000 },
        { min_quantity: 2, price_minor: 45_000 },
      ],
    });
    expect(unitPriceAt(withBands, 6)).toBe(35_000);
  });

  describe('the never-overcharge floor', () => {
    it('ignores a band priced above the face price', () => {
      // Only a raw write produces this, and quoting it would show somebody
      // MORE than the face price on the screen where they decide to buy.
      const bad = tier({ group_bands: [{ min_quantity: 2, price_minor: 60_000 }] });
      expect(unitPriceAt(bad, 4)).toBe(FACE);
    });

    it('ignores a band at one ticket', () => {
      const bad = tier({ group_bands: [{ min_quantity: 1, price_minor: 40_000 }] });
      expect(unitPriceAt(bad, 1)).toBe(FACE);
    });

    it('does not let an overpriced band hide a valid larger one', () => {
      const mixed = tier({
        group_bands: [
          { min_quantity: 2, price_minor: 99_000 },
          { min_quantity: 4, price_minor: 40_000 },
        ],
      });
      expect(unitPriceAt(mixed, 4)).toBe(40_000);
    });
  });

  describe('composing with a sale phase', () => {
    it('keeps the cheaper PHASE price for a group order', () => {
      const both = tier({
        effective_price: 30_000,
        group_bands: [{ min_quantity: 2, price_minor: 45_000 }],
      });
      expect(unitPriceAt(both, 4)).toBe(30_000);
    });

    it('uses the cheaper BAND price', () => {
      const both = tier({
        effective_price: 45_000,
        group_bands: [{ min_quantity: 4, price_minor: 35_000 }],
      });
      expect(unitPriceAt(both, 4)).toBe(35_000);
    });

    it('never charges more than either alone would', () => {
      // The property `Math.min` exists for: nobody loses a discount by
      // qualifying for a second one.
      const both = tier({
        effective_price: 40_000,
        group_bands: [{ min_quantity: 2, price_minor: 42_000 }],
      });
      expect(unitPriceAt(both, 2)).toBe(40_000);
      expect(unitPriceAt(both, 2)).toBeLessThanOrEqual(unitPriceFor(both));
    });
  });
});

describe('groupBandAt', () => {
  it('is null below every band', () => {
    const withBand = tier({ group_bands: [{ min_quantity: 4, price_minor: 40_000 }] });
    expect(groupBandAt(withBand, 3)).toBeNull();
  });

  it('names the winning band so the picker can show it', () => {
    const withBand = tier({ group_bands: [{ min_quantity: 4, price_minor: 40_000 }] });
    expect(groupBandAt(withBand, 5)?.min_quantity).toBe(4);
  });
});

describe('nextGroupBand', () => {
  it('names the next cheaper band a buyer has not reached', () => {
    // The whole reason bands are shown: "add 2 more for ₹400 each" is a
    // reason to buy another ticket. A discount only revealed once you qualify
    // is one most people never find.
    const withBands = tier({
      group_bands: [
        { min_quantity: 2, price_minor: 45_000 },
        { min_quantity: 4, price_minor: 40_000 },
      ],
    });
    expect(nextGroupBand(withBands, 1)?.min_quantity).toBe(2);
    expect(nextGroupBand(withBands, 2)?.min_quantity).toBe(4);
  });

  it('is null once the best band is reached', () => {
    const withBands = tier({
      group_bands: [
        { min_quantity: 2, price_minor: 45_000 },
        { min_quantity: 4, price_minor: 40_000 },
      ],
    });
    expect(nextGroupBand(withBands, 4)).toBeNull();
  });

  it('does not advertise a band that would not save anything', () => {
    // A later band at the same price is not an upsell, and naming it would be
    // a promise of a discount that does not exist.
    const flat = tier({
      group_bands: [
        { min_quantity: 2, price_minor: 40_000 },
        { min_quantity: 6, price_minor: 40_000 },
      ],
    });
    expect(nextGroupBand(flat, 2)).toBeNull();
  });

  it('does not advertise a band beaten by an active phase', () => {
    // With early bird at ₹300 already, a ₹400 band for 4+ is not a saving —
    // and telling somebody to buy two more tickets for a worse price is the
    // one thing this hint must never do.
    const both = tier({
      effective_price: 30_000,
      group_bands: [{ min_quantity: 4, price_minor: 40_000 }],
    });
    expect(nextGroupBand(both, 1)).toBeNull();
  });
});

describe('eligibleBands', () => {
  it('drops the unusable and sorts the rest', () => {
    const messy = tier({
      group_bands: [
        { min_quantity: 6, price_minor: 35_000 },
        { min_quantity: 1, price_minor: 49_000 },
        { min_quantity: 2, price_minor: 99_000 },
        { min_quantity: 4, price_minor: 40_000 },
      ],
    });
    expect(eligibleBands(messy).map((band) => band.min_quantity)).toEqual([4, 6]);
  });

  it('does not mutate the tier it was given', () => {
    // It sorts, and sorting in place would reorder the payload every other
    // consumer is reading.
    const withBands = tier({
      group_bands: [
        { min_quantity: 6, price_minor: 35_000 },
        { min_quantity: 2, price_minor: 45_000 },
      ],
    });
    eligibleBands(withBands);
    expect(withBands.group_bands?.map((band) => band.min_quantity)).toEqual([6, 2]);
  });
});
