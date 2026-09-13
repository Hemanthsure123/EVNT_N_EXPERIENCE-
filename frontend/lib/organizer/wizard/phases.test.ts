import { describe, expect, it } from 'vitest';
import { STEPS, type StepId } from './model';
import { PHASES, memberAnchor, phaseAt, phaseIndex, phaseOf, phaseStatus } from './phases';

/**
 * THE GROUPING, AND THE ONE WAY IT CAN BE SILENTLY WRONG.
 *
 * Three phases over eight steps. Every property here fails without throwing: a
 * step left out of `PHASES` is a form that simply never renders, a step listed
 * twice renders twice with two copies of the same state, and a phase status
 * that rolls up the wrong way shows a green tick over a blocker.
 */

const ALL: StepId[] = STEPS.map((step) => step.id);

describe('every step has exactly one home', () => {
  it('covers all eight, with none stranded', () => {
    // THE TEST THAT MATTERS. The wizard renders members of the current phase
    // and nothing else, so a step missing from this list is a form with no
    // route to it at all — and it looks exactly like a wizard that works.
    const members = PHASES.flatMap((phase) => phase.members).filter(
      (member): member is StepId => member !== 'coupons',
    );
    expect([...members].sort()).toEqual([...ALL].sort());
  });

  it('never lists a step twice', () => {
    const members = PHASES.flatMap((phase) => phase.members);
    expect(new Set(members).size).toBe(members.length);
  });

  it('maps every step back to the phase that holds it', () => {
    for (const step of ALL) {
      const phase = phaseAt(phaseOf(step));
      expect(phase.members).toContain(step);
    }
  });
});

describe('the three phases are the ones the brief asked for', () => {
  it('is exactly three, in order', () => {
    expect(PHASES.map((phase) => phase.label)).toEqual([
      'Core & Media',
      'Schedule & Tickets',
      'Review & Publish',
    ]);
  });

  it('puts Coupons in the first phase, after the fields it prices', () => {
    // A promo code is decided while pricing the event, which is why it is in
    // the pipeline at all rather than only on `/dashboard/promotions`.
    expect(PHASES[0].members).toEqual(['basics', 'venue', 'media', 'details', 'coupons']);
  });

  it('keeps Review alone in the last phase', () => {
    // It is the summary AND the publish button. Anything else on that screen
    // competes with the one action it exists for.
    expect(PHASES[2].members).toEqual(['review']);
  });

  it('numbers them from the front', () => {
    expect(phaseIndex('core')).toBe(0);
    expect(phaseIndex('schedule')).toBe(1);
    expect(phaseIndex('review')).toBe(2);
  });
});

describe('phaseStatus rolls up the WORST news', () => {
  const clean = Object.fromEntries(ALL.map((step) => [step, 'done'])) as Record<
    StepId,
    'done' | 'todo' | 'error'
  >;

  it('is done only when every member is', () => {
    expect(phaseStatus(PHASES[0], clean)).toBe('done');
  });

  it('is error when ANY member is, however complete the rest are', () => {
    // Four of five forms finished and one broken must read as broken. Rolling
    // it up as "mostly done" is how somebody reaches Review and finds a
    // blocker they were shown a green tick for.
    expect(phaseStatus(PHASES[0], { ...clean, venue: 'error' })).toBe('error');
  });

  it('prefers error over todo', () => {
    expect(phaseStatus(PHASES[0], { ...clean, venue: 'error', details: 'todo' })).toBe('error');
  });

  it('is todo when a member is merely unfinished', () => {
    expect(phaseStatus(PHASES[0], { ...clean, details: 'todo' })).toBe('todo');
  });

  it('ignores Coupons entirely', () => {
    // It is not a `StepId`, contributes no validation, and can never block a
    // publish — so a phase cannot be held back by it, and a missing status
    // entry for it must not make the whole phase `todo` by accident.
    expect(phaseStatus(PHASES[0], clean)).toBe('done');
  });
});

describe('anchors', () => {
  it('gives every member a distinct id for Review to scroll to', () => {
    // Review's checklist jumps to the exact form; a phase holds five of them,
    // so a shared or missing anchor lands somebody at the top of the phase and
    // leaves them to find the field.
    const anchors = PHASES.flatMap((phase) => phase.members).map(memberAnchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });
});
