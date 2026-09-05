import { api } from './client';
import type { Paginated } from './types';

/**
 * The organizer dashboard's read surface (`/api/v1/organizer/*`).
 *
 * Every one of these is scoped SERVER-SIDE to the organizations the caller
 * owns — there is no `organization_id` parameter to pass and no way to ask for
 * someone else's numbers. That is deliberate: a client-supplied scope is a
 * client-controlled scope. See `apps/organizer/repositories.py`.
 *
 * All of it is `private, no-store`, so none of it is fetched during a server
 * render and none of it is ever cached at the edge. Money is integer minor
 * units, as everywhere else in this API.
 *
 * **Percentages can be `null`, and that is meaningful.** A rate whose
 * denominator is zero comes back as `null` rather than `0`, and the UI renders
 * a dash. "0% conversion" on an event nobody has opened yet is a false
 * statement; a dash is the truthful one. Anything that consumes these must
 * handle `null` rather than defaulting it to zero.
 */

export type SeriesPoint = { date: string; value: number };
export type LabelValue = { label: string; value: number };

export type OrganizerOverview = {
  revenue_today_minor: number;
  revenue_change_pct: number | null;
  bookings_today: number;
  bookings_change_pct: number | null;
  tickets_sold_today: number;
  tickets_change_pct: number | null;
  events_upcoming: number;
  refunds_today: number;
  refunds_today_minor: number;
  checkins_today: number;
  conversion_pct: number | null;
  conversion_change_pct: number | null;
  generated_at: string;
};

export type OrganizerTimeseries = {
  metric: SeriesMetric;
  days: number;
  points: SeriesPoint[];
};

export type SeriesMetric = 'revenue' | 'bookings' | 'tickets';
export type BreakdownKind = 'revenue_by_event' | 'revenue_by_city' | 'bookings_by_status';

export type OrganizerBreakdown = { by: BreakdownKind; items: LabelValue[] };

/**
 * Every status `Event.status` can hold.
 *
 * `pending_review` and `rejected` are the moderation gate: publishing SUBMITS
 * an event, and only a platform operator's approval makes it `live`. An event
 * in either state is invisible to attendees by construction — every public
 * queryset filters on `live`.
 */
export type EventStatus =
  | 'draft'
  | 'pending_review'
  | 'rejected'
  | 'live'
  | 'paused'
  | 'finished'
  /**
   * Called off, with everybody refunded. PUBLIC and terminal — the event page
   * still resolves and says so, because hundreds of people hold a link in an
   * email and a 404 there reads as "the platform lost my booking".
   */
  | 'cancelled'
  | 'archived';

export type EventRow = {
  id: string;
  title: string;
  status: EventStatus;
  venue: string;
  city: string;
  starts_at: string;
  ends_at: string | null;
  poster_url: string;
  organization_id: string;
  organization_name: string;
  /** What the publish gate checks FIRST, before any readiness check. */
  organization_verified_level: 'unverified' | 'pending' | 'verified';
  /** Tier ROWS, not seats — the gate is "at least one ticket type", and a tier
   *  with quantity 0 satisfies it while adding nothing to `capacity`. */
  ticket_type_count: number;
  capacity: number;
  sold: number;
  revenue_minor: number;
  checkins: number;
  from_price_minor: number | null;
  tickets_available: number | null;
  /** Needed by the optimistic-lock edit endpoint — send back what you read. */
  version: number;
  created_at: string;
  /**
   * An operator's reason for sending the event back.
   *
   * Present ONLY on this organizer-scoped payload — deliberately not on the
   * public `EventDetail`, where an internal review note would be readable by
   * any attendee.
   */
  moderation_note: string;
  submitted_at: string | null;
};

export type BookingStatus = 'reserved' | 'paid' | 'cancelled' | 'expired';

