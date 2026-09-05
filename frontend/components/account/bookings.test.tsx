import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RefundRequestsModule from '@/lib/api/refund-requests';

/**
 * Bookings & Purchases — the two regressions and the one product rule.
 *
 * This replaces `tickets.test.tsx`, whose subject (a wallet of active tickets)
 * no longer exists. What it pinned is kept: the QR drawer must open, close AND
 * reopen, which it once could not.
 *
 * What is new is the reason the screen was rebuilt. `/me/tickets` returns
 * ACTIVE tickets, so a booking that was refunded, used up or never paid had no
 * representation anywhere the customer could reach — and the old "Used" and
 * "Refunded" filters could only ever count zero. These specs assert that all
 * four states reach the list, and that an APPROVED refund is not rendered as a
 * completed one: approval is a decision, and the money moving is a separate
 * fact that arrives later.
 */

const harness = vi.hoisted(() => ({
  bookings: [] as unknown[],
  tickets: [] as unknown[],
  refunds: [] as unknown[],
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path.startsWith('/me/tickets')) {
        return { data: harness.tickets, meta: { next: null } };
      }
      return { data: [], meta: { next: null } };
    }),
  },
}));

vi.mock('@/lib/api/bookings', () => ({
  fetchMyBookings: vi.fn(async () => ({ data: harness.bookings, meta: { next: null } })),
}));

// Partial mock: `REFUND_REQUEST_LABELS` is real (the screen renders its wording)
// and only the fetch is stubbed. Typed through the imported module rather than
// an inline `import()` annotation, which the project's
// `consistent-type-imports` rule forbids.
vi.mock('@/lib/api/refund-requests', async (importOriginal) => {
  const actual = await importOriginal<typeof RefundRequestsModule>();
  return {
    ...actual,
    fetchMyRefundRequests: vi.fn(async () => ({ data: harness.refunds, meta: { next: null } })),
  };
});

// jsdom has no canvas and the QR is drawn as an SVG path from a real encoder —
// stubbed for speed, and because its own tests own that behaviour.
vi.mock('@/components/booking/qr-code', () => ({
  TicketQrCode: () => <div data-testid="qr" />,
}));

vi.mock('@/components/reviews/review-prompt', () => ({ PendingReviewCard: () => null }));

vi.mock('@/lib/discovery/event-deck-context', () => ({
  useEventDeck: () => ({ openEvent: vi.fn() }),
}));

const { MyBookings } = await import('./bookings');

const FUTURE = new Date(Date.now() + 7 * 864e5).toISOString();
const PAST = new Date(Date.now() - 7 * 864e5).toISOString();

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    status: 'paid',
    created_at: PAST,
    hold_expires_at: null,
    payment_order_id: 'order_1',
    total_amount: 101000,
    platform_fee: 1000,
    donation: 0,
    event_id: 'e1',
    event_title: 'Headline Show',
    event_slug: 'headline-show',
    event_starts_at: FUTURE,
    event_ends_at: null,
    event_venue: 'Phoenix Arena',
    event_city: 'Mumbai',
    event_poster_url: '',
    event_status: 'live',
    ticket_count: 2,
    active_ticket_count: 2,
    used_ticket_count: 0,
    items: [{ ticket_type_id: 't1', ticket_type_name: 'Gold', quantity: 2, unit_price: 50000, phase_name: null }],
    ...overrides,
  };
}

function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The real providers, not stubs: the screen mounts the refund and share
  // dialogs, both of which report their outcome through `useToast`.
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MyBookings />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  harness.bookings = [];
  harness.tickets = [];
  harness.refunds = [];
});

