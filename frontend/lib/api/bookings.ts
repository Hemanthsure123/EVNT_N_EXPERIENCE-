import { api } from './client';
import type { Booking, CreateBookingResponse } from './types';

/**
 * Creating a booking is the moment inventory is actually RESERVED — the backend
 * takes a per-tier row lock, decrements availability, and starts a hold timer.
 * It is not a draft, and it is not free to repeat.
 *
 * Which is why every call carries an `Idempotency-Key`. A double-tapped button,
 * a retried request on a flaky connection, or a browser replaying a POST would
 * otherwise reserve twice and hold two sets of tickets against one person. The
 * backend dedupes on `(user, key)` and returns the ORIGINAL booking, so a retry
 * is free and a duplicate is impossible.
 *
 * The key is derived from the selection rather than random: the same tickets for
 * the same event is the same intent, so pressing Continue twice — even after a
 * reload — resolves to one booking.
 */

export function createBooking(
  eventId: string,
  items: { ticket_type_id: string; quantity: number }[],
  idempotencyKey: string,
): Promise<CreateBookingResponse> {
  return api.post<CreateBookingResponse>(
    '/bookings',
    { event_id: eventId, items },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export const fetchBooking = (bookingId: string) =>
  api.get<Booking>(`/bookings/${encodeURIComponent(bookingId)}`);
