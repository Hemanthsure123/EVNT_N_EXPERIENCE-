import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { EventRow } from '@/lib/api/organizer';
import { LIFECYCLE_FILTERS, STATUS_FILTERS } from '@/lib/organizer/event-status';

vi.mock('@/lib/organizer/queries', () => ({
  useInvalidateOrganizer: () => vi.fn(),
}));

import { EventDeck } from './manage-events';

/**
 * THE PROPERTIES WORTH PINNING ON THE EVENT DECK.
 *
 * Not how it looks. What it CLAIMS, and what it refuses to claim — because
 * every one of these fails silently: a link that drops its event id still
 * navigates, a Scan desk offered on a draft still looks like a button, and a
 * count with no floor still shows a number.
 */

const row = (over: Partial<EventRow> = {}): EventRow => ({
  id: 'evt-1',
  title: 'Midnight Comedy',
  status: 'live',
  venue: 'Phoenix Marketcity',
  city: 'Mumbai',
  starts_at: '2026-03-14T13:30:00Z',
  ends_at: null,
  poster_url: '',
  organization_id: 'org-1',
  organization_name: 'Night Owl',
  organization_verified_level: 'verified',
  ticket_type_count: 2,
  capacity: 500,
  sold: 128,
  revenue_minor: 12_800_00,
  checkins: 0,
  from_price_minor: 40_000,
  tickets_available: 372,
  version: 3,
  created_at: '2026-01-01T00:00:00Z',
  moderation_note: '',
  submitted_at: null,
  ...over,
});

const deck = (rows: EventRow[], hasMore = false) =>
  render(
    <EventDeck
      rows={rows}
      isSelected={() => false}
      onToggle={vi.fn()}
      onOpen={vi.fn()}
      hasMore={hasMore}
    />,
  );

describe('the action row', () => {
  it('carries the event id into every place it sends you', () => {
    // The whole difference between this row and four decorations. A link that
    // loses the id still navigates, to a screen about a different event.
    deck([row()]);

    expect(screen.getByRole('link', { name: 'Scan desk' }).getAttribute('href')).toBe(
      '/dashboard/check-in?event=evt-1',
    );
    expect(screen.getByRole('link', { name: 'Analytics' }).getAttribute('href')).toBe(
      '/dashboard/events/evt-1/analytics',
    );
    expect(screen.getByRole('link', { name: 'Reviews' }).getAttribute('href')).toBe(
      '/dashboard/reviews?event=evt-1',
    );
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe(
      '/dashboard/events/evt-1/edit',
    );
  });

  it('does not pretend Payouts is scoped to the event', () => {
    // One settlement per event, and no event filter on the endpoint. Scoping
    // it here would mean searching the loaded page in the browser and
    // reporting "nothing" for an event whose row is on the next one.
    deck([row()]);
    expect(screen.getByRole('link', { name: 'Payouts' }).getAttribute('href')).toBe(
      '/dashboard/payouts',
    );
  });

  it('offers the GATE LIST once the event is past its sale window', () => {
    // After the night, "who came" is the question and the desk has nothing
    // left to scan — the same tile position, the other half of the job.
    deck([row({ status: 'finished' })]);
    expect(screen.getByRole('link', { name: 'Attendees' }).getAttribute('href')).toBe(
      '/dashboard/events/evt-1/attendees',
    );
    expect(screen.queryByRole('link', { name: 'Scan desk' })).toBeNull();
  });

  it('refuses the scan desk on an event that is not published, and says why', () => {
    // `event_id` is what the backend authorizes and wrong-event-checks
    // against. A gate stationed at an event it cannot scan denies a whole
    // queue of valid tickets — so this is not a link at all.
    deck([row({ status: 'draft' })]);

    expect(screen.queryByRole('link', { name: 'Scan desk' })).toBeNull();
    expect(screen.getByText(/scan desk opens once the event is published/i)).toBeTruthy();
  });
});

