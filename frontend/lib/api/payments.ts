import { api } from './client';

/**
 * Telling the backend to go and ASK the provider about a payment.
 *
 * ── THIS IS NOT THE BROWSER REPORTING SUCCESS ─────────────────────────────
 *
 * Razorpay's success callback is a UI hint and this file does not treat it as
 * anything more. All it forwards is the payment ID — an opaque lookup key. The
 * server then calls Razorpay directly and uses only what Razorpay says: the
 * status, the order, the amount. Nothing typed or intercepted in this browser
 * can turn an unpaid booking into a paid one.
 *
 * ── WHY IT EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * The webhook is the primary path and stays the primary path. But it needs a
 * publicly reachable HTTPS endpoint, and a laptop does not have one — so on a
 * local or not-yet-DNS'd deployment the callback never arrives and a real
 * payment never produces a ticket. This nudge closes that gap without lowering
 * the bar for what counts as proof.
 *
 * It is safe to call twice: the backend writes the same `payment.captured:{id}`
 * ledger row the webhook does, so whichever arrives first does the work and the
 * other is a no-op. Turning the webhook on later needs no change here.
 */

export type VerifyPaymentOutcome =
  | 'confirmed'
  | 'already_confirmed'
  | 'duplicate'
  | 'not_captured'
  | 'amount_mismatch'
  | 'hold_expired_refunding'
  | 'ignored';

export function verifyPayment(razorpayPaymentId: string): Promise<{ status: VerifyPaymentOutcome }> {
  return api.post<{ status: VerifyPaymentOutcome }>('/payments/verify', {
    razorpay_payment_id: razorpayPaymentId,
  });
}

/**
 * Complete a payment on a deployment that has NO payment provider.
 *
 * ── WHAT THIS IS ──────────────────────────────────────────────────────────
 *
 * A demo. It exists so the money path can be walked end to end — reserve, pay,
 * confirm, ticket issued with a scannable QR — on a laptop with no Razorpay
 * account and no public HTTPS endpoint for a webhook to arrive at. Before it,
 * every booking made against the fake provider expired unpaid, because nothing
 * anywhere could tell that provider money had arrived.
 *
 * ── WHAT IT IS NOT ────────────────────────────────────────────────────────
 *
 * It is not this browser declaring a payment. The body carries one field — the
 * id of a booking the caller already owns — and the server does the rest: it
 * reads the amount off the booking row, tells the FAKE provider that much was
 * captured, then runs the identical `verify_and_confirm` path a real Razorpay
 * payment runs, ledger dedupe and amount check included. Nothing typed in this
 * browser can change what gets confirmed or for how much.
 *
 * It refuses outright (`409 simulated_payment_unavailable`) whenever a real
 * provider is configured, and the backend's production preflight refuses to
 * boot on a fake provider at all — so this can never be a route to a free
 * ticket on a deployment where money is real.
 */
export function simulatePayment(bookingId: string): Promise<{ status: VerifyPaymentOutcome }> {
  return api.post<{ status: VerifyPaymentOutcome }>('/payments/simulate', {
    booking_id: bookingId,
  });
}
