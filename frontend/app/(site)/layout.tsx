import * as React from 'react';
import { AnnouncementBar } from '@/components/shell/announcement-bar';
import { fetchAnnouncementsSafe } from '@/lib/api/cms';
import { CookieConsent } from '@/components/consent/cookie-consent';
import { FavouritesSync } from '@/components/account/favourites-sync';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteBottomNav } from '@/components/shell/site-bottom-nav';
import { SiteHeader } from '@/components/shell/site-header';
import { SearchProvider } from '@/components/search/search-context';
import { LocationProvider } from '@/lib/location/location-context';

/**
 * The public discovery shell. Everything under it is browsable WITHOUT an
 * account — there is no auth gate anywhere in this layout, by design; sign-in
 * arrives with the booking flow and gates checkout, not browsing.
 *
 * The two providers are the only always-mounted client state: the shared
 * location (city switcher <-> "trending near you") and the shared search
 * overlay (header, hero and ⌘K all drive one instance, code-split until first
 * opened).
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Server-fetched and ISR'd alongside the homepage. Announcements are the
  // same for every visitor, so they belong in the HTML rather than behind a
  // client request that would land after first paint.
  const announcements = await fetchAnnouncementsSafe('home');
  return (
    <LocationProvider>
      <SearchProvider>
        {/* The first focusable thing on every page, so it wears the product's
            primary action: the near-black pill (near-white in dark), fully
            rounded. `focus:z-tooltip` keeps it above the sticky header — a skip
            link rendered underneath the chrome it skips is not a skip link. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-tooltip focus:rounded-full focus:bg-cta focus:px-pill focus:py-2.5 focus:text-label focus:text-cta-foreground focus:shadow-lg"
        >
          Skip to content
        </a>
        {/* One wrapper around everything the shell renders, so the search
            palette can hide it from assistive tech with a single attribute —
            see the `modal={false}` note in components/search/search-overlay. */}
        <div id="site-shell">
          <div className="flex min-h-dvh flex-col">
            <AnnouncementBar announcements={announcements} />
            <SiteHeader />
            {/* Bottom padding clears the mobile bottom nav — its row height
                (`--bottom-nav-height`, 4rem) PLUS the iOS safe-area inset the
                bar pads itself with, or the last section sits under the home
                indicator. Both halves have to move together; see the note in
                bottom-nav.tsx. */}
            <main
              id="main"
              className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0"
            >
              {children}
            </main>
            <SiteFooter className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0" />
          </div>
          <SiteBottomNav />
          <CookieConsent />
          {/* Renders nothing. Mirrors saved events to the account once signed in,
              and merges whatever was saved while logged out. */}
          <FavouritesSync />
        </div>
      </SearchProvider>
    </LocationProvider>
  );
}
