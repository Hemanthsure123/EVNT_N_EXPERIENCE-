'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, CalendarDays, Home, Plus, QrCode } from 'lucide-react';
import { isActive } from '@/components/shell/bottom-nav';
import { cn } from '@/lib/utils/cn';

/**
 * THE ORGANIZER'S BOTTOM NAVIGATION — and the reason the drawer could go.
 *
 * ── WHY NOT REUSE `BottomNav` ────────────────────────────────────────────
 *
 * The public one is a pill of equal items. This has a RAISED CENTRE BUTTON,
 * which is not a variant of "one more item": it breaks the row into two
 * halves, sits outside the bar's own bounds, and is the only control here
 * that is an action rather than a destination. Bending the shared component
 * into both shapes would leave every caller paying for a branch it does not
 * use.
 *
 * What IS shared is the part that must not drift: `isActive` decides the
 * current tab identically on both bars, and the glass surface, the butter
 * active pill and the floating inset are the same design-system pieces. Two
 * navigations that mark the current page differently is the drift this avoids.
 *
 * ── FIVE ITEMS, AND WHAT EACH ONE MEANS ──────────────────────────────────
 *
 * Home and Dashboard are NOT the same destination, which is the one mapping
 * worth writing down: Home is the landing — what needs attention, what
 * happened today, what is next — and Dashboard is the numbers, which is a
 * different question asked at a different moment.
 *
 * ── BELOW `lg`, MATCHING THE SIDEBAR IT REPLACES ─────────────────────────
 *
 * The shell's sidebar appears at `lg`, so this hides at `lg` — not at `md`,
 * like the public bar. A breakpoint copied rather than derived would leave
 * tablet widths between 768px and 1024px with neither navigation, which is the
 * kind of gap nobody finds until somebody opens the dashboard on an iPad.
 */

/** Clearance for the organizer's own bar. It is NOT `BOTTOM_NAV_CLEARANCE`:
 *  that one clears at `md`, and this bar is on screen until `lg`. */
export const ORGANIZER_NAV_CLEARANCE =
  'pb-[calc(var(--bottom-nav-height)_+_env(safe-area-inset-bottom)_+_1.5rem)] lg:pb-0';

/**
 * Where a FLOATING bar must sit so it clears this one.
 *
 * `BulkBar` is `fixed bottom-4` at `z-sticky` — the same corner and the same
 * layer this bar took when it replaced the drawer, so a bulk selection landed
 * underneath the navigation with the nav painting over it (later in the DOM
 * wins on equal z). Derived from the same custom property as the clearance
 * above rather than written out a second time.
 */
export const ORGANIZER_NAV_OFFSET =
  'bottom-[calc(var(--bottom-nav-height)_+_env(safe-area-inset-bottom)_+_1.5rem)] lg:bottom-4';

/** How far the bar floats off the bottom edge. */
const FLOAT_GAP = '0.75rem';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /**
   * Match the path EXACTLY rather than as a prefix.
   *
   * `isActive` special-cases `'/'` because the public home is a prefix of
   * every other public route. `/dashboard` is exactly that problem one level
   * down — without this, Home is marked current on Events, on Scan, on every
   * organizer screen there is, and the bar stops answering the only question
   * it exists to answer. A test pins it, because it looks right until you
   * navigate.
   */
  exact?: boolean;
};

const LEFT: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: <Home className="size-5" />, exact: true },
  { href: '/dashboard/events', label: 'My events', icon: <CalendarDays className="size-5" /> },
];

const RIGHT: NavItem[] = [
  { href: '/dashboard/check-in', label: 'Scan', icon: <QrCode className="size-5" /> },
  { href: '/dashboard/analytics', label: 'Dashboard', icon: <BarChart3 className="size-5" /> },
];

export function OrganizerFooterNav({ className }: { className?: string }) {
  const pathname = usePathname() ?? '';

  return (
    <div
      className={cn(
        // `pointer-events-none` on the positioner and `auto` on the bar: the
        // gap either side of a floating pill must not swallow presses aimed at
        // the page behind it.
        'pointer-events-none fixed inset-x-0 z-sticky flex justify-center px-4 lg:hidden',
        className,
      )}
      style={{ bottom: `calc(${FLOAT_GAP} + env(safe-area-inset-bottom))` }}
    >
      <nav
        aria-label="Organizer"
        className={cn(
          // `glass` is the shared surface — `backdrop-blur` over a
          // semi-transparent ground, with its own fallback for browsers that
          // cannot blur. Not a hand-rolled rgba, so the two bars stay one
          // material.
          'glass pointer-events-auto flex w-full max-w-sm items-center justify-between',
          'rounded-full border px-2 shadow-lg',
        )}
      >
        {LEFT.map((item) => (
          <Tab key={item.href} item={item} pathname={pathname} />
        ))}

        {/* ── THE ACTION, NOT A DESTINATION ──────────────────────────────
            Raised out of the bar so it reads as the primary thing you can do
            here rather than the third of five places you can go. It keeps a
            real `aria-label` because a lone glyph has no accessible name, and
            "Create" is what it does — the plus is the picture of that. */}
        <Link
          href="/dashboard/events/new"
          aria-label="Create an event"
          className={cn(
            'group/create -translate-y-4 inline-flex size-14 shrink-0 items-center justify-center rounded-full',
            'bg-cta text-cta-foreground shadow-lg ring-4 ring-background',
            // A spring on press rather than a fade: the button is round and
            // raised, so scale is the motion that matches its shape.
            'transition-transform duration-fast ease-spring',
            'hover:scale-105 active:scale-95',
            'motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        >
          <Plus className="size-6" aria-hidden />
        </Link>

        {RIGHT.map((item) => (
          <Tab key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
    </div>
  );
}

/**
 * One destination.
 *
 * The label stays in the DOM at every width — a nav whose items lose their
 * names is four anonymous glyphs to a screen reader. It is the ACTIVE tab that
 * wears the butter pill, the same mark the public bar and the sidebar use, so
 * "where am I" is answered the same way everywhere and survives greyscale.
 */
function Tab({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.exact ? pathname === item.href : isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-2 text-caption',
        'transition-colors duration-fast motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'text-nav-active-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex items-center justify-center rounded-full px-3 py-0.5',
          'transition-colors duration-fast motion-reduce:transition-none',
          active ? 'bg-nav-active' : 'bg-transparent',
        )}
      >
        {item.icon}
      </span>
      <span className="max-w-full truncate">{item.label}</span>
    </Link>
  );
}
