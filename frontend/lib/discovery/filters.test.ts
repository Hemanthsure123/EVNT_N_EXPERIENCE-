import { describe, expect, it } from 'vitest';
import type { EventCard } from '@/lib/api/types';
import {
  EMPTY_FILTERS,
  activeFilterChips,
  applyRefinement,
  browseHref,
  clearFilter,
  clientRefinement,
  filtersFromSearchParams,
  filtersToSearchParams,
  hasAnyFilter,
  toServerQuery,
} from './filters';

const event = (over: Partial<EventCard> = {}): EventCard => ({
  id: 'e1',
  title: 'Comedy Night',
  venue: 'The Habitat',
  city: 'Mumbai',
  starts_at: '2026-08-01T14:30:00.000Z',
  poster_url: '',
  from_price: 49900,
  tickets_available: 100,
  organization_id: 'o1',
  organization_name: 'OML',
  ...over,
});

describe('URL <-> filters codec', () => {
  it('round-trips every filter', () => {
    const filters = {
      q: 'arijit',
      city: 'Mumbai',
      category: 'concerts' as const,
      when: 'weekend' as const,
      dateFrom: null,
      dateTo: null,
      price: 'under-500' as const,
      time: 'evening' as const,
      organizer: 'Lighthouse Live',
      sort: 'price-asc' as const,
    };
    const round = filtersFromSearchParams(filtersToSearchParams(filters));
    expect(round).toEqual(filters);
  });

  it('omits defaults from the URL so a clean browse has a clean link', () => {
    expect(filtersToSearchParams(EMPTY_FILTERS).toString()).toBe('');
    expect(browseHref({})).toBe('/events');
    expect(browseHref({ category: 'comedy' })).toBe('/events?category=comedy');
  });

  it('rejects unknown values rather than trusting the URL', () => {
    const filters = filtersFromSearchParams({
      category: 'wrestling',
      when: 'someday',
      price: 'cheap',
      sort: 'random',
    });
    expect(filters.category).toBeNull();
    expect(filters.when).toBeNull();
    expect(filters.price).toBeNull();
    expect(filters.sort).toBe('soonest');
  });

  it('reads Next-style searchParams objects as well as URLSearchParams', () => {
    expect(filtersFromSearchParams({ q: ['first', 'second'] }).q).toBe('first');
    expect(filtersFromSearchParams(new URLSearchParams('q=live')).q).toBe('live');
  });
});

describe('toServerQuery — only what the backend actually accepts', () => {
  it('folds the category into the full-text query alongside the user text', () => {
    const q = toServerQuery({ ...EMPTY_FILTERS, q: 'arijit', category: 'concerts' });
    expect(q.q).toBe('arijit concert');
  });

  it('sends the category term alone when there is no user text', () => {
    expect(toServerQuery({ ...EMPTY_FILTERS, category: 'comedy' }).q).toBe('comedy');
  });

  it('turns a date chip into starts_after/starts_before', () => {
    const now = new Date('2026-07-29T06:00:00.000Z'); // a Wednesday
    const q = toServerQuery({ ...EMPTY_FILTERS, when: 'weekend' }, now);
    expect(q.starts_after).toBeDefined();
    expect(q.starts_before).toBeDefined();
    expect(new Date(q.starts_after!) < new Date(q.starts_before!)).toBe(true);
  });

  it('never sends price or sort — the backend has neither', () => {
    const q = toServerQuery({ ...EMPTY_FILTERS, price: 'free', sort: 'price-desc' });
    expect(q).toEqual({});
  });
});

describe('client-side refinement', () => {
  it('is inactive for filters the server already handled', () => {
    expect(clientRefinement({ ...EMPTY_FILTERS, city: 'Mumbai' }).active).toBe(false);
    expect(clientRefinement({ ...EMPTY_FILTERS, price: 'free' }).active).toBe(true);
    expect(clientRefinement({ ...EMPTY_FILTERS, sort: 'price-asc' }).active).toBe(true);
  });

  it('treats free as exactly zero, not as "cheap"', () => {
    const events = [event({ id: 'a', from_price: 0 }), event({ id: 'b', from_price: 100 })];
    expect(applyRefinement(events, { ...EMPTY_FILTERS, price: 'free' }).map((e) => e.id)).toEqual([
      'a',
    ]);
  });

  it('excludes unpriced events from "under ₹500" instead of assuming they are cheap', () => {
    const events = [
      event({ id: 'cheap', from_price: 30000 }),
      event({ id: 'unpriced', from_price: null }),
      event({ id: 'dear', from_price: 90000 }),
    ];
    expect(
      applyRefinement(events, { ...EMPTY_FILTERS, price: 'under-500' }).map((e) => e.id),
    ).toEqual(['cheap']);
  });

  it('sorts unpriced events last in BOTH directions', () => {
    const events = [
      event({ id: 'unpriced', from_price: null }),
      event({ id: 'dear', from_price: 90000 }),
      event({ id: 'cheap', from_price: 10000 }),
    ];
    expect(
      applyRefinement(events, { ...EMPTY_FILTERS, sort: 'price-asc' }).map((e) => e.id),
    ).toEqual(['cheap', 'dear', 'unpriced']);
    expect(
      applyRefinement(events, { ...EMPTY_FILTERS, sort: 'price-desc' }).map((e) => e.id),
    ).toEqual(['dear', 'cheap', 'unpriced']);
  });
});

