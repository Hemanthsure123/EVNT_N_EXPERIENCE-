import * as React from 'react';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AllEvents, AllEventsSkeleton } from '@/components/discovery/all-events';
import { CategoryTiles } from '@/components/discovery/category-tiles';
import { LocationPrompt } from '@/components/discovery/location-prompt';
import { Showcase } from '@/components/discovery/showcase';
import { Section, SectionHeader } from '@/components/discovery/section';
import { SubscribeCard } from '@/components/discovery/subscribe-card';
import { WhyCuratix } from '@/components/discovery/why-curatix';
import { HireABandSection } from '@/components/hire/hire-a-band-section';
import { fetchHomepageSafe } from '@/lib/api/cms';
import { PUBLIC_LIST_REVALIDATE_SECONDS } from '@/lib/api/events';
import { JsonLd, webSiteJsonLd } from '@/lib/seo/json-ld';
import { SITE_NAME, SITE_URL, pageMetadata } from '@/lib/seo/metadata';

/**
 * The landing page.
 *
 * ── RECOMMEND, THEN LIST, THEN NAVIGATE ───────────────────────────────────
 *
 *   hero          ONE event, full width, with its own colour   (recommend)
 *   all events    chips + a poster grid of what is on sale     (list)
 *   categories    eight ways in for somebody with no plan      (navigate)
 *   HIRE A BAND   the second product, its own band             (the other job)
 *   why / signup  the trust argument and the one ask           (last)
 *
 * That order is the whole layout argument. A visitor arrives in one of three
 * states — "show me something good", "show me what's on", "I know roughly what
 * I want" — and each of the first three blocks answers exactly one of them, in
 * descending order of how many people are in that state.
 *
 * ── WHAT CHANGED, AND WHY IT IS NOT A RESTYLE ─────────────────────────────
 *
 * This page used to open on a marquee of five posters and then run more rails
 * under it: featured, then trending, each one the same card doing the same job
 * under a different heading. Repeating a card is how a page gets long without
 * getting more useful — by the second rail nobody reads the heading, so the
 * editorial distinction stops paying for the scroll it costs.
 *
 * There is now ONE recommendation surface (the hero, which commits to a single
 * event and can therefore give it a date, a venue, a price and a CTA) and ONE
 * listing surface (`AllEvents`, a grid with the browse page's own filter
 * vocabulary along the top). `TrendingSection` is gone from this page for that
 * reason: its cards carried urgency badges computed from remaining stock, and
 * `PosterCard` carries the same badge from the same helper — so the rail was
 * showing the same events again under a heading that implied they were
 * different ones.
 *
 * ── STILL STATIC + ISR ────────────────────────────────────────────────────
 *
 * Nothing here is per-visitor (the location prompt swaps on the client), so a
 * CDN serves identical HTML to everyone. The interval matches the backend's
 * own `s-maxage=30` on `GET /events`, so the page, the Next data cache and the
 * edge age on one clock rather than three.
 */
export const revalidate = PUBLIC_LIST_REVALIDATE_SECONDS;

export const metadata: Metadata = {
  ...pageMetadata(
    'Discover live events, or hire a band',
    'Concerts, comedy, workshops, sports and festivals — plus bands, DJs and performers for your own wedding, party or corporate event. No account needed to browse.',
  ),
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  // Server-side, ISR'd and NEVER throws — the hero is the LCP element, and a
  // failing upstream must not take the front page down.
  const cms = await fetchHomepageSafe();

  return (
    <>
      <JsonLd
        data={webSiteJsonLd({
          name: SITE_NAME,
          url: SITE_URL,
          searchUrlTemplate: `${SITE_URL}/events?q={search_term_string}`,
        })}
      />

      {/* ── THE DOCUMENT'S ONE h1, AND IT IS NOT DRAWN ───────────────────
          The reference design has no page heading: the biggest text on the
          first screen is the name of an EVENT, and adding a "Live events in
          India" banner above the hero to satisfy an outline would be chrome
          nobody asked for on the screen that decides whether somebody stays.

          But the hero's title cannot be the h1 either — it changes every time
          somebody presses a chevron, and a document whose heading mutates on a
          carousel click has no stable outline for a screen reader or a
          crawler.

          So the h1 is real, correct and visually hidden: one per page, first
          in the document, naming the page rather than one of its items. Every
          section below is an h2 under it. */}
      <h1 className="sr-only">Live events, concerts and experiences in India</h1>

      {/* CURATED FIRST, and it says which it is. An operator's picks outrank
          whatever the index returned; with nothing pinned the hero falls back
          to the soonest live events and RELABELS itself, so a visitor is never
          shown "Featured" that nobody featured. */}
      <Showcase collections={cms?.collections} />

      {/* Asks for a location once, after the page has shown its worth — never
          on load. Renders nothing once a city is known or the ask was closed. */}
      <LocationPrompt />

      {/* The grid streams behind its own boundary: the hero is the LCP element
          and must not wait on a second list request to paint. The fallback
          reserves the grid's real height, so the sections below never jump. */}
      <Suspense fallback={<AllEventsSkeleton />}>
        <AllEvents />
      </Suspense>

      <Section>
        {/* No subtitle. The eight tiles below say what they are, and a line
            explaining that categories exist for people who did not search is
            us narrating our own information architecture. */}
        <SectionHeader title="Browse by mood" />
        <CategoryTiles categories={cms?.categories} />
      </Section>

      {/* The second product. Its own tinted band and its own rhythm, because
          everything above sells a ticket to somebody else's event and this
          sells a service for the visitor's own — rendered as another grid it
          would be scrolled past as more of the same. */}
      <HireABandSection />

      <WhyCuratix />

      {/* The one ask on the page, and it comes last — before the footer, after
          every reason to say yes. */}
      <Section>
        <SubscribeCard />
      </Section>
    </>
  );
}
