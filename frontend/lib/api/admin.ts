import { api } from './client';
import type { Paginated } from './types';

/**
 * The operator console's read surface (`/api/v1/admin/*`).
 *
 * Every one of these is staff-only and `private, no-store` on the server, so
 * none of it is ever cached at the edge and none of it is fetched on a server
 * render — the console is per-operator by definition. They run in the browser
 * against a token, which is also what makes a 403 meaningful: it means this
 * person is not staff, not that something broke.
 *
 * Money is integer minor units, as everywhere else in this API.
 */

export type AdminOverview = {
  organizations: number;
  pending_verifications: number;
  revenue_today_minor: number;
  bookings_today: number;
  events_live: number;
  tickets_issued: number;
  checkins_today: number;
  failed_payouts: number;
  generated_at: string;
};

export type SeriesPoint = { date: string; value: number };
export type AdminTimeseries = { metric: string; days: number; points: SeriesPoint[] };

export type BreakdownItem = { label: string; value: number };
export type AdminBreakdown = { by: string; items: BreakdownItem[] };

export type ActivityEntry = {
  id: string;
  type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

/**
 * `unknown` is a real, distinct state — it means "this adapter is configured
 * but nothing contacted it". The UI must render it differently from `ok`; a
 * tile that looks green because nobody checked is the one an operator would
 * trust to page somebody.
 */
export type HealthStatus = 'ok' | 'degraded' | 'unknown';
export type HealthCheck = { name: string; status: HealthStatus; detail: string };
export type AdminHealth = { status: 'ok' | 'degraded'; checks: HealthCheck[] };

export type AdminOrganization = {
  id: string;
  owner_id: string;
  name: string;
  verified_level: 'unverified' | 'pending' | 'verified';
  payout_account_id: string;
  logo_url: string;
  created_at: string;
};

export type AdminUser = {
  id: string;
  email: string;
  full_name: string;
  is_organizer: boolean;
  is_staff: boolean;
  /**
   * `false` means SUSPENDED, and it is an access decision rather than a label:
   * `AuthService.authenticate` refuses an inactive account outright, so a
   * suspended user cannot sign in at all.
   */
  is_active: boolean;
  date_joined: string;
};

/** organizer | staff | attendee | suspended. Empty means everyone. */
export type UserRole = '' | 'organizer' | 'staff' | 'attendee' | 'suspended';

export type AdminSettlement = {
  id: string;
  event_id: string;
  event_title: string;
  status: 'pending' | 'paid' | 'failed' | string;
  gross: number;
  platform_fee: number;
  refunds: number;
  net: number;
  releasable_at: string | null;
  payout_at: string | null;
  attempts: number;
  error: string;
  created_at: string;
};

export type PendingVerification = {
  id: string;
  organization_id: string;
  organization_name: string;
  verified_level: string;
  status: string;
  notes: string;
  created_at: string;
};

export const fetchOverview = () => api.get<AdminOverview>('/admin/overview');

export const fetchTimeseries = (metric: 'revenue' | 'bookings' | 'signups', days = 30) =>
  api.get<AdminTimeseries>(`/admin/timeseries?metric=${metric}&days=${days}`);

export const fetchBreakdown = (by: 'events_by_city' | 'revenue_by_city', limit = 8) =>
  api.get<AdminBreakdown>(`/admin/breakdown?by=${by}&limit=${limit}`);

export const fetchActivity = (limit = 20) =>
  api.get<{ data: ActivityEntry[] }>(`/admin/activity?limit=${limit}`);

export const fetchHealth = () => api.get<AdminHealth>('/admin/health');

export const fetchAdminOrganizations = (
  params: { verified_level?: string; cursor?: string } = {},
) => api.get<Paginated<AdminOrganization>>(`/admin/organizations${query(params)}`);

export const fetchAdminUsers = (params: { q?: string; role?: string; cursor?: string } = {}) =>
  api.get<Paginated<AdminUser>>(`/admin/users${query(params)}`);

export const fetchAdminSettlements = (params: { status?: string; cursor?: string } = {}) =>
  api.get<Paginated<AdminSettlement>>(`/admin/settlements${query(params)}`);

export const fetchPendingVerifications = () =>
  api.get<{ data: PendingVerification[] }>('/admin/verifications');

/** Approve or reject. The rules live in the backend's organizations service. */
export const decideVerification = (organizationId: string, approve: boolean, notes = '') =>
  api.post<void>(`/admin/organizations/${encodeURIComponent(organizationId)}/verification`, {
    approve,
    notes,
  });

/** Re-drive a dead-lettered payout. The pre-existing admin endpoint. */
export const releaseSettlement = (settlementId: string) =>
  api.post<void>(`/admin/settlements/${encodeURIComponent(settlementId)}/release`, {});

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

/**
 * Event moderation — the gate that makes the marketplace curated.
 *
 * An organizer publishing an event moves it to `pending_review`; it is
 * invisible to attendees until an operator approves it here. Approval is the
 * ONLY path to `live`, and the backend enforces that — these calls 403 for
 * anyone who is not staff, which is verified rather than assumed.
 */
export type ModerationEntry = {
  id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  starts_at: string;
  ends_at: string | null;
  poster_url: string;
  status: string;
  submitted_at: string | null;
  moderated_at: string | null;
  /**
   * The LAST decision's reason, not a history.
   *
   * `submit_for_review_if_draft` CLEARS this on resubmission, deliberately —
   * leaving a stale rejection attached to an event now awaiting a fresh review
   * is how an operator rejects it twice for a problem already fixed. A real
   * reason history needs its own table (BACKLOG "Moderation decision log").
   */
  moderation_note: string;
  organization_id: string;
  organization_name: string;
  verified_level: 'unverified' | 'pending' | 'verified';
  created_at: string;
};

/**
 * The queue, or the record of past decisions.
 *
 * `pending_review` (the default) is FIFO — the organizer who has waited
 * longest comes first. Every other status is newest-first, because "what did
 * we just do" is the question being asked of it. `draft` is deliberately NOT
 * reachable: an unsubmitted draft is an organizer's private workspace, and the
 * server falls back to the pending queue rather than honouring it.
 */
export type ModerationStatus = 'pending_review' | 'live' | 'rejected' | 'archived';

export const fetchModerationQueue = (
  params: { status?: ModerationStatus; cursor?: string } = {},
) => api.get<Paginated<ModerationEntry>>(`/admin/events/pending${query(params)}`);

/** Approve, or reject with a reason the organizer can act on (required). */
export const moderateEvent = (eventId: string, approve: boolean, note = '') =>
  api.post<{ id: string; status: string }>(
    `/admin/events/${encodeURIComponent(eventId)}/moderate`,
    { approve, note },
  );

/** Take a live event off sale. Hides the listing; cancels nobody's booking. */
export const unpublishEvent = (eventId: string, note: string) =>
  api.post<{ id: string; status: string }>(
    `/admin/events/${encodeURIComponent(eventId)}/unpublish`,
    { note },
  );

/**
 * The immutable administrative trail: who did what, and when.
 *
 * Distinct from `fetchActivity`, which reads the outbox — that records what the
 * DOMAIN did (a booking was confirmed), this records what a PERSON did (an
 * operator approved this event).
 */
export type AuditEntry = {
  id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export const fetchAuditLog = (
  params: { action?: string; target_id?: string; cursor?: string } = {},
) => api.get<Paginated<AuditEntry>>(`/admin/audit${query(params)}`);

/* ------------------------------------------------------------------ people */

/**
 * Suspend or reinstate an account.
 *
 * REVERSIBLE, which is why it is a suspension and not a delete: an account is
 * referenced by bookings, tickets and payments, and removing one would orphan
 * somebody's ticket to an event they are attending tomorrow. That
 * reversibility is also what lets the console offer undo instead of a
 * confirmation dialog.
 *
 * The server refuses two cases outright — suspending yourself, and suspending
 * another staff member — and both come back as `409 cannot_suspend` with a
 * message written to be shown.
 */
export const setUserSuspended = (userId: string, suspended: boolean, reason = '') =>
  api.post<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/suspension`, {
    suspended,
    reason,
  });

/* ---------------------------------------------------------------- payments */

export type AdminPayment = {
  id: string;
  provider_order_id: string;
  provider_payment_id: string;
  amount_minor: number;
  status: 'created' | 'paid' | 'failed' | 'refunded';
  created_at: string;
  booking_id: string;
  booking_total_minor: number;
  platform_fee_minor: number;
  customer_email: string;
  customer_name: string;
  event_id: string;
  event_title: string;
};

export const fetchAdminPayments = (
  params: { status?: string; q?: string; cursor?: string } = {},
) => api.get<Paginated<AdminPayment>>(`/admin/payments${query(params)}`);

/**
 * A refund RECORD — money already returned.
 *
 * No `status`, because there is none: `execute_refund` writes this row only
 * after the vendor call succeeded. `is_partial` is computed SERVER-side from
 * the refunded amount against the payment's, so it cannot disagree with the
 * numbers beside it.
 */
export type AdminRefund = {
  id: string;
  provider_ref: string;
  amount_minor: number;
  reason: string;
  created_at: string;
  is_partial: boolean;
  payment_id: string;
  payment_ref: string;
  payment_amount_minor: number;
  booking_id: string;
  customer_email: string;
  event_id: string;
  event_title: string;
};

export const fetchAdminRefunds = (params: { q?: string; cursor?: string } = {}) =>
  api.get<Paginated<AdminRefund>>(`/admin/refunds${query(params)}`);
