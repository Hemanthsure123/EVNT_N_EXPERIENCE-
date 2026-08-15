import { api } from './client';
import type { Paginated } from './types';
import type {
  EventAnalytics,
  OrganizerOverview,
  OrganizerTimeseries,
  SeriesMetric,
} from './organizer';

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
export type AdminHealth = {
  status: 'ok' | 'degraded';
  checks: HealthCheck[];
  /**
   * Whether vendors were actually CONTACTED for this response.
   *
   * The UI renders `unknown` differently depending on it: shallow means
   * "we did not check", deep means "this adapter cannot be probed without
   * a side effect". Collapsing the two is how a grey tile stops meaning
   * anything.
   */
  deep: boolean;
};

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
  /**
   * Whether the address has been PROVEN.
   *
   * A separate fact from `is_active`, and the console needs both: an account
   * can be blocked because an operator suspended it, or because nobody ever
   * clicked the code — two different situations with two different fixes, and
   * one flag could not tell them apart.
   */
  email_verified: boolean;
  /**
   * The platform's PRIMARY account.
   *
   * Its operator role cannot be removed by anybody, including itself. The
   * self-demotion guard stops you locking yourself out; this stops the case
   * that loses a whole platform — a newly promoted operator demoting the
   * founding account, after which restoring access needs a database shell.
   *
   * The console reads it to leave that row's role control out entirely. A
   * disabled button would be a control whose only outcome is a 409.
   */
  is_superuser: boolean;
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

/**
 * A date window on a console list.
 *
 * SERVER-SIDE, always. Every list here is cursor-paginated, so filtering a
 * window in the browser means paging through the whole platform to find the
 * rows inside it — and is simply wrong wherever a page boundary falls in the
 * middle of the range.
 *
 * Send `toISOString()` (a `Z` suffix). An unencoded `+05:30` arrives as a
 * space and the server repairs it, but only because that slip is so common.
 */
export type DateWindow = { created_after?: string; created_before?: string };

export const fetchAdminOrganizations = (
  params: { verified_level?: string; q?: string; cursor?: string } & DateWindow = {},
) => api.get<Paginated<AdminOrganization>>(`/admin/organizations${query(params)}`);

export const fetchAdminUsers = (
  params: { q?: string; role?: string; cursor?: string } & DateWindow = {},
) =>
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

/**
 * The All-events queue.
 *
 * `q` is a SUBSTRING match on title, venue, city and organiser name — not the
 * full-text index the public browse uses. An operator has been handed a name
 * and is looking for that row, usually a fragment of it; a stemmed tsquery
 * misses "Winter Com" and matches things nobody asked about.
 *
 * The window is on `starts_at`, because the question is "what runs that
 * weekend", not "what was typed that week".
 */
export const fetchModerationQueue = (
  params: {
    /**
     * `all` widens to every moderatable status. It is NOT the same as omitting
     * this: an ABSENT or unknown status falls back to the pending queue on the
     * server, deliberately, so a mistyped query string cannot silently widen an
     * operator's view. Callers that genuinely want the whole set — the event
     * picker, which has to find a booking's event whatever state it is in —
     * have to say so.
     */
    status?: ModerationStatus | 'all';
    q?: string;
    starts_after?: string;
    starts_before?: string;
    cursor?: string;
  } = {},
) =>
  api.get<Paginated<ModerationEntry>>(`/admin/events/pending${query(params)}`);

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

/**
 * Withdraw the platform's trust in a PROVEN address.
 *
 * A different decision from suspension, which is why it is a different
 * endpoint: suspension says "this person is out of service", revocation says
 * "the address they proved is no longer trusted". The second implies the first
 * — the server clears `email_verified` AND `is_active` in one statement,
 * because clearing the flag alone would let them request a fresh code and be
 * back inside a minute, having re-proven exactly what was just rejected.
 *
 * NOT UNDOABLE from here, and deliberately so. The console offers undo for
 * reversible writes; the way back from this one is reinstating the account and
 * having the person verify their address again, which is the whole point of
 * having withdrawn the trust. It gets a confirmation, not an undo toast.
 *
 * Refused with `409 cannot_suspend` for your own account and for another
 * operator's, for the same reasons suspension is.
 */
