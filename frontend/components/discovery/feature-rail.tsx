import * as React from 'react';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { FeatureCard, FeatureCardSkeleton } from './feature-card';
import { PagedRail } from './paged-rail';
import { Reveal } from './reveal';

/**
 * The primary content row: large feature cards, PAGED rather than scrolled.
 *
 * No autoplay — this is where people choose, so it must never move on its own.
 * And no scroll container: see `PagedRail` for why a scrollbar under a card row
 * is both visual noise and a worse affordance than an arrow plus a count.
 */
export function FeatureRail({
  events,
  className,
}: {
  events: EventCardData[];
  className?: string;
}) {
  return (
    <PagedRail label="events" count={events.length} className={className}>
      {events.map((event, index) => (
        <li key={event.id} className="w-[78vw] shrink-0 sm:w-80 lg:w-[26rem]">
          <Reveal delayMs={Math.min(index, 4) * 60} className="h-full">
            <FeatureCard event={event} />
          </Reveal>
        </li>
      ))}
    </PagedRail>
  );
}

export function FeatureRailSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="flex gap-6 overflow-hidden">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="w-[78vw] shrink-0 sm:w-80 lg:w-[26rem]">
            <FeatureCardSkeleton />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="skeleton h-4 w-16 rounded-md" />
        <div className="flex gap-2">
          <div className="skeleton size-10 rounded-full" />
          <div className="skeleton size-10 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export { RowEmpty as RailEmpty, RowError as RailError } from './row-states';