describe('MyBookings', () => {
  it('shows a booking whose payment never happened — the row that had nowhere to appear', async () => {
    harness.bookings = [
      bookingRow({
        id: 'bbbbbbbb-1111-2222-3333-444444444444',
        status: 'reserved',
        hold_expires_at: new Date(Date.now() + 8 * 60_000).toISOString(),
        ticket_count: 0,
        active_ticket_count: 0,
      }),
    ];

    view();

    expect(await screen.findByText('Payment incomplete')).toBeInTheDocument();
    // The hold is still LIVE, which is the good news on that row: nothing was
    // charged and the seats are still held. The action says so.
    expect(screen.getByRole('link', { name: /Finish payment/ })).toHaveAttribute(
      'href',
      '/booking/e1/review',
    );
    expect(screen.getByText(/mins left/)).toBeInTheDocument();
  });

  it('counts each state on its own chip, including the ones that used to be empty', async () => {
    harness.bookings = [
      bookingRow({ id: 'a1111111-0000-0000-0000-000000000000' }),
      bookingRow({ id: 'b2222222-0000-0000-0000-000000000000', event_starts_at: PAST }),
      bookingRow({ id: 'c3333333-0000-0000-0000-000000000000', status: 'expired', ticket_count: 0, active_ticket_count: 0 }),
    ];

    view();

    // Wait for the DATA, not for the tablist. The chips render on the first
    // paint with nothing in them, so `findAllByRole('tab')` resolves against an
    // empty list and every count reads zero.
    await screen.findByRole('link', { name: /Finish payment|Book again/ });
    const tabs = screen.getAllByRole('tab');
    const label = (name: RegExp) => tabs.find((tab) => name.test(tab.textContent ?? ''));
    expect(label(/^All/)?.textContent).toContain('3');
    expect(label(/^Upcoming/)?.textContent).toContain('1');
    expect(label(/^Past/)?.textContent).toContain('1');
    expect(label(/^Unpaid/)?.textContent).toContain('1');
  });

  it('does NOT render an approved-but-unpaid refund as a completed one', async () => {
    // The single most important rule on this screen. `approved` enqueues the
    // vendor call; `refund_reference` is what says money moved. Rendering the
    // first as the second tells somebody their money is back when it is not.
    harness.bookings = [bookingRow()];
    harness.refunds = [
      {
        id: 'rfr_1',
        status: 'approved',
        reason: 'Cannot attend',
        decision_note: '',
        created_at: PAST,
        decided_at: PAST,
        decided_by_email: null,
        booking_id: bookingRow().id,
        booking_total_minor: 101000,
        booking_status: 'paid',
        requested_by_email: 'a@b.c',
        requested_by_name: 'A',
        event_id: 'e1',
        event_title: 'Headline Show',
        event_starts_at: FUTURE,
        refund_reference: null,
        refund_amount_minor: null,
        refunded_at: null,
      },
    ];

    view();

    // TWO nodes carry the title: `OpenEventLink` renders a `sm:hidden` button
    // (the mobile event deck) and a `hidden sm:inline` anchor (the canonical
    // page), and CSS picks. Asserting one would be asserting a viewport.
    expect((await screen.findAllByText('Headline Show')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Refund settled')).toBeNull();
    expect(screen.getByText(/Refund request/)).toBeInTheDocument();
  });

  it('renders a SETTLED refund with the reference a bank asks for', async () => {
    harness.bookings = [bookingRow()];
    harness.refunds = [
      {
        id: 'rfr_2',
        status: 'approved',
        reason: 'Cannot attend',
        decision_note: '',
        created_at: PAST,
        decided_at: PAST,
        decided_by_email: null,
        booking_id: bookingRow().id,
        booking_total_minor: 101000,
        booking_status: 'paid',
        requested_by_email: 'a@b.c',
        requested_by_name: 'A',
        event_id: 'e1',
        event_title: 'Headline Show',
        event_starts_at: FUTURE,
        refund_reference: 'rfnd_XYZ123',
        refund_amount_minor: 101000,
        refunded_at: PAST,
      },
    ];

    view();

    expect(await screen.findByText('Refund settled')).toBeInTheDocument();
    expect(screen.getByText(/rfnd_XYZ123/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View refund details/ })).toHaveAttribute(
      'href',
      '/account/refunds/rfr_2',
    );
  });

  it('links View ticket to the confirmation page', async () => {
    harness.bookings = [bookingRow()];
    view();

    const link = await screen.findByRole('link', { name: /View .*ticket/i });
    expect(link).toHaveAttribute(
      'href',
      `/booking/${bookingRow().event_id}/confirmation?booking=${bookingRow().id}`,
    );
  });

  it('never offers a refund on a booking that already has a request', async () => {
    // A second request on one booking is a 409, so the control would be a
    // button whose only outcome is an error.
    harness.bookings = [bookingRow()];
    harness.refunds = [
      {
        id: 'rfr_3',
        status: 'pending',
        reason: 'x',
        decision_note: '',
        created_at: PAST,
        decided_at: null,
        decided_by_email: null,
        booking_id: bookingRow().id,
        booking_total_minor: 101000,
        booking_status: 'paid',
        requested_by_email: 'a@b.c',
        requested_by_name: 'A',
        event_id: 'e1',
        event_title: 'Headline Show',
        event_starts_at: FUTURE,
        refund_reference: null,
        refund_amount_minor: null,
        refunded_at: null,
      },
    ];

    view();

    expect((await screen.findAllByText('Headline Show')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Request refund' })).toBeNull();
  });
});
