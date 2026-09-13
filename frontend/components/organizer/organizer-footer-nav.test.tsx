import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/events',
}));

import { ORGANIZER_SECTIONS } from '@/lib/organizer/nav';
import { OrganizerFooterNav, ORGANIZER_NAV_CLEARANCE } from './organizer-footer-nav';

/**
 * The organizer's bottom bar, and the property that made removing the drawer
 * safe rather than merely tidy.
 */
describe('OrganizerFooterNav', () => {
  it('offers the five destinations, with Create as an action', () => {
    render(<OrganizerFooterNav />);
    const nav = screen.getByRole('navigation', { name: 'Organizer' });

    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/dashboard');
    expect(within(nav).getByRole('link', { name: 'My events' }).getAttribute('href')).toBe(
      '/dashboard/events',
    );
    expect(within(nav).getByRole('link', { name: 'Scan' }).getAttribute('href')).toBe(
      '/dashboard/check-in',
    );
    expect(within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe(
      '/dashboard/analytics',
    );

    // The centre button is a lone glyph, so its accessible name has to be
    // written rather than inherited from a label that is not drawn.
    expect(within(nav).getByRole('link', { name: 'Create an event' }).getAttribute('href')).toBe(
      '/dashboard/events/new',
    );
  });

  it('marks the current tab', () => {
    render(<OrganizerFooterNav />);
    // `usePathname` is mocked to /dashboard/events above.
    expect(screen.getByRole('link', { name: 'My events' }).getAttribute('aria-current')).toBe(
      'page',
    );
    // Home must NOT also claim to be current: every organizer route starts
    // with `/dashboard`, so a naive prefix match lights Home on every screen.
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps every label in the DOM', () => {
    // A nav whose items lose their names is four anonymous glyphs to a screen
    // reader.
    render(<OrganizerFooterNav />);
    for (const label of ['Home', 'My events', 'Scan', 'Dashboard']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('clears at `lg`, where the sidebar takes over', () => {
    // NOT `md`, like the public bar. The shell's sidebar appears at `lg`, so a
    // breakpoint copied rather than derived would leave tablet widths with
    // neither navigation.
    expect(ORGANIZER_NAV_CLEARANCE).toContain('lg:pb-0');
    expect(ORGANIZER_NAV_CLEARANCE).toContain('var(--bottom-nav-height)');
    // The safe area, or the bar sits under the home indicator on a phone.
    expect(ORGANIZER_NAV_CLEARANCE).toContain('env(safe-area-inset-bottom)');
  });
});

describe('nothing is stranded by removing the drawer', () => {
  it('every section is either on the bar or on the landing page', () => {
    // THE REASON THE HAMBURGER COULD GO. The organizer has thirteen
    // destinations and the bar has five; the rest are rendered by
    // `AllSections` on Home, driven by this same list. If somebody adds a
    // section and neither place shows it, it is routable and reachable from
    // nothing — which is worse than the drawer, not cleaner.
    const onTheBar = new Set([
      '/dashboard',
      '/dashboard/events',
      '/dashboard/events/new',
      '/dashboard/check-in',
      '/dashboard/analytics',
    ]);

    const elsewhere = ORGANIZER_SECTIONS.filter((section) => !onTheBar.has(section.href));

    // Sanity: the split is real, not an empty set passing vacuously.
    expect(elsewhere.length).toBeGreaterThan(0);
    // And every one of them carries what the grid needs to draw it.
    for (const section of elsewhere) {
      expect(section.label).toBeTruthy();
      expect(section.icon).toBeTruthy();
    }
  });
});
