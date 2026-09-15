import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

import { LeaveDashboardGuard, customerViewDestination } from './leave-dashboard-guard';

/**
 * "YOU ARE LEAVING THE ORGANIZER DASHBOARD."
 *
 * The interceptor is a document listener, so a bug in it does not throw — it
 * either lets somebody fall out of the dashboard unasked, or it traps a link
 * that should have just worked. Both halves are pinned.
 */

const ORIGIN = 'http://localhost:3000';

describe('customerViewDestination', () => {
  it('catches the attendee side', () => {
    expect(customerViewDestination('/events/midnight-comedy-1', ORIGIN)).toBe(
      '/events/midnight-comedy-1',
    );
    expect(customerViewDestination('/', ORIGIN)).toBe('/');
    expect(customerViewDestination('/booking/evt?tickets=a:2#top', ORIGIN)).toBe(
      '/booking/evt?tickets=a:2#top',
    );
  });

  it('lets every operator surface through', () => {
    for (const path of ['/dashboard', '/dashboard/events', '/admin', '/admin/users', '/studio/1']) {
      expect(customerViewDestination(path, ORIGIN)).toBeNull();
    }
  });

  it('matches a prefix at a path boundary, not as a substring', () => {
    // `/dashboardish` is not the dashboard. A bare `startsWith` would say it
    // was and let it through unasked.
    expect(customerViewDestination('/dashboardish', ORIGIN)).toBe('/dashboardish');
  });

  it('ignores other origins and non-page schemes', () => {
    expect(customerViewDestination('https://razorpay.com/x', ORIGIN)).toBeNull();
    expect(customerViewDestination('mailto:hello@curatix.in', ORIGIN)).toBeNull();
    expect(customerViewDestination('tel:+911234567890', ORIGIN)).toBeNull();
  });
});

describe('LeaveDashboardGuard', () => {
  // jsdom does not navigate, and logs an error when a click is allowed to try.
  // A BUBBLE-phase listener swallows that after the guard (capture phase) has
  // already made its decision, so it cannot affect what is being tested.
  const swallow = (event: Event) => event.preventDefault();

  beforeEach(() => {
    push.mockReset();
    document.addEventListener('click', swallow);
  });
  afterEach(() => document.removeEventListener('click', swallow));

  function mount(link: React.ReactNode) {
    return render(
      <>
        <LeaveDashboardGuard />
        {link}
      </>,
    );
  }

  it('asks before a link leaves for the customer view', () => {
    mount(<a href="/events/midnight-comedy-1">Midnight Comedy</a>);
    fireEvent.click(screen.getByText('Midnight Comedy'));

    expect(screen.getByRole('dialog', { name: 'Switch to customer view?' })).toBeTruthy();
    expect(
      screen.getByText(/You are leaving the Organizer Dashboard\. Switch to Customer View/),
    ).toBeTruthy();
    // Nothing has navigated yet — the question comes first.
    expect(push).not.toHaveBeenCalled();
  });

  it('switches only when asked to', () => {
    mount(<a href="/events/midnight-comedy-1">Midnight Comedy</a>);
    fireEvent.click(screen.getByText('Midnight Comedy'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch view' }));
    expect(push).toHaveBeenCalledWith('/events/midnight-comedy-1');
  });

  it('stays put on Cancel', () => {
    mount(<a href="/hire">Hire</a>);
    fireEvent.click(screen.getByText('Hire'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never interrupts a dashboard link', () => {
    mount(<a href="/dashboard/events">My events</a>);
    fireEvent.click(screen.getByText('My events'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('respects an explicit open-elsewhere', () => {
    // A new tab does not leave the dashboard, and hijacking a deliberate
    // modifier-click is hostile.
    mount(
      <>
        <a href="/events/a" target="_blank" rel="noreferrer">
          New tab
        </a>
        <a href="/events/b">Modified</a>
      </>,
    );
    fireEvent.click(screen.getByText('New tab'));
    fireEvent.click(screen.getByText('Modified'), { metaKey: true });
    fireEvent.click(screen.getByText('Modified'), { ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves buttons alone, which is how the mobile deck opens', () => {
    // Discovery cards open the event deck from a BUTTON on a phone, in place,
    // with no navigation — the guard must not stand between a tap and the deck.
    const onPress = vi.fn();
    mount(
      <button type="button" onClick={onPress}>
        Open the event
      </button>,
    );
    fireEvent.click(screen.getByText('Open the event'));
    expect(onPress).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
