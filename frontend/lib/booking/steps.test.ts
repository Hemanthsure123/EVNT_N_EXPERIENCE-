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
 *
 * ── AND THE FUNNEL IS TWO SCREENS NOW ─────────────────────────────────────
 *
 * `login` and `payment` were both steps here. Neither is any more, for two
 * different reasons, and the assertions below moved with the product:
 *
 * - `payment` was a screen that restated the order the previous screen had
 *   just shown and then offered a button. The button moved onto the summary.
 * - `login` was a screen that cost you the selection and your place in the
 *   flow. It is a sheet over whichever screen asked for it.
 *
 * Both URLs still resolve — they 3xx — which is why `currentStep` still has an
 * answer for them.
 */

describe('stepsFor', () => {
  it('is Tickets then Review & pay, and nothing else', () => {
    expect(stepsFor(true).map((step) => step.id)).toEqual(['booking', 'review']);
  });

  it('shows the same two steps signed out, because signing in is not a step', () => {
    // This once asserted a four-entry list ending in `payment`, and before
    // that `['review', 'login', 'payment']`. The rule that decided every
    // version is unchanged: the stepper says what the ROUTER does. The router
    // no longer navigates to sign in, so the row no longer draws it.
    expect(stepsFor(false).map((step) => step.id)).toEqual(['booking', 'review']);
  });

  it('draws Tickets exactly once, and only in one place in the product', () => {
    // The invariant that survived every reversal. `booking` is a real step
    // ONLY because the event page stopped picking; if a picker ever returns to
    // the event page, this step has to go with it.
    for (const authenticated of [true, false]) {
      const ids = stepsFor(authenticated).map((step) => step.id);
      expect(ids.filter((id) => id === 'booking')).toHaveLength(1);
      expect(ids[0]).toBe('booking');
    }
  });

  it('never draws confirmation, because an outcome is not a step', () => {
    // A paid ticket with "1 of 3" above it reads as unfinished business.
    for (const authenticated of [true, false]) {
      expect(stepsFor(authenticated).map((step) => step.id)).not.toContain('confirmation');
    }
  });
});

describe('currentStep', () => {
  it('maps each funnel URL to its step', () => {
    const id = 'evt-1';
    expect(currentStep(`/booking/${id}/review`)).toBe('review');
    expect(currentStep(`/booking/${id}/confirmation`)).toBe('confirmation');
  });

  it('places the retired URLs on the step they redirect to', () => {
    // `/pay` and `/login` are `redirect()` shims kept for histories and shared
    // links. For the frame before the redirect resolves the shell still has a
    // pathname to place, and placing it on a step that no longer exists is how
    // the stepper ends up highlighting the wrong disc.
    const id = 'evt-1';
    expect(currentStep(`/booking/${id}/pay`)).toBe('review');
    expect(currentStep(`/booking/${id}/login`)).toBe('booking');
  });

  it('names the entry URL as the ticket step it now renders', () => {
    expect(currentStep('/booking/evt-1')).toBe('booking');
  });
});

describe('stepHref', () => {
  it('builds the URL for a step, carrying a query when given one', () => {
    const [tickets, review] = stepsFor(true);
    expect(stepHref('evt-1', tickets)).toBe('/booking/evt-1');
    expect(stepHref('evt-1', review)).toBe('/booking/evt-1/review');
    expect(stepHref('evt-1', review, 'tickets=abc:2')).toBe(
      '/booking/evt-1/review?tickets=abc:2',
    );
  });

  it('gives the ticket step a bare URL, since its segment is empty', () => {
    const [tickets] = stepsFor(true);
    expect(stepHref('evt-1', tickets, 'tickets=abc:2')).toBe('/booking/evt-1?tickets=abc:2');
  });
});
