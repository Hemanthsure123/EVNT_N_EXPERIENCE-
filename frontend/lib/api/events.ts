/**
 * The public events read path — the one place that knows how to talk to
 * `GET /events`. Safe to import from Server Components AND Client Components:
 * it only calls the typed client, and the ISR options are inert in the browser.
 *
 * Caching is aligned with the backend's own headers (backend/apps/events/api.py):
 *   list   -> public, max-age=15, s-maxage=30, stale-while-revalidate=30
 *   detail -> public, max-age=30, s-maxage=60, stale-while-revalidate=30
 * so the Next data cache revalidates on the same clock the CDN does, instead of
 * inventing a second, conflicting TTL.
 */

import { api } from './client';
import { isApiError } from './errors';
import type { EventContent } from './event-content';
import type { EventCard, EventDetail, Paginated, TicketTier } from './types';

/** Matches the backend's `s-maxage` for the public list. */
export const PUBLIC_LIST_REVALIDATE_SECONDS = 30;
/** Matches the backend's `s-maxage` for the public detail. */
export const PUBLIC_DETAIL_REVALIDATE_SECONDS = 60;
/** Matches the backend's `s-maxage` on `GET /events/sitemap`. Long, because a
 *  sitemap is read by crawlers on their own schedule, never on a visitor's. */
export const SITEMAP_REVALIDATE_SECONDS = 3600;

/** One `/sitemap.xml` row: what to link to, and when it last changed. */
export type EventSitemapEntry = { id: string; slug: string; updated_at: string };

/**
 * Every publicly-reachable event URL, for `app/sitemap.ts`.
 *
 * NEVER THROWS. `sitemap.ts` is a build-time/route handler with no error
 * boundary: an exception here does not degrade the document, it takes
 * `/sitemap.xml` down entirely — and the static half (landing pages, legal,
 * support) is far more valuable than a 500. An empty array means the sitemap
 * ships without event URLs, which is exactly the state it was in before this
 * endpoint existed.
 */
export async function fetchEventSitemapSafe(): Promise<EventSitemapEntry[]> {
  try {
    const page = await api.get<{ data: EventSitemapEntry[] }>('/events/sitemap', {
      auth: false,
      next: { revalidate: SITEMAP_REVALIDATE_SECONDS },
    });
    return page.data ?? [];
  } catch {
    return [];
  }
}

/** Exactly the query params `EventSearchQuerySerializer` + CursorPagination accept. */
export type EventsQuery = {
  q?: string;
  city?: string;
  /** Every publicly-visible event by one organiser — "More from {organiser}". */
  organization_id?: string;
  starts_after?: string;
  starts_before?: string;
  cursor?: string;
  page_size?: number;
};

export function eventsQueryString(params: EventsQuery): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.city) search.set('city', params.city);
  if (params.starts_after) search.set('starts_after', params.starts_after);
  if (params.starts_before) search.set('starts_before', params.starts_before);
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.organization_id) search.set('organization_id', params.organization_id);
  if (params.page_size) search.set('page_size', String(params.page_size));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * The backend's `meta.next` is a fully-qualified URL built from ITS OWN host.
 * We only want the opaque cursor out of it and re-issue the request through the
 * typed client, so the configured API base URL stays the single authority (and
 * a proxied/rewritten host can never leak into the browser's request).
 */
export function cursorFromNextLink(next: string | null | undefined): string | null {
  if (!next) return null;
  const queryStart = next.indexOf('?');
  const query = queryStart === -1 ? '' : next.slice(queryStart + 1);
  return new URLSearchParams(query).get('cursor');
}

export function fetchEvents(
  params: EventsQuery = {},
  opts: { revalidate?: number; signal?: AbortSignal } = {},
): Promise<Paginated<EventCard>> {
  const { revalidate, signal } = opts;
  return api.get<Paginated<EventCard>>(`/events${eventsQueryString(params)}`, {
    auth: false,
    signal,
    ...(revalidate !== undefined ? { next: { revalidate } } : {}),
  });
}

export function fetchEventDetail(
  eventId: string,
  opts: { revalidate?: number } = {},
): Promise<EventDetail> {
  const { revalidate = PUBLIC_DETAIL_REVALIDATE_SECONDS } = opts;
  return api.get<EventDetail>(`/events/${encodeURIComponent(eventId)}`, {
    auth: false,
    next: { revalidate },
  });
}

/**
 * Ticket tiers with live availability.
 *
 * `no-store`, ALWAYS. Everything else public on this site is cached on a shared
 * 30-second clock, and inventory is the one thing that must never be: a cached
 * "2 left" is how you sell a ticket that doesn't exist, and how you tell someone
 * an event is sold out when it isn't. The backend already treats it this way —
 * it caches tiers for five seconds, not thirty — and this is the client half of
 * the same decision.
 */
export function fetchEventTiers(eventId: string): Promise<{ data: TicketTier[] }> {
  return api.get<{ data: TicketTier[] }>(`/events/${encodeURIComponent(eventId)}/ticket-types`, {
    auth: false,
    cache: 'no-store',
  });
}

/**
 * Gallery, FAQs and running order, in one request.
 *
 * Identical for every visitor and carrying the same edge-cache headers as the
 * detail itself (`apps/events/api.py`'s `EventContentView`), so it revalidates
 * on the same 60-second clock rather than a second, conflicting one.
 *
 * NEVER throws. This is below-the-fold enrichment: if it blips, the page still
 * has the photograph, the price and the buy button, which is the entire reason
 * anyone opened it. Taking the event down because a FAQ read failed would be
 * the wrong trade by a wide margin.
 */
export async function fetchEventContentSafe(
  eventId: string,
  opts: { revalidate?: number } = {},
): Promise<EventContent> {
  const { revalidate = PUBLIC_DETAIL_REVALIDATE_SECONDS } = opts;
  try {
    return await api.get<EventContent>(`/events/${encodeURIComponent(eventId)}/content`, {
      auth: false,
      next: { revalidate },
    });
  } catch {
    return { media: [], faqs: [], timeline: [], slots: [] };
  }
}

export type EventsResult = {
  events: EventCard[];
  /** The backend's raw `meta.next` link, passed through untouched so a client
   * infinite query can be seeded with this page verbatim. */
  next: string | null;
  nextCursor: string | null;
  /** A user-safe message when the read failed — the row renders its error state
   * instead of taking the whole page down. */
  error: string | null;
};

/**
 * Server-side read that NEVER throws. A home page composed of five independent
 * rows must not 500 (or fail `next build`) because one upstream read blipped —
 * each row degrades to its own inline error + retry link.
 */
export async function fetchEventsSafe(
  params: EventsQuery = {},
  opts: { revalidate?: number } = {},
): Promise<EventsResult> {
  const { revalidate = PUBLIC_LIST_REVALIDATE_SECONDS } = opts;
  try {
    const page = await fetchEvents(params, { revalidate });
    return {
      events: page.data,
      next: page.meta.next,
      nextCursor: cursorFromNextLink(page.meta.next),
      error: null,
    };
  } catch (error) {
    return {
      events: [],
      next: null,
      nextCursor: null,
      error: isApiError(error) ? error.message : "We couldn't load these events just now.",
    };
  }
}
