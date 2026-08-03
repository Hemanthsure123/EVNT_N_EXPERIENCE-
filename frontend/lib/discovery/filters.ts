/**
 * The filter model — ONE codec between the URL, the backend query string, and
 * the chips the user sees. The URL is the source of truth for a browse session
 * (shareable, back-button-correct, server-renderable).
 *
 * Two tiers, and the split is honest rather than hidden:
 *
 *  A. SERVER-SIDE (real, index-backed): `q`, `city`, and the date window
 *     (`starts_after`/`starts_before`) — exactly what
 *     `EventSearchQuerySerializer` accepts today. Category rides along as a
 *     single search term (see categories.ts).
 *
 *  B. CLIENT-SIDE refinement (price band, price sort, time of day, organiser):
 *     the backend has no price/organiser filter, no time-of-day predicate, and
 *     only one ordering (`starts_at` asc, pinned to the index that makes cursor
 *     pagination cheap). Rather than fake it, these refine the pages already
 *     loaded, the UI says so, and the results view keeps pulling pages until it
 *     has enough matches. `toServerQuery` is the single seam: when the backend
 *     grows `min_price`/`max_price`/`sort`/`organizer`, they move from
 *     `clientRefinement` into `toServerQuery` and NO component changes.
 *     See BACKLOG.md items 3, 5 and 10.
 *
 * Time of day is the one tier-B filter that is EXACT rather than approximate:
 * `starts_at` is on every card, so the predicate is total over loaded rows —
 * unlike price, which is null until ticketing writes the denormal.
 */

import type { EventCard } from '@/lib/api/types';
import type { EventsQuery } from '@/lib/api/events';
import { type CategorySlug, categoryBySlug, isCategorySlug } from './categories';
import { rangeLabel } from './calendar';
import { type DateWindowId, dateWindow, istStartOfDay } from './date-windows';
import { type TimeBandId, TIME_BANDS, isTimeBand, timeBandOf } from './facets';

export type PriceBandId = 'free' | 'under-500';
export type SortId = 'soonest' | 'price-asc' | 'price-desc';

export type DiscoveryFilters = {
  q: string;
  city: string | null;
  category: CategorySlug | null;
  when: DateWindowId | null;
  /**
   * An explicit date or range, as `YYYY-MM-DD` in IST. `to` equal to `from`
   * is a single day.
   *
   * Kept SEPARATE from `when` rather than folded into it as another window id.
   * The quick windows are named, shareable and stable ("this weekend" means
   * something different tomorrow); a chosen range is a literal. Merging them
   * would mean either losing the name or inventing a fake id for every
   * possible pair of dates.
   *
   * When both are set the RANGE wins — see `toServerQuery`.
   */
  dateFrom: string | null;
  dateTo: string | null;
  price: PriceBandId | null;
  /** Time-of-day band, IST. Refined client-side; exact over loaded rows. */
  time: TimeBandId | null;
  /** Exact organiser name, as it appears on the cards. */
  organizer: string | null;
  sort: SortId;
};

export const EMPTY_FILTERS: DiscoveryFilters = {
  q: '',
  city: null,
  category: null,
  when: null,
  dateFrom: null,
  dateTo: null,
  price: null,
  time: null,
  organizer: null,
  sort: 'soonest',
};

/** ₹500 in minor units. */
const UNDER_500_MINOR = 50_000;

const WHEN_LABELS: Record<DateWindowId, string> = {
  today: 'Today',
  weekend: 'This weekend',
  week: 'This week',
  month: 'This month',
};

const PRICE_LABELS: Record<PriceBandId, string> = {
  free: 'Free',
  'under-500': 'Under ₹500',
};

export const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: 'soonest', label: 'Soonest first' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
];

const isWhen = (v: string | null): v is DateWindowId =>
  v === 'today' || v === 'weekend' || v === 'week' || v === 'month';
const isPrice = (v: string | null): v is PriceBandId => v === 'free' || v === 'under-500';
const isSort = (v: string | null): v is SortId =>
  v === 'soonest' || v === 'price-asc' || v === 'price-desc';

