import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The signed-in header renders. That is the whole test, and it would have
 * caught a production outage.
 *
 * ── WHAT HAPPENED ─────────────────────────────────────────────────────────
 *
 * `<NotificationBell />` was added INSIDE `<Button asChild>`. `asChild` renders
 * through Radix `Slot`, which calls `React.Children.only` — exactly one element
 * child or it throws. Two children threw, the error boundary caught it, and the
 * entire organizer dashboard became "This screen didn't load".
 *
 * Every check missed it for one reason: they were all signed OUT. The shell
 * short-circuits to `SignedOut` before this bar mounts, so the server HTML was
 * clean, every chunk resolved, and an unauthenticated browser probe reported
 * zero console errors — on a screen that was completely broken for every real
 * organizer.
 *
 * Hence this renders the bar DIRECTLY, with a populated bell, which is the
 * exact condition that threw.
 *
 * ── WHAT THE BAR IS NOW ───────────────────────────────────────────────────
 *
 * The breadcrumb, the search button and the filled "Create event" pill are all
 * gone: the brand lockup on the left, the bell and the account menu on the
 * right. The `asChild` Button that caused the outage above went with Create,
 * so the Slot trap is no longer reachable HERE — but the property that test
 * was really pinning (the signed-in bar renders, with data in the bell) is
 * what still matters, and it is what is asserted below.
 */

const useAttention = vi.fn();
vi.mock('@/lib/organizer/attention', () => ({ useAttention: () => useAttention() }));

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ user: { full_name: 'Asha Rao', email: 'asha@example.com' }, signOut: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { TopBar } from './dashboard-shell';

function renderBar() {
  // No props. The bar takes none — it is the brand, the bell and the account.
  return render(<TopBar />);
}

describe('organizer TopBar', () => {
  it('renders with an empty attention list', () => {
    useAttention.mockReturnValue({ items: [], isPending: false, isError: false });

    renderBar();

    expect(screen.getByLabelText('Curatix dashboard')).toBeInTheDocument();
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('carries the brand and NOT the controls that moved', () => {
    // Create lives on the footer bar's raised `+` now, and search was removed
    // outright. Either one reappearing here is the same action offered twice
    // on one screen, which is how neither of them reads as the primary.
    useAttention.mockReturnValue({ items: [], isPending: false, isError: false });

    renderBar();

    expect(screen.queryByLabelText('Create event')).toBeNull();
    expect(screen.queryByLabelText('Search the dashboard')).toBeNull();
    // And the trail it replaced is gone: every screen under this shell carries
    // its own <h1>, so a second copy of the page name here was duplication.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });

  it('renders when attention items arrive — the case that threw in production', () => {
    // Data arriving is what triggered it: the badge is conditional on
    // `count > 0`, so the bar only reached the failing shape once a query
    // resolved with rows. The stack trace was setData -> onSuccess -> render.
    useAttention.mockReturnValue({
      items: [
        { id: 'a', severity: 'critical', title: 'Payout failed', detail: 'x', href: '/x' },
        { id: 'b', severity: 'info', title: 'Event rejected', detail: 'y', href: '/y' },
      ],
      isPending: false,
      isError: false,
    });

    renderBar();

    expect(screen.getByLabelText('Notifications, 2 needing attention')).toBeInTheDocument();
    expect(screen.getByLabelText('Curatix dashboard')).toBeInTheDocument();
  });
});
