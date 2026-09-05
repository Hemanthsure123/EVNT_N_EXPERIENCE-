import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewStep } from './review';
import { emptyDraft } from '@/lib/organizer/wizard/model';

/**
 * Whether Review offers a Submit button.
 *
 * The backend accepts a submission from `draft` and `rejected` and answers
 * every other status with `InvalidEventStateError`. Before the edit route
 * existed that could not happen — the wizard only ever held an event it had
 * just created — so the button was unconditional.
 *
 * Editing changed that, and an unconditional Submit on a live event is a
 * control whose entire job is to fail. This file is the guard: it is the kind
 * of regression that reappears the moment somebody simplifies the prop away,
 * and it is invisible until an organizer presses it on a selling event.
 *
 * Rendering only — no snapshots, no styling assertions. The question is
 * whether the control is offered.
 */

const props = {
  draft: emptyDraft('org-1'),
  issues: [],
  onJump: vi.fn(),
  onPublish: vi.fn(),
  publishing: false,
  publishError: null,
  organizationName: 'Blue Door Presents',
  organizations: [{ id: 'org-1', name: 'Blue Door Presents', verified_level: 'verified' }],
  saveState: 'saved' as const,
  saveError: null,
  onSaveNow: vi.fn(),
};

const submitButton = () => screen.queryByRole('button', { name: /submit for approval/i });

describe('ReviewStep decides whether submitting is a real action', () => {
  it('offers Submit while creating, where no status exists yet', () => {
    render(<ReviewStep {...props} />);
    expect(submitButton()).not.toBeNull();
  });

  it('offers Submit on a draft', () => {
    render(<ReviewStep {...props} eventStatus="draft" />);
    expect(submitButton()).not.toBeNull();
  });

  it('offers Submit on a rejected event, which is how it gets fixed and resent', () => {
    render(<ReviewStep {...props} eventStatus="rejected" />);
    expect(submitButton()).not.toBeNull();
  });

  it('offers NO Submit on a live event', () => {
    // The server would refuse it every time.
    render(<ReviewStep {...props} eventStatus="live" />);
    expect(submitButton()).toBeNull();
  });

  it('offers no Submit while an event is already awaiting review', () => {
    // Pressing it would be a second submission of something already queued.
    render(<ReviewStep {...props} eventStatus="pending_review" />);
    expect(submitButton()).toBeNull();
  });

  it('says changes are saved automatically instead of leaving the step blank', () => {
    // Removing the button must not leave an organizer wondering how their edit
    // is meant to take effect.
    render(<ReviewStep {...props} eventStatus="live" />);
    expect(screen.getByText(/saved automatically/i)).toBeTruthy();
  });

  it('still shows the readiness checklist on a live event', () => {
    // "Is this event actually complete" stays a useful question long after it
    // went on sale, so only the ACTION is withdrawn, not the review.
    render(<ReviewStep {...props} eventStatus="live" />);
    expect(screen.getByText(/checklist/i)).toBeTruthy();
  });
});
