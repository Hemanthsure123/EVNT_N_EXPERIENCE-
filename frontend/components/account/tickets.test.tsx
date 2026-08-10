import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { MyTickets } from './tickets';

/**
 * The ticket wallet. Two things here are worth a test:
 *
 *  1. **The code sheet closes.** It could not. `TicketSheet` derived its own
 *     open state as `startAt >= 0` while the parent passed `0` for "nothing
 *     selected" — so pressing the X set the state that reopened it at index 0,
 *     and the dialog was undismissable for as long as the account held one
 *     scannable ticket. An index is a position; it was carrying "is this open"
 *     as well, and the two disagreed.
 *
 *  2. **One booking is one card.** Twelve tickets drew twelve identical cards
 *     and buried every other booking beneath them.
 *
 * The rest of this screen is presentation.
 */

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ api: { get, post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/lib/api/refund-requests', () => ({
  fetchMyRefundRequests: () => Promise.resolve({ data: [], meta: { next: null } }),
  REFUND_REQUEST_LABELS: {
    pending: { label: 'Pending', customerHint: '' },
    approved: { label: 'Approved', customerHint: '' },
    rejected: { label: 'Rejected', customerHint: '' },
    failed: { label: 'Failed', customerHint: '' },
  },
}));
// The wallet now renders the pending-review card, which fetches through the
// same mocked `api.get` and would be handed the TICKET payload — every ticket
// arriving as a pending review, and four extra `article`s in the counts below.
// Stubbed rather than fed a second fixture: these tests are about the wallet.
vi.mock('@/components/reviews/review-prompt', () => ({
  PendingReviewCard: () => null,
}));
// The QR renderer draws to a canvas jsdom does not implement. The codes are not
// what these tests are about.
vi.mock('@/components/booking/qr-code', () => ({
  TicketQrCode: () => <div data-testid="qr" />,
}));

function ticket(index: number, bookingId = 'bk-1') {
  return {
    id: `t-${index}`,
    booking_id: bookingId,
    event_id: 'ev-1',
    event_title: 'Techie Summit',
    ticket_type_name: 'PREMIUM FOOD',
    status: 'active',
    created_at: '2026-08-09T10:00:00Z',
    qr_token: `v1.token${index}.sig`,
  };
}

function renderWallet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MyTickets />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({
    data: [ticket(1), ticket(2), ticket(3), ticket(4)],
    meta: { next: null },
  });
});

describe('MyTickets', () => {
  it('draws ONE card for a booking of four, not four', async () => {
    renderWallet();
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    // The count is what the four duplicate cards were previously conveying.
    expect(screen.getByText('4 tickets')).toBeInTheDocument();
  });

  it('opens the code sheet and CLOSES it again', async () => {
    const user = userEvent.setup();
    renderWallet();

    const open = await screen.findByRole('button', { name: /show 4 codes/i });
    await user.click(open);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^close$/i }));

    // The regression: this stayed on screen. `queryByRole` rather than a
    // negated `find`, so a dialog that never closes fails here rather than
    // timing out somewhere else.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reopens cleanly after being closed', async () => {
    // The bug made the FIRST close impossible; a fix that closed once and then
    // refused to reopen would be a different bug with the same symptom.
    const user = userEvent.setup();
    renderWallet();

    const open = await screen.findByRole('button', { name: /show 4 codes/i });
    await user.click(open);
    await user.click(screen.getByRole('button', { name: /^close$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /show 4 codes/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('keeps separate bookings on separate cards', async () => {
    get.mockResolvedValue({
      data: [ticket(1, 'bk-1'), ticket(2, 'bk-1'), ticket(3, 'bk-2')],
      meta: { next: null },
    });
    renderWallet();
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  });
});
