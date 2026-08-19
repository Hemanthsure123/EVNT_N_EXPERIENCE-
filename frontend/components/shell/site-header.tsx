'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { AccountControl } from '@/components/auth/account-control';
import { CitySwitcher } from '@/components/discovery/city-switcher';
import { HeaderSearchTrigger } from '@/components/search/search-trigger';
import { CategoriesMenu } from './categories-menu';
import { Header } from './header';
import { NavLink, NavRail } from './nav-rail';
import { ThemeToggle } from './theme-toggle';

/**
 * The discovery shell's header.
 *
 * ── TWO ROWS, AND THE SPLIT IS THE POINT ──────────────────────────────────
 *
 * Row one is IDENTITY AND PLACE: the wordmark, where you are (the city
 * switcher), where you can go (the nav), and who you are (the account
 * control). Row two is one thing — the search field — full width.
 *
 * The single-row header this replaces had all five competing for ~1232px, and
 * the search field was the loser every time: it was squeezed to ~240px at
 * `lg`, hidden behind an icon below that, and its rolling suggestions were
 * invisible at the widths most people browse at. Search is the primary way
 * into a catalogue of thousands of events. Giving it its own full-bleed row
 * costs 56px of vertical space and ends the width fight permanently — the nav
 * no longer has to thin out by breakpoint to make room for it, so every
 * destination is visible at every desktop width instead of disappearing one by
 * one on the way down.
 *
 * ── BOTH ROWS STAY ────────────────────────────────────────────────────────
 *
 * The reference hides its nav row on scroll and docks the search field alone.
 * That was built and then taken back out: this row also carries the ACCOUNT
 * CONTROL, so collapsing it left a signed-in visitor with no route to their
 * tickets or sign-out until they scrolled back up. The row condenses instead
 * (`h-header-lg` -> `h-header`) — see the note in `header.tsx`.
 *
 * ── THE NAV HOLDS DESTINATIONS ONLY ───────────────────────────────────────
 *
 * Routes with their own URL, so the active item is derived from
 * `usePathname()` alone. Filters ("this weekend", "free") are query params on
 * `/events` and live in the home page's chip row and the browse toolbar;
 * telling them apart in the nav would need `useSearchParams`, which opts every
 * static page in this layout out of prerendering.
 *
 * These are OUR four destinations, and there are four of them because that is
 * how many the product has. The reference design's bar carries seven — Dining,
 * Movies, Stores, Play — because that company sells seven things. Copying the
 * shape of a nav is a design decision; copying its contents would be shipping
 * links to pages that do not exist.
 *
 * ── HOME IS THE LOGO, NOT A PILL ──────────────────────────────────────────
 *
 * A "Home" item beside a wordmark that already links home spends the most
 * valuable slot in the bar on the one destination nobody needs help finding.
 *
 * Below `md` the nav is gone entirely and `SiteBottomNav` carries the same
 * destinations under the thumb — which is why there is no hamburger: it would
 * open a menu duplicating a bar already on screen.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? '/';

  return (
    <Header
      nav={
        <>
          {/* WHERE YOU ARE, beside the brand and separated from it by a
              hairline — the reference's arrangement, and the right one: the
              city scopes everything the nav then leads to, so it reads before
              the destinations rather than sitting among them as a fifth. */}
          <span className="mx-1 hidden h-8 w-px shrink-0 bg-border lg:mx-2 lg:block" aria-hidden />
          {/* From `lg` only. The city scopes what the nav leads to, so it reads
              before the destinations — but at 768px the row is brand + divider
              + city + four pills + two controls, which is over budget and was
              measured overflowing. Below `lg` the city is still one tap away on
              `/cities` and in the bottom nav. */}
          <CitySwitcher className="hidden lg:flex" />

          <NavRail activeKey={pathname} className="ml-1 hidden md:flex lg:ml-3">
            <NavLink
              href="/events"
              active={pathname === '/events' || pathname.startsWith('/events/')}
            >
              Events
            </NavLink>
            <CategoriesMenu active={pathname.startsWith('/categories')} />
            {/* ── THE WIDTH LADDER ────────────────────────────────────────
                Two rows bought the search field its own full-width row, and
                that is most of the budget problem solved — but 768px is still
                768px. `Cities` joins at `lg`, which is exactly the width the
                measurement showed the row fitting at. Everything hidden here
                is in the bottom nav under the thumb. */}
            <NavLink
              href="/cities"
              active={pathname.startsWith('/cities')}
              className="hidden lg:inline-flex"
            >
              Cities
            </NavLink>
            {/* Survives every width: somebody hiring a band for a wedding is
                not browsing events, and burying the second PRODUCT would be a
                business decision dressed up as a layout one. */}
            <NavLink href="/hire" active={pathname.startsWith('/hire')}>
              Hire a band
            </NavLink>
          </NavRail>
        </>
      }
      /**
       * The full-width field, on every width. The compact icon trigger that
       * used to stand in for it below `lg` is gone with the width fight that
       * created it — one search affordance, one shape, everywhere.
       */
      belowBar={<HeaderSearchTrigger />}
      actions={
        <>
          <ThemeToggle />
          {/* Last, in the corner with the most weight: signing in is the one
              action in this group somebody is trying to COMPLETE, where the
              theme is a preference they set once. */}
          <AccountControl />
        </>
      }
    />
  );
}
