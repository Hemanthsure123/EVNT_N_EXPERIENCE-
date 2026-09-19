'use client';

/**
 * Cashfree Checkout (JS SDK v3), loaded only when somebody actually decides to
 * pay.
 *
 * THE SDK IS NOT ON THE PAGE UNTIL THE BUTTON IS PRESSED — the same rule
 * `razorpay.ts` follows, and for the same reason: this is a third-party script
 * on the highest-intent route in the product, and loading it eagerly would put
 * a blocking external request on every visitor who reaches the funnel,
 * including everyone who abandons before paying. With two gateways the cost of
 * getting that wrong doubles, since only one of them can ever be used per
 * booking. Injected on demand, cached per gateway, fetched at most once.
 *
 * ── THE SESSION ID IS THE ORDER'S PUBLIC HANDLE, NOT A KEY ────────────────
 *
 * Razorpay Checkout opens on `(key_id, order_id)`. Cashfree opens on a single
 * `payment_session_id`, minted with the order and returned only by the create
 * call — which is why `create_order` returns a `CreatedOrder` rather than a
 * bare id, and why the booking row stores it. There is NO public key here and
 * nothing to configure in the browser: the session is the whole credential,
 * it belongs to exactly one order, and it expires.
 *
 * ── THE MODE COMES FROM THE SERVER, WITH THE ORDER ────────────────────────
 *
 * `Cashfree({ mode })` must match the environment that minted the session, or
 * the SDK opens against the wrong API and the session is rejected. So it
 * travels with the order, in `payment.environment`, rather than being read
 * primarily from a `NEXT_PUBLIC_` var that is free to drift from
 * `CASHFREE_ENVIRONMENT` on the backend — the exact class of mismatch
 * `resolveKeyId` exists to prevent on the Razorpay side.
 *
 * `resolveCashfreeMode` keeps an env var as the LAST resort, in the same role
 * it plays there: what is left after a reload has lost the server's answer and
 * storage is unavailable. It is a fallback, not a competing source.
 *
 * ── AND THE RESULT IS STILL NOT PROOF ─────────────────────────────────────
 *
 * Nothing this SDK resolves with is treated as payment. The caller forwards
 * the ORDER id to `POST /payments/verify`, which makes the SERVER ask Cashfree
 * what it thinks; the confirmation screen then polls the booking until the
 * backend itself says `paid`. Identical to the Razorpay path, because the
 * trust model is about who is asserting the fact, not about which vendor it is.
 */

const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

export type CashfreeMode = 'sandbox' | 'production';

type CashfreeCheckoutResult = {
  error?: { message?: string; code?: string; type?: string };
  redirect?: boolean;
  paymentDetails?: { paymentMessage?: string };
};

type CashfreeInstance = {
  checkout: (options: {
    paymentSessionId: string;
    redirectTarget?: '_modal' | '_self' | '_blank' | '_top';
  }) => Promise<CashfreeCheckoutResult>;
};

declare global {
  interface Window {
    Cashfree?:
      | ((options: { mode: CashfreeMode }) => CashfreeInstance)
      | (new (options: { mode: CashfreeMode }) => CashfreeInstance);
  }
}

const REMEMBERED_MODE = 'ee-cashfree-mode';

const isMode = (value: unknown): value is CashfreeMode =>
  value === 'sandbox' || value === 'production';

/**
 * Keep the server's environment for the rest of the session.
 *
 * `POST /bookings` returns it once. Without this, a reload on the review
 * screen — the single most likely place for someone to press refresh — would
 * leave the page unable to say which Cashfree API minted the session it is
 * holding, and `Cashfree({ mode })` would open against the wrong one and be
 * refused. Exactly the gap `rememberKeyId` fills on the Razorpay side.
 *
 * `sessionStorage`, not `localStorage`: it must not outlive the tab, and it
 * must never become a stale answer that survives a redeploy from sandbox to
 * production.
 */
export function rememberCashfreeMode(mode: string): void {
  if (!isMode(mode) || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(REMEMBERED_MODE, mode);
  } catch {
    /* storage blocked — `resolveCashfreeMode` falls back below */
  }
}

/**
 * The mode to open with, most-specific first: the one that came back with THIS
 * order, then the one remembered from it this session, then the deployment's
 * own env value, then `sandbox`.
 *
 * The same ordering `resolveKeyId` uses, and the env var is the same
 * last-resort role it plays there — not a second source of truth competing
 * with the server, but the only thing left when the server's answer has been
 * lost to a reload and storage is unavailable.
 *
 * The final fallback is `sandbox` because the two failure modes are not
 * symmetrical: a sandbox SDK against a production session is refused before
 * any money moves, and the customer retries. Defaulting the other way would
 * point a production checkout at a session that does not exist there, which
 * looks identical and is the one that can only be discovered in production.
 */
