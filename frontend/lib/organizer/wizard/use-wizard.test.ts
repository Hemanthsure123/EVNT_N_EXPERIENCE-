import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { createEvent } from '@/lib/api/organizer-writes';
import { draftStorageKey } from './model';
import { useWizard } from './use-wizard';

/**
 * The save engine's unstick paths.
 *
 * The bug this suite exists for: a draft could be COMPLETE but never CREATED —
 * every required field present, `eventId` null — because the tab closed inside
 * the autosave delay, or the one flush that ran failed. Re-opening the Studio
 * restored it faithfully and then never scheduled a save: edits schedule one,
 * but re-opening is not an edit, and Review's Submit (the only other flush
 * trigger) was disabled BY the "has not been saved yet" blocker. A dead end
 * with nothing on screen failing.
 */

vi.mock('@/lib/api/organizer-writes', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  createTicketType: vi.fn(),
  updateTicketType: vi.fn(),
  uploadPoster: vi.fn(),
  publishEvent: vi.fn(),
}));

const mockCreate = vi.mocked(createEvent);

/** Past the 1200ms autosave delay. */
const AUTOSAVE_WAIT_MS = 1300;
/** Past the 4000ms single-retry backoff. */
const RETRY_WAIT_MS = 4100;

/** A stored draft that is creatable the moment it is restored. */
const COMPLETE_DRAFT = {
  eventId: null,
  version: 1,
  organizationId: 'org-1',
  title: 'Summer Sessions',
  venue: 'Phoenix Arena',
  city: 'Mumbai',
  // Far future, so `canCreate` holds regardless of when the suite runs.
  startsAt: '2030-01-01T19:00',
};

function mount() {
  return renderHook(() =>
    useWizard({ userId: 'user-1', organizationIds: ['org-1'], ready: true }),
  );
}

describe('useWizard save engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.setItem(draftStorageKey('user-1'), JSON.stringify(COMPLETE_DRAFT));
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('schedules a save for a restored draft that is creatable but was never created', async () => {
    mockCreate.mockResolvedValue({ id: 'evt-1', version: 1 } as never);
    const { result } = mount();

    // Restored as local-only: the fields are all there, the event is not.
    expect(result.current.hydrated).toBe(true);
    expect(result.current.draft.eventId).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
    });

    // The hydrate pass owed this draft a save, and paid it — no edit needed.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.current.draft.eventId).toBe('evt-1');
    expect(result.current.state).toBe('saved');
  });

  it('retries ONCE with backoff after a network-ish failure, then succeeds', async () => {
    mockCreate
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ id: 'evt-1', version: 1 } as never);
    const { result } = mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
    });
    // The request never arrived; the draft is held locally, not errored.
    expect(result.current.state).toBe('offline');
    expect(result.current.draft.eventId).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_WAIT_MS);
    });
    // The armed retry ran and landed the create — no keystroke required.
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.current.draft.eventId).toBe('evt-1');
    expect(result.current.state).toBe('saved');
  });

  it('retries a single time, never a loop', async () => {
    mockCreate.mockRejectedValue(new TypeError('fetch failed'));
    const { result } = mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_WAIT_MS);
    });
    await act(async () => {
      // Well past any further backoff — nothing else may fire.
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('offline');
  });

  it('shows a server refusal as an error and does NOT retry it', async () => {
    // The server ANSWERED and said no — the same request would get the same
    // refusal, so retrying is noise. The message is surfaced instead.
    mockCreate.mockRejectedValue(new ApiError(400, 'invalid_input', 'That start time has passed.'));
    const { result } = mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('That start time has passed.');
  });

  it('does not schedule anything for a restored draft that already exists on the server', async () => {
    window.localStorage.setItem(
      draftStorageKey('user-1'),
      JSON.stringify({ ...COMPLETE_DRAFT, eventId: 'evt-9', version: 3 }),
    );
    const { result } = mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // Saved is saved — no create, no patch, no busywork on open.
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.current.state).toBe('saved');
  });
});
