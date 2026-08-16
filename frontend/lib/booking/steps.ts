/**
 * The funnel's steps, and how a URL maps onto them.
 *
 * ── TICKET SELECTION IS NOT A STEP ANY MORE ───────────────────────────────
 *
 * It used to be step 1: the event page had a full picker — session, tier,
 * quantity, total, Book — and pressing Book opened a funnel screen that asked
 * for exactly the same four things again. Two screens, one decision, and a
 * progress bar telling somebody they were a quarter of the way through a
 * choice they had already made.
 *
 * The event page keeps the picker, because that is where somebody is deciding
 * — beside the poster, the date, the venue and the line-up. The funnel now
 * starts where the decision ENDS: prove who you are if we do not know yet,
 * confirm what you picked, pay.
 *
 * ── SIGN IN COMES FIRST, AND THE STEPPER USED TO DISAGREE ─────────────────
 *
 * `stepsFor(false)` returned `[review, login, payment]`, so a visitor was told
 * they were starting on Review. The ROUTING has always sent an anonymous
 * visitor from `/review` straight to `/login` — so the progress indicator
 * named a step they were about to be bounced out of, and the one they were
 * actually on was drawn as step 2.
 *
 * A stepper that disagrees with the router is worse than no stepper: it is the
 * only thing on the screen claiming to say where you are.
 *
 * `booking` survives as a StepId only so an old `/booking/{id}` link still
 * resolves; the route redirects to `review` and no stepper ever draws it.
 *
 * ── LOGIN IS CONDITIONAL, and that shapes the model ───────────────────────
 *
 * Showing a signed-in person a step they will never see — greyed out, or worse
 * briefly highlighted — is an unnecessary screen. So the step LIST depends on
 * auth: two steps when signed in, three when not, and the stepper renders
 * whatever it is given rather than hiding one of a fixed three.
 */

export type StepId = 'booking' | 'login' | 'review' | 'payment';

export type Step = {
  id: StepId;
  label: string;
  /** Relative to `/booking/[eventId]`. */
  segment: string;
};

const ALL: Record<StepId, Step> = {
  // Not in any step list — see the note above. Kept so `currentStep` can name
  // the legacy `/booking/{id}` URL while it redirects.
  booking: { id: 'booking', label: 'Tickets', segment: '' },
  login: { id: 'login', label: 'Sign in', segment: 'login' },
  review: { id: 'review', label: 'Review', segment: 'review' },
  payment: { id: 'payment', label: 'Payment', segment: 'pay' },
};

export const stepsFor = (authenticated: boolean): Step[] =>
  authenticated ? [ALL.review, ALL.payment] : [ALL.login, ALL.review, ALL.payment];

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