/** Accepts either a URLSearchParams or Next's `searchParams` prop shape. */
type ParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: ParamsLike, key: string): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** `YYYY-MM-DD`, and a real date — `2026-02-31` parses but is not one. */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Read `from`/`to`, tolerating the ways they arrive wrong.
 *
 * A malformed date is treated as ABSENT rather than as an error, for the same
 * reason the organizer lists do it: these params come from links people share
 * and edit, the view is already scoped safely, and a browse page that 400s
 * because a date picker emitted something odd is worse than one that shows
 * more results than asked for.
 *
 * A reversed range is SWAPPED, not dropped — somebody who picked the dates in
 * the other order meant the range between them.
 */
function readDateRange(params: ParamsLike): Pick<DiscoveryFilters, 'dateFrom' | 'dateTo'> {
  const rawFrom = read(params, 'from');
  const rawTo = read(params, 'to');
  const from = isIsoDate(rawFrom) ? rawFrom : null;
  const to = isIsoDate(rawTo) ? rawTo : null;

  if (from && to) return from <= to ? { dateFrom: from, dateTo: to } : { dateFrom: to, dateTo: from };
  // A lone `to` is a range with no start, which is not something the UI can
  // produce; treating it as a single day is the closest honest reading.
  if (!from && to) return { dateFrom: to, dateTo: to };
  return { dateFrom: from, dateTo: from ? (to ?? from) : null };
}

export function filtersFromSearchParams(params: ParamsLike): DiscoveryFilters {
  const category = read(params, 'category');
  const when = read(params, 'when');
  const price = read(params, 'price');
  const sort = read(params, 'sort');
  const city = read(params, 'city');
  const time = read(params, 'time');
  const organizer = read(params, 'organizer');
  return {
    q: (read(params, 'q') ?? '').trim(),
    city: city ? city.trim() : null,
    category: isCategorySlug(category) ? category : null,
    when: isWhen(when) ? when : null,
    ...readDateRange(params),
    price: isPrice(price) ? price : null,
    time: isTimeBand(time) ? time : null,
    organizer: organizer ? organizer.trim() : null,
    sort: isSort(sort) ? sort : 'soonest',
  };
}

export function filtersToSearchParams(filters: DiscoveryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.city) params.set('city', filters.city);
  if (filters.category) params.set('category', filters.category);
  if (filters.when) params.set('when', filters.when);
  if (filters.dateFrom) params.set('from', filters.dateFrom);
  if (filters.dateTo && filters.dateTo !== filters.dateFrom) params.set('to', filters.dateTo);
  if (filters.price) params.set('price', filters.price);
  if (filters.time) params.set('time', filters.time);
  if (filters.organizer) params.set('organizer', filters.organizer);
  if (filters.sort !== 'soonest') params.set('sort', filters.sort);
  return params;
}

/** `/events?...` for a set of filters (or bare `/events` when they're empty). */
export function browseHref(filters: Partial<DiscoveryFilters>): string {
  const qs = filtersToSearchParams({ ...EMPTY_FILTERS, ...filters }).toString();
  return qs ? `/events?${qs}` : '/events';
}

/**
 * TIER A — what the backend actually understands today. `now` is injected so a
 * server render and a client render of the same filters agree.
 */
export function toServerQuery(filters: DiscoveryFilters, now: Date = new Date()): EventsQuery {
  const category = categoryBySlug(filters.category);
  // Both terms go into one `q`: Postgres `websearch` ANDs them, so this reads
  // as "the user's words AND the category stem" — which is what the chip means.
  const terms = [filters.q, category?.query].filter(Boolean).join(' ').trim();
  // An explicit range WINS over a named window. Both can be present in a URL
  // somebody hand-edited, and the literal is the more specific instruction.
  const range = explicitRange(filters, now);
  const window = !range && filters.when ? dateWindow(filters.when, now) : null;
  const bounds = range ?? window;

  return {
    ...(terms ? { q: terms } : {}),
    ...(filters.city ? { city: filters.city } : {}),
    ...(bounds ? { starts_after: bounds.from, starts_before: bounds.to } : {}),
  };
}

/**
 * A chosen date range as instants the API understands.
 *
 * The day boundaries are IST, because that is the timezone the events are in
 * and the day a user picks is the day they mean locally. `from` is clamped to
 * NOW when the range starts today — asking the API for events that started
 * this morning would return ones already under way.
 */
