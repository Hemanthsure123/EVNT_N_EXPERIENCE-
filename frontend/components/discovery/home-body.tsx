import * as React from 'react';
import { Suspense } from 'react';
import { AllEvents, AllEventsSkeleton } from '@/components/discovery/all-events';
import { CategoryTiles } from '@/components/discovery/category-tiles';
import { LocationPrompt } from '@/components/discovery/location-prompt';
import { Showcase } from '@/components/discovery/showcase';
import { Section, SectionHeader } from '@/components/discovery/section';
import { SubscribeCard } from '@/components/discovery/subscribe-card';
import {
  TrendingSection,
  SellingFastSection,
  RailSectionSkeleton,
} from '@/components/discovery/home-sections';
import { WhyCuratix } from '@/components/discovery/why-curatix';
import { HireABandSection } from '@/components/hire/hire-a-band-section';
import { fetchHomepageSafe } from '@/lib/api/cms';

/**
 * THE LANDING PAGE'S BODY — mounted in two places, written once.
 *
 * ── WHY IT LEFT `app/(site)/page.tsx` ────────────────────────────────────
 *
 * An organizer pressing Home in their bottom bar used to be sent to `/`, which
 * is a different route GROUP: the attendee shell took over, so the four-tab
 * public bar (Home, Events, Saved, Hire) replaced the organizer's own and they
 * had left the product. The landing page is now rendered INSIDE the dashboard
 * at `/dashboard/home`, where the organizer chrome stays put.
 *
 * That needs the same page in two route groups, and this is the one copy of
 * it. A second arrangement of these nine sections for the organizer's version
 * is the drift this codebase refuses everywhere else: it would look identical
 * the week it was written and diverge on the first change to either.
 *
 * ── WHAT IS NOT IN HERE ──────────────────────────────────────────────────
 *
 * The `WebSite` JSON-LD and the canonical stay on the public route. They are
 * claims about `/` — a search engine must not be told that the copy behind an
 * organizer's login is the same document, and the dashboard is `noindex`
 * anyway.
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
 * This page used to open on a marquee of five posters and then run more rails
 * under it: featured, then trending, each the same card doing the same job
 * under a different heading. Repeating a card is how a page gets long without
 * getting more useful. There is now ONE recommendation surface (the hero,
 * which commits to a single event and can therefore give it a date, a venue, a
 * price and a CTA) and ONE listing surface (`AllEvents`, a grid carrying the
 * browse page's own filter vocabulary).
 */
export async function HomeBody() {
  // Server-side, ISR'd and NEVER throws — the hero is the LCP element, and a
  // failing upstream must not take the front page down.
  const cms = await fetchHomepageSafe();

  return (
    <>
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

      {/* THE FIRST FIVE OF "ALL EVENTS", not a separately curated row. The
          two sections used to read two sources and could disagree about what
          was on next; both now read `fetchUpcomingEvents` — one memoised
          request — and the hero is a prefix of the grid below it. */}
      {/* 1. Hero Carousel Showcase */}
      <Showcase />

      {/* 2. Browse by Mood Horizontal Carousel (District App Layout) */}
      <Section className="py-4 sm:py-6">
        <SectionHeader title="Browse by mood" />
        <CategoryTiles categories={cms?.categories} />
      </Section>

      {/* 3. Trending Events Horizontal Rail */}
      <Suspense fallback={<RailSectionSkeleton />}>
        <TrendingSection />
      </Suspense>

      {/* 4. Selling Fast Scarcity Shelf */}
      <Suspense fallback={null}>
        <SellingFastSection />
      </Suspense>

      <LocationPrompt />

      {/* 5. All Events Discovery Grid */}
      <Suspense fallback={<AllEventsSkeleton />}>
        <AllEvents />
      </Suspense>

      <HireABandSection />

      <WhyCuratix />

      <Section>
        <SubscribeCard />
      </Section>
    </>
  );
}
