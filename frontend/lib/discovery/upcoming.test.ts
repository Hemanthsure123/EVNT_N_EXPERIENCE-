import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURED_COUNT, HOME_UPCOMING_SIZE, featuredFrom } from './upcoming';

/**
 * "FEATURED EVENTS" IS THE FIRST FIVE OF "ALL EVENTS".
 *
 * The two landing-page sections used to read two sources — an operator's CMS
 * collection and `GET /events` — and could disagree on one screen about what
 * was on next. Every assertion here fails silently if it regresses: two lists
 * that differ still render perfectly.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('featuredFrom', () => {
  it('takes the first five, in the order the server sent', () => {
    const events = Array.from({ length: 12 }, (_, index) => `event-${index}`);
    expect(featuredFrom(events)).toEqual(['event-0', 'event-1', 'event-2', 'event-3', 'event-4']);
  });

  it('returns what there is when there are fewer than five', () => {
    expect(featuredFrom(['only'])).toEqual(['only']);
    expect(featuredFrom([])).toEqual([]);
  });

  it('never re-sorts', () => {
    // The ORDER is the server's (`PUBLIC_LIST_ORDERING`). A second sort here
    // would be a second source of truth for it.
    expect(featuredFrom(['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('is five, and fits inside the shared page', () => {
    expect(FEATURED_COUNT).toBe(5);
    expect(FEATURED_COUNT).toBeLessThanOrEqual(HOME_UPCOMING_SIZE);
  });
});

describe('both sections read the same query', () => {
  it('Featured reads fetchUpcomingEvents and not its own list', () => {
    const source = read('components/discovery/showcase.tsx');
    expect(source).toContain('fetchUpcomingEvents()');
    expect(source).toContain('featuredFrom(');
    // The two ways it used to diverge: its own fetch, and the CMS collection.
    expect(source).not.toContain('fetchEventsSafe(');
    // Matched on the CODE form it used to take, not the word: the file's own
    // docstring explains the change and mentions the field by name.
    expect(source).not.toContain('collections?.featured');
    expect(source).not.toContain("Homepage['collections']");
  });

  it('All Events reads the same call', () => {
    const source = read('components/discovery/all-events.tsx');
    expect(source).toContain('fetchUpcomingEvents()');
    expect(source).not.toContain('fetchEventsSafe(');
  });
});
