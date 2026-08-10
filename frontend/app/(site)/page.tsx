import * as React from 'react';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CategoryTiles } from '@/components/discovery/category-tiles';
import { LocationPrompt } from '@/components/discovery/location-prompt';
import { Showcase } from '@/components/discovery/showcase';
import { RailSectionSkeleton, TrendingSection } from '@/components/discovery/home-sections';
import { Reveal } from '@/components/discovery/reveal';
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
 * ── ONE PURPOSE PER SECTION, IN ONE ORDER ─────────────────────────────────
 *
 *   showcase        an operator's picks, moving    (the first screen: events)
 *   categories      eight ways in, if search isn't (icon tiles, no imagery)
 *   HIRE A BAND     the second product             (tinted band, own rhythm)
 *   trending        what is actually selling       (derived, not curated)
 *   why Curatix    the trust argument, once
 *   newsletter      the one ask                    (last, before the footer)
 *
 * ── THE PAGE NOW OPENS ON INVENTORY, NOT ON A PITCH ───────────────────────
 *
 * It used to open with a split hero — headline, paragraph, trust badges, a
 * search bar, six quick-filter chips and a featured panel. That is nine things
 * on the screen that decides whether somebody stays, and eight of them are
 * about us. The first screen is now the curated rail: real events, moving,
 * with one way onward.
 *
 * Search did not disappear with it — it moved to the HEADER, where it was
 * already present on every other page, and took the hero bar's rolling
 * suggestions with it. One search affordance, on every route, instead of two
 * that only agreed on the front page.
 *
 * ── WHAT CHANGED, AND WHY IT IS NOT A RESTYLE ─────────────────────────────
 *
 * The old page ran FOUR event rails in a row — featured, editor's pick,
 * trending, selling fast — which is four variations of one card doing one job.
 * Repeating a card is how a page gets long without getting more useful: by the
 * third rail nobody reads the heading, so the editorial distinction between
 * them stops paying for the scroll it costs.
 *
 * There are now TWO event rails with genuinely different jobs — what a human
 * chose, and what is actually selling. `SellingFastSection` is gone as a
 * section because Trending's cards already carry real urgency badges computed
 * from remaining stock; a separate rail was showing the same events twice
 * under a different heading. Editor's pick went for the same reason, and the
 * collection still exists in the CMS for whenever it earns its own slot.
 *
 * The space that bought is spent on WHITESPACE and on the second product, not
 * on a fifth rail.
 *
 * ── STILL STATIC + ISR ────────────────────────────────────────────────────
 *
 * Nothing here is per-visitor (the one personalised row swaps on the client),
 * so a CDN serves identical HTML to everyone. The interval matches the
 * backend's own `s-maxage=30` on `GET /events`, so the page, the Next data
 * cache and the edge age on one clock rather than three.
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
  //
  // This used to be two reads in parallel; the second fetched featured
  // performers for a "Featured acts" scroller inside the Hire a Band section.
  // That block is gone (see the note in `hire-a-band-section.tsx`), and its
  // request went with it rather than being left to load something nothing
  // renders.
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

      {/* CURATED FIRST, and it says which it is. An operator's picks outrank
          whatever the index returned; with nothing pinned the rail falls back
          to the soonest live events and RELABELS itself, so a visitor is never
          shown "Featured" that nobody featured. */}
      <Showcase collections={cms?.collections} />

      {/* Asks for a location once, after the page has shown its worth — never
          on load. Renders nothing once a city is known or the ask was closed. */}
      <LocationPrompt />

      <Section>
        <Reveal>
          {/* No subtitle. The eight tiles below say what they are, and a line
              explaining that categories exist for people who did not search is
              us narrating our own information architecture. */}
          <SectionHeader title="Browse by mood" href="/events" linkLabel="All events" />
        </Reveal>
        <CategoryTiles categories={cms?.categories} />
      </Section>

      {/* The second product. Its own tinted band and its own rhythm, because
          everything above sells a ticket to somebody else's event and this
          sells a service for the visitor's own — rendered as another rail it
          would be scrolled past as more of the same. */}
      <HireABandSection />

      <Suspense fallback={<RailSectionSkeleton />}>
        <TrendingSection />
      </Suspense>

      <WhyCuratix />

      {/* The one ask on the page, and it comes last — before the footer, after
          every reason to say yes. */}
      <Section>
        <SubscribeCard />
      </Section>
    </>
  );
}