export type OrganizerBooking = {
  id: string;
  status: BookingStatus;
  total_amount_minor: number;
  platform_fee_minor: number;
  payment_ref: string;
  /** The refundable payment's own id, or null when there is nothing to refund
   *  (never captured, or already refunded). The refund action enables on THIS,
   *  never on `payment_ref` — that is the vendor's string and not what
   *  `POST /payments/{id}/refund` accepts. */
  payment_id: string | null;
  hold_expires_at: string;
  created_at: string;
  quantity: number;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  event_id: string;
  event_title: string;
  event_starts_at: string;
};

export type CustomerRow = {
  customer_id: string;
  email: string;
  full_name: string;
  bookings: number;
  /** With THIS organizer only — never platform-wide spend. */
  lifetime_value_minor: number;
  last_booked_at: string;
};

export type CustomerProfile = {
  customer_id: string;
  email: string;
  bookings: number;
  lifetime_value_minor: number;
  refunds: number;
  refunded_minor: number;
  tickets_issued: number;
  tickets_attended: number;
  recent_bookings: {
    id: string;
    status: BookingStatus;
    total_amount_minor: number;
    created_at: string;
    event_id: string;
    event_title: string;
    event_starts_at: string;
  }[];
  top_cities: LabelValue[];
};

export type TierAnalytics = {
  id: string;
  name: string;
  price_minor: number;
  quantity: number;
  sold: number;
  reserved: number;
  revenue_minor: number;
};

/** The event's own identity, so an analytics page is one request, not two. */
export type EventAnalyticsHeader = {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  venue: string;
  city: string;
};

export type EventAnalytics = {
  event_id: string;
  /** Null only if the event was soft-deleted between the two reads. */
  event: EventAnalyticsHeader | null;
  revenue_minor: number;
  /** Money returned. NOT subtracted from `revenue_minor`, which already
   *  excludes refunded payments — see the backend selector. */
  refunded_minor: number;
  refunded_count: number;
  capacity: number;
  sold: number;
  checkins: number;
  sell_through_pct: number | null;
  conversion_pct: number | null;
  abandonment_pct: number | null;
  attendance_pct: number | null;
  bookings_by_status: LabelValue[];
  scans_by_result: LabelValue[];
  tiers: TierAnalytics[];
  sales_timeline: SeriesPoint[];
};

export type OrganizerActivity = {
  id: string;
  type: string;
  customer: string;
  event_id: string;
  event_title: string;
  amount_minor: number;
  created_at: string;
};

export type Audience = {
  customers: number;
  repeat_customers: number;
  repeat_pct: number | null;
};

/**
 * One row of the unified activity feed.
 *
 * `severity` comes from the SERVER rather than being re-derived here from a
 * string match on `type`. A feed where a failed payout renders like a ticket
 * sale buries the one entry that needed a human, and deciding that in two
 * places is how the two eventually disagree.
 */
export type ActivityKind = 'booking' | 'refund' | 'checkin' | 'payout' | 'publishing';
export type ActivitySeverity = 'info' | 'success' | 'warning' | 'critical';

export type FeedEntry = {
  id: string;
  kind: ActivityKind;
  /** The originating domain event, e.g. `booking.paid`, `payout.failed`. */
  type: string;
  title: string;
  detail: string;
  event_id: string;
  event_title: string;
  amount_minor: number;
  severity: ActivitySeverity;
  at: string;
};

export const fetchOrganizerFeed = (limit = 30) =>
  api.get<{ data: FeedEntry[] }>(`/organizer/feed?limit=${limit}`);

/**
 * A refund RECORD — money already returned.
 *
 * There is deliberately NO `status` field. `payments.execute_refund` writes
 * this row only after the vendor call succeeded, so every row here is
 * completed; pending/approved/rejected states would need a refund-REQUEST
 * model that does not exist (BACKLOG "Refund request workflow"). The UI must
 * not invent them.
 */
