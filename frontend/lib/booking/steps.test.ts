import { describe, expect, it } from 'vitest';
import { currentStep, stepHref, stepsFor } from './steps';

/**
 * The funnel's shape.
 *
 * Nothing tested this, which is how it kept a step that had stopped existing:
 * ticket selection moved to the event page and the stepper carried on drawing
 * "1 Tickets" in front of it, telling somebody they were a third of the way
 * through a choice they had already made.
 */

describe('stepsFor', () => {
  it('is Review then Payment when signed in', () => {
    expect(stepsFor(true).map((step) => step.id)).toEqual(['review', 'payment']);
  });

  it('puts Sign in FIRST when signed out, because the router does', () => {
    // This asserted `['review', 'login', 'payment']`, on the argument that a
    // sign-in wall before the total is the fastest way to lose somebody who
    // has already chosen. That is a real argument — but it was never
    // IMPLEMENTED: `/booking/{id}/review` has always redirected an anonymous
    // visitor to `/login`.
    //
    // So the stepper drew "Review" as step 1 for somebody who was about to be
    // bounced to step 2, and the step they were actually on was numbered
    // second. A progress indicator that disagrees with the router is worse
    // than none, since it is the only thing on screen claiming to say where
    // you are.
    //
    // Resolved in favour of the router: sign in, then review, then pay. If the
    // review-before-sign-in argument is ever taken up, the REDIRECT is what
    // has to change, and this test should change with it.
    expect(stepsFor(false).map((step) => step.id)).toEqual(['login', 'review', 'payment']);
  });

  it('never includes the ticket-selection step', () => {
    // THE regression. `booking` survives as an id so the legacy
    // `/booking/{id}` URL can still be named while it redirects, and it must
    // never be drawn as a step again.
    for (const authenticated of [true, false]) {
      expect(stepsFor(authenticated).map((step) => step.id)).not.toContain('booking');
    }
  });

  it('numbers to two steps signed in and three signed out', () => {
    expect(stepsFor(true)).toHaveLength(2);
    expect(stepsFor(false)).toHaveLength(3);
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

  it('still names the legacy entry URL', () => {
    // It resolves to `booking` so nothing throws while the route redirects to
    // review. The stepper never asks about this one, because `stepsFor` does
    // not contain it.
    expect(currentStep('/booking/evt-1')).toBe('booking');
  });
});

describe('stepHref', () => {
  it('builds the URL for a step, carrying a query when given one', () => {
    const [review, payment] = stepsFor(true);
    expect(stepHref('evt-1', review)).toBe('/booking/evt-1/review');
    expect(stepHref('evt-1', payment, 'tickets=abc:2')).toBe('/booking/evt-1/pay?tickets=abc:2');
  });
});
