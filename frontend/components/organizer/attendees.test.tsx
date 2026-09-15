import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendeeRow } from '@/lib/api/organizer';

/**
 * THE GATE LIST — the claims a steward acts on.
 *
 * Everything pinned here is something that would be wrong without ever
 * throwing: a count that describes one page instead of the door, a phone number
 * under the wrong name, a voided ticket that reads like somebody to expect.
 */

const harness = vi.hoisted(() => ({
  rows: [] as AttendeeRow[],
  hasNextPage: false,
  count: null as number | null,
  attendance: { admitted: 0, capacity: 0 },
  params: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(harness.params),
}));

vi.mock('@/lib/organizer/queries', () => ({
  useEventAttendees: () => ({
    data: { pages: [{ data: harness.rows, meta: { next: null, previous: null, count: harness.count } }] },
    isPending: false,
    isError: false,
    hasNextPage: harness.hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/api/organizer-writes', () => ({
  fetchAttendance: () => Promise.resolve(harness.attendance),
}));

import { EventAttendees } from './attendees';

const row = (over: Partial<AttendeeRow> = {}): AttendeeRow => ({
  ticket_id: 't-1',
  holder_name: 'Asha Rao',
  holder_email: 'asha@example.com',
  is_reassigned: false,
  buyer_name: 'Asha Rao',
  buyer_email: 'asha@example.com',
  phone: '',
  ticket_type_id: 'tier-1',
  ticket_type: 'Gold',
  status: 'active',
  used_at: null,
  gate: '',
  booking_id: 'b-1',
  created_at: '2026-03-01T10:00:00Z',
  ...over,
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventAttendees eventId="evt-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  harness.rows = [row()];
  harness.hasNextPage = false;
  harness.count = null;
  harness.attendance = { admitted: 0, capacity: 0 };
  harness.params = '';
});

describe('one row per ticket', () => {
  it('draws a row per ticket, not per booking', () => {
    // Two seats on one booking is two people through a door.
    harness.rows = [
      row({ ticket_id: 't-1', holder_name: 'Asha Rao' }),
      row({ ticket_id: 't-2', holder_name: 'Priya Nair', is_reassigned: true }),
    ];
    mount();
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('Priya Nair')).toBeTruthy();
  });

  it('names the buyer when the ticket was addressed to somebody else', () => {
    harness.rows = [
      row({
        holder_name: 'Priya Nair',
        holder_email: 'priya@example.com',
        is_reassigned: true,
        buyer_name: 'Asha Rao',
        buyer_email: 'asha@example.com',
      }),
    ];
    mount();
    expect(screen.getByText('Booked by Asha Rao')).toBeTruthy();
  });
});

describe('the counts', () => {
  it('takes "inside now" from the attendance endpoint, not from the loaded rows', async () => {
    // `checkin` reconciles its counter against the used-ticket count in the
    // database — the SAME figure the scan desk shows.
    harness.rows = [row({ status: 'used', used_at: '2026-03-14T14:00:00Z' })];
    harness.attendance = { admitted: 312, capacity: 500 };
    mount();
    expect(await screen.findByText('312')).toBeTruthy();
    expect(screen.getByText('/ 500')).toBeTruthy();
  });

  it('shows a dash rather than a zero before attendance resolves', () => {
    mount();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('says "X of Y" when the server sent the total', () => {
    harness.rows = [row({ ticket_id: 't-1' }), row({ ticket_id: 't-2' })];
    harness.hasNextPage = true;
    harness.count = 5;
    mount();
    expect(screen.getByText('Showing 2 of 5 attendees')).toBeTruthy();
  });

  it('falls back to a FLOOR when there is no total and more pages remain', () => {
    harness.rows = [row({ ticket_id: 't-1' }), row({ ticket_id: 't-2' })];
    harness.hasNextPage = true;
    mount();
    expect(screen.getByText('Showing 2+ attendees')).toBeTruthy();
  });
});

describe('the contact details', () => {
  it('makes the email and the phone links', () => {
    harness.rows = [row({ phone: '+919876543210' })];
    mount();
    expect(screen.getByRole('link', { name: '+919876543210' }).getAttribute('href')).toBe(
      'tel:+919876543210',
    );
    expect(screen.getByRole('link', { name: 'asha@example.com' }).getAttribute('href')).toBe(
      'mailto:asha@example.com',
    );
  });

  it('never shows a phone on a re-addressed ticket', () => {
    // The server blanks it; this asserts the screen does not reintroduce the
    // buyer's number under somebody else's name.
    harness.rows = [
      row({ holder_name: 'Priya Nair', is_reassigned: true, phone: '', buyer_name: 'Asha Rao' }),
    ];
    mount();
    expect(screen.queryByRole('link', { name: /^\+?\d/ })).toBeNull();
  });
});

describe('what a ticket says at the door', () => {
  it('reads "Checked in" with the gate', () => {
    harness.rows = [row({ status: 'used', used_at: '2026-03-14T14:05:00Z', gate: 'Gate A' })];
    const view = mount();
    const card = view.container.querySelector('article');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('Checked in')).toBeTruthy();
    expect(within(card as HTMLElement).getByText(/Gate A/)).toBeTruthy();
  });

  it('reads "Not valid" on a void ticket, never "Cancelled", and still lists it', () => {
    harness.rows = [row({ status: 'void', holder_name: 'Asha Rao' })];
    const view = mount();
    // Scoped to the row: "Not valid" is also a choice in the status filter.
    const card = view.container.querySelector('article') as HTMLElement;
    expect(within(card).getByText('Not valid')).toBeTruthy();
    expect(within(card).getByText('Asha Rao')).toBeTruthy();
    expect(screen.queryByText(/cancelled/i)).toBeNull();
  });

  it('carries an initial rather than inventing an avatar', () => {
    harness.rows = [row({ holder_name: 'Priya Nair' })];
    mount();
    expect(screen.getByText('P')).toBeTruthy();
  });
});

describe('the export', () => {
  it('says how many rows it covers and that more are waiting', () => {
    harness.rows = [row({ ticket_id: 't-1' }), row({ ticket_id: 't-2' })];
    harness.hasNextPage = true;
    mount();
    expect(screen.getByText(/Export covers the 2 rows loaded so far/)).toBeTruthy();
  });

  it('is disabled when there is nothing to export', () => {
    harness.rows = [];
    mount();
    expect((screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('the filters mirror the reference', () => {
  it('offers All Status and Sort by Booking Date, and says which sort narrows the list', () => {
    mount();
    expect(screen.getByRole('option', { name: 'All Status' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Sort by Booking Date' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /checked in only/i })).toBeTruthy();
  });
});

describe('the empty states are different', () => {
  it('blames the filters when there are filters', () => {
    harness.rows = [];
    harness.params = 'q=nobody';
    mount();
    expect(screen.getByText(/Nobody matches those filters/i)).toBeTruthy();
  });

  it('explains when nothing has sold yet', () => {
    harness.rows = [];
    mount();
    expect(screen.getByText(/No tickets have been issued/i)).toBeTruthy();
  });
});
