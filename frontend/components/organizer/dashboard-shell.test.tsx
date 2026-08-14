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
  return render(
    <TopBar onOpenDrawer={vi.fn()} onOpenPalette={vi.fn()} pathname="/dashboard" />,
  );
}

describe('organizer TopBar', () => {
  it('renders with an empty attention list', () => {
    useAttention.mockReturnValue({ items: [], isPending: false, isError: false });

    renderBar();

    expect(screen.getByLabelText('Create event')).toBeInTheDocument();
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
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

    // The create-event action and the bell are SIBLINGS. If the bell is ever
    // nested back inside the `asChild` Button, Slot throws and render() fails
    // before this line — which is precisely the regression being pinned.
    expect(screen.getByLabelText('Notifications, 2 needing attention')).toBeInTheDocument();
    expect(screen.getByLabelText('Create event')).toBeInTheDocument();
  });
});
