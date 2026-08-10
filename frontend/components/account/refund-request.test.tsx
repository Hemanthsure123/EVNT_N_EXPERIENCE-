import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import type * as RefundApi from '@/lib/api/refund-requests';
import { RefundRequestDialog } from './refund-request';

/**
 * The dialog that spends somebody's ticket.
 *
 * Two things are worth a test here and the rest is form plumbing:
 *
 *  1. **A multi-ticket booking says so before the button.** One request
 *     cancels every ticket on the booking. Somebody opening this from one
 *     card, seeing one event title, is one press from cancelling three others
 *     — the count is the only thing standing between them and that.
 *  2. **The two 409s read as answers, not failures.** `already_open` and
 *     `not_refundable` are states, and a person told only "something went
 *     wrong" retries a request that can never succeed.
 */

const requestRefund = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/refund-requests', async (importOriginal) => ({
  ...(await importOriginal<typeof RefundApi>()),
  requestRefund,
}));

function mount(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const TARGET = { bookingId: 'b-1', eventTitle: 'Sunburn Arena', ticketCount: 1 };

beforeEach(() => {
  requestRefund.mockReset();
});

describe('RefundRequestDialog', () => {
  it('names how many tickets the request would cancel', () => {
    mount(<RefundRequestDialog target={{ ...TARGET, ticketCount: 4 }} onClose={() => {}} />);

    expect(screen.getByText(/all 4 tickets would be cancelled together/i)).toBeInTheDocument();
  });

  it('does not say "all" for a single ticket', () => {
    mount(<RefundRequestDialog target={TARGET} onClose={() => {}} />);

    expect(screen.queryByText(/tickets would be cancelled together/i)).not.toBeInTheDocument();
    expect(screen.getByText(/stops working at the gate/i)).toBeInTheDocument();
  });

  it('refuses to send an empty reason', async () => {
    const user = userEvent.setup();
    mount(<RefundRequestDialog target={TARGET} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(requestRefund).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason for the booking', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    requestRefund.mockResolvedValue({ id: 'r-1', status: 'pending' });
    mount(<RefundRequestDialog target={TARGET} onClose={onClose} />);

    await user.type(screen.getByLabelText(/why are you asking/i), '  I cannot make the date  ');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(requestRefund).toHaveBeenCalledWith('b-1', 'I cannot make the date'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('explains an already-open request instead of reporting a generic failure', async () => {
    const user = userEvent.setup();
    requestRefund.mockRejectedValue(
      new ApiError(409, 'refund_request_already_open', 'Already open.'),
    );
    mount(<RefundRequestDialog target={TARGET} onClose={() => {}} />);

    await user.type(screen.getByLabelText(/why are you asking/i), 'Plans changed entirely');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/already an open request/i)).toBeInTheDocument();
  });

  it('explains an uncharged booking', async () => {
    const user = userEvent.setup();
    requestRefund.mockRejectedValue(
      new ApiError(409, 'booking_not_refundable', 'Not refundable.'),
    );
    mount(<RefundRequestDialog target={TARGET} onClose={() => {}} />);

    await user.type(screen.getByLabelText(/why are you asking/i), 'Plans changed entirely');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/never charged/i)).toBeInTheDocument();
  });

  it('clears the box between bookings', async () => {
    const user = userEvent.setup();
    const { rerender } = mount(<RefundRequestDialog target={TARGET} onClose={() => {}} />);

    await user.type(screen.getByLabelText(/why are you asking/i), 'Wrong date');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RefundRequestDialog
            target={{ ...TARGET, bookingId: 'b-2', eventTitle: 'Other show' }}
            onClose={() => {}}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText(/why are you asking/i)).toHaveValue('');
  });
});