function explicitRange(
  filters: DiscoveryFilters,
  now: Date,
): { from: string; to: string } | null {
  if (!filters.dateFrom) return null;
  const startOfFrom = istStartOfDay(new Date(`${filters.dateFrom}T00:00:00Z`));
  const startOfTo = istStartOfDay(new Date(`${filters.dateTo ?? filters.dateFrom}T00:00:00Z`));
  const endOfTo = new Date(startOfTo.getTime() + 24 * 60 * 60 * 1000 - 1);
  const from = startOfFrom > now ? startOfFrom : now;
  if (from > endOfTo) return null; // Entirely in the past; no bound is honest.
  return { from: from.toISOString(), to: endOfTo.toISOString() };
}

/** TIER B — the predicate + comparator applied to whatever pages are loaded. */
export type ClientRefinement = {
  active: boolean;
  predicate: (event: EventCard) => boolean;
  comparator: ((a: EventCard, b: EventCard) => number) | null;
};

export function clientRefinement(filters: DiscoveryFilters): ClientRefinement {
  const priceActive = filters.price !== null;
  const sortActive = filters.sort !== 'soonest';
  const timeActive = filters.time !== null;
  const organizerActive = filters.organizer !== null;

  const predicate = (event: EventCard) => {
    if (filters.time && timeBandOf(event.starts_at) !== filters.time) return false;
    if (filters.organizer && event.organization_name !== filters.organizer) return false;
    if (filters.price === 'free') return event.from_price === 0;
    if (filters.price === 'under-500') {
      return event.from_price !== null && event.from_price < UNDER_500_MINOR;
    }
    return true;
  };

  // Unpriced events (ticketing hasn't written the denormal) sort last in both
  // directions rather than pretending to be free or infinitely expensive.
  const byPrice = (direction: 1 | -1) => (a: EventCard, b: EventCard) => {
    const left = a.from_price;
    const right = b.from_price;
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return (left - right) * direction;
  };

  return {
    active: priceActive || sortActive || timeActive || organizerActive,
    predicate,
    comparator:
      filters.sort === 'price-asc'
        ? byPrice(1)
        : filters.sort === 'price-desc'
          ? byPrice(-1)
          : null,
  };
}

export function applyRefinement(events: EventCard[], filters: DiscoveryFilters): EventCard[] {
  const { predicate, comparator } = clientRefinement(filters);
  const filtered = events.filter(predicate);
  return comparator ? [...filtered].sort(comparator) : filtered;
}

/** The removable chips shown above the results. */
export type ActiveFilterChip = {
  key: keyof DiscoveryFilters;
  label: string;
};

export function activeFilterChips(filters: DiscoveryFilters): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (filters.q) chips.push({ key: 'q', label: `"${filters.q}"` });
  if (filters.category) {
    chips.push({ key: 'category', label: categoryBySlug(filters.category)?.label ?? '' });
  }
  if (filters.when) chips.push({ key: 'when', label: WHEN_LABELS[filters.when] });
  // One chip for the pair. Two ("from 1 Apr", "to 5 Apr") would let somebody
  // dismiss half a range and leave an open-ended one the picker cannot show.
  if (filters.dateFrom) {
    chips.push({ key: 'dateFrom', label: rangeLabel(filters.dateFrom, filters.dateTo) ?? '' });
  }
  if (filters.time) {
    const band = TIME_BANDS.find((b) => b.id === filters.time);
    if (band) chips.push({ key: 'time', label: band.label });
  }
  if (filters.price) chips.push({ key: 'price', label: PRICE_LABELS[filters.price] });
  if (filters.city) chips.push({ key: 'city', label: filters.city });
  if (filters.organizer) chips.push({ key: 'organizer', label: filters.organizer });
  return chips;
}

/** Display label for a category slug (empty string if it's somehow unknown). */
export const categoryLabel = (slug: CategorySlug | null) =>
  slug ? (categoryBySlug(slug)?.label ?? '') : '';

export function clearFilter(filters: DiscoveryFilters, key: keyof DiscoveryFilters) {
  // The range is ONE filter with two fields. Clearing only `dateFrom` would
  // leave a dangling `dateTo` that serialises into a URL the picker cannot
  // represent.
  if (key === 'dateFrom' || key === 'dateTo') {
    return { ...filters, dateFrom: null, dateTo: null };
  }
  return { ...filters, [key]: key === 'q' ? '' : key === 'sort' ? 'soonest' : null };
}

export function hasAnyFilter(filters: DiscoveryFilters): boolean {
  return activeFilterChips(filters).length > 0 || filters.sort !== 'soonest';
}

export { WHEN_LABELS, PRICE_LABELS, UNDER_500_MINOR };
