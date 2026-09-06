import { api } from './client';

/**
 * The waiting list for a sold-out event.
 *
 * ── IT IS NOT THE SAVED-EVENTS PATTERN, AND THE DIFFERENCE IS THE POINT ───
 *
 * Saving works while anonymous: the browser keeps a local set and merges it on
 * sign-in, because a bookmark's only consumer is the same browser. A waitlist
 * join is a promise to CONTACT somebody, and an anonymous visitor has no
 * address — so there is nothing to keep locally that would mean anything. The
 * affordance stays ungated (the button is drawn for everybody) and the press
 * opens the sign-in sheet, which is the shape the checkout already uses.
 *
 * ── EVERY CALL RETURNS THE WHOLE SET ─────────────────────────────────────
 *
 * Join, leave and the account read all answer with `event_ids`, so the client
 * REPLACES its local set rather than reconciling — one reducer for three
 * responses, and no way for a dropped request to leave the button lying.
 */

export type WaitlistState = {
  /** Whether the account is on THIS event's list. */
  joined: boolean;
  /** Every event this account is waiting on. */
  event_ids: string[];
};

export type WaitlistEntry = {
  joined_at: string;
  /** Null while waiting. Set once — a person is written to about an event
   *  exactly once, which is what the message itself promises. */
  notified_at: string | null;
  id: string;
  title: string;
  slug: string;
  venue: string;
  city: string;
  starts_at: string;
  poster_url: string;
  tickets_available: number | null;
  /** False for a cancelled or withdrawn event. It stays on the list carrying
   *  this rather than vanishing: hiding it would look like the join was lost,
   *  and a called-off show is exactly what somebody waiting needs to know. */
  is_available: boolean;
};

const path = (eventId: string) => `/events/${encodeURIComponent(eventId)}/waitlist`;

/** Join. Idempotent — pressing twice is one row and one place in the queue. */
export const joinWaitlist = (eventId: string) =>
  api.post<WaitlistState>(path(eventId), {});

/**
 * Leave. A 200 whether or not they were on it, because the caller's intent is
 * "I should not be on this list" and that is true either way.
 */
export const leaveWaitlist = (eventId: string) => api.delete<WaitlistState>(path(eventId));

/**
 * Every event this account is waiting on.
 *
 * `private, no-store` on the server — per-user data, and a shared cache must
 * never hand one person's list to another. This is also why "am I on it"
 * cannot ride the event payload: `GET /events/{id}` is deliberately public and
 * edge-cached with a warm path of zero queries.
 */
export const fetchMyWaitlist = () =>
  api.get<{ data: WaitlistEntry[]; event_ids: string[] }>('/me/waitlist');
