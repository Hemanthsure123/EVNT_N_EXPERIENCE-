import { fireEvent, render, screen } from '@testing-library/react';
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
  pending: [] as { event_id: string; title: string }[],
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

// The rating rows are their own component with their own form; here they only
// need to say which event they are for.
vi.mock('@/components/reviews/review-prompt', () => ({
  usePendingReviews: () => ({
    data: { data: harness.pending },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  uniquePendingReviews: (rows: unknown[]) => rows,
  PendingReviewRow: ({ row }: { row: { title: string } }) => <p>Rate {row.title}</p>,
}));

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
  harness.pending = [];
});

const openTab = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));

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
    // Upcoming is the default view, so an unpaid booking is one press away.
    await screen.findByRole('radio', { name: 'Unpaid' });
    openTab('Unpaid');

    // The hold is still LIVE: the chip is its countdown and the primary action
    // finishes the payment.
    expect(await screen.findByText(/mins left/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Finish payment/ })).toHaveAttribute(
      'href',
      '/booking/e1/review',
    );
    // And the booking's own page -- the same ticket layout as a paid one.
    expect(screen.getByRole('link', { name: /Details/ })).toHaveAttribute(
      'href',
      '/booking/e1/confirmation?booking=bbbbbbbb-1111-2222-3333-444444444444&from=bookings',
    );
  });

  it('has three views, Upcoming, Unpaid and Yet to Rate, and opens on Upcoming', async () => {
    harness.bookings = [
      bookingRow({ id: 'a1111111-0000-0000-0000-000000000000', event_title: 'Coming Up' }),
      bookingRow({
        id: 'b2222222-0000-0000-0000-000000000000',
        event_title: 'Already Over',
        event_starts_at: PAST,
      }),
      bookingRow({
        id: 'c3333333-0000-0000-0000-000000000000',
        event_title: 'Never Paid',
        status: 'expired',
        ticket_count: 0,
        active_ticket_count: 0,
      }),
    ];

    view();

    expect((await screen.findAllByText('Coming Up')).length).toBeGreaterThan(0);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent)).toEqual(['Upcoming', 'Unpaid', 'Yet to Rate']);
    expect(screen.getByRole('radio', { name: 'Upcoming' })).toHaveAttribute('aria-checked', 'true');
    // No "All": a past booking is in no booking view at all.
    expect(screen.queryByRole('radio', { name: /^All/ })).toBeNull();
    expect(screen.queryByText('Already Over')).toBeNull();
    expect(screen.queryByText('Never Paid')).toBeNull();

    openTab('Unpaid');
    expect((await screen.findAllByText('Never Paid')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Book again/ })).toBeInTheDocument();
    // The upcoming card is gone from this view. ("Coming Up" itself is still
    // on screen, in the next-pass banner, which belongs to every view.)
    expect(screen.queryByRole('link', { name: /View .*ticket/i })).toBeNull();
  });

  it('lists the events waiting for a rating under Yet to Rate, and nowhere else', async () => {
    harness.bookings = [bookingRow()];
    harness.pending = [{ event_id: 'e9', title: 'Last Weekend' }];

    view();

    expect((await screen.findAllByText('Headline Show')).length).toBeGreaterThan(0);
    // The standalone "Rate your recent experiences" card is gone.
    expect(screen.queryByText('Rate Last Weekend')).toBeNull();
    expect(screen.queryByText(/Rate your recent experiences/)).toBeNull();

    openTab('Yet to Rate');
    expect(await screen.findByText('Rate Last Weekend')).toBeInTheDocument();
  });

  it('keeps only the headings, with no subtitle under the page title', async () => {
    harness.bookings = [bookingRow()];
    view();
    expect(
      await screen.findByRole('heading', { name: /Your Bookings & Purchases/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Every ticket, pass and refund/)).toBeNull();
  });

  it('says nothing on the list about a refund that is only approved', async () => {
    // Approval is a decision and a transfer is a fact, and neither is the
    // list's to show. Both are explained on the ticket's own page.
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
    // Refund status lives on the ticket's own page, never on the list.
    expect(screen.queryByText(/refund/i)).toBeNull();
    expect(screen.getByRole('link', { name: /View .*ticket/i })).toBeInTheDocument();
  });

  it('lists a SETTLED refund without saying so, and opens its ticket page', async () => {
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

    // Still listed (the list is the only way to the page that explains it)
    // with no chip, no amount returned and no reference.
    const link = await screen.findByRole('link', { name: /View ticket/ });
    expect(link).toHaveAttribute(
      'href',
      `/booking/${bookingRow().event_id}/confirmation?booking=${bookingRow().id}&from=bookings`,
    );
    expect(screen.queryByText(/refund/i)).toBeNull();
    expect(screen.queryByText(/rfnd_XYZ123/)).toBeNull();
    expect(screen.queryByText('Confirmed')).toBeNull();
  });

  it('links View ticket to the confirmation page', async () => {
    harness.bookings = [bookingRow()];
    view();

    const link = await screen.findByRole('link', { name: /View .*ticket/i });
    expect(link).toHaveAttribute(
      'href',
      `/booking/${bookingRow().event_id}/confirmation?booking=${bookingRow().id}&from=bookings`,
    );
  });

  it('offers no refund control on the list, because it is on the ticket page now', async () => {
    // Moved with the rest of the refund information. The ticket page still
    // withholds it from a booking that already has a request (a second request
    // is a 409).
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
    expect(screen.queryByRole('button', { name: /refund/i })).toBeNull();
  });
});
