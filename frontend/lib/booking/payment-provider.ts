'use client';

/**
 * Which payment provider actually created this order — and which ones the
 * customer may switch to.
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
 * `POST /bookings` returns `payment.provider`, and this module keeps it for
 * the rest of the session for exactly the reason `rememberKeyId` exists:
 * `GET /bookings/{id}` did not return it, so a reload on the payment step —
 * the single most likely place for someone to press refresh — would otherwise
 * leave the page unable to say what it is talking to.
 *
 * `sessionStorage`, not `localStorage`: it must not outlive the tab, and it
 * must never become a stale answer that survives a redeploy onto a different
 * backend.
 *
 * ── THE SECOND GATEWAY DID NOT CHANGE ANY OF THAT ─────────────────────────
 *
 * It made it matter more. With two live gateways the provider is a fact about
 * the BOOKING, not about the deployment, so `payment.provider` is now read off
 * the booking row on the server and every booking read carries it. What this
 * module must never do is INFER the provider from which credential happens to
 * be present — that is the original bug with a second way to reach it.
 *
 * The SELECTED gateway and the ORDER'S gateway are deliberately separate
 * ideas. A press on the selector changes the selection immediately (the UI has
 * to respond), and the order only moves once the server says it did. Storing
 * one value for both is how a checkout ends up showing "Cashfree" over a
 * Razorpay order id.
 */

/** The gateway values the API can report. */
export type PaymentProvider = 'razorpay' | 'cashfree' | 'fake';

const REMEMBERED = 'ee-payment-provider';

const KNOWN: readonly PaymentProvider[] = ['razorpay', 'cashfree', 'fake'];

const isProvider = (value: unknown): value is PaymentProvider =>
  typeof value === 'string' && (KNOWN as readonly string[]).includes(value);

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
 * The final fallback is deliberately a REAL provider. Being wrong that way
 * shows a checkout that may fail to open; being wrong the other way shows a
 * "simulate payment" control on a deployment where money is real, which is not
 * a mistake worth risking to save a render.
 *
 * It stays `razorpay` rather than becoming the new default gateway, because
 * this answers "what is this order" and not "what should we pre-select". The
 * pre-selection is the SERVER'S (`PAYMENTS_DEFAULT_GATEWAY`), since the server
 * is what creates the order — a client-side default would be a guess that the
 * order could contradict.
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

/**
 * The gateways this deployment offers, from `payment.available_providers`.
 *
 * Unknown names are DROPPED rather than rendered: a gateway the frontend has
 * no SDK for would draw a row that cannot open a checkout, which is the same
 * class of lie as a nav item pointing at a 404 — on the one screen where it
 * costs money. `fake` is dropped too, because the demo path has its own
 * clearly-labelled control and a "simulate" option beside a live gateway is a
 * pay-nothing button.
 *
 * Returns `[]` when there is nothing real to choose between, and the selector
 * renders as plain text in that case — a chevron promising a choice that does
 * not exist is exactly what `PayUsing` was originally written to avoid.
 */
export function selectableProviders(available: readonly string[] | undefined): PaymentProvider[] {
  const seen = new Set<string>();
  const out: PaymentProvider[] = [];
  for (const name of available ?? []) {
    if (!isProvider(name) || name === 'fake' || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  // One option is not a choice. Returning it anyway would draw a dropdown
  // whose menu has a single row already ticked.
  return out.length > 1 ? out : [];
}

/** What each gateway is called on screen. Never derived from the id. */
export const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  cashfree: 'Cashfree',
  razorpay: 'Razorpay',
  fake: 'Demo mode',
};

/**
 * The one sentence each gateway gets under its name in the menu.
 *
 * Deliberately about what the CUSTOMER gets, not about the company. "UPI,
 * cards, wallets & netbanking" is true of both and is the only thing somebody
 * choosing between them can actually act on — the instrument is picked inside
 * the provider's own modal either way, so there is nothing else honest to say.
 */
export const PROVIDER_BLURBS: Record<PaymentProvider, string> = {
  cashfree: 'UPI, cards, wallets & netbanking',
  razorpay: 'UPI, cards, wallets & netbanking',
  fake: 'No money moves on this deployment',
};
