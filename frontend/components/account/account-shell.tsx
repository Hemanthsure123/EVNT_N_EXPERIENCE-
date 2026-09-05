'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bookmark,
  Building2,
  Loader2,
  Settings,
  Ticket,
  User as UserIcon,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-provider';
import { cn } from '@/lib/utils/cn';

/**
 * The profile application's frame.
 *
 * ── IT IS AN APPLICATION, NOT A FORM ──────────────────────────────────────
 *
 * Same shell grammar as the organizer and admin surfaces — a rail of
 * destinations beside one content column — so a person moving between their
 * tickets and their dashboard never crosses a design boundary. Design system
 * §12.1: the rail holds destinations, filters live in the content.
 *
 * ── ONLY DESTINATIONS THAT EXIST ──────────────────────────────────────────
 *
 * The brief asked for eighteen sections: Overview, Tickets, Saved, Wishlist,
 * Upcoming, Past, Orders, Refunds, Invoices, Notifications, Security,
 * Connected Accounts, Appearance, Privacy, Language, Support, Delete Account,
 * Activity.
 *
 * Four are built, because four have data:
 *
 *   Overview  — `/auth/me` + `/organizations/`
 *   Tickets   — `/me/tickets`, with Upcoming/Past/Cancelled as views of it
 *   Saved     — `/me/saved-events` when signed in, `lib/discovery/use-favourites`
 *               (device-local) while browsing anonymously
 *   Host      — `/organizations/` + its verification endpoints. Shown to
 *               EVERYONE, not only existing organizers: it is the only way
 *               to become one, so hiding it from people who are not one yet
 *               would hide it from exactly its audience.
 *   Settings  — five sections (profile, appearance, notifications, privacy,
 *               account), each backed by something real, plus the honest state
 *               of everything else. Its own sub-rail lives INSIDE the content
 *               column and its section is a `?section=` param, not a route: it
 *               is one destination with five views, and putting those five in
 *               this rail would make the account nav ten entries deep.
 *
 * The rest need endpoints that do not exist: `apps/accounts` exposes exactly
 * register / login / refresh / logout / me. There is no session list, no
 * connected-accounts table, no notification-preference model, no invoice
 * generator, no delete-account flow. Shipping those as nav entries would be
 * §12.3's dead navigation, and shipping them with invented content would break
 * §13.6. `BACKLOG.md` names the endpoint each one needs.
 *
 * ── THE ACTIVE ITEM IS THE WARM PILL, NOT THE CTA ─────────────────────────
 *
 * `bg-nav-active` (butter/cream, dark ink; a deep warm brown carrying cream in
 * dark theme) is the platform's one "you are here" fill — the same token the
 * site header's nav pill and the account menu's active scope use. It is
 * deliberately NOT `bg-cta`: the near-black pill means "press this to finish
 * something", and a rail of five near-black destinations would put five primary
 * actions on every account screen.
 *
 * Rows are `min-h-control` (44px) and fully rounded in the horizontal mobile
 * scroller, softening to `rounded-xl` in the two-line vertical rail at lg where
 * a capsule around two lines of text reads as a lozenge rather than a tab.
 */

/**
 * `hint` is gone. Each nav item shows its label only.
 *
 * "Overview / Your account at a glance", "Tickets / Upcoming, past and
 * refunded" — five two-line rows whose second line restated the first in more
 * words. A nav is scanned, not read, and the label is already the clearest
 * word available for what it points at.
 */
type Section = { href: string; label: string; icon: LucideIcon };

