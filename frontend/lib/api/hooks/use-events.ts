'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import type { EventCard, Paginated } from '../types';

export type EventsQuery = {
  q?: string;
  city?: string;
};

/** GET /events — the public browse/search list (unauthenticated, cursor-paginated). */
export function useEvents(params: EventsQuery = {}) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.city) search.set('city', params.city);
  const qs = search.toString();

  return useQuery({
    queryKey: ['events', params],
    queryFn: ({ signal }) =>
      api.get<Paginated<EventCard>>(`/events${qs ? `?${qs}` : ''}`, { auth: false, signal }),
  });
}
