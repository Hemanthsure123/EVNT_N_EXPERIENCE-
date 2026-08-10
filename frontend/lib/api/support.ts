import { api } from './client';
import type { Paginated } from './types';

/**
 * ── ONE MODULE FOR THREE AUDIENCES ────────────────────────────────────────
 *
 * The customer who asks, the organiser who answers about their own event, and
 * the operator who answers for the platform are three views of ONE row. Three
 * clients is how they drift into disagreeing about what was said, which on a
 * support record is the disagreement that matters most — it is what both sides
 * would point at if a chargeback followed.
 *
 * ── AUDIENCE IS A ROUTING DECISION, NOT A GUESS ───────────────────────────
 *
 * "The gate would not scan my code" is the organiser's question: they are
 * standing at that gate. "I was charged twice" is the platform's; an organiser
 * cannot see a payment record and must not be handed one.
 *
 * The customer chooses, because guessing from the text routes a refund dispute
 * to a venue. `both` is for somebody who genuinely does not know, and is what
 * the ticket-scanning entry point sends.
 *
 * The server NARROWS `organizer`/`both` to `platform` when there is no event to
 * route to — a query addressed to an organiser with nothing naming one would
 * sit in a queue nobody owns.
 */

export type SupportAudience = 'organizer' | 'platform' | 'both';

/**
 * `answered` means somebody from the other side replied. It is never set by
 * hand — the server refuses it — because a value that can be set without
 * replying is a value that will be.
 */
export type SupportStatus = 'open' | 'answered' | 'resolved' | 'closed';

export type SupportReply = {
  id: string;
  body: string;
  created_at: string;
  /** True when the author answered AS the organiser or the platform. */
  is_staff_reply: boolean;
  author_name: string;
};

export type SupportQuery = {
  id: string;
  audience: SupportAudience;
  status: SupportStatus;
  subject: string;
  body: string;
  event_id: string | null;
  event_title: string;
  ticket_id: string | null;
  asked_by_name: string;
  asked_by_email: string;
  /** Empty on LIST responses — a queue is scanned by subject, and shipping
   *  every message on every row would make a page of twenty enormous. Populated
   *  by `fetchSupportQuery`. */
  replies: SupportReply[];
  created_at: string;
  updated_at: string;
};

/* ── the customer's half ─────────────────────────────────────────────────── */

export const raiseSupportQuery = (input: {
  subject: string;
  body: string;
  audience: SupportAudience;
  eventId?: string | null;
  ticketId?: string | null;
}) =>
  api.post<SupportQuery>('/support/queries', {
    subject: input.subject,
    body: input.body,
    audience: input.audience,
    event_id: input.eventId ?? null,
    ticket_id: input.ticketId ?? null,
  });

export const fetchMySupportQueries = (params: { cursor?: string } = {}) =>
  api.get<Paginated<SupportQuery>>(`/support/queries${query(params)}`);

export const fetchSupportQuery = (id: string) =>
  api.get<SupportQuery>(`/support/queries/${encodeURIComponent(id)}`);

/* ── shared ──────────────────────────────────────────────────────────────── */

export const replyToSupportQuery = (id: string, body: string) =>
  api.post<SupportQuery>(`/support/queries/${encodeURIComponent(id)}/replies`, { body });

export const setSupportQueryStatus = (id: string, status: 'open' | 'resolved' | 'closed') =>
  api.post<SupportQuery>(`/support/queries/${encodeURIComponent(id)}/status`, { status });

/* ── the queues ──────────────────────────────────────────────────────────── */

export const fetchOrganizerSupportQueries = (params: { status?: string; cursor?: string } = {}) =>
  api.get<Paginated<SupportQuery>>(`/organizer/support/queries${query(params)}`);

export const fetchAdminSupportQueries = (params: { status?: string; cursor?: string } = {}) =>
  api.get<Paginated<SupportQuery>>(`/admin/support/queries${query(params)}`);

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
 * states are easy to word wrongly. In particular `answered` must never read as
 * "done" — it means a reply is waiting for the CUSTOMER, which on a queue is
 * the opposite of finished.
 */
export const SUPPORT_STATUS_LABELS: Record<
  SupportStatus,
  { label: string; hint: string; tone: 'warning' | 'info' | 'success' | 'neutral' }
> = {
  open: {
    label: 'Open',
    hint: 'Waiting for a reply.',
    tone: 'warning',
  },
  answered: {
    label: 'Replied',
    // Deliberately not "Resolved". Somebody has answered; whether it helped is
    // the asker's call, and only they can make it.
    hint: 'There is a reply waiting for you.',
    tone: 'info',
  },
  resolved: {
    label: 'Resolved',
    hint: 'Marked resolved. Reply if it is not.',
    tone: 'success',
  },
  closed: {
    label: 'Closed',
    hint: 'Closed. Raise a new query if you need us again.',
    tone: 'neutral',
  },
};
