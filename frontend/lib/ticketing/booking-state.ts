import type { MyBooking } from '@/lib/api/types';
import type { RefundRequest } from '@/lib/api/refund-requests';

/**
 * WHICH OF FOUR THINGS A BOOKING IS, TO THE PERSON WHO MADE IT.
 *
 * ── WHY THIS IS A PURE MODULE ─────────────────────────────────────────────
 *
 * The rules below are the ones a reader would not guess from the component,
 * and every one of them fails SILENTLY rather than visibly — a booking filed
 * under the wrong chip is simply missing from the list somebody is looking at,
 * with nothing on screen saying so. Same reasoning as
 * `lib/discovery/calendar.ts` and `settings-sections.ts`.
 *
 * ── THE STATE IS NOT `booking.status` ─────────────────────────────────────
 *
 * `Booking.status` is `reserved | paid | cancelled | expired` and it does NOT
 * answer the question this screen asks. Two of its answers are load-bearing
 * here and neither is a status:
 *
 *   · A REFUNDED booking is still `paid`. There is no `refunded` member of the
 *     enum — what a refund changes is the TICKETS (`active` → `void`) and,
 *     separately, a `RefundRequest` row. A screen reading status alone files a
 *     refunded booking under "upcoming" and offers to show its dead codes.
 *
 *   · A booking whose PAYMENT FAILED is still `reserved` with its hold
 *     counting down, because the gateway never tells our backend that a
 *     customer's card was declined. "The payment failed" and "you have not
 *     paid yet" are the same row, and the honest label for both is the second
 *     one: the seats are held and the payment is unfinished.
 */

export type BookingState =
  /** Paid, live codes, and the event has not finished. The reason to open this screen. */
  | 'upcoming'
  /** Paid and over — attended, or the date has passed. Nothing left to do. */
  | 'finished'
  /** Money was genuinely returned, or every ticket on it was voided. */
  | 'refunded'
  /** Reserved and unpaid, or a hold that lapsed. The only state with an action. */
  | 'unpaid';

/** When the event is actually over. `ends_at` is nullable, so `starts_at` is
 *  the floor — an event with no stated end is treated as finishing when it
 *  starts, which is the conservative direction: it moves OUT of "upcoming"
 *  rather than lingering there for ever. */
export function eventEndsAt(booking: Pick<MyBooking, 'event_starts_at' | 'event_ends_at'>): number {
  return Date.parse(booking.event_ends_at ?? booking.event_starts_at);
}

/**
 * Whether the refund on this booking has SETTLED — money moved, not a decision
 * to move it.
 *
 * `status === 'approved'` is deliberately not enough. Approval enqueues the
 * vendor call; `refund_reference` exists only once the provider accepted it.
 * The gap between the two is real and sometimes days long, and a list that
 * files an approved-but-unpaid refund under "Refunded" is telling somebody
 * their money is back when it is not.
 */
export function refundSettled(request: RefundRequest | undefined): boolean {
  return Boolean(request && request.refund_reference);
}

export function bookingState(
  booking: MyBooking,
  request: RefundRequest | undefined,
  now: number,
): BookingState {
  if (booking.status !== 'paid') return 'unpaid';

  // Settled refund wins over everything: the tickets are void and the money is
  // back, whatever the dates say.
  if (refundSettled(request)) return 'refunded';

  // Every ticket voided with none used is a refund that reached the tickets —
  // reachable through the organiser's own refund path, which writes no
  // `RefundRequest` at all, so status alone would miss it entirely.
  if (booking.ticket_count > 0 && booking.active_ticket_count === 0 && booking.used_ticket_count === 0) {
    return 'refunded';
  }

  if (booking.active_ticket_count > 0 && eventEndsAt(booking) > now) return 'upcoming';
  return 'finished';
}

/** A hold that is still live — the only case that offers "finish paying". */
export function holdIsLive(booking: MyBooking, now: number): boolean {
  return (
    booking.status === 'reserved' &&
    Boolean(booking.hold_expires_at) &&
    Date.parse(booking.hold_expires_at as string) > now
  );
}

/**
 * The reference a person reads out to support.
 *
 * The FIRST EIGHT characters of the booking's uuid, upper-cased. Deliberately
 * not a new identifier: there is no short booking-code column, so a "booking
 * code" beside a "booking id" would be the same value printed twice. This is
 * the prefix the platform already quotes back at people, and the full uuid is
 * what a copy control puts on the clipboard.
 */
export function bookingRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/**
 * THE THREE VIEWS OF THE TICKETS SCREEN.
 *
 * There used to be five chips — All, Upcoming, Unpaid, Past, Cancelled — and a
 * separate "Rate your recent experiences" card above them. Three views replace
 * all of it, and each one is a question somebody opens this screen to answer:
 * what am I going to, what did I not finish paying for, and what have I not
 * rated yet.
 *
 * `rate` is not a booking state. Its rows are the server's pending-review list
 * (`GET /me/pending-reviews`), which already knows which attended events have
 * no review — so it is fetched, not derived here.
 */
export type TicketsTab = 'upcoming' | 'unpaid' | 'rate';

export const TICKETS_TABS: readonly { value: TicketsTab; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'rate', label: 'Yet to Rate' },
] as const;

export type DecoratedBooking = {
  booking: MyBooking;
  request: RefundRequest | undefined;
  state: BookingState;
};

/**
 * The bookings a tab shows, in the order it shows them.
 *
 * ── A REFUNDED BOOKING STILL LISTS UNDER UPCOMING ─────────────────────────
 *
 * Refund status is shown on the ticket's own page and nowhere on this list, by
 * the owner's rule. Dropping refunded rows instead would make a refund
 * unreachable: the list is the only way to the page that explains it. So a
 * paid booking for an event still to come is listed whether or not its money
 * came back, and the row stays silent about which.
 *
 * `finished` rows (paid and over) are in NO booking tab. The ones still worth
 * acting on — attended and not yet rated — are what the `rate` tab lists.
 *
 * Upcoming is soonest first, because the next thing you are going to is the
 * thing you need at a door. Unpaid is live holds first — the only rows with a
 * deadline — and then the newest attempt.
 */
export function rowsForTab(
  items: DecoratedBooking[],
  tab: Exclude<TicketsTab, 'rate'>,
  now: number,
): DecoratedBooking[] {
  if (tab === 'upcoming') {
    return items
      .filter(
        (item) =>
          item.state === 'upcoming' ||
          (item.state === 'refunded' && eventEndsAt(item.booking) > now),
      )
      .sort(
        (a, b) => Date.parse(a.booking.event_starts_at) - Date.parse(b.booking.event_starts_at),
      );
  }
  return items
    .filter((item) => item.state === 'unpaid')
    .sort((a, b) => {
      const aLive = holdIsLive(a.booking, now);
      const bLive = holdIsLive(b.booking, now);
      if (aLive !== bLive) return aLive ? -1 : 1;
      return Date.parse(b.booking.created_at) - Date.parse(a.booking.created_at);
    });
}
