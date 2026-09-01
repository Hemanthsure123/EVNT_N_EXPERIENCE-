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
 * ── THE STEPPER MUST AGREE WITH THE ROUTER ────────────────────────────────
 *
 * `stepsFor(false)` once returned `[review, login, payment]`, so a visitor was
 * told they were starting on Review while the router bounced them to Login. A
 * stepper that disagrees with the router is worse than no stepper: it is the
 * only thing on screen claiming to say where you are. That is also why
 * `currentStep` still maps the two RETIRED segments rather than falling
 * through to `booking` — for the frame before a redirect resolves, the shell
 * still has to place the pathname somewhere true.
 */

/**
 * ── TWO STEPS, AND SIGN-IN IS NOT ONE OF THEM ─────────────────────────────
 *
 * `payment` is gone: it was a screen that restated the order and offered a
 * button, so the button moved onto the summary and the navigation went with
 * it. `login` is gone as a STEP for a different reason — it is a bottom sheet
 * over whatever screen asked for it, so signing in no longer costs the
 * selection, the scroll position or the sense of where you were.
 *
 * What is left is the two decisions somebody actually makes: what to buy, and
 * whether to pay for it.
 */
export type StepId = 'booking' | 'review' | 'confirmation';

export type Step = {
  id: StepId;
  label: string;
  /** Relative to `/booking/[eventId]`. */
  segment: string;
};

/**
 * `confirmation` is deliberately absent: it is the OUTCOME, not a step. Drawing
 * it as a fourth disc would tell somebody holding a paid ticket that they have
 * one more thing to do.
 */
const ALL: Record<'booking' | 'review', Step> = {
  booking: { id: 'booking', label: 'Tickets', segment: '' },
  review: { id: 'review', label: 'Review & pay', segment: 'review' },
};

// The parameter is kept so callers do not all have to change, and because the
// list becoming auth-dependent again is a live possibility; it is unused
// because signing in is a sheet now rather than a screen.
export const stepsFor = (_authenticated: boolean): Step[] => [ALL.booking, ALL.review];

/**
 * Which step a pathname is on.
 *
 * `/pay` and `/login` are retired routes that 3xx to `/review` and to the
 * picker. They are still mapped, because for the instant before the redirect
 * resolves the shell has a pathname to place — and mapping them to a step that
 * no longer exists is how the stepper ends up highlighting the wrong disc.
 */
export function currentStep(pathname: string): StepId {
  if (pathname.endsWith('/confirmation')) return 'confirmation';
  if (pathname.endsWith('/review') || pathname.endsWith('/pay')) return 'review';
  return 'booking';
}

export const stepHref = (eventId: string, step: Step, query = ''): string => {
  const base = `/booking/${eventId}${step.segment ? `/${step.segment}` : ''}`;
  return query ? `${base}?${query}` : base;
};
