'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { AccountControl } from '@/components/auth/account-control';
import { CitySwitcher } from '@/components/discovery/city-switcher';
import { CompactSearchTrigger, HeaderSearchTrigger } from '@/components/search/search-trigger';
import { CategoriesMenu } from './categories-menu';
import { Header } from './header';
import { NavLink, NavRail } from './nav-rail';
import { ThemeToggle } from './theme-toggle';

/**
 * The discovery shell's header.
 *
 * ── THE NAV HOLDS DESTINATIONS ONLY ───────────────────────────────────────
 *
 * Routes with their own URL, so the active item is derived from
 * `usePathname()` alone. Filters ("this weekend", "free") deliberately live in
 * the hero's quick-filter row instead: they are query params on `/events`, and
 * telling them apart in the nav would need `useSearchParams`, which opts every
 * static page in this layout out of prerendering.
 *
 * ── HOME IS THE LOGO, NOT A PILL ──────────────────────────────────────────
 *
 * A "Home" item sitting next to a wordmark that already links home spends the
 * most valuable slot in the bar on the one destination nobody needs help
 * finding. Its removal is what pays for the Categories menu.
 *
 * ── THE WIDTH BUDGET IS THE DESIGN ────────────────────────────────────────
 *
 * The container caps at 1280px, so the widest this row ever gets is ~1232px of
 * usable space — a 1920px monitor buys nothing. Into that go the brand (~140),
 * the nav, a search field, and four controls (~260). The old bar asked for six
 * nav pills AND a 448px search inside it, which needs ~1350px; it was over
 * budget at every width it was ever displayed at, and simply painted the
 * overflow on top of the search field.
 *
 * So items leave the bar as the room does, and each one that leaves is in the
 * Categories menu at exactly the widths it is gone:
 *
 *   md   (768+)   Categories · Hire a band          — search is the icon
 *   lg   (1024+)  + Events                          — search becomes a field
 *   xl   (1280+)  + Cities                          — the full bar
 *
 * "Hire a band" survives all the way down because it is the second PRODUCT,
 * not a filter on the first — somebody hiring a band for a wedding is not
 * browsing events, and burying that is a business decision dressed up as a
 * layout one. Below md the nav is gone entirely and `SiteBottomNav` carries
 * the same destinations under the thumb, which is why there is no hamburger:
 * it would open a menu duplicating the bar already on screen.
 *
 * ── THE ACTIONS ROW HAS EXACTLY ONE COMPLETABLE ACTION ────────────────────
 *
 * Search, city and theme are all things you ADJUST; signing in is the only one
 * you FINISH, which is why it is last and in the corner with the most weight.
 * In the light-first language that means it should be the near-black pill —
 * the product's single primary-action shape. `AccountControl` lives in
 * components/auth and is not this area's to change; see the note at the end of
 * this slice's report.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? '/';

  return (
    <Header
      nav={
        <NavRail activeKey={pathname} className="hidden md:flex">
          <NavLink
            href="/events"
            active={pathname === '/events' || pathname.startsWith('/events/')}
            className="hidden lg:inline-flex"
          >
            Events
          </NavLink>
          <CategoriesMenu active={pathname.startsWith('/categories')} />
          <NavLink
            href="/cities"
            active={pathname.startsWith('/cities')}
            className="hidden xl:inline-flex"
          >
            Cities
          </NavLink>
          <NavLink
            href="/hire"
            active={pathname.startsWith('/hire')}
            className="hidden md:inline-flex"
          >
            Hire a band
          </NavLink>
        </NavRail>
      }
      search={<HeaderSearchTrigger />}
      actions={
        <>
          <CompactSearchTrigger className="lg:hidden" />
          <CitySwitcher />
          <ThemeToggle />
          {/* Last, in the corner with the most weight. Signing in is the one
              action in this group somebody is trying to complete; the theme
              toggle is a preference they set once. */}
          <AccountControl />
        </>
      }
    />
  );
}
