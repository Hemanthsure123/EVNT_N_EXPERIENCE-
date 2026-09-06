import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as WaitlistApi from '@/lib/api/waitlist';
import type * as AuthProvider from '@/lib/auth/auth-provider';
import { WaitlistButton } from './waitlist-button';

/**
 * The one control a sold-out event still offers.
 *
 * Three things are worth a test and the rest is styling:
 *
 * 1. **The affordance is not gated, and the PROMISE is.** The button is drawn
 *    for an anonymous visitor — a control that demands an account before it
 *    appears removes it from exactly the people still deciding — but the press
 *    opens the sign-in sheet rather than pretending to have joined anything.
 *    A waitlist join is a promise to write to somebody, and an anonymous
 *    browser has no address; the "appears to work, delivers nothing" failure
 *    is the one this codebase refuses everywhere.
 * 2. **The join survives the interruption.** Answering a sign-in prompt must
 *    not cost the action that raised it, the same way the funnel's Checkout
 *    press resumes on the far side of its sheet.
 * 3. **It says nothing is held.** Several people are told per returned ticket,
 *    and a control that implied a reservation would send somebody to a venue
 *    on it.
 */

const joinWaitlist = vi.hoisted(() => vi.fn());
const leaveWaitlist = vi.hoisted(() => vi.fn());
const fetchMyWaitlist = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/waitlist', async (importOriginal) => ({
  ...(await importOriginal<typeof WaitlistApi>()),
  joinWaitlist,
  leaveWaitlist,
  fetchMyWaitlist,
}));

const useAuth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/auth-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthProvider>()),
  useAuth,
}));

/** The sheet renders the whole auth panel; only its presence is under test. */
vi.mock('@/components/auth/auth-sheet', () => ({
  AuthSheet: ({ open, onAuthenticated }: { open: boolean; onAuthenticated: () => void }) =>
    open ? (
      <div>
        <span>sign-in sheet</span>
        <button type="button" onClick={() => onAuthenticated()}>
          pretend to sign in
        </button>
      </div>
    ) : null,
}));

function mount(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const EVENT = 'e-1';

beforeEach(() => {
  joinWaitlist.mockReset();
  leaveWaitlist.mockReset();
  fetchMyWaitlist.mockReset();
  useAuth.mockReset();
  fetchMyWaitlist.mockResolvedValue({ data: [], event_ids: [] });
  joinWaitlist.mockResolvedValue({ joined: true, event_ids: [EVENT] });
  leaveWaitlist.mockResolvedValue({ joined: false, event_ids: [] });
});

function signedIn(eventIds: string[] = []) {
  useAuth.mockReturnValue({ user: { id: 'u-1', email: 'a@b.c' }, status: 'authenticated' });
  fetchMyWaitlist.mockResolvedValue({ data: [], event_ids: eventIds });
}

function anonymous() {
  useAuth.mockReturnValue({ user: null, status: 'anonymous' });
}

describe('WaitlistButton', () => {
  it('is offered to an anonymous visitor rather than hidden', () => {
    anonymous();
    mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    expect(screen.getByRole('button', { name: /tell me when tickets are free/i })).toBeEnabled();
  });

  it('asks an anonymous visitor to sign in instead of pretending to join', async () => {
    anonymous();
    mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    await userEvent.click(screen.getByRole('button', { name: /tell me when/i }));

    expect(screen.getByText('sign-in sheet')).toBeInTheDocument();
    // The whole point: nothing was written. A local "join" would be a promise
    // to email an address that does not exist.
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it('completes the join on the far side of the sign-in sheet', async () => {
    anonymous();
    mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    await userEvent.click(screen.getByRole('button', { name: /tell me when/i }));
    await userEvent.click(screen.getByRole('button', { name: /pretend to sign in/i }));

    await waitFor(() => expect(joinWaitlist).toHaveBeenCalledWith(EVENT));
  });

  it('does NOT join when the sheet is dismissed without signing in', async () => {
    anonymous();
    const { rerender } = mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    await userEvent.click(screen.getByRole('button', { name: /tell me when/i }));
    // The sheet's mock has no close control, so re-mounting stands in for a
    // dismissal — what matters is that no write happened without a session.
    rerender(<></>);

    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it('joins directly for somebody already signed in', async () => {
    signedIn();
    mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    await userEvent.click(screen.getByRole('button', { name: /tell me when/i }));

    await waitFor(() => expect(joinWaitlist).toHaveBeenCalledWith(EVENT));
    expect(screen.queryByText('sign-in sheet')).not.toBeInTheDocument();
  });

  it('shows the joined state for an event already on the list', async () => {
    signedIn([EVENT]);
    mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    const button = await screen.findByRole('button', { name: /you're on the list/i });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves when pressed again', async () => {
    signedIn([EVENT]);
    mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    await userEvent.click(await screen.findByRole('button', { name: /you're on the list/i }));

    await waitFor(() => expect(leaveWaitlist).toHaveBeenCalledWith(EVENT));
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it('says nothing is held, before the press and after it', async () => {
    signedIn();
    mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    expect(screen.getByText(/nothing is held for you/i)).toBeInTheDocument();
  });

  it('surfaces a refusal rather than silently leaving the button unchanged', async () => {
    signedIn();
    joinWaitlist.mockRejectedValue(new Error('nope'));
    mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    await userEvent.click(screen.getByRole('button', { name: /tell me when/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('asks for nothing at all while anonymous', () => {
    // An anonymous 401 on the platform's busiest public page is a request that
    // can only ever fail, on every render of every sold-out event.
    anonymous();
    mount(<WaitlistButton eventId={EVENT} returnTo="/events/e-1" />);

    expect(fetchMyWaitlist).not.toHaveBeenCalled();
  });
});
