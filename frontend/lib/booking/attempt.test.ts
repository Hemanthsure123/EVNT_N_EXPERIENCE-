import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptFor, bumpAttempt } from './attempt';
import { idempotencyKeyFor, type Selection } from './selection';

/**
 * The rule that decides whether somebody can buy the same tickets twice.
 *
 * ── THE BUG THESE TESTS EXIST FOR ─────────────────────────────────────────
 *
 * The `Idempotency-Key` was a pure function of the order, so "two General
 * tickets for this event" was the same string for ever. Buying them made them
 * permanently unbuyable by that account: the server replayed the settled
 * booking, the checkout showed its stale total beside the new order's lines,
 * and Pay opened a provider order that had already been captured — which the
 * provider refuses with a generic error. Every retry reproduced it, because
 * retrying was what triggered it.
 *
 * The attempt is what separates a RETRY (same attempt, must replay) from a
 * SECOND PURCHASE (new attempt, must reserve). Both halves are asserted here:
 * it must be stable enough to survive a double-tap and a reload, and it must
 * move when the previous attempt has ended.
 */

const EVENT = 'evt-1';
const SELECTION: Selection = [{ tierId: 'tier-a', quantity: 2 }];

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('attemptFor', () => {
  it('starts at 1 and does not move on its own', () => {
    expect(attemptFor(EVENT, SELECTION)).toBe(1);
    // Read twice — a value that incremented on read would be a nonce, which is
    // exactly what must not happen: a double-tap would then reserve twice.
    expect(attemptFor(EVENT, SELECTION)).toBe(1);
    expect(attemptFor(EVENT, SELECTION)).toBe(1);
  });

  it('is scoped to the event AND the selection', () => {
    bumpAttempt(EVENT, SELECTION);
    expect(attemptFor(EVENT, SELECTION)).toBe(2);
    // A different quantity is a different order and starts its own count.
    expect(attemptFor(EVENT, [{ tierId: 'tier-a', quantity: 3 }])).toBe(1);
    expect(attemptFor('evt-2', SELECTION)).toBe(1);
  });

  it('ignores a hand-edited or half-written value rather than producing NaN', () => {
    // `NaN` would stringify into a key every attempt agreed on — i.e. the
    // original bug, reintroduced through the store instead of the function.
    window.sessionStorage.setItem('ee-booking-attempt', '{"evt-1:tier-a:2":"banana"}');
    expect(attemptFor(EVENT, SELECTION)).toBe(1);
    window.sessionStorage.setItem('ee-booking-attempt', 'not json at all');
    expect(attemptFor(EVENT, SELECTION)).toBe(1);
  });

  it('falls back to 1 when storage refuses, instead of throwing on the money path', () => {
    // A private window with site data blocked throws on read. This runs one
    // step before a reserve; it must degrade, never break the checkout.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(attemptFor(EVENT, SELECTION)).toBe(1);
  });
});

describe('bumpAttempt', () => {
  it('moves to the next attempt and persists it', () => {
    expect(bumpAttempt(EVENT, SELECTION)).toBe(2);
    expect(attemptFor(EVENT, SELECTION)).toBe(2);
    expect(bumpAttempt(EVENT, SELECTION)).toBe(3);
  });

  it('survives a write failure without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => bumpAttempt(EVENT, SELECTION)).not.toThrow();
  });
});

describe('idempotencyKeyFor', () => {
  it('is IDENTICAL for the same attempt — the double-tap protection', () => {
    const attempt = attemptFor(EVENT, SELECTION);
    expect(idempotencyKeyFor(EVENT, SELECTION, attempt)).toBe(
      idempotencyKeyFor(EVENT, SELECTION, attempt),
    );
  });

  it('is order-independent, so a reshuffled selection is the same intent', () => {
    const a: Selection = [
      { tierId: 'b', quantity: 1 },
      { tierId: 'a', quantity: 2 },
    ];
    const b: Selection = [
      { tierId: 'a', quantity: 2 },
      { tierId: 'b', quantity: 1 },
    ];
    expect(idempotencyKeyFor(EVENT, a, 1)).toBe(idempotencyKeyFor(EVENT, b, 1));
  });

  it('CHANGES when the attempt does — the second purchase', () => {
    const first = idempotencyKeyFor(EVENT, SELECTION, attemptFor(EVENT, SELECTION));
    bumpAttempt(EVENT, SELECTION);
    const second = idempotencyKeyFor(EVENT, SELECTION, attemptFor(EVENT, SELECTION));
    expect(second).not.toBe(first);
  });

  it('defaults to attempt 1, so a caller with no store behaves as before', () => {
    expect(idempotencyKeyFor(EVENT, SELECTION)).toBe(idempotencyKeyFor(EVENT, SELECTION, 1));
  });
});
