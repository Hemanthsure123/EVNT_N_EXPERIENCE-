'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, CalendarDays, Home, Plus, QrCode } from 'lucide-react';
import { isActive } from '@/components/shell/bottom-nav';
import { useScrollDirection } from '@/lib/utils/use-scroll-direction';
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
 * What IS shared is `isActive`, which decides the current tab identically on
 * both bars. Two navigations that disagree about which page you are on is the
 * drift that avoids.
 *
 * ── HOME LEAVES THE DASHBOARD, AND `Dashboard` IS WHERE IT USED TO GO ────
 *
 * Home is `/` — the public landing page — at the owner's instruction. That
 * moved a real destination out of the bar, and `/dashboard` is not optional:
 * it is the landing that carries the attention panel, today's figures AND the
 * sections grid, which is the only route to the eight organizer screens this
 * bar has no room for. So `Dashboard` points at `/dashboard` rather than at
 * `/dashboard/analytics`, and analytics is reached from that grid.
 *
 * Without that swap, taking Home off `/dashboard` would have stranded
 * Bookings, Customers, Promotions, Payouts, Refunds, Crew, Reviews, Support
 * and Activity behind no link at all on a phone.
 *
 * ── THE ACTIVE MARK IS VIOLET HERE, AND BUTTER ON THE PUBLIC SITE ────────
 *
 * `bg-primary text-primary-foreground` — the wayfinding violet, which is the
 * same token the filter pills on this dashboard already use for "this one is
 * applied". The attendee site keeps `--nav-active` (the warm butter fill).
 * That is a deliberate split rather than drift: the two products say "you are
 * here" in their own colour, and the organizer surface says it the same way in
 * the sidebar, in this bar and in the wizard's stepper.
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
   * down — without this, Dashboard is marked current on Events, on Scan, on
   * every organizer screen there is, and the bar stops answering the only
   * question it exists to answer. A test pins it, because it looks right until
   * you navigate.
   */
  exact?: boolean;
};

const LEFT: NavItem[] = [
  // THE PUBLIC LANDING PAGE, not the dashboard's own. See the note above.
  { href: '/', label: 'Home', icon: <Home className="size-5" />, exact: true },
  { href: '/dashboard/events', label: 'My events', icon: <CalendarDays className="size-5" /> },
];

const RIGHT: NavItem[] = [
  { href: '/dashboard/check-in', label: 'Scan', icon: <QrCode className="size-5" /> },
  { href: '/dashboard', label: 'Dashboard', icon: <BarChart3 className="size-5" />, exact: true },
];

export function OrganizerFooterNav({ className }: { className?: string }) {
  const pathname = usePathname() ?? '';
  const hidden = useAutoHide();

  return (
    <div
      className={cn(
        // `pointer-events-none` on the positioner and `auto` on the bar: the
        // gap either side of a floating pill must not swallow presses aimed at
        // the page behind it.
        'pointer-events-none fixed inset-x-0 z-sticky flex justify-center px-4 lg:hidden',
        // ── THE AUTO-HIDE ────────────────────────────────────────────────
        //
        // On the POSITIONER, not on the `<nav>`: the raised `+` is a sibling
        // of the bar's items and sits OUTSIDE its bounds, so translating the
        // bar alone would slide the pill away and leave the button hovering
        // over the page. One transform on the parent moves both in lockstep,
        // which is also why it is the parent that owns the transition.
        //
        // `150%`, not `translate-y-full`. "Full" is this element's own height
        // and the button overhangs it — at exactly 100% the plus stays visible
        // as a black semicircle on the bottom edge. The extra half also covers
        // the float gap and the safe-area inset below it.
        'transition-transform duration-slow ease-out motion-reduce:transition-none',
        hidden ? 'translate-y-[150%]' : 'translate-y-0',
        className,
      )}
      style={{ bottom: `calc(${FLOAT_GAP} + env(safe-area-inset-bottom))` }}
      // Hidden from the accessibility tree only while it is off screen, so a
      // screen reader cannot land on a bar the sighted reader cannot see.
      // `inert` would be stronger and is not used: it is still unsupported on
      // enough Safari versions that the attribute would be a no-op exactly
      // where this bar matters most.
      aria-hidden={hidden || undefined}
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
            "Create" is what it does — the plus is the picture of that.

            It is also the ONLY create control on a phone now: the header's
            filled "Create event" button is gone, so this is not a duplicate of
            it — it is the replacement. */}
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
 * SHOULD THE BAR BE OUT OF THE WAY RIGHT NOW?
 *
 * The scroll direction decides it, with two refusals on top — and both are the
 * difference between a bar that gets out of the way and one that disappears
 * when somebody needs it:
 *
 * 1. **Never while focus is inside it.** Tabbing to "Scan" and having the
 *    navigation slide off screen leaves a keyboard or switch user following a
 *    focus ring they cannot see. The document's own `focusin`/`focusout` are
 *    used rather than React's handlers, because the check has to hold for a
 *    focus that arrives while this component is not re-rendering.
 * 2. **Never on a page too short to scroll.** A document that barely exceeds
 *    the viewport can still be pushed past the hook's top zone by an
 *    overscroll bounce, which would hide the navigation on a page nobody
 *    meaningfully scrolled.
 */
function useAutoHide(): boolean {
  const direction = useScrollDirection();
  const [focusWithin, setFocusWithin] = React.useState(false);
  const [scrollable, setScrollable] = React.useState(false);

  React.useEffect(() => {
    const inNav = (node: EventTarget | null) =>
      node instanceof Element && Boolean(node.closest('nav[aria-label="Organizer"]'));

    const onFocusIn = (event: FocusEvent) => setFocusWithin(inNav(event.target));
    const onFocusOut = () => setFocusWithin(false);

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  React.useEffect(() => {
    // Measured on a timer as well as on resize: the organizer's screens grow
    // as their data arrives (a table paints its rows, a deck loads a page), so
    // "is this page scrollable" is not answered once at mount.
    const measure = () =>
      setScrollable(document.documentElement.scrollHeight > window.innerHeight + SCROLL_SLACK);
    measure();
    window.addEventListener('resize', measure);
    const timer = window.setInterval(measure, 1000);
    return () => {
      window.removeEventListener('resize', measure);
      window.clearInterval(timer);
    };
  }, []);

  return direction === 'down' && !focusWithin && scrollable;
}

/** A page must exceed the viewport by more than this before the bar will hide
 *  — roughly the height of the bar itself plus its clearance, so a page with
 *  nothing below the fold never takes its own navigation away. */
const SCROLL_SLACK = 200;

/**
 * One destination.
 *
 * The label stays in the DOM at every width — a nav whose items lose their
 * names is four anonymous glyphs to a screen reader. It is the ACTIVE tab that
 * wears the violet pill, and the colours CROSSFADE rather than snapping: the
 * pill's fill, the icon and the label all run the same transition, so pressing
 * a tab reads as one object changing state instead of three things repainting
 * at once.
 */
function Tab({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.exact ? pathname === item.href : isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-2 text-caption',
        'transition-colors duration-slow ease-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex items-center justify-center rounded-full px-3 py-0.5',
          'transition-colors duration-slow ease-out motion-reduce:transition-none',
          active ? 'bg-primary text-primary-foreground' : 'bg-transparent',
        )}
      >
        {item.icon}
      </span>
      <span className="max-w-full truncate">{item.label}</span>
    </Link>
  );
}
