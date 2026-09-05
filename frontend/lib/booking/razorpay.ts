'use client';

/**
 * Razorpay Checkout, loaded only when someone actually decides to pay.
 *
 * THE SDK IS NOT ON THE PAGE UNTIL THE BUTTON IS PRESSED. It is a third-party
 * script on the highest-intent route in the product; loading it eagerly would
 * put a blocking external request on every visitor who reaches the funnel,
 * including everyone who abandons before payment. Injected on demand, it costs
 * nothing until it is needed, and the promise is cached so a second press
 * doesn't fetch it twice.
 *
 * THE KEY PREFERS THE SERVER'S. `POST /bookings` returns `payment.key_id`
 * alongside the order id, and the two have to be from the same Razorpay account
 * or Checkout rejects the order. Reading the key only from a frontend env var
 * invites exactly that mismatch — a valid key paired with an order created under
 * a different account, failing only in production. So: this order's key, then
 * the one remembered from it this session, then the deployment's env value.
 * (`GET /bookings/{id}` doesn't return the key, which is why the session memory
 * exists at all — without it, refreshing the payment page left no way to pay.)
 *
 * There is no secret here: `key_id` is the PUBLIC half. The secret signs the
 * webhook, which is the only thing the backend trusts as proof of payment — the
 * browser's success callback is a UI hint, never evidence.
 */

const SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

export type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  handler: (response: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let loader: Promise<boolean> | null = null;

/** Injects the Checkout script once. Resolves false if it can't be loaded. */
export function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (loader) return loader;

  loader = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      // A blocked or offline third-party script must not look like a failed
      // payment — the caller shows "couldn't reach the payment provider".
      loader = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return loader;
}

const REMEMBERED_KEY = 'ee-rzp-key';

/**
 * Keep the server's key for the rest of the session.
 *
 * `POST /bookings` returns it once; `GET /bookings/{id}` does not. Without this,
 * refreshing the payment page — the single most likely place for someone to hit
 * reload — left the page with no key and no way to pay. It is the PUBLIC half of
 * the pair, so storing it is not a secret leak; the secret signs webhooks and
 * never leaves the backend.
 *
 * `sessionStorage`, not `localStorage`: it should not outlive the tab, and it
 * should never become a stale key that survives a redeploy onto a new account.
 */
export function rememberKeyId(key: string): void {
  if (!key || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(REMEMBERED_KEY, key);
  } catch {
    /* storage blocked — the env fallback below still applies */
  }
}

/**
 * The public key to use, most-specific first: the one that came back with THIS
 * order, then the one remembered from it this session, then the deployment's
 * own env value. The order matters — the key and the order id have to belong to
 * the same Razorpay account or Checkout rejects the order outright.
 */
export function resolveKeyId(fromServer: string): string {
  if (fromServer) return fromServer;
  if (typeof window !== 'undefined') {
    try {
      const remembered = window.sessionStorage.getItem(REMEMBERED_KEY);
      if (remembered) return remembered;
    } catch {
      /* fall through to the env value */
    }
  }
  return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '';
}

/**
 * What the gateway actually said when it refused.
 *
 * ── ALL OF THIS WAS ALREADY ARRIVING, AND ALL BUT ONE FIELD WAS DISCARDED ──
 *
 * `checkout.on('payment.failed')` hands over Razorpay's full `error` object.
 * This module read `description` and threw the rest away, so a customer whose
 * payment failed was told one sentence and could be told nothing more — no
 * reason to quote to their bank, no payment reference for support, and no way
 * for the UI to tell "your bank declined it" apart from "you closed the app".
 *
 * Nothing here is inferred or invented: every field is Razorpay's own, passed
 * through verbatim, and every one is optional because the SDK does not promise
 * them. A failure screen renders only what actually arrived.
 *
 *   `code`     the class of failure — BAD_REQUEST_ERROR, GATEWAY_ERROR …
 *   `reason`   the machine reason — payment_timed_out, insufficient_funds …
 *   `source`   whose side it happened on — customer | bank | gateway | business
 *   `step`     where in the flow — payment_authentication, payment_authorization
 *   `paymentId` / `orderId`  the references support asks for
 */
export type CheckoutFailure = {
  /** Razorpay's human sentence, or ours when the SDK gave none. */
  message: string;
  code?: string;
  reason?: string;
  source?: string;
  step?: string;
  paymentId?: string;
  orderId?: string;
};

export type CheckoutArgs = {
  keyId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  eventTitle: string;
  customer: { name?: string; email?: string };
  onSuccess: (response: RazorpaySuccess) => void;
  onDismiss: () => void;
  /**
   * The second argument is the whole diagnostic. It is OPTIONAL to every
   * caller that only wants the sentence, so adding it broke nothing — but the
   * failure screen exists because of it.
   */
  onFailure: (message: string, failure?: CheckoutFailure) => void;
};

export async function openCheckout(args: CheckoutArgs): Promise<void> {
  const ready = await loadRazorpay();
  if (!ready || !window.Razorpay) {
    args.onFailure('We could not reach the payment provider. Check your connection and try again.');
    return;
  }

  const checkout = new window.Razorpay({
    key: args.keyId,
    amount: args.amountMinor,
    currency: args.currency,
    name: 'Curatix',
    description: args.eventTitle,
    order_id: args.orderId,
    prefill: { name: args.customer.name, email: args.customer.email },
    handler: args.onSuccess,
    modal: { ondismiss: args.onDismiss },
  });

  checkout.on('payment.failed', (payload) => {
    // Read defensively at every level. This is a third-party SDK's event
    // payload on the money path: a shape change must degrade to the generic
    // sentence, never throw inside a handler the customer cannot see.
    const error = (
      payload as
        | {
            error?: {
              code?: string;
              description?: string;
              reason?: string;
              source?: string;
              step?: string;
              metadata?: { payment_id?: string; order_id?: string };
            };
          }
        | undefined
    )?.error;
    const message =
      error?.description ?? 'The payment did not go through. No money has been taken.';
    args.onFailure(message, {
      message,
      code: error?.code,
      reason: error?.reason,
      source: error?.source,
      step: error?.step,
      paymentId: error?.metadata?.payment_id,
      orderId: error?.metadata?.order_id ?? args.orderId,
    });
  });

  checkout.open();
}