export type OrganizerRefund = {
  id: string;
  provider_ref: string;
  amount_minor: number;
  reason: string;
  created_at: string;
  payment_id: string;
  payment_ref: string;
  payment_amount_minor: number;
  /** Computed from the pair, not stored — see `decorate_refunds`. */
  is_partial: boolean;
  booking_id: string;
  event_id: string;
  event_title: string;
};

export const fetchOrganizerRefunds = (params: { event_id?: string; cursor?: string } = {}) =>
  api.get<Paginated<OrganizerRefund>>(`/organizer/refunds${query(params)}`);

export const fetchOrganizerOverview = () => api.get<OrganizerOverview>('/organizer/overview');

/**
 * `end` is optional and omitted entirely when absent, so the rolling window
 * keeps sending the exact request it always sent — same URL, same server cache
 * entry. A custom range is (end - days, end].
 */
export const fetchOrganizerTimeseries = (metric: SeriesMetric, days = 30, end?: string) =>
  api.get<OrganizerTimeseries>(
    `/organizer/timeseries?metric=${metric}&days=${days}${end ? `&end=${end}` : ''}`,
  );

export const fetchOrganizerBreakdown = (by: BreakdownKind, limit = 8) =>
  api.get<OrganizerBreakdown>(`/organizer/breakdown?by=${by}&limit=${limit}`);

export const fetchOrganizerActivity = (limit = 20) =>
  api.get<{ data: OrganizerActivity[] }>(`/organizer/activity?limit=${limit}`);

export const fetchAudience = () => api.get<Audience>('/organizer/audience');

/**
 * Date bounds are ISO-8601 and go to the SERVER, never applied here.
 *
 * These lists are cursor-paginated, so filtering a window on the client would
 * mean pulling every page to find the rows inside it — slow, and wrong the
 * moment a page boundary falls inside the range. Always send `toISOString()`
 * (which ends in `Z`); an unencoded `+00:00` offset would arrive as a space.
 */
export type EventRowFilters = {
  q?: string;
  status?: string;
  city?: string;
  starts_after?: string;
  starts_before?: string;
  cursor?: string;
};

export const fetchEventRows = (params: EventRowFilters = {}) =>
  api.get<Paginated<EventRow>>(`/organizer/event-rows${query(params)}`);

export type BookingFilters = {
  event_id?: string;
  status?: string;
  q?: string;
  created_after?: string;
  created_before?: string;
  cursor?: string;
};

export const fetchOrganizerBookings = (params: BookingFilters = {}) =>
  api.get<Paginated<OrganizerBooking>>(`/organizer/bookings${query(params)}`);

export const fetchCustomers = (params: { q?: string; cursor?: string } = {}) =>
  api.get<Paginated<CustomerRow>>(`/organizer/customers${query(params)}`);

export const fetchCustomerProfile = (customerId: string) =>
  api.get<CustomerProfile>(`/organizer/customers/${encodeURIComponent(customerId)}`);

export const fetchEventAnalytics = (eventId: string, days = 30) =>
  api.get<EventAnalytics>(
    `/organizer/events/${encodeURIComponent(eventId)}/analytics?days=${days}`,
  );

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

/**
 * Payouts — served by `settlements`, not by the organizer module.
 *
 * One settlement per event, released after the event ends AND the refund
 * window passes. `net = gross - platform_fee - refunds`, recomputed
 * authoritatively from the payment records at release time; the totals below
 * are the display copy. Never treat them as the amount that will be paid.
 */
export type SettlementStatus = 'pending' | 'paid' | 'failed' | 'zero';

/**
 * Exactly the fields `SettlementSerializer` returns — no more.
 *
 * `releasable_at` is here now: "when do I get paid" is the organizer's own
 * question, and the payouts screen could previously only restate the RULE
 * ("after the event and its refund window") because it had no date. It is the
 * same instant the release job acts on, so it cannot drift from what happens.
 *
 * `attempts` and `error` remain deliberately absent, and appear only on the
 * ADMIN payload: retry counts and vendor error strings are operator
 * diagnostics, not something to surface to the organizer whose money it is.
 * Declaring them anyway would have produced a field that is always `undefined`
 * and a UI that renders "attempt 0 of 5".
 */
