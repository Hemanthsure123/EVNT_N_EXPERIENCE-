import { api } from './client';
import type { Paginated } from './types';

/**
 * ── THE REFUND REQUEST LIFECYCLE ──────────────────────────────────────────
 *
 * ONE module for all three audiences — the customer who asks, the organizer
 * who decides, and the operator who oversees — because they are three views of
 * the same row and three clients is how they drift into disagreeing about what
 * was decided.
 *
 * ── A REQUEST IS NOT A REFUND ─────────────────────────────────────────────
 *
 * The distinction runs through every type here and is worth stating once. A
 * `Refund` (see `lib/api/organizer.ts`) is money that has ALREADY moved — the
 * backend writes one only after the vendor call succeeded, so every row in that
 * list is a completed fact. A `RefundRequest` is somebody ASKING, and it has a
 * lifecycle with a human decision in the middle.
 *
 * That is why `approved` does not mean "refunded": approval enqueues the
 * vendor call, and the money arriving is a separate fact the customer is told
 * about separately. Any UI here that says "refunded" on an `approved` row is
 * lying about where somebody's money is.
 *
 * `failed` is the fourth state and the one most likely to be forgotten: the
 * approval stood but the money did not move. It must not render as a success.
 */

export type RefundRequestStatus = 'pending' | 'approved' | 'rejected' | 'failed';

export type RefundRequest = {
  id: string;
  status: RefundRequestStatus;
  /** The customer's own words. Shown to the decider unedited. */
  reason: string;
  /**
   * Shown to the CUSTOMER. Required by the backend on a rejection — a refusal
   * with no reason is what turns a declined refund into a chargeback, and it
   * is the only part of a refusal anybody reads.
   */
  decision_note: string;
  created_at: string;
  decided_at: string | null;
  decided_by_email: string | null;
  booking_id: string;
  /**
   * What would ACTUALLY be refunded, read from the booking. A request carries
   * no amount of its own: approving refunds the payment in full, because there
   * is no partial-refund path in this system, and a field the executor would
   * ignore is a field that silently discards what was typed.
   */
  booking_total_minor: number;
  booking_status: string;
  requested_by_email: string;
  requested_by_name: string;
  event_id: string;
  event_title: string;
  event_starts_at: string;
};

/* ── The customer's half ────────────────────────────────────────────────── */

/**
 * Ask for a refund on your own paid booking.
 *
 * `409 refund_request_already_open` when one is already outstanding — one open
 * request per booking, enforced by a partial unique index rather than by a
 * check that could lose a race.
 *
 * `409 booking_not_refundable` when the booking was never paid. A lapsed hold
 * released its own inventory and was never charged.
 */
export const requestRefund = (bookingId: string, reason: string) =>
  api.post<RefundRequest>(`/bookings/${encodeURIComponent(bookingId)}/refund-requests`, { reason });

/** What I asked for, and what happened — the status that used to be an email thread. */
export const fetchMyRefundRequests = (params: { status?: string; cursor?: string } = {}) =>
  api.get<Paginated<RefundRequest>>(`/me/refund-requests${query(params)}`);

/* ── The organizer's and operator's half ─────────────────────────────────── */

/** The queue an organizer works through. Pending is FIFO — oldest first. */
export const fetchOrganizerRefundRequests = (params: { status?: string; cursor?: string } = {}) =>
  api.get<Paginated<RefundRequest>>(`/organizer/refund-requests${query(params)}`);

/** Platform-wide. Staff only. */
export const fetchAdminRefundRequests = (params: { status?: string; cursor?: string } = {}) =>
  api.get<Paginated<RefundRequest>>(`/admin/refund-requests${query(params)}`);

/**
 * Approve or reject.
 *
 * ONE endpoint for the organizer AND the operator — the rule (own the event, or
 * be staff) lives in the backend service, and a second admin-only route would
 * only be a second place for it to drift.
 *
 * `409 refund_request_already_decided` when somebody else got there first. That
 * is a real outcome on a queue two people work, not an error to swallow: the
 * loser must be told their click did nothing rather than believing they
 * rejected something already approved and refunded.
 */
export const decideRefundRequest = (requestId: string, approve: boolean, note = '') =>
  api.post<RefundRequest>(`/refund-requests/${encodeURIComponent(requestId)}/decide`, {
    approve,
    note,
  });

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

/**
 * How a status should READ, in one place.
 *
 * Centralised because the same row appears on three surfaces and the four
 * states are easy to describe wrongly. In particular `approved` must never be
 * worded as "refunded", and `failed` must never render as a success — those
 * two are the whole reason a request and a refund are different objects.
 */
export const REFUND_REQUEST_LABELS: Record<
  RefundRequestStatus,
  { label: string; customerHint: string; tone: 'pending' | 'positive' | 'neutral' | 'negative' }
> = {
  pending: {
    label: 'Awaiting decision',
    customerHint: 'The organiser has not decided yet. You will get an email either way.',
    tone: 'pending',
  },
  approved: {
    label: 'Approved',
    // Deliberately not "Refunded". The money has not necessarily moved yet.
    customerHint:
      'Approved and being processed. Banks take 5–7 working days for cards, 1–3 for UPI.',
    tone: 'positive',
  },
  rejected: {
    label: 'Declined',
    customerHint: 'Your ticket is still valid and will still admit you.',
    tone: 'neutral',
  },
  failed: {
    label: 'Could not be processed',
    customerHint: 'It was approved but the refund did not go through. Contact support.',
    tone: 'negative',
  },
};
