'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  type EventsQuery,
  PUBLIC_LIST_REVALIDATE_SECONDS,
  cursorFromNextLink,
  fetchEvents,
} from '../events';
import type { EventCard, Paginated } from '../types';

export type { EventsQuery };

/** Client staleTime mirrors the backend's `s-maxage` so the browser, the Next
 * data cache and the CDN all age this data on the same clock. */
const EVENTS_STALE_MS = PUBLIC_LIST_REVALIDATE_SECONDS * 1000;

export const eventsQueryKey = (params: EventsQuery) => ['events', params] as const;

/** GET /events — one page. Used where a single row is enough (home rails). */
export function useEvents(params: EventsQuery = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: eventsQueryKey(params),
    queryFn: ({ signal }) => fetchEvents(params, { signal }),
    staleTime: EVENTS_STALE_MS,
    enabled: options.enabled ?? true,
  });
}

/** The shape TanStack wants when seeding an infinite query from a server render. */
export type SeededEventPages = {
  pages: Paginated<EventCard>[];
  pageParams: (string | null)[];
};

/**
 * GET /events with the backend's CURSOR pagination — the browse/search surface.
 * `getNextPageParam` reads the opaque cursor straight out of `meta.next`, so
 * the client never has to know how DRF encodes it.
 *
 * `initialData` seeds the cache with the page the SERVER already rendered, so
 * mounting the results view costs zero extra requests. Pass it ONLY when the
 * params still match what the server fetched — a seed under the wrong key would
 * show the previous filter's results.
 */
export function useEventsInfinite(
  params: EventsQuery = {},
  options: { enabled?: boolean; initialData?: SeededEventPages } = {},
) {
  return useInfiniteQuery({
    queryKey: [...eventsQueryKey(params), 'infinite'] as const,
    queryFn: ({ pageParam, signal }) =>
      fetchEvents({ ...params, cursor: pageParam ?? undefined }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: Paginated<EventCard>) => cursorFromNextLink(lastPage.meta.next),
    staleTime: EVENTS_STALE_MS,
    enabled: options.enabled ?? true,
    initialData: options.initialData,
    // Keep the previous results mounted while a new filter loads. Tearing the
    // grid down to a skeleton and rebuilding it is the single most expensive
    // thing a filter tap can do — it was measured at >400ms INP. The caller
    // dims the list and marks it busy while `isPlaceholderData` is true.
    placeholderData: (previous) => previous,
  });
}
