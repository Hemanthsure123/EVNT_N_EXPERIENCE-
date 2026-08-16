/**
 * Grouped search suggestions, derived from the ONE search endpoint that exists
 * today (`GET /events?q=`).
 *
 * The backend has no dedicated suggest/autocomplete endpoint yet (BACKLOG.md
 * item 1), so one full-text query is fanned out into the groups the UI shows:
 * matching events directly, plus the distinct venues / organizers / cities
 * those matches sit in. That is genuinely useful — the venue and organizer
 * names come from real matching rows, not a guess — and it costs a single
 * index-backed request that the backend already caches.
 *
 * The `artist` group is declared in the vocabulary but never produced here:
 * the backend has no artist entity, and inventing one by chopping up event
 * titles would put wrong names in front of users. It lights up for free the
 * day a real suggest endpoint exists.
 */

import { fetchEvents } from '@/lib/api/events';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { eventPath } from '@/lib/events/ref';
import { browseHref } from '@/lib/discovery/filters';
import type { SuggestionGroup, SuggestionsProvider } from './types';

const MAX_EVENTS = 5;
/** Two per facet: the palette shows all groups at once without scrolling. */
const MAX_PER_FACET = 2;
/** One page is plenty to derive facets from, and keeps the request cheap. */
const SAMPLE_SIZE = 12;

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export const derivedSuggestions: SuggestionsProvider = async (query, options = {}) => {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const page = await fetchEvents(
    { q: trimmed, page_size: options.limit ?? SAMPLE_SIZE },
    { signal: options.signal },
  );
  const events = page.data;

  const groups: SuggestionGroup[] = [];

  if (events.length) {
    groups.push({
      type: 'event',
      label: 'Events',
      items: events.slice(0, MAX_EVENTS).map((event) => ({
        id: `event:${event.id}`,
        type: 'event',
        label: event.title,
        sublabel: `${event.venue}, ${event.city}`,
        href: eventPath(event),
      })),
    });
  }

  const venues = uniqueBy(events, (e) => e.venue).slice(0, MAX_PER_FACET);
  if (venues.length) {
    groups.push({
      type: 'venue',
      label: 'Venues',
      items: venues.map((event) => ({
        id: `venue:${event.venue}`,
        type: 'venue',
        label: event.venue,
        sublabel: event.city,
        href: browseHref({ q: event.venue }),
      })),
    });
  }

  const organizers = uniqueBy(events, (e) => e.organization_name).slice(0, MAX_PER_FACET);
  if (organizers.length) {
    groups.push({
      type: 'organizer',
      label: 'Organizers',
      items: organizers.map((event) => ({
        id: `organizer:${event.organization_id}`,
        type: 'organizer',
        label: event.organization_name,
        href: browseHref({ q: event.organization_name }),
      })),
    });
  }

  // Cities come from the matching rows first (they're demonstrably relevant),
  // topped up by any served city whose NAME matches what was typed — so
  // "mum" offers Mumbai even before an event in Mumbai comes back.
  const cityNames = uniqueBy(
    [
      ...events.map((e) => e.city),
      ...POPULAR_CITIES.filter((c) => c.name.toLowerCase().startsWith(trimmed.toLowerCase())).map(
        (c) => c.name,
      ),
    ],
    (name) => name,
  ).slice(0, MAX_PER_FACET);

  if (cityNames.length) {
    groups.push({
      type: 'city',
      label: 'Cities',
      items: cityNames.map((city) => ({
        id: `city:${city}`,
        type: 'city',
        label: city,
        sublabel: 'Browse this city',
        href: browseHref({ city }),
      })),
    });
  }

  return groups;
};
