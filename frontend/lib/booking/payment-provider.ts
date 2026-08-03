'use client';

/**
 * Which payment provider actually created this order.
 *
 * ── WHY THE BACKEND HAS TO SAY, AND WHY AN EMPTY KEY WAS THE WRONG SIGNAL ──
 *
 * The pay step used to decide whether a real checkout was possible by asking
 * whether `payment.key_id` was a non-empty string. Those are different
 * questions. `RAZORPAY_KEY_ID` and `PAYMENTS_BACKEND` are independent settings,
 * so a key left in `.env` from a previous deploy, alongside a switch to the
 * fake provider, produced a live-looking "Pay ₹1,200" button that opened
 * Razorpay Checkout with a `fake_order_…` id — which Razorpay rejects with "not
 * a valid id" after the customer has already committed to paying.
 *
 * `POST /bookings` now returns `payment.provider`, and this module keeps it for
 * the rest of the session for exactly the reason `rememberKeyId` exists:
 * `GET /bookings/{id}` does not return it, so a reload on the payment step —
 * the single most likely place for someone to press refresh — would otherwise
 * leave the page unable to say what it is talking to.
 *
 * `sessionStorage`, not `localStorage`: it must not outlive the tab, and it must
 * never become a stale answer that survives a redeploy onto a different backend.
 */

/** The `PAYMENTS_BACKEND` values the API can report. */
export type PaymentProvider = 'razorpay' | 'fake';

const REMEMBERED = 'ee-payment-provider';

const isProvider = (value: unknown): value is PaymentProvider =>
  value === 'razorpay' || value === 'fake';

export function rememberProvider(provider: string): void {
  if (!isProvider(provider) || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(REMEMBERED, provider);
  } catch {
    /* storage blocked — `resolveProvider` falls back below */
  }
}

/**
 * The provider to assume, most-specific first: the one that came back with THIS
 * order, then the one remembered from it this session, then `razorpay`.
 *
 * The final fallback is deliberately the REAL provider. Being wrong that way
 * shows a checkout that may fail to open; being wrong the other way shows a
 * "simulate payment" control on a deployment where money is real, which is not
 * a mistake worth risking to save a render.
 */
export function resolveProvider(fromServer: string): PaymentProvider {
  if (isProvider(fromServer)) return fromServer;
  if (typeof window !== 'undefined') {
    try {
      const remembered = window.sessionStorage.getItem(REMEMBERED);
      if (isProvider(remembered)) return remembered;
    } catch {
      /* fall through */
    }
  }
  return 'razorpay';
}
