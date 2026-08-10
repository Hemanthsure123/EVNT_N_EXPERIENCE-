import * as React from 'react';
import { Container } from '@/components/shell/container';
import { fetchEventsSafe } from '@/lib/api/events';
import { sellingFast } from '@/lib/discovery/demand';
import { browseHref } from '@/lib/discovery/filters';
import { FeatureRailSkeleton } from './feature-rail';
import { Reveal } from './reveal';
import { Section, SectionHeader } from './section';
import { SellingFastCard } from './selling-fast-card';
import { TrendingNearYou } from './trending-near-you';

/**
 * The home page's two content sections.
 *
 * There used to be four rails (trending, this weekend, upcoming, popular
 * cities). They're down to two on purpose: a landing page that keeps scrolling
 * competes with the browse page it should be feeding. Everything cut is one tap
 * away behind a quick-filter chip or a "See all" — where the tools to refine it
 * actually live.
 *
 * Each section is an async Server Component with its own Suspense boundary, so
 * a slow row streams behind a content-shaped skeleton instead of holding the
 * page — and a failed row renders its own error rather than 500-ing it (see
 * `fetchEventsSafe`).
 */

const FEED_SIZE = 20;
/** Wider net for scarcity: genuinely low-stock events are rare, so a 20-row
 * page can easily contain none at all. */
const DEMAND_SCAN_SIZE = 60;
const FEATURED_COUNT = 5;

export async function TrendingSection() {
  // The hero's carousel takes the soonest 5; this row starts after them, so the
  // page never shows the same event twice.
  const { events, error } = await fetchEventsSafe({ page_size: FEED_SIZE });

  return (
    <Section>
      <TrendingNearYou
        initialEvents={events.slice(FEATURED_COUNT, FEATURED_COUNT + 8)}
        initialError={error}
      />
    </Section>
  );
}

export async function SellingFastSection() {
  const { events } = await fetchEventsSafe({ page_size: DEMAND_SCAN_SIZE });
  const scarce = sellingFast(events);

  // Nothing is genuinely scarce right now, so there is nothing honest to say.
  // An always-present "Selling fast" shelf is manufactured urgency.
  if (!scarce.length) return null;

  return (
    <section className="py-section lg:py-section-lg">
      <Container className="flex flex-col gap-8">
        <Reveal>
          <SectionHeader
            title="Selling fast"
            subtitle="Genuinely low on tickets — counts come straight from live inventory"
            href={browseHref({})}
            linkLabel="See all events"
          />
        </Reveal>

        {/* ── A RAIL ON A PHONE, A GRID ON EVERYTHING ELSE ───────────────
            `grid-cols-1` meant one full-width card per row, so a shelf of
            eight was eight screens of scrolling to pass ONE section — and the
            home page has several. A horizontal snap rail turns that into one
            screen with a swipe, which is what District and BookMyShow both do
            on a phone and what the hero carousel above already does here.

            Pure CSS: `flex` + scroll snap below `sm`, `grid` from `sm` where
            the pointer and the width make a grid the better shape. No
            JavaScript, so it costs nothing and cannot fail to hydrate.

            The card is `w-4/5`, not full width, deliberately — the sliver of
            the next card is the affordance. A rail whose items are exactly
            100% wide looks identical to a stack and nobody swipes it. */}
        <ul className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 xl:grid-cols-4">
          {scarce.map((event, index) => (
            <li key={event.id} className="h-full w-4/5 shrink-0 snap-start sm:w-auto sm:shrink">
              <Reveal delayMs={Math.min(index, 5) * 60} className="h-full">
                <SellingFastCard event={event} />
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/** Suspense fallback — same box, same rhythm as the real row. */
export function RailSectionSkeleton() {
  return (
    <Section>
      <div className="flex flex-col gap-2">
        <div className="skeleton h-0.5 w-10 rounded-full" aria-hidden />
        <div className="skeleton h-8 w-56 rounded-md" aria-hidden />
        <div className="skeleton h-4 w-72 rounded-md" aria-hidden />
      </div>
      <FeatureRailSkeleton />
    </Section>
  );
}
