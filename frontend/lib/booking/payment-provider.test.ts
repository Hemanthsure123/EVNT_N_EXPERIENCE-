import { afterEach, describe, expect, it } from 'vitest';
import { rememberProvider, resolveProvider } from './payment-provider';

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
