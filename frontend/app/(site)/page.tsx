import * as React from 'react';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CategoryTiles } from '@/components/discovery/category-tiles';
import { CuratedRail } from '@/components/discovery/curated-rail';
import { HomeHero } from '@/components/discovery/home-hero';
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
 *   hero            what this is, and a way in     (search + the live island)
 *   featured        fewer, larger, editorial       (an operator's picks)
 *   categories      eight ways in, if search isn't (icon tiles, no imagery)
 *   HIRE A BAND     the second product             (tinted band, own rhythm)
 *   trending        what is actually selling       (derived, not curated)
 *   why Curatix    the trust argument, once
 *   newsletter      the one ask                    (last, before the footer)
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
 * ── THE DYNAMIC ISLAND IS UNTOUCHED ───────────────────────────────────────
 *
 * `HomeHero` and everything inside it is exactly as it was — the brief asked
 * for that explicitly, and it is also the most-tested component on this page.
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

      <HomeHero hero={cms?.hero} />

      {/* CURATED FIRST. An operator's editorial choice outranks whatever the
          index happened to return — and the rail says which it is, so a
          visitor is never shown "Featured" that nobody featured. It renders
          nothing at all when empty rather than back-filling. */}
      <CuratedRail
        collections={cms?.collections}
        collection="featured"
        title="Featured this week"
        subtitle="Chosen by our team, not by an algorithm"
      />

      <Section>
        <Reveal>
          <SectionHeader
            title="Browse by mood"
            subtitle="Eight ways in, if search is not the way in"
            href="/events"
            linkLabel="All events"
          />
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
