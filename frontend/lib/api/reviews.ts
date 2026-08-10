import { api } from './client';
import type { Paginated } from './types';

/**
 * Post-event reviews.
 *
 * Two audiences share this file because they share a resource: anybody can
 * read an event's reviews, only an attendee can write one. The server decides
 * which — nothing here is a permission check, and `eligibility` exists so the
 * UI can show the right thing rather than a form that will be refused.
 */

export type Review = {
  id: string;
  rating: number;
  body: string;
  /** A ticket on this booking was actually SCANNED at the gate. Not a claim
   *  the reviewer made about themselves. */
  verified_attendee: boolean;
  /** "Asha R." — never a full name, never an email. */
  author: string;
  edited: boolean;
  created_at: string;
};

export type ReviewSummary = {
  average: number;
  count: number;
  /** Keys arrive as strings over JSON; always all five, zeros included. */
  distribution: Record<string, number>;
};

/**
 * Why somebody cannot review, as a code rather than a sentence.
 *
 * The server sends the code and the client owns the wording, because the right
 * thing to SAY differs by surface: the event page can say "you weren't at
 * this one" quietly, while the account page has room to explain a closed
 * window. One shared sentence would be wrong on one of them.
 */
export type EligibilityReason =
  | ''
  | 'event_cancelled'
  | 'event_not_finished'
  | 'window_closed'
  | 'did_not_attend'
  | 'booking_refunded'
  | 'already_reviewed';

export type Eligibility = {
  allowed: boolean;
  reason: EligibilityReason;
  verified_attendee: boolean;
};

export type PendingReview = {
  event_id: string;
  booking_id: string;
  title: string;
  poster_url: string;
  starts_at: string;
  ended_at: string;
  venue: string;
  city: string;
};

const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}/reviews`;

export const fetchReviews = (eventId: string, cursor?: string | null) =>
  api.get<Paginated<Review>>(`${base(eventId)}${cursor ? `?cursor=${cursor}` : ''}`);

export const fetchReviewSummary = (eventId: string) =>
  api.get<ReviewSummary>(`${base(eventId)}/summary`);

export const fetchEligibility = (eventId: string) =>
  api.get<Eligibility>(`${base(eventId)}/eligibility`);

export const fetchMyReview = (eventId: string) =>
  api.get<Review | null>(`${base(eventId)}/mine`);

export const submitReview = (eventId: string, rating: number, body: string) =>
  api.post<Review>(base(eventId), { rating, body });

export const updateMyReview = (eventId: string, rating: number, body: string) =>
  api.patch<Review>(`${base(eventId)}/mine`, { rating, body });

export const fetchPendingReviews = () =>
  api.get<{ data: PendingReview[] }>('/me/pending-reviews');

/** What each star means, said out loud. Used as the accessible name of each
 *  star and as the live hint under the row — a bare "3 of 5" tells somebody
 *  nothing about whether 3 is a complaint. */
export const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Not great',
  3: 'Fine',
  4: 'Good',
  5: 'Excellent',
};
