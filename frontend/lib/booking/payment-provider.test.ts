import { afterEach, describe, expect, it } from 'vitest';
import { rememberProvider, resolveProvider, selectableProviders } from './payment-provider';

/**
 * These guard one specific shipped bug: the pay step deciding whether a real
 * checkout was possible by asking whether the public key was a non-empty
 * string. `RAZORPAY_KEY_ID` and `PAYMENTS_BACKEND` are independent settings, so
 * a leftover key beside a switch to the fake provider rendered a live "Pay"
 * button that opened Razorpay Checkout with a `fake_order_…` id.
 */

afterEach(() => window.sessionStorage.clear());

describe('resolveProvider', () => {
  it('prefers what came back with THIS order', () => {
    rememberProvider('fake');
    expect(resolveProvider('razorpay')).toBe('razorpay');
  });

  it('falls back to the one remembered this session — a reload on the pay step', () => {
    rememberProvider('fake');
    expect(resolveProvider('')).toBe('fake');
  });

  it('assumes the REAL provider when nothing is known', () => {
    // Being wrong this way shows a checkout that may fail to open. Being wrong
    // the other way puts a "simulate payment" control on a deployment where
    // money is real, which is not a trade worth making.
    expect(resolveProvider('')).toBe('razorpay');
  });

  it('ignores a value that is not a provider it knows', () => {
    rememberProvider('stripe');
    expect(resolveProvider('paypal')).toBe('razorpay');
    expect(window.sessionStorage.getItem('ee-payment-provider')).toBeNull();
  });
});

/**
 * What the selector may draw.
 *
 * The rule this enforces is the one `PayUsing` was originally written around:
 * a chevron promising a choice we cannot honour is a control that lies about
 * what pressing it does, on the last screen before money moves. So the
 * affordance appears only when there is genuinely more than one thing to pick.
 */
describe('selectableProviders', () => {
  it('offers both when the server lists both', () => {
    expect(selectableProviders(['cashfree', 'razorpay'])).toEqual(['cashfree', 'razorpay']);
  });

  it('preserves the server order, so the default the server chose reads first', () => {
    expect(selectableProviders(['razorpay', 'cashfree'])).toEqual(['razorpay', 'cashfree']);
  });

  it('offers NOTHING for a single gateway — one option is not a choice', () => {
    // A dropdown whose menu holds one already-ticked row is a control that
    // wastes a press to tell you what the trigger already said.
    expect(selectableProviders(['razorpay'])).toEqual([]);
  });

  it('drops a gateway this build has no SDK for', () => {
    // Rendering it would draw a row that cannot open a checkout — the same
    // class of lie as a nav item pointing at a 404.
    expect(selectableProviders(['cashfree', 'stripe', 'razorpay'])).toEqual([
      'cashfree',
      'razorpay',
    ]);
  });

  it('never offers the demo provider beside a real one', () => {
    // A "simulate payment" row next to a live gateway is a pay-nothing button.
    expect(selectableProviders(['cashfree', 'fake'])).toEqual([]);
  });

  it('is empty for a demo deployment, so the plain-text control renders', () => {
    expect(selectableProviders(['fake'])).toEqual([]);
  });

  it('survives a missing or empty list rather than throwing on the money path', () => {
    expect(selectableProviders(undefined)).toEqual([]);
    expect(selectableProviders([])).toEqual([]);
  });

  it('collapses duplicates', () => {
    expect(selectableProviders(['cashfree', 'cashfree', 'razorpay'])).toEqual([
      'cashfree',
      'razorpay',
    ]);
  });
});
