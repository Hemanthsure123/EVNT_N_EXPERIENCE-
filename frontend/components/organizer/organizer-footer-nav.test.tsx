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

    // THE LANDING PAGE, rendered inside the dashboard. Pointing this at `/`
    // swaps the whole route group, so the attendee's four-tab bar replaces
    // this one — the chrome changing under somebody is the bug this pins.
    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe(
      '/dashboard/home',
    );
    expect(within(nav).getByRole('link', { name: 'My events' }).getAttribute('href')).toBe(
      '/dashboard/events',
    );
    expect(within(nav).getByRole('link', { name: 'Scan' }).getAttribute('href')).toBe(
      '/dashboard/check-in',
    );
    // The organizer's OWN landing, which is where Home used to point. It
    // carries the sections grid, so this tab is what keeps the eight screens
    // the bar has no room for reachable at all.
    expect(within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe(
      '/dashboard',
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
    // Dashboard must NOT also claim to be current: every organizer route
    // starts with `/dashboard`, so a naive prefix match lights it on every
    // screen. Home is `/`, which `isActive` special-cases for the same reason.
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
  });

  it('wears the DEEPER frost, and carries its own elevation', () => {
    // `glass-strong` over `glass`: a 28px blur is affordable on a 384px pill
    // and not on the full-width sticky header, which is why they are two
    // utilities. The `shadow-lg` CLASS must stay off — the utility's rim
    // highlight and drop shadow are one `box-shadow` list, and a Tailwind
    // utility would replace both.
    render(<OrganizerFooterNav />);
    const bar = screen.getByRole('navigation', { name: 'Organizer' });
    const classes = bar.className.split(' ');
    expect(classes).toContain('glass-strong');
    expect(classes).not.toContain('glass');
    expect(classes).not.toContain('shadow-lg');
  });

  it('marks the current tab in VIOLET, not butter', () => {
    // The organizer product's "you are here" colour. The attendee site keeps
    // `--nav-active`; one surface using both is the drift this pins.
    render(<OrganizerFooterNav />);
    const pill = screen.getByRole('link', { name: 'My events' }).querySelector('span[aria-hidden]');
    expect(pill).not.toBeNull();
    const classes = (pill as HTMLElement).className.split(' ');
    expect(classes).toContain('bg-primary');
    expect(classes).toContain('text-primary-foreground');
    expect(classes).not.toContain('bg-nav-active');
  });

  it('crossfades the colours rather than snapping them', () => {
    // Pressing a tab has to read as one object changing state. Without the
    // transition on BOTH the pill and the label, the fill animates and the
    // text does not, which looks like a rendering fault rather than a press.
    render(<OrganizerFooterNav />);
    const tab = screen.getByRole('link', { name: 'Scan' });
    expect(tab.className).toContain('transition-colors');
    expect(tab.className).toContain('duration-slow');
    const pill = tab.querySelector('span[aria-hidden]') as HTMLElement;
    expect(pill.className).toContain('transition-colors');
  });

  it('starts on screen, and moves the raised + with the bar', () => {
    // The transform is on the POSITIONER: the `+` sits outside the pill's
    // bounds, so translating the pill alone would leave the button hovering
    // over the page. Nothing has scrolled here, so it must be showing.
    const { container } = render(<OrganizerFooterNav />);
    const positioner = container.firstElementChild as HTMLElement;
    expect(positioner.className).toContain('translate-y-0');
    expect(positioner.className).toContain('transition-transform');
    // And the plus is INSIDE the element that moves.
    expect(positioner.querySelector('a[aria-label="Create an event"]')).not.toBeNull();
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
