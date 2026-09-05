'use client';

import * as React from 'react';
import { formatMoney } from '@/lib/discovery/format';
import type { Booking, BookingItem, MyBooking } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';

/**
 * THE BILL, IN ONE PLACE.
 *
 * ── WHY THIS IS A SHARED COMPONENT AND NOT THREE LAYOUTS ──────────────────
 *
 * The same arithmetic is rendered on the review screen, the confirmation's
 * bill summary, the failed-payment order card and the refund breakdown. Four
 * copies is four chances to get the one rule wrong that actually matters:
 *
 *     total_amount ALREADY CONTAINS platform_fee AND donation.
 *
 * The ticket subtotal is `total_amount - platform_fee - donation`, and adding
 * either back on overstates a charge on a screen somebody is about to pay or
 * has just paid. `bookingBill()` below is the single implementation, so a
 * fifth surface cannot re-derive it differently.
 *
 * ── LINES THAT DO NOT EXIST ARE ABSENT, NOT ZERO ──────────────────────────
 *
 * There is no discount, no coupon, no tax and no second fee anywhere in this
 * platform — one `platform_fee` at `PLATFORM_FEE_BPS` and an optional
 * donation, and that is the entire list. A "Discount −₹0.00" row would be a
 * claim that a discount mechanism exists. A zero donation is simply not drawn.
 */

export type BillLine = {
  label: string;
  /** Minor units. `null` renders nothing at all — see the note above. */
  amount: number | null;
  /** A returned/deducted amount. Rendered with a leading minus and in green. */
  credit?: boolean;
  /** Secondary line under the label — a tier's phase name, a quantity. */
  hint?: string;
};

/**
 * A booking's real lines, derived once.
 *
 * `items` is preferred over `total - fee - donation` for the subtotal because
 * the rows above it are drawn from the same array — a subtotal computed a
 * second way can disagree with the lines it is meant to sum, and on a receipt
 * that is the one number a reader will check by hand. It falls back to the
 * arithmetic when `items` is absent (`POST /bookings` returns the SUMMARY
 * serializer, which carries no lines).
 */
export function bookingBill(
  booking: Pick<Booking | MyBooking, 'total_amount' | 'platform_fee' | 'donation'> & {
    items?: BookingItem[];
  },
): { lines: BillLine[]; subtotal: number; total: number } {
  const items = booking.items ?? [];
  const subtotal = items.length
    ? items.reduce((sum, line) => sum + line.unit_price * line.quantity, 0)
    : booking.total_amount - booking.platform_fee - booking.donation;

  const lines: BillLine[] = [
    {
      label: items.length === 1 ? ticketLabel(items[0]) : 'Tickets',
      amount: subtotal,
      hint: items.length > 1 ? items.map(ticketLabel).join(' · ') : items[0]?.phase_name ?? undefined,
    },
    // ONE fee, named for what it is. Splitting it into a "convenience fee" and
    // something else would be inventing a second charge; see the platform-fee
    // note in CLAUDE.md — it is 1% of the ticket subtotal, added on top, and it
    // is its own line precisely so it is never a hidden fee.
    { label: 'Platform fee', amount: booking.platform_fee || null },
    // Absent unless the buyer actually gave. It is money to the platform's own
    // account, not to the organiser, and it is NOT returned by an ordinary
    // refund — which is why it can never be folded into the ticket line.
    { label: 'Donation', amount: booking.donation || null },
  ];

  return { lines, subtotal, total: booking.total_amount };
}

function ticketLabel(item: BookingItem): string {
  const tier = item.phase_name ? `${item.ticket_type_name} — ${item.phase_name}` : item.ticket_type_name;
  return `${item.quantity} × ${tier}`;
}

/**
 * The line list plus its total rule.
 *
 * `onDark` because this appears inside the confirmation's dark bill sheet as
 * well as on white cards, and the dark values come from the theme-independent
 * `ink` ramp — a semantic token would flip and disappear there.
 */
export function BillLines({
  lines,
  total,
  totalLabel = 'Total paid',
  onDark = false,
  className,
}: {
  lines: BillLine[];
  /** Minor units. Omit for a breakdown with no bottom rule. */
  total?: number | null;
  totalLabel?: string;
  onDark?: boolean;
  className?: string;
}) {
  const visible = lines.filter((line) => line.amount !== null);

  return (
    <dl className={cn('flex flex-col gap-2.5', className)}>
      {visible.map((line) => (
        <div key={line.label} className="flex items-start justify-between gap-4">
          <dt className="min-w-0">
            <span className={cn('block text-body-sm', onDark ? 'text-ink-300' : 'text-muted-foreground')}>
              {line.label}
            </span>
            {line.hint ? (
              <span className={cn('mt-0.5 block text-caption', onDark ? 'text-ink-400' : 'text-foreground-subtle')}>
                {line.hint}
              </span>
            ) : null}
          </dt>
          <dd
            className={cn(
              'shrink-0 text-body-sm font-medium tabular-nums',
              line.credit
                ? 'text-success-subtle-foreground'
                : onDark
                  ? 'text-ink-50'
                  : 'text-foreground',
            )}
          >
            {line.credit ? '−' : ''}
            {formatMoney(Math.abs(line.amount as number))}
          </dd>
        </div>
      ))}

      {total !== null && total !== undefined ? (
        <div
          className={cn(
            'mt-1 flex items-baseline justify-between gap-4 border-t pt-3',
            onDark ? 'border-ink-800' : 'border-border',
          )}
        >
          <dt className={cn('text-body font-bold', onDark ? 'text-ink-25' : 'text-foreground')}>
            {totalLabel}
          </dt>
          {/* The total is the one number in violet. It is what a reader is
              actually looking for, and on a page of near-black text the brand
              accent is the cheapest way to say "this line". */}
          <dd className="shrink-0 text-body font-bold tabular-nums text-primary">
            {formatMoney(total)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
