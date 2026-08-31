/**
 * "Similar events", ranked from data this platform actually has.
 *
 * ── WHY THIS IS CLIENT-SIDE RANKING, NOT A QUERY ──────────────────────────
 *
 * `GET /events` accepts `q`, `city`, `starts_after`, `starts_before`, `cursor`
 * and `page_size` — and nothing else. There is no `organization` filter and no
 * relevance/similarity endpoint. Adding one would be a backend change, which
 * this work is explicitly not allowed to make.
 *
 * What the client already holds is the feed the widget was opened from: a real
 * page of `EventCard`s, every one carrying `organization_id`, `category`,
 * `city` and `starts_at`. Ranking those is honest — each row is a real event
 * with a real relationship to the one on screen — and it costs no request.
 *
 * ── THE RANKING, AND WHY IT IS ORDERED THIS WAY ───────────────────────────
 *
 *   1. SAME ORGANISER. The strongest relationship the data supports, and the
 *      one the section is for: somebody who liked this promoter's night wants
 *      their next one. It is also the only tier that is a FACT about the pair
 *      rather than a resemblance.
 *   2. Same organiser is exhausted -> same CATEGORY, same city.
 *   3. Then same category anywhere.
 *   4. Then same city.
 *
 * Anything sharing NONE of those is dropped rather than used as filler. A rail
 * padded with unrelated events under the heading "Similar events" is a claim
 * about a relationship that does not exist — and per the repo's standing rule,
 * a section nothing backs is ABSENT, not empty. Callers render nothing when
 * this returns nothing.
 *
 * Past events are dropped too: the whole point of the rail is what to book
 * next.
 */

import type { EventCard } from '@/lib/api/types';

/** Ranked buckets, best first. A candidate matching none of them is excluded. */
function tierOf(candidate: EventCard, current: EventCard): number {
  const sameOrganiser =
    Boolean(candidate.organization_id) && candidate.organization_id === current.organization_id;
  const sameCategory = Boolean(candidate.category) && candidate.category === current.category;
  const sameCity =
    Boolean(candidate.city) && candidate.city.toLowerCase() === current.city.toLowerCase();

  if (sameOrganiser) return 0;
  if (sameCategory && sameCity) return 1;
  if (sameCategory) return 2;
  if (sameCity) return 3;
  return Number.POSITIVE_INFINITY;
}

export type SimilarEventsOptions = {
  /** How many to return. The rail peeks, so a handful is plenty. */
  limit?: number;
  /** Injected so the comparison is testable; defaults to the wall clock. */
  now?: number;
};

export function selectSimilarEvents(
  current: EventCard,
  pool: readonly EventCard[],
  { limit = 8, now = Date.now() }: SimilarEventsOptions = {},
): EventCard[] {
  const seen = new Set<string>([current.id]);

  const ranked = pool
    .filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      // Upcoming only. A rail of finished shows answers nobody's question, and
      // an unparseable date is treated as absent rather than as "now".
      const starts = Date.parse(candidate.starts_at);
      return Number.isFinite(starts) && starts > now;
    })
    .map((candidate) => ({ candidate, tier: tierOf(candidate, current) }))
    .filter((row) => Number.isFinite(row.tier))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      // Within a tier, soonest first — the same ordering every other list on
      // this site uses, so the rail cannot look arbitrarily shuffled.
      return Date.parse(a.candidate.starts_at) - Date.parse(b.candidate.starts_at);
    });

  return ranked.slice(0, limit).map((row) => row.candidate);
}

/**
 * True when at least one candidate is the SAME ORGANISER, which is what lets a
 * caller title the rail "More from {organiser}" instead of "Similar events".
 * Naming the relationship is only honest when the relationship is that one.
 */
export function isOrganiserRail(current: EventCard, selected: readonly EventCard[]): boolean {
  return (
    selected.length > 0 &&
    selected.every(
      (candidate) =>
        Boolean(current.organization_id) &&
        candidate.organization_id === current.organization_id,
    )
  );
}
