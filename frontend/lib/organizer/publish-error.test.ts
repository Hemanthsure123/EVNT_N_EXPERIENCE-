import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { describePublishFailure } from './publish-error';

/**
 * The refusals a Submit can come back with, and which of them are actually
 * failures.
 *
 * The case worth the test file: an organizer whose event was ALREADY submitted
 * used to get "Only draft or rejected events can be submitted (this one is
 * 'pending_review')" as terminal red text, on the screen where they had just
 * done the right thing. The outcome they pressed for is the outcome they have,
 * so that refusal has to read as done — not as a mistake.
 */
describe('describePublishFailure', () => {
  const api = (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(409, code, message, details);

  it('treats an already-submitted event as done, not as a failure', () => {
    const failure = describePublishFailure(
      api('invalid_event_state', "Only draft or rejected events can be submitted (this one is 'pending_review').", {
        status: 'pending_review',
      }),
    );

    expect(failure.alreadyDone).toBe(true);
    expect(failure.tone).toBe('warning');
    // The organizer is told where their event is, not what the server refused.
    expect(failure.message).toMatch(/already in the review queue/i);
  });

  it('treats an already-live event as done', () => {
    const failure = describePublishFailure(
      api('invalid_event_state', "… (this one is 'live').", { status: 'live' }),
    );

    expect(failure.alreadyDone).toBe(true);
    expect(failure.tone).toBe('warning');
    expect(failure.message).toMatch(/already published/i);
  });

  it('keeps a genuinely wrong transition an error, with the server sentence', () => {
    const sentence = "A 'archived' event cannot be archived. Take it off sale first.";
    const failure = describePublishFailure(api('invalid_event_state', sentence, { status: 'archived' }));

    expect(failure.alreadyDone).toBeUndefined();
    expect(failure.tone).toBe('error');
    expect(failure.message).toBe(sentence);
  });

  it('does not guess when the status is absent', () => {
    // An older backend, or a code raised from a path that sends no details:
    // report it rather than assuming success and navigating away from a draft
    // that never got submitted.
    const failure = describePublishFailure(api('invalid_event_state', 'Refused.'));

    expect(failure.alreadyDone).toBeUndefined();
    expect(failure.tone).toBe('error');
  });

  it('sends an unverified organisation somewhere it can be fixed', () => {
    const failure = describePublishFailure(
      api('organization_not_verified', 'This organisation needs to be verified first.', {
        verified_level: 'none',
      }),
    );

    expect(failure.tone).toBe('error');
    expect(failure.action?.href).toBe('/account/organizer');
    expect(failure.action?.label).toMatch(/get verified/i);
  });

  it('reads a pending verification as waiting, not as a mistake', () => {
    const failure = describePublishFailure(
      api('organization_not_verified', 'Still being verified.', { verified_level: 'pending' }),
    );

    expect(failure.tone).toBe('warning');
    expect(failure.action?.label).toMatch(/check verification status/i);
    // Not alreadyDone: the event is NOT in the queue, so the caller must not
    // navigate away as though it were.
    expect(failure.alreadyDone).toBeUndefined();
  });

  it('jumps to the step that fixes a failed readiness check', () => {
    const failure = describePublishFailure(
      api('event_not_publishable', 'This event needs at least one ticket type.'),
    );

    expect(failure.tone).toBe('error');
    expect(failure.action?.step).toBe('tickets');
  });

  it('offers a reload, never a retry, on a stale version', () => {
    const failure = describePublishFailure(api('stale_event_version', 'Version moved.'));

    expect(failure.tone).toBe('warning');
    expect(failure.action?.label).toBe('Reload');
  });

  it('falls back without inventing an action for an unknown throw', () => {
    expect(describePublishFailure(new Error('boom')).tone).toBe('error');
    expect(describePublishFailure(new Error('boom')).action).toBeUndefined();
  });
});
