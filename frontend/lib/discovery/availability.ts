/**
 * The card's status badge, derived from the two denormalized columns the
 * `ticketing` module keeps current on the event row (`tickets_available`,
 * `from_price_minor`). Both are nullable: null means "ticketing hasn't written
 * it yet", which is NOT zero — so null never produces a badge.
 *
 * These are DISPLAY signals read from a cached list payload. They are never the
 * basis of a decision: the authoritative availability check happens under a
 * per-tier row lock in the backend at reserve time (CLAUDE.md, "cache-for-
 * display, decide-under-lock"). A card saying "Few left" is a nudge, not a
 * promise, and the booking flow re-checks.
 */

import type { EventCard } from '@/lib/api/types';
import type { BadgeProps } from '@/components/ui/badge';

/** Below this, a tier is "nearly gone". */
const FEW_LEFT_THRESHOLD = 10;
/** Below this, it's moving fast. */
const SELLING_FAST_THRESHOLD = 50;

export type AvailabilityBadge = {
  label: string;
  variant: NonNullable<BadgeProps['variant']>;
  /** Screen-reader phrasing, since the visual label is deliberately terse. */
  srLabel: string;
};

export function availabilityBadge(
  event: Pick<EventCard, 'tickets_available' | 'from_price'>,
): AvailabilityBadge | null {
  const { tickets_available: available, from_price: fromPrice } = event;

  if (available === 0) {
    return { label: 'Sold out', variant: 'destructive', srLabel: 'Sold out' };
  }
  if (available !== null && available <= FEW_LEFT_THRESHOLD) {
    return { label: 'Few left', variant: 'warning', srLabel: `Only ${available} tickets left` };
  }
  if (available !== null && available <= SELLING_FAST_THRESHOLD) {
    return { label: 'Selling fast', variant: 'accent', srLabel: 'Selling fast' };
  }
  if (fromPrice === 0) {
    return { label: 'Free', variant: 'success', srLabel: 'Free entry' };
  }
  return null;
}

export const isSoldOut = (event: Pick<EventCard, 'tickets_available'>) =>
  event.tickets_available === 0;