const SECTIONS: Section[] = [
  { href: '/account', label: 'Overview', icon: UserIcon },
  { href: '/account/tickets', label: 'Tickets', icon: Ticket },
  { href: '/account/saved', label: 'Saved', icon: Bookmark },
  {
    href: '/account/organizer',
    label: 'Host events',
    icon: Building2,
  },
  {
    href: '/account/settings',
    label: 'Settings',
    icon: Settings,
    // Named after the sections that actually exist there, in their rail order
    // (`components/account/settings-sections.ts`) — a hint that promises more
    // than the destination holds is the same defect as a dead nav entry.,
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/account' ? pathname === '/account' : pathname.startsWith(href);
}

/**
 * Settings is the one account screen whose PHONE layout carries this rail's job
 * itself.
 *
 * `components/account/settings-mobile.tsx` opens on the person's own card and
 * then lists rows to their tickets, their saved events, the organiser side and
 * every settings section — so the chip strip above it would be a second,
 * competing set of the same destinations pinned over a screen designed without
 * one. It is hidden BELOW `lg` on that route only; the desktop rail is
 * untouched, and every other account screen keeps the strip at every width
 * because none of them offer another way out.
 */
const RAIL_HIDDEN_ON_PHONE = '/account/settings';

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/account';
  const { status } = useAuth();

  if (status === 'unknown') {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <p className="inline-flex items-center gap-2 text-body-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading your account…
        </p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-stack-lg py-section text-center lg:py-section-lg">
        <h1 className="text-h3 md:text-h2">Sign in to see your account</h1>
        <p className="text-body text-muted-foreground">Tickets, orders and saved events.</p>
        <Link
          href="/sign-in?next=%2Faccount"
          className="mt-stack inline-flex h-control items-center rounded-full bg-cta px-pill-lg text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-cta-active"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-block-lg py-block-lg lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-section-lg lg:py-section">
      {/* STICKY AT EVERY WIDTH. The nav scrolled away with the page, so on a
          long Tickets or Saved list the only way back to another section was
          to scroll the whole page up again. It is a rail, not content — the
          one thing on this screen that should always be reachable.

          It was `lg:sticky` only, which is backwards: the phone is where the
          lists are longest and where scrolling back is most expensive. Below
          `lg` the chip strip pins under the header with its own background,
          because a transparent bar with the list running visibly through it
          is worse than no bar.

          `self-start` matters: a grid item stretches to the row height by
          default, and a full-height item has nothing to stick to. */}
      <nav
        aria-label="Account sections"
        className={cn(
          'sticky top-sticky-top z-sticky -mx-4 min-w-0 self-start border-b border-border bg-background px-4 pt-2 lg:top-sticky-top-lg lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0',
          pathname.startsWith(RAIL_HIDDEN_ON_PHONE) && 'max-lg:hidden',
        )}
      >
        {/* Horizontal below lg, vertical above — the same responsive rail the
            wizard uses, so the pattern is learned once. `-mx-1 px-1` lets the
            focus ring of the first and last chip breathe inside the scroller
            instead of being clipped by `overflow-x-auto`.

            ── AND IT DOES NOT DRAW ITS OWN SCROLLBAR ──────────────────────
            `overflow-x-auto` with no `scrollbar-none` meant this row rendered
            the project's GLOBAL scrollbar styling — `styles/globals.css` sets
            `::-webkit-scrollbar` to `--scrollbar-thickness` (6px) filled with
            `--input`, a mid grey. On a phone that is a thick grey bar directly
            under the tabs, which reads as a broken underline indicator rather
            than as a scroll affordance: the tabs already say which one is
            active with a filled pill, so the bar is saying nothing and looking
            like a mistake.

            `.scrollbar-none` is the project's own utility (tokens.css) and is
            what category-tiles, filter-toolbar, hero-carousel, home-sections
            and marquee all use for exactly this. The row still scrolls; it
            just stops advertising it with a bar nobody can grab on a
            touchscreen anyway. */}
        <ul className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
          {SECTIONS.map((section) => {
            const active = isActive(pathname, section.href);
            return (
              <li key={section.href} className="shrink-0 lg:shrink">
                <Link
                  href={section.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-control w-full items-center gap-2.5 rounded-full px-3.5 py-2 transition-colors duration-fast lg:rounded-xl',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    active
                      ? 'bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <section.icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-label">{section.label}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className="min-w-0">{children}</main>
    </div>
  );
}
