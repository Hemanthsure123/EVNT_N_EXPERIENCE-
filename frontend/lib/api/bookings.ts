import { api } from './client';
import type { Booking, CreateBookingResponse, MyBooking, Paginated } from './types';

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
  /**
   * The organiser's questionnaire, as `{question_id: answer}`.
   *
   * Sent WITH the reserve rather than afterwards, because this is the one
   * place the required-answer rule cannot be routed around: a later "submit
   * your answers" call the browser is trusted to make before paying is a gate
   * with an API-shaped hole in it, and refusing at confirm would mean taking
   * money and then declining to issue a ticket.
   *
   * Omitted entirely when empty — the overwhelming majority of events ask
   * nothing, and an empty object on every booking request is noise on the
   * platform's hottest write.
   */
  answers?: Record<string, string>,
): Promise<CreateBookingResponse> {
  const hasAnswers = answers && Object.keys(answers).length > 0;
  return api.post<CreateBookingResponse>(
    '/bookings',
    { event_id: eventId, items, ...(hasAnswers ? { answers } : {}) },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export const fetchBooking = (bookingId: string) =>
  api.get<Booking>(`/bookings/${encodeURIComponent(bookingId)}`);

/**
 * The account's purchase history — every booking, in every state.
 *
 * Cursor-paginated and deliberately NOT a widening of `/me/tickets`: that
 * endpoint answers "what can admit me at a gate", which is a strictly narrower
 * question than "what have I bought". A refunded, used, cancelled or unpaid
 * booking has no active ticket and belongs on this list.
 */
export const fetchMyBookings = (cursor?: string | null) =>
  api.get<Paginated<MyBooking>>(`/me/bookings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);

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

/**
 * Apply a promotional code to a live hold. `POST` again to REPLACE it.
 *
 * Its own call rather than a field on `createBooking`, for the same reason the
 * donation is: the hold is taken when the review screen opens and the code is
 * typed while reading that screen. Applying it at create would mean either
 * re-reserving for every code somebody tries — where the tier could be gone by
 * the second reserve, so trying a code could cost them their seats — or folding
 * the code into the idempotency key, which mints a new key per attempt on the
 * money path.
 *
 * The backend decides the discount under the COUPON's row lock, inside the
 * transaction that already holds the booking's, and prices it against the
 * booking's own line items — which were priced under the tier locks when the
 * hold was taken. Nothing about the money is sent from here, and nothing sent
 * from here is trusted: only the code.
 *
 * A refusal is a `422` whose `code` names the reason — `coupon_not_found`,
 * `coupon_expired`, `coupon_exhausted`, `coupon_already_used`,
 * `coupon_wrong_event`, `coupon_leaves_nothing_to_charge` — so the field can
 * say what is actually wrong instead of "invalid code". Its `message` is
 * written to be shown verbatim.
 *
 * Replacing is safe: the backend releases the old redemption and takes the new
 * one in ONE transaction, so a refused second code leaves the first in place.
 */
export const applyBookingCoupon = (bookingId: string, code: string) =>
  api.post<Booking>(`/bookings/${encodeURIComponent(bookingId)}/coupon`, { code });

/**
 * Take the code back off, and put the redemption back in the pool.
 *
 * Idempotent — a booking with no code answers `200` unchanged and does not
 * churn the payment order, so this is safe to call without checking first.
 * Answers with the booking rather than `204` because the caller needs the new
 * total, and making it re-read would be a second round trip on a screen where
 * the number just moved.
 */
export const clearBookingCoupon = (bookingId: string) =>
  api.delete<Booking>(`/bookings/${encodeURIComponent(bookingId)}/coupon`);
