import * as React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LocationState } from '@/lib/location/use-location';
import { LocationPrompt } from './location-prompt';

/**
 * The location ask.
 *
 * What is worth testing here is entirely about WHEN it appears and what
 * pressing it does to the browser — not how it looks. Three of these guard
 * against the two ways a location prompt goes wrong in the wild: firing the OS
 * permission dialog before the user has agreed to anything, and coming back
 * after being dismissed.
 */

const locationState = vi.hoisted(() => ({ current: {} as Partial<LocationState> }));
const authState = vi.hoisted(() => ({ current: { status: 'anonymous', user: null } as {
  status: string;
  user: { onboarding_completed_at: string | null } | null;
} }));

vi.mock('@/lib/location/location-context', () => ({
  useLocationContext: () => locationState.current,
}));

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => authState.current,
}));

const BASE: Partial<LocationState> = {
  city: null,
  status: 'idle',
  precision: null,
  ready: true,
  dismissed: false,
  detect: vi.fn(),
  setCity: vi.fn(),
  dismiss: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  locationState.current = { ...BASE, detect: vi.fn(), setCity: vi.fn(), dismiss: vi.fn() };
  authState.current = { status: 'anonymous', user: null };
});

afterEach(() => {
  vi.useRealTimers();
});

/** Past the appear delay. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(3000);
  });
}

describe('LocationPrompt', () => {
  it('is not in the first frame', () => {
    // A modal present at first paint is an interstitial: it lands before the
    // visitor has seen anything worth granting a permission FOR, and competes
    // with the LCP element for the same moment.
    render(<LocationPrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('appears after the delay', () => {
    render(<LocationPrompt />);
    settle();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('never calls geolocation just by appearing', () => {
    // THE point of the component. The browser's own prompt fires only from a
    // press, so the order is always: explain, choose, then grant. A site that
    // fires it on load is the fastest route to a permanent block, and a block
    // is not something we can undo.
    render(<LocationPrompt />);
    settle();
    expect(locationState.current.detect).not.toHaveBeenCalled();
  });

  it('detects only when asked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LocationPrompt />);
    settle();

    await user.click(screen.getByRole('button', { name: /use my location/i }));
    expect(locationState.current.detect).toHaveBeenCalledOnce();
  });

  it('stays away once a city is known', () => {
    locationState.current = { ...locationState.current, city: { name: 'Mumbai', slug: 'mumbai' } as never };
    render(<LocationPrompt />);
    settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays away once dismissed', () => {
    locationState.current = { ...locationState.current, dismissed: true };
    render(<LocationPrompt />);
    settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('waits for onboarding rather than stacking on it', () => {
    // A signed-in newcomer is already being asked for their name and photo.
    // Two dialogs at once is how somebody dismisses both without reading
    // either — and this one's dismissal is permanent.
    authState.current = { status: 'authenticated', user: { onboarding_completed_at: null } };
    render(<LocationPrompt />);
    settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes its turn once onboarding is finished', () => {
    authState.current = {
      status: 'authenticated',
      user: { onboarding_completed_at: '2026-08-01T00:00:00Z' },
    };
    render(<LocationPrompt />);
    settle();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers cities instead of a dead button once permission is blocked', async () => {
    // Re-offering "Use my location" after a refusal is a control whose only
    // possible outcome is the same refusal.
    locationState.current = { ...locationState.current, status: 'denied' };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LocationPrompt />);
    settle();

    expect(screen.queryByRole('button', { name: /use my location/i })).not.toBeInTheDocument();
    expect(screen.getByText(/blocked for this site/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mumbai' }));
    expect(locationState.current.setCity).toHaveBeenCalled();
  });

  it('treats closing by any route as a real answer', async () => {
    // Escape, the scrim and "Not now" are the same decision, and it sticks. A
    // dialog that returns next load has been postponed, not dismissed — which
    // is what makes people block the permission outright.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LocationPrompt />);
    settle();

    await user.keyboard('{Escape}');
    expect(locationState.current.dismiss).toHaveBeenCalled();
  });
});
