'use client';

import * as React from 'react';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { useEvents } from '@/lib/api/hooks/use-events';
import { browseHref } from '@/lib/discovery/filters';
import { useLocationContext } from '@/lib/location/location-context';
import { FeatureRail, FeatureRailSkeleton, RailEmpty, RailError } from './feature-rail';
import { Reveal } from './reveal';
import { SectionHeader } from './section';

/**
 * "Trending near you" — the page's primary content row, and the one
 * personalised block on an otherwise STATIC page.
 *
 * The home page is ISR'd and edge-cacheable, so the server render can know
 * nothing about who's asking. This row therefore ships with the ISR'd national
 * list already in the HTML (good LCP, good SEO, correct for a first-time
 * visitor) and swaps to the city-filtered list on the client the moment a city
 * is known. Personalisation without giving up the cache.
 *
 * The heading names the city once one is set, because a row called "near you"
 * should say where "you" is.
 */
export function TrendingNearYou({
  initialEvents,
  initialError,
}: {
  initialEvents: EventCardData[];
  initialError: string | null;
}) {
  const { city, ready } = useLocationContext();
  const enabled = ready && !!city;

  const query = useEvents({ city: city?.name, page_size: 8 }, { enabled });

  const usingCity = enabled && !!query.data;
  const events = usingCity ? query.data.data : initialEvents;
  const loading = enabled && query.isPending;

  return (
    <>
      <Reveal>
        <SectionHeader
          title={city ? `Popular in ${city.name}` : 'Trending near you'}
          subtitle={
            city
              ? 'What people are booking around you right now'
              : 'Across India — set your city from the top nav for closer picks'
          }
          href={city ? browseHref({ city: city.name }) : '/events'}
        />
      </Reveal>

      {loading ? <FeatureRailSkeleton /> : null}

      {!loading && query.isError ? (
        <RailError
          message="We couldn't load events for your city."
          retryHref={browseHref({ city: city?.name })}
        />
      ) : null}

      {!loading && !query.isError && events.length ? <FeatureRail events={events} /> : null}

      {!loading && !query.isError && !events.length ? (
        initialError ? (
          <RailError message={initialError} retryHref="/events" />
        ) : (
          <RailEmpty
            title={city ? `Nothing on in ${city.name} yet` : 'Nothing trending right now'}
            description="New events go live every week. Try a nearby city in the meantime."
            ctaLabel="Browse all cities"
            ctaHref="/cities"
          />
        )
      ) : null}
    </>
  );
}