describe('archive, and the delete that does not exist', () => {
  it('offers archive on a draft', () => {
    deck([row({ status: 'draft' })]);
    expect(screen.getByRole('button', { name: 'Archive Midnight Comedy' })).toBeTruthy();
  });

  it('refuses it on a published event, with the reason on the control', () => {
    // `POST /events/{id}/archive` takes draft, rejected and finished only —
    // archiving something people hold tickets to hides it while the tickets
    // stay valid.
    deck([row({ status: 'live' })]);
    expect(screen.queryByRole('button', { name: 'Archive Midnight Comedy' })).toBeNull();
    expect(screen.getByText(/Archive Midnight Comedy \(not available\)/)).toBeTruthy();
  });

  it('never offers a delete', () => {
    // An event is referenced by bookings, tickets and a settlement, all
    // `PROTECT`ed. A delete control could only refuse or orphan real money —
    // the reference design has one and this must not grow one.
    deck([row({ status: 'draft' }), row({ id: 'evt-2', status: 'finished' })]);
    expect(screen.queryByText(/delete/i)).toBeNull();
  });
});

describe('the numbers', () => {
  it('renders the loaded count as a FLOOR while more pages are waiting', () => {
    // The list is cursor-paginated with no `meta.count`, so a bare number here
    // would be a total nobody computed.
    deck([row(), row({ id: 'evt-2' })], true);
    expect(screen.getByText(/^2\+ events loaded so far$/)).toBeTruthy();
  });

  it('drops the floor once the whole list is in', () => {
    deck([row(), row({ id: 'evt-2' })], false);
    expect(screen.getByText('2 events')).toBeTruthy();
  });

  it('says there are no tiers rather than drawing an empty meter', () => {
    // A 0/0 meter reads as "nothing has sold"; the truth is that nothing can.
    deck([row({ capacity: 0, sold: 0, ticket_type_count: 0 })]);
    expect(screen.getByText(/No ticket types yet/)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('measures sell-through against capacity', () => {
    deck([row({ capacity: 500, sold: 128 })]);
    const meter = screen.getByRole('progressbar', { name: '128 of 500 sold' });
    expect(meter.getAttribute('aria-valuenow')).toBe('26');
  });
});

describe('selection is a DESKTOP affordance', () => {
  it('keeps the checkbox out of the layout below `lg`', () => {
    // The bulk bar is a floating pill in the same corner as the organizer's
    // bottom navigation. Nothing below `lg` can be selected, so that bar can
    // never appear there and the two can never collide.
    deck([row()]);
    const label = screen.getByLabelText('Select Midnight Comedy').closest('label');
    expect(label).not.toBeNull();
    const classes = (label as HTMLElement).className.split(' ');
    expect(classes).toContain('hidden');
    expect(classes).toContain('lg:inline-flex');
  });
});

describe('the lifecycle pills share the table’s vocabulary', () => {
  it('is a subset of the stored statuses, never a third vocabulary', () => {
    // The pills and the desktop select write the SAME `?status=` param. A
    // value here that the select does not know is a filter the rest of the
    // screen cannot describe or clear.
    const known = new Set(STATUS_FILTERS.map((option) => option.value));
    for (const option of LIFECYCLE_FILTERS) {
      expect(known.has(option.value)).toBe(true);
    }
  });

  it('opens on All, and offers exactly the three lifecycles under it', () => {
    expect(LIFECYCLE_FILTERS[0].value).toBe('');
    expect(LIFECYCLE_FILTERS.map((option) => option.label)).toEqual([
      'All',
      'Live',
      'Past',
      'Drafts',
    ]);
  });
});

describe('the card head', () => {
  it('names the event and its state, and nothing it cannot back', () => {
    const view = deck([row({ status: 'live', capacity: 500, sold: 480 })]);
    const card = view.container.querySelector('article');
    expect(card).not.toBeNull();
    // 480/500 is past the 85% threshold, so the badge is the DERIVED fact
    // rather than the stored one.
    expect(within(card as HTMLElement).getByText('Selling fast')).toBeTruthy();
    expect(within(card as HTMLElement).getByText('Midnight Comedy')).toBeTruthy();
  });
});
