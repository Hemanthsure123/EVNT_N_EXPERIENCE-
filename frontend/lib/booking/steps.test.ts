import { describe, expect, it } from 'vitest';
import { currentStep, stepHref, stepsFor } from './steps';

/**
 * The funnel's shape.
 *
 * ── THIS HAS NOW BEEN BOTH WAYS, AND THE INVARIANT IS "ASK ONCE" ──────────
 *
 * Ticket selection began as step 1 while the event page ALSO carried a full
 * picker, so pressing Book asked for the same four things again. The step was
 * deleted and the event page kept the picker. It is a step again now, and the
 * event page's picker is gone: the picking happens once, on a screen whose
 * only job is picking.
 *
 * What is worth testing is not which screen won. It is that exactly one did —
 * and that the stepper agrees with the router about where somebody is.
 */

describe('stepsFor', () => {
  it('starts at Tickets, because that is where the funnel now begins', () => {
    expect(stepsFor(true).map((step) => step.id)).toEqual(['booking', 'review', 'payment']);
  });

  it('puts Sign in after Tickets and before Review, because the router does', () => {
    // This once asserted `['review', 'login', 'payment']`, on the argument
    // that a sign-in wall before the total loses somebody who has already
    // chosen. A real argument — but never IMPLEMENTED: `/booking/{id}/review`
    // has always redirected an anonymous visitor to `/login`, so the stepper
    // drew "Review" as the step somebody was about to be bounced out of.
    //
    // Resolved in favour of the router. If the review-before-sign-in argument
    // is ever taken up, the REDIRECT is what has to change, and this test
    // changes with it.
    expect(stepsFor(false).map((step) => step.id)).toEqual([
      'booking',
      'login',
      'review',
      'payment',
    ]);
  });

  it('draws Tickets exactly once, and only in one place in the product', () => {
    // The invariant that survived both reversals. `booking` is a real step
    // again ONLY because the event page stopped picking; if a picker ever
    // returns to the event page, this step has to go with it.
    for (const authenticated of [true, false]) {
      const ids = stepsFor(authenticated).map((step) => step.id);
      expect(ids.filter((id) => id === 'booking')).toHaveLength(1);
      expect(ids[0]).toBe('booking');
    }
  });

  it('numbers to three steps signed in and four signed out', () => {
    expect(stepsFor(true)).toHaveLength(3);
    expect(stepsFor(false)).toHaveLength(4);
  });
});

describe('currentStep', () => {
  it('maps each funnel URL to its step', () => {
    const id = 'evt-1';
    expect(currentStep(`/booking/${id}/review`)).toBe('review');
    expect(currentStep(`/booking/${id}/login`)).toBe('login');
    expect(currentStep(`/booking/${id}/pay`)).toBe('payment');
    expect(currentStep(`/booking/${id}/confirmation`)).toBe('payment');
  });

  it('names the entry URL as the ticket step it now renders', () => {
    // `/booking/{id}` was a redirect and is a PAGE again. The mapping did not
    // change; what changed is that the step it names is one somebody can see.
    expect(currentStep('/booking/evt-1')).toBe('booking');
  });
});

describe('stepHref', () => {
  it('builds the URL for a step, carrying a query when given one', () => {
    const [tickets, review, payment] = stepsFor(true);
    expect(stepHref('evt-1', tickets)).toBe('/booking/evt-1');
    expect(stepHref('evt-1', review)).toBe('/booking/evt-1/review');
    expect(stepHref('evt-1', payment, 'tickets=abc:2')).toBe('/booking/evt-1/pay?tickets=abc:2');
  });

  it('gives the ticket step a bare URL, since its segment is empty', () => {
    const [tickets] = stepsFor(true);
    expect(stepHref('evt-1', tickets, 'tickets=abc:2')).toBe('/booking/evt-1?tickets=abc:2');
  });
});
