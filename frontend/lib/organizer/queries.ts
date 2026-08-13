'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  fetchAudience,
  fetchCustomerProfile,
  fetchCustomers,
  fetchEventAnalytics,
  fetchEventRows,
  fetchOrganizerActivity,
  fetchOrganizerBookings,
  fetchOrganizerBreakdown,
  fetchOrganizerFeed,
  fetchOrganizerOverview,
  fetchOrganizerRefunds,
  fetchOrganizerReviews,
  fetchOrganizerTimeseries,
  fetchSettlements,
  type BookingFilters,
  type BreakdownKind,
  type EventRowFilters,
  type SeriesMetric,
} from '@/lib/api/organizer';
import { cursorFromNextLink } from '@/lib/api/events';

/**
 * Every organizer read, as a hook.
 *
 * THE FRESHNESS POLICY, which is the only interesting decision in this file:
 *
 * - **Aggregates** (overview, series, breakdowns) are cached server-side for
 *   30–300s already, so a short client `staleTime` on top costs nothing and
 *   stops a tab-switch refetching numbers that cannot have moved. The overview
 *   polls, because it is the one surface an organizer leaves open during an
 *   on-sale.
 * - **Tables** (events, bookings, customers) have `staleTime: 0`. An organizer
 *   acts on individual rows — refunds one, publishes one — and a stale row is
 *   how someone refunds a booking that was already refunded.
 * - **`keepPreviousData`** on every filtered list. Without it, typing in the
 *   search box unmounts the table on each keystroke and the page height jumps;
 *   with it, the old rows stay put and dim while the new ones load. That is
 *   the single biggest perceived-speed difference on this screen.
 *
 * Polling is `refetchIntervalInBackground: false` throughout — a dashboard
 * left open in a background tab should not keep hitting the API all night.
 */

const KEY = {
  overview: ['organizer', 'overview'] as const,
  series: (metric: SeriesMetric, days: number, end?: string) =>
    ['organizer', 'series', metric, days, end ?? 'now'] as const,
  breakdown: (by: BreakdownKind, limit: number) => ['organizer', 'breakdown', by, limit] as const,
  activity: (limit: number) => ['organizer', 'activity', limit] as const,
  audience: ['organizer', 'audience'] as const,
  eventRows: (filters: EventRowFilters) => ['organizer', 'event-rows', filters] as const,
  bookings: (filters: BookingFilters) => ['organizer', 'bookings', filters] as const,
  customers: (search: string) => ['organizer', 'customers', search] as const,
  customer: (id: string) => ['organizer', 'customer', id] as const,
  analytics: (id: string, days: number) => ['organizer', 'analytics', id, days] as const,
  settlements: ['organizer', 'settlements'] as const,
  feed: (limit: number) => ['organizer', 'feed', limit] as const,
  refunds: (eventId: string) => ['organizer', 'refunds', eventId] as const,
};

/** 15s. Fast enough to feel live during an on-sale, slow enough to be polite. */
const LIVE_POLL_MS = 15_000;

export function useOverview() {
  return useQuery({
    queryKey: KEY.overview,
    queryFn: fetchOrganizerOverview,
    staleTime: 15_000,
    refetchInterval: LIVE_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useTimeseries(metric: SeriesMetric, days = 30, end?: string) {
  return useQuery({
    // `end` is part of the key — two windows of the same LENGTH are different
    // data, and sharing an entry would draw one window's points under the
    // other's dates. A plausible chart for the wrong days is worse than an
    // error, because nobody questions it.
    queryKey: KEY.series(metric, days, end),
    queryFn: () => fetchOrganizerTimeseries(metric, days, end),
    // The server caches this for 300s; asking again sooner cannot produce a
    // different answer.
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  });
}

export function useReviews(eventId?: string) {
  return useInfiniteQuery({
    queryKey: ['organizer', 'reviews', eventId ?? ''] as const,
    queryFn: ({ pageParam }) =>
      fetchOrganizerReviews({ event_id: eventId || undefined, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useBreakdown(by: BreakdownKind, limit = 8) {
  return useQuery({
    queryKey: KEY.breakdown(by, limit),
    queryFn: () => fetchOrganizerBreakdown(by, limit),
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  });
}

export function useActivity(limit = 20) {
  return useQuery({
    queryKey: KEY.activity(limit),
    queryFn: () => fetchOrganizerActivity(limit),
    // Not cached server-side, on purpose — a feed exists to be current.
    staleTime: 0,
    refetchInterval: LIVE_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/**
 * The unified feed: bookings, refunds, admissions, payouts, publishing.
 *
 * Polls on the same clock as the overview. It is the surface an organizer
 * leaves open during an on-sale, and a timeline that needs a manual refresh to
 * show a failed payout is a timeline that reports the failure late.
 */
export function useFeed(limit = 30) {
  return useQuery({
    queryKey: KEY.feed(limit),
    queryFn: () => fetchOrganizerFeed(limit),
    staleTime: 0,
    refetchInterval: LIVE_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useRefunds(eventId = '') {
  return useInfiniteQuery({
    queryKey: KEY.refunds(eventId),
    queryFn: ({ pageParam }) =>
      fetchOrganizerRefunds({ event_id: eventId || undefined, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    // Money moving out. An organizer acts on these rows — a stale one is how
    // somebody refunds a booking that was already refunded.
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

export function useAudience() {
  return useQuery({ queryKey: KEY.audience, queryFn: fetchAudience, staleTime: 60_000 });
}

export function useEventRows(filters: EventRowFilters) {
  return useInfiniteQuery({
    queryKey: KEY.eventRows(filters),
    queryFn: ({ pageParam }) => fetchEventRows({ ...filters, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

export function useOrganizerBookings(filters: BookingFilters) {
  return useInfiniteQuery({
    queryKey: KEY.bookings(filters),
    queryFn: ({ pageParam }) =>
      fetchOrganizerBookings({ ...filters, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

export function useCustomers(search: string) {
  return useInfiniteQuery({
    queryKey: KEY.customers(search),
    queryFn: ({ pageParam }) =>
      fetchCustomers({ q: search || undefined, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

export function useCustomerProfile(customerId: string | null) {
  return useQuery({
    queryKey: KEY.customer(customerId ?? ''),
    queryFn: () => fetchCustomerProfile(customerId as string),
    enabled: Boolean(customerId),
    staleTime: 0,
  });
}

export function useEventAnalytics(eventId: string | null, days = 30) {
  return useQuery({
    queryKey: KEY.analytics(eventId ?? '', days),
    queryFn: () => fetchEventAnalytics(eventId as string, days),
    enabled: Boolean(eventId),
    staleTime: 60_000,
  });
}

export function useSettlements() {
  return useInfiniteQuery({
    queryKey: KEY.settlements,
    queryFn: ({ pageParam }) => fetchSettlements({ cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
  });
}

/**
 * Invalidate everything a write could have moved.
 *
 * Coarse on purpose. Publishing an event changes the events table, the
 * upcoming count on the overview, and potentially a breakdown — enumerating
 * precisely which keys is how a dashboard ends up showing a stale tile next to
 * a fresh table. One prefix, one line, no drift.
 */
export function useInvalidateOrganizer() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['organizer'] });
}

/** A mutation that refreshes the whole dashboard once it lands. */
export function useOrganizerMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const invalidate = useInvalidateOrganizer();
  return useMutation({ mutationFn, onSuccess: () => void invalidate() });
}
