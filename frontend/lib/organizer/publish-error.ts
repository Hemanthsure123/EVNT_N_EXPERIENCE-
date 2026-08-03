import { ApiError } from '@/lib/api/errors';
import type { StepId } from './wizard/model';

/**
 * Turning a refused publish into something the organizer can act on.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Three separate screens submit an event for review (the wizard's Review step,
 * the events-table bulk bar, and the resubmit button on a rejected event), and
 * all three rendered the same thing: `error.message` as terminal red text. That
 * is how "cannot submit events for approval" gets reported as a platform fault.
 * Every one of those messages is a true, specific statement — "this event needs
 * a ticket type", "this organisation is not verified yet" — and every one of
 * them has an obvious next move that the screen was not offering.
 *
 * The backend already ships what is needed to do better. `DomainError` puts a
 * stable machine `code` on every failure and `OrganizationNotVerifiedError`
 * carries `details.verified_level` specifically so a caller can tell "you have
 * not applied" apart from "we are still reviewing you". Nothing read either.
 *
 * ── THE MESSAGE IS THE SERVER'S, THE ACTION IS OURS ───────────────────────
 *
 * The server's sentence is shown verbatim: it knows exactly which check failed
 * and paraphrasing it here would drift the moment a check is added. What this
 * adds is the destination — a link to the verification page, or a jump to the
 * wizard step that fixes it.
 *
 * An unrecognised code still renders its message with no action, which is the
 * old behaviour and the right floor. Inventing an action for a failure we do
 * not understand would send somebody to the wrong screen.
 */

export type PublishFailure = {
  /** The server's own sentence, shown verbatim. */
  message: string;
  /** Where to go, when we know. */
  action?: { label: string; href?: string; step?: StepId };
  /** `warning` for "you are waiting on somebody", `error` for "you must change
   *  something". A pending review is not a mistake and should not read as one. */
  tone: 'warning' | 'error';
};

const FALLBACK = 'Could not submit. Your draft is safe — try again in a moment.';

/** Which wizard step fixes which publish check, by the words the server uses.
 *  Matched on a distinctive fragment rather than the whole sentence so a
 *  wording tweak on the server does not silently drop the jump. */
const STEP_FOR: { fragment: string; step: StepId }[] = [
  { fragment: 'ticket type', step: 'tickets' },
  { fragment: 'title', step: 'basics' },
  { fragment: 'venue', step: 'venue' },
  { fragment: 'start time', step: 'schedule' },
];

export function describePublishFailure(thrown: unknown): PublishFailure {
  if (!(thrown instanceof ApiError)) return { message: FALLBACK, tone: 'error' };

  if (thrown.code === 'organization_not_verified') {
    // `pending` means an operator has the application and has not decided.
    // There is nothing to fix, so there is no fix to offer — only somewhere to
    // watch. Sending them to the form they already submitted would read as
    // "your submission was lost".
    const pending =
      (thrown.details as { verified_level?: string } | undefined)?.verified_level === 'pending';
    return {
      message: thrown.message,
      tone: pending ? 'warning' : 'error',
      action: {
        label: pending ? 'Check verification status' : 'Get verified',
        href: '/account/organizer',
      },
    };
  }

  if (thrown.code === 'event_not_publishable') {
    const lower = thrown.message.toLowerCase();
    const match = STEP_FOR.find((entry) => lower.includes(entry.fragment));
    return {
      message: thrown.message,
      tone: 'error',
      action: match ? { label: 'Fix this', step: match.step } : undefined,
    };
  }

  if (thrown.code === 'stale_event_version') {
    // Someone (or another tab) changed the event underneath this one. A retry
    // with the version we are holding is exactly how the edit the lock just
    // protected gets clobbered, so the only safe offer is a reload.
    return {
      message: 'This event changed somewhere else. Reload to get the latest version.',
      tone: 'warning',
      action: { label: 'Reload', href: '' },
    };
  }

  return { message: thrown.message || FALLBACK, tone: 'error' };
}
