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

/**
 * Set (or clear, with `0`) the donation on a live hold.
 *
 * Its own call rather than a field on `createBooking`, because the reservation
 * happens when the review screen opens — the countdown has to be counting
 * something — and the donation is chosen while reading that screen.
 *
 * The backend moves the amount under the booking's row lock WITHOUT touching
 * the reservation, and re-issues the payment order for the new total. It never
 * releases and re-reserves: a tier could be gone by the time a second reserve
 * ran, so choosing to give ₹15 would be able to cost somebody their seats.
 *
 * No `Idempotency-Key`: this is idempotent by construction. It sets an absolute
 * amount rather than applying a delta, and setting the same amount twice is a
 * no-op that does not even re-issue the order.
 */
export const setBookingDonation = (bookingId: string, donationMinor: number) =>
  api.post<Booking>(`/bookings/${encodeURIComponent(bookingId)}/donation`, {
    donation_minor: donationMinor,
  });

/**
 * Release a hold the customer no longer wants.
 *
 * ── IT IS ALSO THE FIX FOR "IT SAYS SOLD OUT AND I HAD THEM" ──────────────
 *
 * `cancel_booking` checks `status == RESERVED` and DELIBERATELY does not check
 * the deadline (backend/apps/booking/services.py:511). That matters, because an
 * expired booking keeps occupying `TicketType.reserved` until the sweeper runs
 * — `booking.release_expired` is scheduled every 60 seconds, so there is up to
 * a minute where the seats are held by a booking that has already been declared
 * dead on screen.
 *
 * Pressing "Get these tickets again" inside that minute reserved against
 * inventory that still counted the customer's OWN lapsed hold, so on a tight
 * tier it was refused `sold_out` for tickets nobody else had taken. Cancelling
 * first frees them immediately and the retry reserves against the truth.
 *
 * No `Idempotency-Key`: cancelling twice is a `booking_not_cancellable` 409,
 * which is a safe no-op for a caller that has already got what it wanted.
 */
export const cancelBooking = (bookingId: string) =>
  api.post<Booking>(`/bookings/${encodeURIComponent(bookingId)}/cancel`, {});
