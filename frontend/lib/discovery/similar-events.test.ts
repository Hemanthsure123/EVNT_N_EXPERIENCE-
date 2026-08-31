import { describe, expect, it } from 'vitest';
import type { EventCard } from '@/lib/api/types';
import { isOrganiserRail, selectSimilarEvents } from './similar-events';

const NOW = Date.parse('2026-03-01T00:00:00.000Z');
const inDays = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

function card(overrides: Partial<EventCard> & { id: string }): EventCard {
  return {
    id: overrides.id,
    title: overrides.title ?? `Event ${overrides.id}`,
    venue: overrides.venue ?? 'Venue',
    city: overrides.city ?? 'Hyderabad',
    category: overrides.category ?? 'music',
    starts_at: overrides.starts_at ?? inDays(10),
    poster_url: overrides.poster_url ?? '',
    from_price: overrides.from_price ?? 49900,
    tickets_available: overrides.tickets_available ?? 100,
    organization_id: overrides.organization_id ?? 'org-a',
    organization_name: overrides.organization_name ?? 'Org A',
  };
}

const current = card({ id: 'current', organization_id: 'org-a', category: 'music', city: 'Hyderabad' });

describe('selectSimilarEvents', () => {
  it('never includes the event you are already looking at', () => {
    const result = selectSimilarEvents(current, [current, card({ id: 'b' })], { now: NOW });
    expect(result.map((e) => e.id)).not.toContain('current');
  });

  it('ranks the same organiser above everything else', () => {
    const sameCityDifferentOrg = card({ id: 'city', organization_id: 'org-b', category: 'comedy' });
    const sameOrganiser = card({
      id: 'org',
      organization_id: 'org-a',
      category: 'comedy',
      city: 'Mumbai',
      starts_at: inDays(30),
    });
    const result = selectSimilarEvents(current, [sameCityDifferentOrg, sameOrganiser], { now: NOW });
    expect(result[0].id).toBe('org');
  });

  it('prefers same category AND city over same category alone', () => {
    const categoryOnly = card({ id: 'cat', organization_id: 'org-b', city: 'Mumbai' });
    const categoryAndCity = card({ id: 'both', organization_id: 'org-b', city: 'Hyderabad' });
    const result = selectSimilarEvents(current, [categoryOnly, categoryAndCity], { now: NOW });
    expect(result.map((e) => e.id)).toEqual(['both', 'cat']);
  });

  it('DROPS an event sharing nothing rather than using it as filler', () => {
    // A rail padded to look full is a claim about a relationship that does not
    // exist. Better to render fewer, or none.
    const unrelated = card({
      id: 'unrelated',
      organization_id: 'org-z',
      category: 'workshops',
      city: 'Delhi',
    });
    expect(selectSimilarEvents(current, [unrelated], { now: NOW })).toEqual([]);
  });

  it('drops events that have already happened', () => {
    const past = card({ id: 'past', starts_at: inDays(-2) });
    expect(selectSimilarEvents(current, [past], { now: NOW })).toEqual([]);
  });

  it('treats an unparseable date as absent rather than as now', () => {
    const broken = card({ id: 'broken', starts_at: 'not-a-date' });
    expect(selectSimilarEvents(current, [broken], { now: NOW })).toEqual([]);
  });

  it('orders soonest-first within a tier, matching every other list on the site', () => {
    const later = card({ id: 'later', starts_at: inDays(20) });
    const sooner = card({ id: 'sooner', starts_at: inDays(5) });
    const result = selectSimilarEvents(current, [later, sooner], { now: NOW });
    expect(result.map((e) => e.id)).toEqual(['sooner', 'later']);
  });

  it('de-duplicates a pool that repeats an event', () => {
    const dupe = card({ id: 'dupe' });
    const result = selectSimilarEvents(current, [dupe, dupe, dupe], { now: NOW });
    expect(result).toHaveLength(1);
  });

  it('respects the limit', () => {
    const pool = Array.from({ length: 20 }, (_, i) => card({ id: `e${i}`, starts_at: inDays(i + 1) }));
    expect(selectSimilarEvents(current, pool, { now: NOW, limit: 3 })).toHaveLength(3);
  });

  it('matches city case-insensitively — organisers type it freehand', () => {
    const shouty = card({ id: 'shouty', organization_id: 'org-b', category: 'other', city: 'HYDERABAD' });
    expect(selectSimilarEvents(current, [shouty], { now: NOW }).map((e) => e.id)).toEqual(['shouty']);
  });

  it('does not treat two uncategorised events as sharing a category', () => {
    const blankCurrent = card({ id: 'blank-current', category: '', city: 'Delhi', organization_id: 'org-a' });
    const blankOther = card({ id: 'blank-other', category: '', city: 'Mumbai', organization_id: 'org-b' });
    // "" means NOT CATEGORISED, which is a fact rather than a shared trait.
    expect(selectSimilarEvents(blankCurrent, [blankOther], { now: NOW })).toEqual([]);
  });
});

describe('isOrganiserRail', () => {
  it('is true only when every card is the same organiser, so the heading can name them', () => {
    const mine = card({ id: 'mine', organization_id: 'org-a' });
    const theirs = card({ id: 'theirs', organization_id: 'org-b' });
    expect(isOrganiserRail(current, [mine])).toBe(true);
    expect(isOrganiserRail(current, [mine, theirs])).toBe(false);
  });

  it('is false for an empty rail', () => {
    expect(isOrganiserRail(current, [])).toBe(false);
  });
});