export function resolveCashfreeMode(fromServer: string): CashfreeMode {
  if (isMode(fromServer)) return fromServer;
  if (typeof window !== 'undefined') {
    try {
      const remembered = window.sessionStorage.getItem(REMEMBERED_MODE);
      if (isMode(remembered)) return remembered;
    } catch {
      /* fall through to the env value */
    }
  }
  const fromEnv = process.env.NEXT_PUBLIC_CASHFREE_ENVIRONMENT;
  return isMode(fromEnv) ? fromEnv : 'sandbox';
}

let loader: Promise<boolean> | null = null;

/** Injects the Checkout script once. Resolves false if it can't be loaded. */
export function loadCashfree(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Cashfree) return Promise.resolve(true);
  if (loader) return loader;

  loader = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Cashfree));
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

/**
 * Build the SDK handle.
 *
 * v3 ships `window.Cashfree` as a plain factory, but it has been a constructor
 * in the wild and a `new`-less call on a constructor throws `TypeError` inside
 * the press handler — a crash the customer sees as nothing happening at all.
 * Both shapes are tried, which costs one `try` and removes a whole class of
 * version-drift failure on the money path.
 */
function instantiate(mode: CashfreeMode): CashfreeInstance | null {
  const factory = window.Cashfree;
  if (!factory) return null;
  try {
    return (factory as (options: { mode: CashfreeMode }) => CashfreeInstance)({ mode });
  } catch {
    try {
      const Ctor = factory as new (options: { mode: CashfreeMode }) => CashfreeInstance;
      return new Ctor({ mode });
    } catch {
      return null;
    }
  }
}

export type CashfreeCheckoutArgs = {
  paymentSessionId: string;
  mode: CashfreeMode;
  /**
   * The order this session belongs to. Not used to OPEN the checkout —
   * Cashfree needs only the session — but forwarded to the server afterwards,
   * because the order id is the handle the backend stores and the only thing
   * that ties this press back to a booking.
   */
  orderId: string;
  /**
   * Cashfree's modal resolves with the order it was opened for and does not
   * reliably hand over a payment id, so `onSuccess` receives the ORDER. The
   * server resolves the captured payment from it (`captured_payment_for_order`)
   * — the same question `reconcile_pending` asks, asked on demand.
   */
  onSuccess: (orderId: string) => void;
  onDismiss: () => void;
  onFailure: (message: string, failure?: CashfreeFailure) => void;
};

/**
 * What the gateway actually said when it refused — the same shape
 * `razorpay.ts` reports, so `step-failed.tsx` renders one contract.
 *
 * Every field is Cashfree's own, passed through verbatim, and every one is
 * optional because the SDK does not promise them. `source` and `step` have no
 * Cashfree equivalent and are deliberately LEFT UNSET rather than invented:
 * a failure screen renders only what actually arrived.
 */
export type CashfreeFailure = {
  message: string;
  code?: string;
  reason?: string;
  orderId?: string;
};

export async function openCashfreeCheckout(args: CashfreeCheckoutArgs): Promise<void> {
  const ready = await loadCashfree();
  if (!ready) {
    args.onFailure('We could not reach the payment provider. Check your connection and try again.');
    return;
  }

  const cashfree = instantiate(args.mode);
  if (!cashfree) {
    args.onFailure('We could not start the payment. Please try again in a moment.');
    return;
  }

  let result: CashfreeCheckoutResult;
  try {
    // `_modal` keeps the customer on this origin, which is what lets the
    // funnel resume exactly where it paused. A full redirect would hand
    // control to Cashfree and come back through a return_url, and the review
    // screen's live hold, countdown and order state would all have to be
    // rebuilt from a query string.
    result = await cashfree.checkout({
      paymentSessionId: args.paymentSessionId,
      redirectTarget: '_modal',
    });
  } catch (thrown) {
    args.onFailure(
      thrown instanceof Error && thrown.message
        ? thrown.message
        : 'The payment did not go through. No money has been taken.',
    );
    return;
  }

  if (result?.error) {
    const message =
      result.error.message || 'The payment did not go through. No money has been taken.';
    args.onFailure(message, {
      message,
      code: result.error.code,
      reason: result.error.type,
      orderId: args.orderId,
    });
    return;
  }

  // ── A REDIRECT IS NOT A FAILURE, AND IT IS NOT A SUCCESS EITHER ─────────
  //
  // Some instruments (a bank page, certain UPI apps) take the customer away
  // and Cashfree resolves with `redirect: true` and no outcome. Treating that
  // as a failure would bounce somebody to an error screen mid-payment;
  // treating it as success would claim a ticket for money that may not have
  // moved. Both are wrong, so it goes down the SAME road as a success: ask
  // the server, then poll the booking. The server's answer is the only one
  // that decides, exactly as it is for every other path.
  args.onSuccess(args.orderId);
}