describe('active chips', () => {
  it('lists one removable chip per applied filter, and sort is not one', () => {
    const chips = activeFilterChips({
      q: 'jazz',
      city: 'Goa',
      category: 'concerts',
      when: 'today',
    dateFrom: null,
    dateTo: null,
      price: 'free',
      time: 'evening',
      organizer: 'Lighthouse Live',
      sort: 'price-asc',
    });
    expect(chips.map((c) => c.key)).toEqual([
      'q',
      'category',
      'when',
      'time',
      'price',
      'city',
      'organizer',
    ]);
  });

  it('clears a filter back to its own empty value', () => {
    const filters = { ...EMPTY_FILTERS, q: 'jazz', city: 'Goa', sort: 'price-asc' as const };
    expect(clearFilter(filters, 'q').q).toBe('');
    expect(clearFilter(filters, 'city').city).toBeNull();
    expect(clearFilter(filters, 'sort').sort).toBe('soonest');
  });

  it('counts a non-default sort as an applied filter', () => {
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasAnyFilter({ ...EMPTY_FILTERS, sort: 'price-asc' })).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* A chosen date, or a range of them                                           */
/* -------------------------------------------------------------------------- */

describe('explicit date ranges', () => {
  const now = new Date('2026-03-10T06:00:00Z'); // 11:30 IST

  it('survives a URL round trip', () => {
    const params = filtersToSearchParams({
      ...EMPTY_FILTERS,
      dateFrom: '2026-04-01',
      dateTo: '2026-04-05',
    });
    expect(params.get('from')).toBe('2026-04-01');
    expect(params.get('to')).toBe('2026-04-05');

    const round = filtersFromSearchParams(params);
    expect(round.dateFrom).toBe('2026-04-01');
    expect(round.dateTo).toBe('2026-04-05');
  });

  it('writes a single day as one param, not two identical ones', () => {
    const params = filtersToSearchParams({
      ...EMPTY_FILTERS,
      dateFrom: '2026-04-01',
      dateTo: '2026-04-01',
    });
    expect(params.get('from')).toBe('2026-04-01');
    expect(params.get('to')).toBeNull();
    // …and reading it back still means that one day.
    expect(filtersFromSearchParams(params).dateTo).toBe('2026-04-01');
  });

  it('treats a malformed date as absent rather than erroring', () => {
    // These arrive from links people share and edit. The view is already
    // scoped safely, so widening beats a 400.
    const filters = filtersFromSearchParams(new URLSearchParams('from=not-a-date&to=2026-13-45'));
    expect(filters.dateFrom).toBeNull();
    expect(filters.dateTo).toBeNull();
  });

  it('rejects a date that matches the shape but is not real', () => {
    expect(filtersFromSearchParams(new URLSearchParams('from=2026-02-31')).dateFrom).toBeNull();
  });

  it('swaps a reversed range rather than dropping it', () => {
    // Somebody who picked the dates in the other order meant the span.
    const filters = filtersFromSearchParams(new URLSearchParams('from=2026-04-05&to=2026-04-01'));
    expect(filters.dateFrom).toBe('2026-04-01');
    expect(filters.dateTo).toBe('2026-04-05');
  });

  it('sends the range to the API as instants', () => {
    const query = toServerQuery(
      { ...EMPTY_FILTERS, dateFrom: '2026-04-01', dateTo: '2026-04-02' },
      now,
    );
    expect(query.starts_after).toBeDefined();
    expect(query.starts_before).toBeDefined();
    expect(new Date(query.starts_after!).getTime()).toBeLessThan(
      new Date(query.starts_before!).getTime(),
    );
  });

  it('clamps a range starting today to NOW, not to this morning', () => {
    // Otherwise the first page is full of events that already started.
    const query = toServerQuery({ ...EMPTY_FILTERS, dateFrom: '2026-03-10' }, now);
    expect(new Date(query.starts_after!).getTime()).toBe(now.getTime());
  });

  it('beats a named window when a URL carries both', () => {
    // Both can appear in a hand-edited link. The literal is the more specific
    // instruction, so it wins.
    const withBoth = toServerQuery(
      { ...EMPTY_FILTERS, when: 'today', dateFrom: '2026-05-01', dateTo: '2026-05-01' },
      now,
    );
    const rangeOnly = toServerQuery(
      { ...EMPTY_FILTERS, dateFrom: '2026-05-01', dateTo: '2026-05-01' },
      now,
    );
    expect(withBoth).toEqual(rangeOnly);
  });

  it('sends no date bound at all for a range entirely in the past', () => {
    // A bound where `after` exceeds `before` matches nothing; no bound at
    // least shows the user something.
    const query = toServerQuery({ ...EMPTY_FILTERS, dateFrom: '2020-01-01' }, now);
    expect(query.starts_after).toBeUndefined();
    expect(query.starts_before).toBeUndefined();
  });
});
