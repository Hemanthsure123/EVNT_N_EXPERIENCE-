import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendeeRow } from '@/lib/api/organizer';

/**
 * THE GATE LIST — the claims a steward acts on.
 *
 * Everything pinned here is something that would be wrong without ever
 * throwing: a count that describes one page instead of the door, a phone
 * number under the wrong name, a voided ticket that reads like somebody to
 * expect.
 */

const harness = vi.hoisted(() => ({
  rows: [] as AttendeeRow[],
  hasNextPage: false,
  attendance: { admitted: 0, capacity: 0 },
  params: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(harness.params),
}));

vi.mock('@/lib/organizer/queries', () => ({
  useEventAttendees: () => ({
    data: { pages: [{ data: harness.rows, meta: { next: null } }] },
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
  harness.attendance = { admitted: 0, capacity: 0 };
  harness.params = '';
});

describe('one row per ticket', () => {
  it('draws a card per ticket, not per booking', () => {
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
    // Somebody has to be asked about it, and once a ticket is re-addressed the
    // buyer has no other way to be seen on this screen.
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

describe('the live count', () => {
  it('comes from the attendance endpoint, not from counting the loaded rows', async () => {
    // `checkin` reconciles its Redis counter against the used-ticket count in
    // the database, so this is the SAME figure the scan desk shows. Counting
    // `status === 'used'` here would describe one page and disagree with the
    // desk on the same event.
    harness.rows = [row({ status: 'used', used_at: '2026-03-14T14:00:00Z' })];
    harness.attendance = { admitted: 312, capacity: 500 };
    mount();

    expect(await screen.findByText('312')).toBeTruthy();
    expect(screen.getByText('/ 500')).toBeTruthy();
  });

  it('renders the loaded-ticket count as a FLOOR while pages remain', () => {
    harness.rows = [row({ ticket_id: 't-1' }), row({ ticket_id: 't-2' })];
    harness.hasNextPage = true;
    mount();
    expect(screen.getByText(/^2\+ tickets loaded$/)).toBeTruthy();
  });

  it('shows a dash rather than a zero before attendance resolves', () => {
    // "0 inside" and "we have not asked yet" look identical to a careless
    // renderer and completely different to somebody working a door.
    mount();
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('the phone number', () => {
  it('is a tel: link when it belongs to the person being admitted', () => {
    harness.rows = [row({ phone: '+919876543210' })];
    mount();
    const link = screen.getByRole('link', { name: '+919876543210' });
    expect(link.getAttribute('href')).toBe('tel:+919876543210');
  });

  it('is absent on a re-addressed ticket', () => {
    // The server blanks it — nothing stores an assigned attendee's number, and
    // the buyer's under somebody else's name is how a steward rings the wrong
    // person. This asserts the screen does not reintroduce it from `buyer_*`.
    harness.rows = [
      row({ holder_name: 'Priya Nair', is_reassigned: true, phone: '', buyer_name: 'Asha Rao' }),
    ];
    mount();
    expect(screen.queryByRole('link', { name: /^\+?\d/ })).toBeNull();
  });
});

describe('what a ticket says at the door', () => {
  it('reads "Checked in" with the time and the gate', () => {
    harness.rows = [
      row({ status: 'used', used_at: '2026-03-14T14:05:00Z', gate: 'Gate A' }),
    ];
    const view = mount();
    const card = view.container.querySelector('article');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('Checked in')).toBeTruthy();
    expect(within(card as HTMLElement).getByText(/Gate A/)).toBeTruthy();
  });

  it('reads "Not valid" on a void ticket, never "Cancelled"', () => {
    // The reason could be a refund or a called-off event. What the steward
    // needs to know is only that it will be refused at the door.
    harness.rows = [row({ status: 'void' })];
    mount();
    expect(screen.getByText('Not valid')).toBeTruthy();
    expect(screen.queryByText(/cancelled/i)).toBeNull();
  });

  it('still lists a void ticket rather than hiding it', () => {
    // The person whose ticket was voided is exactly the one who turns up
    // anyway; hiding the row leaves a steward with no way to see why.
    harness.rows = [row({ status: 'void', holder_name: 'Asha Rao' })];
    mount();
    expect(screen.getByText('Asha Rao')).toBeTruthy();
  });

  it('carries initials rather than inventing an avatar', () => {
    // Nothing stores an attendee photograph, and a generated one would either
    // leak an email hash to a third party or draw a pattern that means nothing.
    harness.rows = [row({ holder_name: 'Asha Rao' })];
    mount();
    expect(screen.getByText('AR')).toBeTruthy();
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
    expect(
      (screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('the sort that narrows the list says so', () => {
  it('labels the admitted ordering as checked-in only', () => {
    // `used_at` is null for everybody still outside and a null in a cursor
    // keyset makes paging skip rows, so the server restricts that ordering.
    // A list that silently got shorter is worse than a longer option label.
    mount();
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
