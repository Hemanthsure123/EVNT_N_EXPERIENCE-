/**
 * Facets and headline numbers for the browse page, derived ONLY from event
 * rows the backend actually returned.
 *
 * The browse page asks two questions this file answers: "how much is here?"
 * (the banner's stat strip) and "what can I narrow by?" (the drawer's time and
 * organiser sections). Both are computed from the loaded pages, and both say so
 * — a count from a cursor-paginated list is a floor, never a total, so every
 * number that can still grow is rendered with a `+`.
 *
 * WHY A FLOOR AND NOT A TOTAL: the backend uses cursor pagination precisely to
 * avoid a `COUNT(*)` on every browse request (CLAUDE.md, performance checklist
 * item 7), so `meta.count` is absent by design. "230 concerts" would be a
 * number nobody computed. "20+ events" is the same information, true.
 *
 * WHAT IS DELIBERATELY NOT FACETED, because the platform does not record it:
 * distance (no venue geocoding), language, accessibility, age suitability,
 * duration (`ends_at` isn't on the card payload), and rating (there is no
 * review system). Each is in BACKLOG.md with the field it would need. A filter
 * that silently matches nothing is worse than an absent one.
 */

import type { EventCard } from '@/lib/api/types';
import { istHour, istStartOfDay } from './date-windows';

export type TimeBandId = 'morning' | 'afternoon' | 'evening' | 'late';

export type TimeBand = {
  id: TimeBandId;
  label: string;
  /** Inclusive IST start hour. */
  from: number;
  /** Exclusive IST end hour; wraps past midnight when `to <= from`. */
  to: number;
  hint: string;
};

/**
 * Bands chosen around how Indian event listings actually cluster: matinees and
 * workshops in the morning, the big evening slot from 5pm, and club nights
 * after 9 — which is why `late` wraps past midnight rather than ending the day.
 */
export const TIME_BANDS: TimeBand[] = [
  { id: 'morning', label: 'Morning', from: 5, to: 12, hint: '5am – 12pm' },
  { id: 'afternoon', label: 'Afternoon', from: 12, to: 17, hint: '12pm – 5pm' },
  { id: 'evening', label: 'Evening', from: 17, to: 21, hint: '5pm – 9pm' },
  { id: 'late', label: 'Late night', from: 21, to: 5, hint: '9pm – 5am' },
];

export const isTimeBand = (value: string | null): value is TimeBandId =>
  TIME_BANDS.some((band) => band.id === value);

export function timeBandOf(iso: string): TimeBandId {
  const hour = istHour(new Date(iso));
  const band = TIME_BANDS.find(({ from, to }) =>
    to > from ? hour >= from && hour < to : hour >= from || hour < to,
  );
  return band?.id ?? 'evening';
}

export type Facet = { value: string; count: number };

/**
 * Organisers present in the loaded pages, busiest first.
 *
 * Honest by construction: these are names that appear in results the user can
 * already see, so selecting one can never produce an empty screen. The backend
 * has no organiser filter param, so this refines client-side like price does —
 * the same tier-B seam, documented in filters.ts.
 */
export function organiserFacets(events: EventCard[], limit = 8): Facet[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const name = event.organization_name?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/** Time bands present in the loaded pages, in clock order (empty ones dropped). */
export function timeFacets(events: EventCard[]): (Facet & { id: TimeBandId })[] {
  const counts = new Map<TimeBandId, number>();
  for (const event of events) {
    const id = timeBandOf(event.starts_at);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return TIME_BANDS.filter((band) => counts.has(band.id)).map((band) => ({
    id: band.id,
    value: band.label,
    count: counts.get(band.id) ?? 0,
  }));
}

export type ResultStats = {
  /** Events loaded so far. */
  loaded: number;
  /** True when more pages exist — every count below is then a floor. */
  more: boolean;
  /** Starting today, IST. */
  today: number;
  /** `from_price === 0`. Null pricing is "not priced yet", never free. */
  free: number;
  /** Distinct cities represented. */
  cities: number;
};

export function resultStats(events: EventCard[], more: boolean, now = new Date()): ResultStats {
  const dayStart = istStartOfDay(now).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const cities = new Set<string>();
  let today = 0;
  let free = 0;

  for (const event of events) {
    if (event.city) cities.add(event.city.toLowerCase());
    const at = Date.parse(event.starts_at);
    if (at >= dayStart && at < dayEnd) today += 1;
    if (event.from_price === 0) free += 1;
  }

  return { loaded: events.length, more, today, free, cities: cities.size };
}

/** "24+" while more pages exist, "24" once the list is exhausted. */
export const countLabel = (value: number, more: boolean) => `${value}${more ? '+' : ''}`;
