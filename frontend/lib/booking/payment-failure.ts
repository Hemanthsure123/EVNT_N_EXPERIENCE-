import type { CheckoutFailure } from './razorpay';

/**
 * WHAT THE GATEWAY SAID, CARRIED FROM THE PRESS TO THE FAILURE SCREEN.
 *
 * ── WHY sessionStorage AND NOT THE URL ────────────────────────────────────
 *
 * The diagnostic is one attempt's worth of detail — a provider error code, a
 * payment id, whose side it happened on. Three reasons it does not travel in a
 * query string:
 *
 *   · A URL gets shared, bookmarked, pasted into a support chat and written to
 *     every access log between here and the origin. A payment reference does
 *     not belong in any of those.
 *   · It would survive a reload and a back-navigation, so a screen reached
 *     later would keep asserting a failure that has since been retried.
 *   · It is long. Five fields of provider prose in a query string is a URL
 *     nobody can read and some proxies will truncate.
 *
 * sessionStorage is scoped to the tab, dies with it, and is keyed by BOOKING —
 * so a diagnostic can never be shown against a different attempt.
 *
 * ── EVERY READ AND WRITE IS GUARDED ───────────────────────────────────────
 *
 * `sessionStorage` throws outright in a private window with site data blocked,
 * during a thumbnail capture, and wherever a browser has been told to refuse
 * storage. This is the money path: a storage refusal must cost a sentence of
 * detail, never the screen.
 */

const KEY = 'ee-payment-failure';

type Stored = CheckoutFailure & { bookingId: string; at: number };

export function rememberFailure(bookingId: string, failure: CheckoutFailure, at: number): void {
  try {
    const payload: Stored = { ...failure, bookingId, at };
    window.sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* Storage refused. The failure screen falls back to its generic copy. */
  }
}

/**
 * The stored diagnostic for THIS booking, or null.
 *
 * The booking id is re-checked on read rather than trusted from the key: one
 * slot is reused across attempts, and showing attempt A's bank code beside
 * attempt B's amount would be worse than showing no code at all.
 */
export function recallFailure(bookingId: string): CheckoutFailure | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.bookingId !== bookingId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function forgetFailure(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* Nothing to do — the key is re-checked against the booking id on read. */
  }
}

/**
 * Razorpay's machine reason → a sentence, and what to do about it.
 *
 * ── THIS IS A LOOKUP, NOT AN INFERENCE ────────────────────────────────────
 *
 * Every key below is a value Razorpay actually sends in `error.reason`. An
 * unrecognised reason falls through to the provider's own `description` — which
 * is a real sentence written by the people who know what happened — and only
 * then to a generic line. At no point does this guess a cause from a code it
 * does not know: "your bank declined it" and "you cancelled" are different
 * facts, and telling somebody the wrong one sends them to argue with the wrong
 * party.
 *
 * The advice is what a person can actually DO. "Contact your bank" for a limit,
 * "try another method" for a decline, "wait and check" for a timeout — because
 * a timeout is the one case where the money may genuinely have left and come
 * back on its own.
 */
const REASONS: Record<string, { title: string; advice: string }> = {
  payment_failed: {
    title: 'Your bank did not authorise the payment.',
    advice: 'Try again with another method, or check with your bank first.',
  },
  payment_timed_out: {
    title: 'The bank took too long to authorise the payment.',
    advice:
      'Try again. If money did leave your account it is reversed automatically, usually within 24–48 hours.',
  },
  payment_cancelled: {
    title: 'The payment was cancelled before it completed.',
    advice: 'Your tickets are still held. Try again when you are ready.',
  },
  payment_pending: {
    title: 'The bank has not confirmed the payment yet.',
    advice: 'Give it a moment before trying again — a second attempt could charge you twice.',
  },
  input_validation_failed: {
    title: 'The payment details were not accepted.',
    advice: 'Check the details and try again, or use a different method.',
  },
  insufficient_funds: {
    title: 'There were not enough funds available.',
    advice: 'Try a different account or method.',
  },
  invalid_vpa: {
    title: 'That UPI ID was not recognised.',
    advice: 'Check the handle and try again, or pay another way.',
  },
  payment_limit_exceeded: {
    title: 'The payment is over a limit on your account.',
    advice: 'Your bank sets these. Try a different method, or raise the limit with them.',
  },
};

export type FailureCopy = {
  title: string;
  advice: string;
  /** The provider's own sentence, kept verbatim where it added something. */
  providerMessage: string | null;
};

export function describeFailure(failure: CheckoutFailure | null): FailureCopy {
  const known = failure?.reason ? REASONS[failure.reason] : undefined;
  if (known) {
    return {
      ...known,
      // Only when it says something the mapped title does not. Repeating the
      // same fact in two registers reads as a system that is not sure.
      providerMessage:
        failure?.message && failure.message !== known.title ? failure.message : null,
    };
  }
  if (failure?.message) {
    return {
      title: failure.message,
      advice: 'Try again with another method, or check with your bank.',
      providerMessage: null,
    };
  }
  return {
    // Deliberately not "your payment failed". Where nothing arrived from the
    // gateway, the only thing this platform actually knows is that no payment
    // was recorded — which is also true of an abandoned attempt.
    title: 'We did not receive a payment for this booking.',
    advice: 'Nothing has been charged. Your tickets are still held — try again.',
    providerMessage: null,
  };
}

/** Whose side it happened on, for the diagnostics block. Razorpay's own
 *  vocabulary, mapped to words rather than left as a raw enum. */
export function failureSource(source: string | undefined): string | null {
  switch (source) {
    case 'bank':
      return 'Your bank';
    case 'gateway':
      return 'The payment gateway';
    case 'customer':
      return 'The payment app';
    case 'business':
      return 'Curatix';
    default:
      return null;
  }
}
