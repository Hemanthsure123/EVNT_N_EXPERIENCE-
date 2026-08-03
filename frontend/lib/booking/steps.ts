/**
 * The funnel's four steps, and how a URL maps onto them.
 *
 * LOGIN IS CONDITIONAL, and that shapes the whole model. Showing a signed-in
 * person a step they will never see — greyed out, or worse, briefly highlighted
 * — is the "unnecessary screen" the brief rules out. So the step LIST itself
 * depends on auth: three steps when signed in, four when not, and the stepper
 * renders whatever it's given rather than hiding one of a fixed four.
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
