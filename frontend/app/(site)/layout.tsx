import * as React from 'react';
import { AnnouncementBar } from '@/components/shell/announcement-bar';
import { fetchAnnouncementsSafe, fetchHomepageSafe } from '@/lib/api/cms';
import { browseHref } from '@/lib/discovery/filters';
import { Onboarding } from '@/components/account/onboarding';
import { ReviewPrompt } from '@/components/reviews/review-prompt';
import { CookieConsent } from '@/components/consent/cookie-consent';
import { FavouritesSync } from '@/components/account/favourites-sync';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteBottomNav } from '@/components/shell/site-bottom-nav';
import { SiteHeader } from '@/components/shell/site-header';
import { SearchProvider } from '@/components/search/search-context';
import { LocationProvider } from '@/lib/location/location-context';
import { SOCIAL_HANDLES } from '@/lib/brand';
import { JsonLd, organizationJsonLd } from '@/lib/seo/json-ld';
import { SITE_NAME, SITE_URL } from '@/lib/seo/metadata';

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
import { EventDeckProvider } from '@/lib/discovery/event-deck-context';
import { EventWidgetDeck } from '@/components/event/event-widget-deck';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const announcements = await fetchAnnouncementsSafe('home');
  const cms = await fetchHomepageSafe();
  const terms = (cms?.popular_searches ?? []).map((row) => ({
    label: row.label,
    href: browseHref({ q: row.query }),
  }));

  return (
    <LocationProvider>
      <SearchProvider terms={terms}>
        <EventDeckProvider>
          <JsonLd
            data={organizationJsonLd({
              name: SITE_NAME,
              url: SITE_URL,
              logo: `${SITE_URL}/icon`,
              sameAs: Object.values(SOCIAL_HANDLES).filter(Boolean),
            })}
          />
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-tooltip focus:rounded-full focus:bg-cta focus:px-pill focus:py-2.5 focus:text-label focus:text-cta-foreground focus:shadow-lg"
          >
            Skip to content
          </a>
          <div id="site-shell">
            <div className="flex min-h-dvh flex-col">
              <AnnouncementBar announcements={announcements} />
              <SiteHeader />
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
            <Onboarding />
            <ReviewPrompt />
            <FavouritesSync />
            <EventWidgetDeck />
          </div>
        </EventDeckProvider>
      </SearchProvider>
    </LocationProvider>
  );
}
