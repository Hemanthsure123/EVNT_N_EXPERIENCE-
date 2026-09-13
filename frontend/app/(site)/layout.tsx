import * as React from 'react';
import { SkipToContent } from '@/components/shell/skip-to-content';
import { AnnouncementBar } from '@/components/shell/announcement-bar';
import { fetchAnnouncementsSafe, fetchHomepageSafe } from '@/lib/api/cms';
import { browseHref } from '@/lib/discovery/filters';
import { Onboarding } from '@/components/account/onboarding';
import { ReviewPrompt } from '@/components/reviews/review-prompt';
import { CookieConsent } from '@/components/consent/cookie-consent';
import { FavouritesSync } from '@/components/account/favourites-sync';
import { BOTTOM_NAV_CLEARANCE } from '@/components/shell/bottom-nav';
import { cn } from '@/lib/utils/cn';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteBottomNav } from '@/components/shell/site-bottom-nav';
import { SiteHeader } from '@/components/shell/site-header';
import { DiscoveryProviders } from '@/components/discovery/discovery-providers';
import { SOCIAL_HANDLES } from '@/lib/brand';
import { JsonLd, organizationJsonLd } from '@/lib/seo/json-ld';
import { SITE_NAME, SITE_URL } from '@/lib/seo/metadata';

/**
 * The public discovery shell. Everything under it is browsable WITHOUT an
 * account — there is no auth gate anywhere in this layout, by design; sign-in
 * arrives with the booking flow and gates checkout, not browsing.
 *
 * The always-mounted client state — the shared location (city switcher <->
 * "trending near you"), the shared search overlay (header, hero and ⌘K all
 * drive one instance, code-split until first opened) and the mobile event deck
 * — is `DiscoveryProviders`. It is a component rather than three nested
 * providers written out here because the organizer dashboard renders the same
 * landing page at `/dashboard/home`, and a second hand-assembled stack is how
 * one of them ends up missing a provider.
 */

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const announcements = await fetchAnnouncementsSafe('home');
  const cms = await fetchHomepageSafe();
  const terms = (cms?.popular_searches ?? []).map((row) => ({
    label: row.label,
    href: browseHref({ q: row.query }),
  }));

  return (
    <>
      <JsonLd
        data={organizationJsonLd({
          name: SITE_NAME,
          url: SITE_URL,
          logo: `${SITE_URL}/icon`,
          sameAs: Object.values(SOCIAL_HANDLES).filter(Boolean),
        })}
      />
      {/* OUTSIDE the providers' `#site-shell` wrapper, deliberately: an open
          overlay hides that subtree from assistive technology, and the skip
          link is the one control that has to survive it. */}
      <SkipToContent targetId="main" />

      <DiscoveryProviders terms={terms}>
        <div className="flex min-h-dvh flex-col">
          <AnnouncementBar announcements={announcements} />
          <SiteHeader />
          <main id="main" className={cn('flex-1', BOTTOM_NAV_CLEARANCE)}>
            {children}
          </main>
          <SiteFooter className={BOTTOM_NAV_CLEARANCE} />
        </div>
        <SiteBottomNav />
        <CookieConsent />
        <Onboarding />
        <ReviewPrompt />
        <FavouritesSync />
      </DiscoveryProviders>
    </>
  );
}
