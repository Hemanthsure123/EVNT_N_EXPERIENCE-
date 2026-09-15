import { fetchEventsSafe } from '@/lib/api/events';

/**
 * THE ONE QUERY BEHIND "FEATURED EVENTS" AND "ALL EVENTS".
 *
 * ── THE BUG THIS REPLACES ────────────────────────────────────────────────
 *
 * The two sections on the landing page answered from two different sources.
 * "All events" read `GET /events`; "Featured events" read an operator-curated
 * CMS collection and only fell back to `GET /events` when nothing was pinned.
 * So the hero could show one pinned event while the grid under it showed a
 * different first event — two lists on one screen disagreeing about what was
 * on next, with nothing on the page to say why.
 *
 * ── ONE REQUEST, NOT TWO THAT HAPPEN TO MATCH ────────────────────────────
 *
 * Both sections call `fetchUpcomingEvents()` with IDENTICAL arguments, and
 * Next memoises identical `fetch` calls within a render — so the page makes one
 * request and both sections read the same rows. Featured is then a prefix of
 * that list (`featuredFrom`), which makes "they disagree" structurally
 * impossible rather than merely unlikely: two separate requests with different
 * page sizes would be two chances for an event to be published between them.
 *
 * ── THE ORDER IS THE SERVER'S ────────────────────────────────────────────
 *
 * Soonest first, then — for events starting at the same instant — the most
 * recently PUBLISHED first, then the id. It is `PUBLIC_LIST_ORDERING` in
 * `apps/events/repositories.py`, and the paginator reads the same constant.
 * There is deliberately no client-side sort here: a second sort is a second
 * source of truth for an order the API already promises, and the day they
 * differ the hero and page two of the browse list disagree.
 */

/** Rows the landing page fetches once and shares between both sections. */
export const HOME_UPCOMING_SIZE = 12;

/** How many of them lead the page as "Featured events". */
export const FEATURED_COUNT = 5;

export function fetchUpcomingEvents() {
  // No arguments on purpose. A caller that could pass its own page size would
  // produce a different URL, a second request, and the drift this removes.
  return fetchEventsSafe({ page_size: HOME_UPCOMING_SIZE });
}

/** The featured rail: the first `FEATURED_COUNT` of the shared list, in order. */
export function featuredFrom<T>(events: readonly T[]): T[] {
  return events.slice(0, FEATURED_COUNT);
}
