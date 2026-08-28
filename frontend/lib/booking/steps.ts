/**
 * The funnel's steps, and how a URL maps onto them.
 *
 * ── TICKET SELECTION IS A STEP AGAIN, AND STILL ONLY ASKED ONCE ───────────
 *
 * The history matters, because this has now been both ways.
 *
 * Originally it was step 1 AND the event page carried a full picker, so
 * pressing Book asked for the same four things a second time: two screens, one
 * decision, and a progress bar telling somebody they were a quarter of the way
 * through a choice they had already made. The fix at the time was to delete
 * the step and keep the event page's picker.
 *
 * It is a step again — but the duplication is gone the OTHER way. The event
 * page no longer picks; it shows a price and a `Book tickets` CTA, and the
 * picking happens once, on a screen whose only job is picking. That is the
 * shape the reference design uses, and it is better than the original for a
 * reason the first version could not have: a ticket tier now carries real
 * availability, per-order limits and a sale window, and a panel wedged into a
 * 22rem sidebar beside a poster is the worst place to read any of it.
 *
 * The rule that survives from the old note is the one that mattered: ASK
 * ONCE. Whichever screen owns the picker, the other must not have one.
 *
 * ── SIGN IN COMES FIRST, AND THE STEPPER USED TO DISAGREE ─────────────────
 *
 * `stepsFor(false)` once returned `[review, login, payment]`, so a visitor was
 * told they were starting on Review while the router bounced them to Login. A
 * stepper that disagrees with the router is worse than no stepper: it is the
 * only thing on screen claiming to say where you are.
 *
 * ── LOGIN IS CONDITIONAL, and that shapes the model ───────────────────────
 *
 * Showing a signed-in person a step they will never see is an unnecessary
 * screen. So the step LIST depends on auth, and the stepper renders whatever
 * it is given rather than hiding one of a fixed set.
 */

export type StepId = 'booking' | 'login' | 'review' | 'payment';

export type Step = {
  id: StepId;
  label: string;
  /** Relative to `/booking/[eventId]`. */
  segment: string;
};

const ALL: Record<StepId, Step> = {
  booking: { id: 'booking', label: 'Tickets', segment: '' },
  login: { id: 'login', label: 'Sign in', segment: 'login' },
  review: { id: 'review', label: 'Review', segment: 'review' },
  payment: { id: 'payment', label: 'Payment', segment: 'pay' },
};

export const stepsFor = (authenticated: boolean): Step[] =>
  authenticated
    ? [ALL.booking, ALL.review, ALL.payment]
    : [ALL.booking, ALL.login, ALL.review, ALL.payment];

/** Which step a pathname is on. */
export function currentStep(pathname: string): StepId {
  if (pathname.endsWith('/login')) return 'login';
  if (pathname.endsWith('/review')) return 'review';
  if (pathname.endsWith('/pay') || pathname.endsWith('/confirmation')) return 'payment';
  return 'booking';
}

export const stepHref = (eventId: string, step: Step, query = ''): string => {
  const base = `/booking/${eventId}${step.segment ? `/${step.segment}` : ''}`;
  return query ? `${base}?${query}` : base;
};
