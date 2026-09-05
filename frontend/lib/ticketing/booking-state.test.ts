import { describe, expect, it } from 'vitest';
import type { MyBooking } from '@/lib/api/types';
import type { RefundRequest } from '@/lib/api/refund-requests';
import { bookingRef, bookingState, eventEndsAt, holdIsLive, refundSettled } from './booking-state';

/**
 * The rules a component would get wrong silently.
 *
 * Every case here files a booking under the WRONG CHIP if it breaks, which on
 * screen looks like a booking that has vanished — no error, nothing to click,
 * and the row is simply not in the list somebody is scrolling. That is exactly
 * the class of failure a pure module plus a test exists to catch, and none of
 * it is visible by looking at a list that renders.
 */

const NOW = Date.parse('2026-06-01T12:00:00Z');
const FUTURE = '2026-07-01T18:00:00Z';
const PAST = '2026-05-01T18:00:00Z';

function booking(overrides: Partial<MyBooking> = {}): MyBooking {
  return {
    id: '9f8e7d6c-1111-2222-3333-444455556666',
    status: 'paid',
    created_at: '2026-04-01T10:00:00Z',
    hold_expires_at: null,
    payment_order_id: 'order_x',
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
    items: [],
    ...overrides,
  };
}

function request(overrides: Partial<RefundRequest> = {}): RefundRequest {
  return {
    id: 'rfr_1',
    status: 'approved',
    reason: 'Cannot attend',
    decision_note: '',
    created_at: '2026-05-02T10:00:00Z',
    decided_at: '2026-05-02T11:00:00Z',
    decided_by_email: 'organiser@example.com',
    booking_id: '9f8e7d6c-1111-2222-3333-444455556666',
    booking_total_minor: 101000,
    booking_status: 'paid',
    requested_by_email: 'buyer@example.com',
    requested_by_name: 'Asha',
    event_id: 'e1',
    event_title: 'Headline Show',
    event_starts_at: FUTURE,
    refund_reference: null,
    refund_amount_minor: null,
    refunded_at: null,
    ...overrides,
  };
}

describe('bookingState', () => {
  it('files a paid booking with live tickets and a future event as upcoming', () => {
    expect(bookingState(booking(), undefined, NOW)).toBe('upcoming');
  });

  it('files a paid booking whose event has passed as finished', () => {
    expect(bookingState(booking({ event_starts_at: PAST }), undefined, NOW)).toBe('finished');
  });

  it('prefers ends_at over starts_at, so an event still running is still upcoming', () => {
    // Started this morning, runs until tomorrow. `starts_at` alone would file a
    // multi-day festival as finished on its opening afternoon.
    const running = booking({ event_starts_at: '2026-06-01T09:00:00Z', event_ends_at: FUTURE });
    expect(bookingState(running, undefined, NOW)).toBe('upcoming');
  });

  it('files a used-up booking as finished even while the event is in the future', () => {
    const admitted = booking({ active_ticket_count: 0, used_ticket_count: 2 });
    expect(bookingState(admitted, undefined, NOW)).toBe('finished');
  });

  it('does NOT call an approved-but-unpaid refund "refunded"', () => {
    // THE distinction this whole two-table design exists for. Approval enqueues
    // the vendor call; the money moving is a separate fact, sometimes days
    // later. Filing this under Refunded tells somebody their money is back.
    const state = bookingState(booking(), request({ status: 'approved' }), NOW);
    expect(state).toBe('upcoming');
    expect(refundSettled(request({ status: 'approved' }))).toBe(false);
  });

  it('files a SETTLED refund as refunded, whatever the dates say', () => {
    const settled = request({ refund_reference: 'rfnd_abc', refunded_at: '2026-05-03T10:00:00Z' });
    expect(refundSettled(settled)).toBe(true);
    expect(bookingState(booking(), settled, NOW)).toBe('refunded');
  });

  it('catches a refund that never had a request — every ticket voided, none used', () => {
    // An organiser-initiated refund writes no `RefundRequest` at all, so a
    // screen reading the request alone would keep offering dead codes.
    const voided = booking({ active_ticket_count: 0, used_ticket_count: 0, ticket_count: 2 });
    expect(bookingState(voided, undefined, NOW)).toBe('refunded');
  });

  it('never calls a booking with no tickets at all "refunded"', () => {
    // Zero of zero is an UNPAID booking, not a refunded one. Without the
    // `ticket_count > 0` guard the two are indistinguishable.
    const unpaid = booking({ status: 'reserved', ticket_count: 0, active_ticket_count: 0 });
    expect(bookingState(unpaid, undefined, NOW)).toBe('unpaid');
  });

  it('files every non-paid status as unpaid', () => {
    for (const status of ['reserved', 'cancelled', 'expired'] as const) {
      expect(bookingState(booking({ status }), undefined, NOW)).toBe('unpaid');
    }
  });
});

describe('holdIsLive', () => {
  it('is true only for a reserved booking whose deadline is still ahead', () => {
    expect(holdIsLive(booking({ status: 'reserved', hold_expires_at: FUTURE }), NOW)).toBe(true);
    expect(holdIsLive(booking({ status: 'reserved', hold_expires_at: PAST }), NOW)).toBe(false);
    // A PAID booking's `hold_expires_at` is left behind on the row and means
    // nothing; reading it as a live hold would put a countdown on a ticket.
    expect(holdIsLive(booking({ status: 'paid', hold_expires_at: FUTURE }), NOW)).toBe(false);
  });
});

describe('eventEndsAt', () => {
  it('falls back to starts_at when the organiser stated no end', () => {
    expect(eventEndsAt({ event_starts_at: FUTURE, event_ends_at: null })).toBe(Date.parse(FUTURE));
  });
});

describe('bookingRef', () => {
  it('is the uuid prefix, upper-cased — not a new identifier', () => {
    expect(bookingRef('9f8e7d6c-1111-2222-3333-444455556666')).toBe('9F8E7D6C');
  });
});
