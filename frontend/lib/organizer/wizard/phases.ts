import { STEPS, type StepId } from './model';

/**
 * THREE PHASES OVER EIGHT STEPS — and why the eight did not go away.
 *
 * The wizard's top tracker carried eight entries. On a phone that is a row you
 * scroll, which is a progress indicator that stops telling you where you are;
 * on any width it is eight decisions presented as eight journeys. It is three
 * now: Core & Media, Schedule & Tickets, Review & Publish.
 *
 * ── THE STEP IDS ARE UNTOUCHED, DELIBERATELY ─────────────────────────────
 *
 * `StepId` is not only a tracker label. It is the key of `Issue.step`, of
 * `stepStatus`, of `SERVER_BACKED_STEPS`, and of the Review checklist's
 * "take me to the problem" jump. Collapsing eight ids into three would make
 * every one of those coarser: an error on the venue would point at a phase
 * containing five forms, and the one affordance that makes a long draft
 * fixable — press the failing item, land on the field — would become "press
 * the failing item, land somewhere near it".
 *
 * So this is a GROUPING, not a replacement. Eight steps still validate, still
 * report, still get jumped to; three phases are what an organizer navigates.
 *
 * ── AND THE ORDER INSIDE A PHASE IS THE ORDER ON SCREEN ──────────────────
 *
 * A phase renders its members stacked, each already a set of closed-by-default
 * accordions. `members` is therefore a running order, not a set — Basics before
 * Venue before Media is the sequence somebody fills a form in, and it is the
 * same sequence the old eight-step tracker walked.
 */

export type PhaseId = 'core' | 'schedule' | 'review';

/**
 * A phase member.
 *
 * Every member except `coupons` is a real `StepId`. Coupons is NOT one, and
 * that is the whole reason this type is a union rather than `StepId[]`: a
 * promo code is not part of the event draft. It has its own endpoint, its own
 * lifecycle, and it can never block a publish — so it has no validation to
 * contribute, no completion percentage to move, and nothing for `Issue.step`
 * to point at. Adding it to `STEPS` to get it on screen would have put a
 * non-step into every one of those records.
 */
export type PhaseMember = StepId | 'coupons';

export type Phase = {
  id: PhaseId;
  label: string;
  /** One line under the heading, for what this phase is actually for. */
  hint: string;
  members: readonly PhaseMember[];
};

export const PHASES: readonly Phase[] = [
  {
    id: 'core',
    label: 'Core & Media',
    hint: 'What the event is, where it happens, and how it looks',
    members: ['basics', 'venue', 'media', 'details', 'coupons'],
  },
  {
    id: 'schedule',
    label: 'Schedule & Tickets',
    hint: 'When it runs, what it costs, and how people find it',
    members: ['schedule', 'tickets', 'seo'],
  },
  {
    id: 'review',
    label: 'Review & Publish',
    hint: 'What is still missing, and the button that sends it',
    members: ['review'],
  },
];

/** The phase a step belongs to. Falls back to the first phase rather than
 *  `undefined`: a caller handed an unknown id is better off at the start of
 *  the wizard than on a screen rendering nothing. */
export function phaseOf(step: StepId): PhaseId {
  return PHASES.find((phase) => phase.members.includes(step))?.id ?? PHASES[0].id;
}

export function phaseAt(id: PhaseId): Phase {
  return PHASES.find((phase) => phase.id === id) ?? PHASES[0];
}

export function phaseIndex(id: PhaseId): number {
  const at = PHASES.findIndex((phase) => phase.id === id);
  return at === -1 ? 0 : at;
}

/**
 * THE WORST NEWS FROM ANY STEP IN THE PHASE.
 *
 * `error` beats `todo` beats `done`, in that order, and the order is the
 * point: a phase whose five forms are four-fifths complete and one-fifth
 * broken must read as broken. Rolling it up the other way — "mostly done" —
 * is how somebody reaches Review and finds a blocker they were shown a green
 * tick for.
 *
 * A phase with no validating members at all (there is none today, but Review
 * is one step away from being one) is `todo` rather than `done`: a tick earned
 * by having nothing to check is a tick that means nothing.
 */
export function phaseStatus(
  phase: Phase,
  status: Record<StepId, 'done' | 'todo' | 'error'>,
): 'done' | 'todo' | 'error' {
  const states = phase.members
    .filter((member): member is StepId => member !== 'coupons')
    .map((member) => status[member]);

  if (!states.length) return 'todo';
  if (states.includes('error')) return 'error';
  return states.every((state) => state === 'done') ? 'done' : 'todo';
}

/**
 * The label a phase member shows above its own group of accordions.
 *
 * Taken from `STEPS` so the names cannot drift from the ones `Issue.step`
 * reports against, with the one non-step spelled out here.
 */
export function memberLabel(member: PhaseMember): string {
  if (member === 'coupons') return 'Coupons';
  return STEPS.find((step) => step.id === member)?.label ?? member;
}

/** The DOM id a phase member's section carries, so Review's checklist can
 *  scroll to the exact form rather than to the top of a phase holding five. */
export const memberAnchor = (member: PhaseMember) => `wizard-${member}`;
