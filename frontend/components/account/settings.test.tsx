import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings screen's structure and its ONE substantive product rule.
 *
 * jsdom has no layout engine, so nothing here asserts a breakpoint — the
 * responsive halves are pure CSS and belong in the e2e viewport pass. What is
 * worth locking in a unit test is the part a screenshot would never catch:
 *
 * - **No fake control.** The Notifications section must contain NO switch and no
 *   checkbox, because there is no notification-preference model to write to. A
 *   toggle that flips, looks saved and changes nothing is the single worst thing
 *   this page could ship, and it is exactly the thing somebody adds later
 *   "for completeness". This test fails when they do.
 * - **Heading order.** The Google Calendar card's heading is an `h3`, so its
 *   POSITION decides whether this page has an axe `heading-order` violation:
 *   above the section's `h2` it is a skipped level, below it is fine. The stub
 *   below mirrors that `h3` deliberately so the assertion is real.
 * - **The nav is a nav, and only the open section is current.** An index (bare
 *   URL) has no current item; a chosen section has exactly one.
 */

const harness = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(harness.search),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({
    user: {
      email: 'asha@example.com',
      full_name: 'Asha Menon',
      email_verified: true,
      date_joined: '2025-03-04T10:00:00Z',
    },
    signOut: vi.fn(async () => {}),
  }),
}));

vi.mock('@/lib/theme/theme-provider', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('@/lib/push/use-push', () => ({
  usePush: () => ({ state: 'off', busy: false, error: null, enable: vi.fn(), disable: vi.fn() }),
}));

vi.mock('@/lib/consent/use-cookie-consent', () => ({
  useCookieConsent: () => ({ preference: 'essential', ready: true, accept: vi.fn() }),
}));

// Mirrors the real card's `h3` — the whole point of the heading-order assertion.
vi.mock('@/components/calendar/google-calendar-card', () => ({
  GoogleCalendarCard: () => (
    <section aria-labelledby="google-calendar-heading">
      <h3 id="google-calendar-heading">Google Calendar</h3>
    </section>
  ),
}));

// Stubbed for its heading level and nothing else: the real one opens an XHR and
// belongs to its own tests.
vi.mock('@/components/account/avatar-upload', () => ({
  AvatarUpload: () => (
    <section aria-labelledby="avatar-heading">
      <h2 id="avatar-heading">Profile picture</h2>
    </section>
  ),
}));

const { AccountSettings } = await import('./settings');

/** Every heading in document order, as levels. */
function headingLevels(): number[] {
  return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((node) =>
    Number(node.tagName.slice(1)),
  );
}

beforeEach(() => {
  harness.search = '';
});

describe('AccountSettings', () => {
  it('shows an index of every section when the URL names none', () => {
    render(<AccountSettings />);
    // Two navs are in the DOM — the rail and the index — and CSS shows exactly
    // one of them at any width, so neither is ever a duplicate landmark on
    // screen. Both list all five sections.
    const navs = screen.getAllByRole('navigation', { name: 'Settings sections' });
    expect(navs).toHaveLength(2);
    const [rail, index] = navs;
    for (const label of ['Profile', 'Appearance', 'Notifications', 'Privacy & data', 'Account']) {
      expect(within(index).getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
    // The INDEX marks nothing current, because on the viewport where it is the
    // visible nav nothing has been chosen yet — an index whose first card
    // claimed to be the current page would be telling the reader they are
    // somewhere they have not gone.
    expect(index.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    // The RAIL does, and correctly: it is only on screen from `lg`, where the
    // column beside it is already rendering the default section.
    expect(rail.querySelector('[aria-current="page"]')).toHaveAttribute(
      'href',
      '/account/settings?section=profile',
    );
  });

  it('marks the open section as the current page, and drops the index', () => {
    harness.search = 'section=privacy';
    render(<AccountSettings />);
    expect(screen.getAllByRole('navigation', { name: 'Settings sections' })).toHaveLength(1);
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/account/settings?section=privacy');
    expect(screen.getByRole('heading', { level: 2, name: 'Privacy & data' })).toBeInTheDocument();
  });

  it('opens a hand-typed section whatever its case, and the default when it is unknown', () => {
    harness.search = 'section=APPEARANCE';
    const view = render(<AccountSettings />);
    expect(screen.getByRole('radiogroup', { name: 'Colour theme' })).toBeInTheDocument();

    view.unmount();
    harness.search = 'section=security';
    render(<AccountSettings />);
    // Treated as absent rather than as an error: the content column falls back
    // to Profile instead of rendering a blank page beside a rail.
    expect(screen.getByRole('heading', { level: 2, name: 'Profile' })).toBeInTheDocument();
  });

  it('offers NO switch or checkbox under Notifications, because nothing would store one', () => {
    harness.search = 'section=notifications';
    render(<AccountSettings />);
    const card = screen.getByRole('region', { name: 'Notifications' });
    expect(within(card).queryByRole('switch')).toBeNull();
    expect(within(card).queryByRole('checkbox')).toBeNull();
    // What it says instead. `notifications` sends to every ticket holder, so
    // this is a statement of fact rather than a preference.
    expect(within(card).getByText('Always sent')).toBeInTheDocument();
  });

  it('lands a Google Calendar callback on the section that renders its outcome', () => {
    harness.search = 'calendar=connected';
    render(<AccountSettings />);
    expect(screen.getByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Google Calendar' })).toBeInTheDocument();
  });

  it('never skips a heading level, in any section', () => {
    for (const section of ['', 'section=profile', 'section=appearance', 'section=account']) {
      harness.search = section;
      const view = render(<AccountSettings />);
      const levels = headingLevels();
      expect(levels[0], `${section || 'index'} must start at h1`).toBe(1);
      for (let index = 1; index < levels.length; index += 1) {
        // The rule axe's `heading-order` enforces: a level may repeat or step
        // down, but may only step UP by one. This is what puts the calendar
        // card's `h3` after the Account card's `h2` rather than before it.
        expect(
          levels[index] - levels[index - 1],
          `${section || 'index'} skips a level: ${levels.join(' → ')}`,
        ).toBeLessThanOrEqual(1);
      }
      view.unmount();
    }
  });
});
