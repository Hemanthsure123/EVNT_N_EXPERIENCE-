import { afterEach, describe, expect, it } from 'vitest';
import { resolveCashfreeMode, rememberCashfreeMode } from './cashfree';

/**
 * `Cashfree({ mode })` has to match the environment that minted the session.
 * Get it wrong and the SDK opens against the wrong API and the session is
 * rejected — after the customer has pressed Pay.
 *
 * The ordering mirrors `resolveKeyId`'s, and for the same reason: the value
 * that came back with THIS order is the only one guaranteed to agree with it.
 */

afterEach(() => window.sessionStorage.clear());

describe('resolveCashfreeMode', () => {
  it('prefers what came back with THIS order', () => {
    rememberCashfreeMode('sandbox');
    expect(resolveCashfreeMode('production')).toBe('production');
  });

  it('falls back to the one remembered this session — a reload on the review step', () => {
    // The gap this exists to fill: `POST /bookings` returns the environment
    // once, and a refresh on the review screen would otherwise leave the page
    // holding a session it cannot say which API to open against.
    rememberCashfreeMode('production');
    expect(resolveCashfreeMode('')).toBe('production');
  });

  it('assumes sandbox when nothing is known', () => {
    // The two failure modes are not symmetrical. A sandbox SDK against a
    // production session is refused before any money moves and the customer
    // retries; defaulting the other way points a production checkout at a
    // session that does not exist there, which is discovered only in prod.
    expect(resolveCashfreeMode('')).toBe('sandbox');
  });

  it('ignores a value that is not an environment it knows', () => {
    rememberCashfreeMode('staging');
    expect(resolveCashfreeMode('live')).toBe('sandbox');
    expect(window.sessionStorage.getItem('ee-cashfree-mode')).toBeNull();
  });
});
