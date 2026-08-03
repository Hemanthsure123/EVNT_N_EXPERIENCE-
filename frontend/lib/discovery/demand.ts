import type { EventCard } from '@/lib/api/types';

/**
 * "Selling fast" — derived ONLY from data the backend actually maintains.
 *
 * `tickets_available` is the sum of remaining tickets across an event's tiers,
 * written by the `ticketing` module from the authoritative counters. That is the
 * one real demand signal available, so it is the only one used.
 *
 * What is deliberately NOT shown, and why:
 * - **Booked percentage.** The card payload has remaining tickets but not the
 *   original capacity, so a percentage cannot be computed — only guessed.
 * - **"X people are interested."** Nothing on the platform records interest.
 * - **Ratings.** There is no review system.
 * Manufacturing any of those would be fabricated scarcity on a page whose whole
 * job is to be trusted with someone's money.
 *
 * Note this is a DISPLAY signal read from a cached list. The authoritative
 * check happens under a per-tier row lock at reserve time (see the backend's
 * "cache-for-display, decide-under-lock" rule), so a card saying "12 left" is a
 * nudge, never a promise.
 */

/** At or below this many remaining tickets, an event is genuinely scarce. */
export const SELLING_FAST_THRESHOLD = 50;

export type DemandSignal = {
  /** Remaining tickets — a real count, not a percentage. */
  seatsLeft: number;
  /** True when the event is close enough that time is itself the pressure. */
  startsSoon: boolean;
};

const SOON_MS = 72 * 60 * 60 * 1000;

export function demandSignal(event: EventCard, now = Date.now()): DemandSignal | null {
  const seatsLeft = event.tickets_available;
  // `null` means ticketing hasn't written the denormal yet — that is "unknown",
  // which is not the same as "scarce". Zero means sold out, not selling.
  if (seatsLeft === null || seatsLeft <= 0 || seatsLeft > SELLING_FAST_THRESHOLD) return null;
  return {
    seatsLeft,
    startsSoon: Date.parse(event.starts_at) - now <= SOON_MS,
  };
}

/** The genuinely high-demand subset, scarcest first. */
export function sellingFast(events: EventCard[], limit = 6, now = Date.now()): EventCard[] {
  return events
    .filter((event) => demandSignal(event, now) !== null)
    .sort((a, b) => (a.tickets_available ?? 0) - (b.tickets_available ?? 0))
    .slice(0, limit);
}
