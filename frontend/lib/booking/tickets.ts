import { api } from '@/lib/api/client';
import type { Paginated } from '@/lib/api/types';

/**
 * The tickets a booking issued, for the confirmation screen.
 *
 * ── WHY IT READS /me/tickets AND FILTERS ──────────────────────────────────
 *
 * `GET /bookings/{id}` does not carry tickets, and adding them would put a
 * prefetch on a response the confirmation screen POLLS every two seconds —
 * paying for a join on every poll to use it on the last one. `GET /me/tickets`
 * already exists, is already ordered newest-first, and now returns `booking_id`
 * (one local column, no join, no extra query), so the tickets just issued are
 * at the top of the first page and are identified exactly.
 *
 * Filtering by BOOKING rather than by event matters: a repeat buyer for the
 * same event holds tickets from earlier bookings, and a confirmation screen
 * that showed those would be showing someone codes they have already used.
 *
 * The list is a page, not a total. Someone who bought ten tickets to one event
 * gets ten rows at the top of a page that holds far more, so nothing here needs
 * to paginate — but nothing here should claim completeness either, which is why
 * the screen links to the account page as the canonical home.
 */

export type IssuedTicket = {
  id: string;
  booking_id: string;
  event_id: string;
  event_title: string;
  ticket_type_id: string;
  ticket_type_name: string;
  status: 'active' | 'used' | 'void';
  /** The signed token. It IS the ticket — `checkin` verifies this string. */
  qr_token: string;
  created_at: string;
};

export async function fetchTicketsForBooking(bookingId: string): Promise<IssuedTicket[]> {
  const page = await api.get<Paginated<IssuedTicket>>('/me/tickets');
  return page.data.filter((ticket) => ticket.booking_id === bookingId);
}
