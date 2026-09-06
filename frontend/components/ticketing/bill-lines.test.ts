import { describe, expect, it } from 'vitest';
import type { BookingItem } from '@/lib/api/types';
import { bookingBill } from './bill-lines';

/**
 * The bill's arithmetic.
 *
 * One rule, and every case here is a way of getting it wrong:
 *
 *     total_amount = subtotal − discount + platform_fee + donation
 *
 * `bookingBill` is rendered on the review screen, the confirmation, the
 * failed-payment card and the refund breakdown, so a mistake here is the same
 * mistake on four surfaces — and on the two where somebody is checking a
 * charge by hand.
 */

const TICKET: BookingItem = {
  ticket_type_id: 't1',
  ticket_type_name: 'Gold',
  quantity: 2,
  unit_price: 50_000,
  phase_name: null,
};

function booking(overrides: Partial<Parameters<typeof bookingBill>[0]> = {}) {
  return bookingBill({
    total_amount: 101_000,
    platform_fee: 1_000,
    donation: 0,
    discount: 0,
    coupon_code: null,
    items: [TICKET],
    ...overrides,
  });
}

const amountOf = (bill: ReturnType<typeof bookingBill>, label: string) =>
  bill.lines.find((line) => line.label.startsWith(label))?.amount ?? null;

describe('bookingBill', () => {
  it('sums the ticket lines for the subtotal', () => {
    expect(booking().subtotal).toBe(100_000);
  });

  it('draws no discount row when there is none', () => {
    // Absent, not zero. A "Discount −₹0.00" row is a claim that something went
    // wrong with a discount nobody had.
    expect(amountOf(booking(), 'Discount')).toBeNull();
  });

  it('draws the discount as a CREDIT, named with the code', () => {
    const bill = booking({
      discount: 20_000,
      coupon_code: 'SAVE20',
      total_amount: 80_800,
      platform_fee: 800,
    });
    const line = bill.lines.find((row) => row.label.startsWith('Discount'));

    expect(line?.label).toBe('Discount (SAVE20)');
    expect(line?.amount).toBe(20_000);
    expect(line?.credit).toBe(true);
  });

  it('falls back to a generic label when the payload carries no code', () => {
    // `POST /bookings` used to answer with no `coupon_code` at all. A row
    // reading "Discount (undefined)" is worse than one reading "Discount".
    const bill = booking({ discount: 20_000, coupon_code: null });
    expect(bill.lines.find((row) => row.label.startsWith('Discount'))?.label).toBe('Discount');
  });

  describe('the column adds up', () => {
    const check = (bill: ReturnType<typeof bookingBill>) => {
      const signed = bill.lines
        .filter((line) => line.amount !== null)
        .reduce((sum, line) => sum + (line.credit ? -1 : 1) * (line.amount as number), 0);
      expect(signed).toBe(bill.total);
    };

    it('with nothing but tickets', () => {
      check(booking());
    });

    it('with a discount', () => {
      check(booking({ discount: 20_000, total_amount: 80_800, platform_fee: 800 }));
    });

    it('with a discount and a donation', () => {
      check(
        booking({
          discount: 20_000,
          donation: 1_500,
          total_amount: 82_300,
          platform_fee: 800,
        }),
      );
    });
  });

  describe('without line items', () => {
    /**
     * The fallback path, and the one that was actually wrong.
     *
     * `total - fee - donation` is the subtotal AFTER the discount, so a
     * payload with no `items` understated the ticket line by exactly the
     * discount — and the column then failed to add up to the total printed
     * beneath it.
     */
    it('recovers the TICKET subtotal by adding the discount back', () => {
      const bill = bookingBill({
        total_amount: 80_800,
        platform_fee: 800,
        donation: 0,
        discount: 20_000,
        coupon_code: 'SAVE20',
      });

      expect(bill.subtotal).toBe(100_000);
    });

    it('still adds up', () => {
      const bill = bookingBill({
        total_amount: 82_300,
        platform_fee: 800,
        donation: 1_500,
        discount: 20_000,
        coupon_code: 'SAVE20',
      });
      const signed = bill.lines
        .filter((line) => line.amount !== null)
        .reduce((sum, line) => sum + (line.credit ? -1 : 1) * (line.amount as number), 0);

      expect(signed).toBe(82_300);
    });

    it('reads a payload with no discount field at all as no discount', () => {
      // A cached response from before coupons shipped, or a fixture that has
      // not caught up. `undefined` arithmetic would make every number NaN on
      // the screen somebody is paying on.
      const bill = bookingBill({ total_amount: 101_000, platform_fee: 1_000, donation: 0 });
      expect(bill.subtotal).toBe(100_000);
      expect(amountOf(bill, 'Discount')).toBeNull();
    });
  });
});
