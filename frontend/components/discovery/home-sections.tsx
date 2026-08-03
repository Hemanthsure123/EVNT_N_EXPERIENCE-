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

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {scarce.map((event, index) => (
            <li key={event.id} className="h-full">
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