export const revokeUserVerification = (userId: string, reason = '') =>
  api.delete<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/verification`, {
    body: { reason },
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
  params: { status?: string; q?: string; cursor?: string } & DateWindow = {},
) =>
  api.get<Paginated<AdminPayment>>(`/admin/payments${query(params)}`);

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

export const fetchAdminRefunds = (params: { q?: string; cursor?: string } & DateWindow = {}) =>
  api.get<Paginated<AdminRefund>>(`/admin/refunds${query(params)}`);

/* ─────────────────────── one event, as an operator ─────────────────────── */

/**
 * An operator's view of a single event, and their power over it.
 *
 * The two analytics reads return the ORGANIZER's own payloads, which is why
 * they are typed from `lib/api/organizer` rather than redeclared here. That is
 * deliberate on the server too: an operator answering "my numbers look wrong"
 * has to be reading the same numbers the organizer is reading, and a second
 * shape here would be the first step towards the two disagreeing.
 */
export const fetchAdminEventAnalytics = (eventId: string, days = 30) =>
  api.get<EventAnalytics>(`/admin/events/${encodeURIComponent(eventId)}/analytics?days=${days}`);

export const fetchAdminOrganizationAnalytics = (
  organizationId: string,
  params: { metric?: SeriesMetric; days?: number } = {},
) =>
  api.get<{ overview: OrganizerOverview; timeseries: OrganizerTimeseries }>(
    `/admin/organizations/${encodeURIComponent(organizationId)}/analytics${query({
      metric: params.metric,
      days: params.days === undefined ? undefined : String(params.days),
    })}`,
  );

/**
 * Edit any event. `version` is the optimistic lock the organizer's own edits
 * take — an operator editing without one would be exactly the clobber the lock
 * exists to prevent, and the server refuses a request that omits it.
 */
export const updateAdminEvent = (
  eventId: string,
  version: number,
  changes: Record<string, unknown>,
) =>
  api.patch<{ id: string; status: string; version: number }>(
    `/admin/events/${encodeURIComponent(eventId)}`,
    { version, ...changes },
  );

/**
 * Remove an event — in ANY state — and make good on it.
 *
 * ── IT NO LONGER REFUSES WHEN SOMEBODY HOLDS A TICKET ────────────────────
 *
 * It used to, and this comment used to say so. The refusal was well-reasoned
 * and backwards: it blocked in exactly the cases an operator reaches for it (a
 * fraudulent listing that has already sold), and left the dangerous half — the
 * refunds — as a separate action somebody had to remember.
 *
 * The server now does the whole job in one operation: soft-delete, refund every
 * paid booking, release every live hold, email the attendees and the organiser.
 * So the two can never come apart.
 *
 * It answers with a SUMMARY rather than 204, because the click spends money —
 * show the operator what it actually did. The reason is required and is shown
 * to the organiser verbatim.
 */
export type DeleteEventResult = {
  event_id: string;
  title: string;
  refunds_enqueued: number;
  holds_released: number;
  attendees_notified: number;
};

export const deleteAdminEvent = (eventId: string, reason: string) =>
  api.delete<DeleteEventResult>(
    `/admin/events/${encodeURIComponent(eventId)}?reason=${encodeURIComponent(reason)}`,
  );

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * ── THE SUPPORT DESK ──────────────────────────────────────────────────────
 *
 * "The customer says they paid but has no ticket" is the single most common
 * support question a ticketing platform gets, and until `GET /admin/bookings`
 * it could not be answered from the product at all: `GET /bookings/{id}` is
 * scoped to the booking's own owner, so an operator could not open one even
 * holding the id.
 *
 * The payment search partly covered it and structurally could not cover it
 * fully — a booking that never reached payment has no `Payment` row to be
 * found by, and that abandoned checkout is exactly what people phone about.
 */

export type AdminBooking = {
  id: string;
  status: 'reserved' | 'paid' | 'cancelled' | 'expired';
  quantity: number;
  /** The answer to "did my tickets get issued?", on the row rather than behind a click. */
  tickets_issued: number;
  total_amount_minor: number;
  platform_fee_minor: number;
  payment_ref: string;
  payment_order_id: string;
  hold_expires_at: string | null;
  /**
   * COMPUTED server-side from the pair, never stored. `reserved` alone does not
   * tell an operator whether to wait or act — a hold past its expiry simply has
   * not been swept yet.
   */
  is_expired_hold: boolean;
  created_at: string;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  event_id: string;
  event_title: string;
  event_starts_at: string;
};

export type AdminBookingTicket = {
  id: string;
  ticket_type_name: string;
  status: 'active' | 'used' | 'void';
  used_at: string | null;
  gate: string | null;
  attendee_name: string | null;
  /**
   * There is deliberately NO `qr_token` here, and the backend does not send
   * one. The token is the credential that admits somebody; an operator needs
   * to know tickets exist and whether they have been used, never the code
   * itself. `POST /checkin/lookup` verifies a token the holder presents rather
   * than handing one out.
   */
};

export type AdminBookingDetail = AdminBooking & {
  items: {
    ticket_type_id: string;
    ticket_type_name: string;
    quantity: number;
    unit_price_minor: number;
  }[];
  tickets: AdminBookingTicket[];
  /** So "hold expired 4 minutes ago" is measured against the SERVER's clock. */
  server_time: string;
};

/** One `q` across email, booking id (prefix), payment reference and event title. */
export const fetchAdminBookings = (
  params: { q?: string; status?: string; event_id?: string; cursor?: string } & DateWindow = {},
) =>
  api.get<Paginated<AdminBooking>>(`/admin/bookings${query(params)}`);

export const fetchAdminBooking = (bookingId: string) =>
  api.get<AdminBookingDetail>(`/admin/bookings/${encodeURIComponent(bookingId)}`);

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * ── DEEP HEALTH ───────────────────────────────────────────────────────────
 *
 * Six of the eight tiles were permanently grey: the endpoint named WHICH
 * adapter was configured and contacted none of them. `?deep=1` actually
 * reaches the payment provider and the storage bucket and inspects the outbox.
 *
 * Opt-in and cached 60s server-side, so a console left open on a wall never
 * becomes traffic against Razorpay. `deep` comes back on the response so the
 * UI can say which kind of answer it is showing — without it, a shallow
 * `unknown` tile and a deep one look identical.
 */
export const fetchHealthDeep = () => api.get<AdminHealth>('/admin/health?deep=1');

/* ------------------------------------------------------------- hire desk */

/**
 * A hire enquiry, as the desk sees it.
 *
 * ── IT CARRIES THE CONTACT DETAILS, WHICH THE OLD PAYLOAD DID NOT ─────────
 *
 * This used to be a marketplace brief shown to performers, and a performer
 * seeing a lead was deliberately shown the job and NOT the person — a
 * customer's identity was not theirs to have until they were hired. The only
 * reader now is an operator whose entire job is to get back to them, so
 * withholding them would make the queue unworkable.
 *
 * `customer_email` is not a duplicate of `contact_email`. The account's
 * address and the address they asked to be reached on are often different
 * people: the bride's account, the planner's inbox.
 */
export type AdminEnquiry = {
  id: string;
  performer_type: string;
  performer_type_display: string;
  occasion: string;
  occasion_display: string;
  city: string;
  event_date: string;
  budget_min_minor: number;
  budget_max_minor: number;
  guests: number | null;
  notes: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  customer_email: string;
  status: EnquiryStatus;
  status_display: string;
  /** Written for the NEXT operator, never shown to the customer. */
  admin_note: string;
  handled_by_email: string;
  created_at: string;
};

/** The four an operator can move between. `cancelled` is absent because it is
 *  the CUSTOMER's word for their own request — an operator marking somebody's
 *  enquiry withdrawn on their behalf is a different act from closing it. */
export type EnquiryStatus =
  | 'new'
  | 'in_progress'
  | 'closed_won'
  | 'closed_lost'
  | 'cancelled';

export const fetchAdminEnquiries = (
  params: { status?: string; q?: string; cursor?: string } = {},
) => api.get<Paginated<AdminEnquiry>>(`/admin/enquiries${query(params)}`);

export const decideEnquiry = (
  enquiryId: string,
  input: { status: EnquiryStatus; admin_note?: string },
) => api.patch<AdminEnquiry>(`/admin/enquiries/${encodeURIComponent(enquiryId)}`, input);

/**
 * Grant or remove the operator role.
 *
 * ── ONE REFUSAL, AND IT IS THE IMPORTANT ONE ──────────────────────────────
 *
 * An operator cannot remove their OWN role: the console is the only place this
 * lives, so somebody who demoted themselves would lose the screen that could
 * put it back. Demoting somebody ELSE is allowed, and is the action
 * `setUserSuspended` already points at when it refuses to suspend a staff
 * member and says "remove their operator role first" — until this existed,
 * that instruction named an endpoint that was not there.
 *
 * Granting requires a VERIFIED, active address. An operator can suspend
 * accounts, release payouts and delete events, and handing that to an address
 * nobody proved belongs to its holder is what verification exists to prevent.
 * Both refusals come back as `409 cannot_suspend` with a message written to be
 * shown.
 */
export const setUserOperator = (userId: string, isStaff: boolean, reason = '') =>
  api.post<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/role`, {
    is_staff: isStaff,
    reason,
  });
