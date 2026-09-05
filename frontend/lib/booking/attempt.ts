import type { Selection } from './selection';
import { selectionSignature } from './selection';

/**
 * WHICH CHECKOUT ATTEMPT THIS IS.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * `Idempotency-Key` protects a RETRY OF ONE REQUEST: a double-tapped Continue,
 * a dropped connection, a reload mid-submit. The key is derived from the order
 * so that all three resolve to one booking, and CLAUDE.md is explicit that it
 * must not become a nonce — a fresh random key per request would reserve a new
 * set of tickets on every one of those.
 *
 * But "two General tickets for this event" is then the same string for ever, so
 * the key could not tell a RETRY from a SECOND PURCHASE. Buy those two tickets,
 * come back, choose them again, and the server replayed the booking you already
 * paid for: nothing was reserved, the checkout showed that settled booking's
 * total beside the new order's lines, and Pay opened a provider order that had
 * already been captured — which the provider refuses with a generic error.
 * Every retry reproduced it, because retrying was what triggered it.
 *
 * ── WHY THIS IS NOT A NONCE ───────────────────────────────────────────────
 *
 * The attempt number is STABLE for as long as one checkout is in progress. It
 * lives in `sessionStorage`, keyed by event + selection, so:
 *
 *   double-tap        same attempt → same key → replayed. ✔
 *   reload            same attempt → same key → replayed. ✔
 *   dropped request   same attempt → same key → replayed. ✔
 *   deliberate re-buy the previous attempt ENDED, so it is bumped once and the
 *                     new key reserves properly. ✔
 *
 * Every protection the derived key was written for is intact. What changes is
 * that a finished attempt stops speaking for the next one.
 *
 * The server bounds the same thing independently (a paid booking answers for
 * its key for a few minutes and no longer), so a client that never bumped would
 * still recover. Neither guard is load-bearing alone, which is the point.
 *
 * ── EVERY READ AND WRITE IS GUARDED ───────────────────────────────────────
 *
 * `sessionStorage` throws outright in a private window with site data blocked,
 * and is absent on the server. This is the money path: a storage refusal must
 * fall back to attempt 1 — which behaves exactly as the old key did — never
 * throw on the way to a reserve.
 */

const STORE_KEY = 'ee-booking-attempt';

const slotFor = (eventId: string, selection: Selection) =>
  `${eventId}:${selectionSignature(selection)}`;

function read(): Record<string, number> {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // A hand-edited or half-written value must not make the key `NaN`, which
    // would be a string every attempt agreed on — i.e. the original bug back.
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function write(store: Record<string, number>): void {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* Storage refused. `attemptFor` then answers 1 every time, which is exactly
       the behaviour that shipped before attempts existed. */
  }
}

/** This selection's current attempt. Always ≥ 1, never `NaN`. */
export function attemptFor(eventId: string, selection: Selection): number {
  const value = read()[slotFor(eventId, selection)];
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/**
 * Start a NEW attempt at this selection, and return its number.
 *
 * Called only when the booking that came back cannot be paid for — the previous
 * attempt is over, whatever ended it. Never called speculatively: a bump that
 * happens on a render, a re-mount or a focus event would be a nonce with extra
 * steps.
 */
export function bumpAttempt(eventId: string, selection: Selection): number {
  const store = read();
  const slot = slotFor(eventId, selection);
  const next = attemptFor(eventId, selection) + 1;
  store[slot] = next;
  write(store);
  return next;
}