export type OrganizerSettlement = {
  id: string;
  event_id: string;
  event_title: string;
  status: SettlementStatus;
  gross: number;
  platform_fee: number;
  refunds: number;
  net: number;
  /** When the scheduler may release it. Null until the event has an end. */
  releasable_at: string | null;
  payout_at: string | null;
  provider_ref: string;
  created_at: string;
};

export const fetchSettlements = (params: { cursor?: string } = {}) =>
  api.get<Paginated<OrganizerSettlement>>(`/organizer/settlements${query(params)}`);

export const fetchEventSettlement = (eventId: string) =>
  api.get<OrganizerSettlement>(`/organizer/settlements/${encodeURIComponent(eventId)}`);

export type OrganizerReview = {
  id: string;
  rating: number;
  body: string;
  verified_attendee: boolean;
  created_at: string;
  event_id: string;
  event_title: string;
  reviewer_name: string;
};

export const fetchOrganizerReviews = (params: { event_id?: string; cursor?: string } = {}) =>
  api.get<Paginated<OrganizerReview>>(`/organizer/reviews${query(params)}`);

/* ────────────────────────── earnings, funnel, insights ────────────────── */

/**
 * The three money questions `overview` cannot answer.
 *
 * `overview` is today against yesterday, which is the right window for "is the
 * on-sale working" and the wrong one for "how is the business doing".
 *
 * `month_change_pct` compares this month so far against the SAME ELAPSED SPAN
 * of last month, not against the whole of it — `comparison_days` is how many
 * days that is, and it is exposed so the UI can say so rather than implying a
 * full-month comparison it did not make.
 */
export type OrganizerEarnings = {
  lifetime_revenue_minor: number;
  lifetime_tickets: number;
  lifetime_attendees: number;
  /** Null, never 0, when nobody has paid yet: "no attendees" and "attendees
   *  who paid nothing" are different facts and must not render alike. */
  avg_revenue_per_attendee_minor: number | null;
  month_revenue_minor: number;
  month_change_pct: number | null;
  comparison_days: number;
  generated_at: string;
};

export const fetchOrganizerEarnings = () => api.get<OrganizerEarnings>('/organizer/earnings');

/**
 * Per-event conversion, quota fill and repeat share.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────
 *
 * No impressions, no detail views, no add-to-cart, no CTR. The platform does
 * not measure any of them — there is no view, impression, session or
 * analytics-event model anywhere in the backend. Every field below is a count
 * of rows that exist. Adding the other four means building a tracking
 * pipeline, not widening this type.
 */
export type OrganizerFunnelRow = {
  id: string;
  title: string;
  status: EventStatus;
  starts_at: string;
  /** EVERY booking row, any status. A reserved-then-expired hold is exactly
   *  the abandonment the conversion rate measures, so it is the denominator. */
  bookings_started: number;
  bookings_paid: number;
  conversion_pct: number | null;
  capacity: number;
  tickets_sold: number;
  quota_fill_pct: number | null;
  revenue_minor: number;
  paying_attendees: number;
  repeat_attendee_pct: number | null;
};

export const fetchOrganizerFunnel = (params: { cursor?: string } = {}) =>
  api.get<Paginated<OrganizerFunnelRow>>(`/organizer/funnel${query(params)}`);

/** What the server found worth saying, with the evidence it found it from. */
export type OrganizerInsight = {
  kind: string;
  metric: string;
  key: string;
  label: string;
  value: number;
  /** How many rows the recommendation came from. Rendered, not hidden: advice
   *  drawn from nine bookings and advice drawn from nine hundred are different
   *  advice, and the server already refuses to answer below its minimum. */
  sample_size: number;
};

export const fetchOrganizerInsights = () =>
  api.get<{ data: OrganizerInsight[] }>('/organizer/insights').then((response) => response.data);
