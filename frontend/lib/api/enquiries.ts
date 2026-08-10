import { api } from './client';
import type { Paginated } from './types';

/**
 * The hire desk.
 *
 * ── WHAT THIS REPLACED ────────────────────────────────────────────────────
 *
 * `lib/api/performers.ts` served a two-sided marketplace: customers posted
 * briefs, listed acts quoted on them, and accepting a quote booked one. The
 * platform has no supply side now. Somebody sends what they need, and an
 * OPERATOR gets back to them — by phone or email, off the platform.
 *
 * So there is no browse, no quote, no accept. Two verbs: send one, and
 * withdraw it if your plans change.
 *
 * ── THE CONTACT FIELDS EXIST BECAUSE THE READER CHANGED ───────────────────
 *
 * A marketplace brief deliberately carried the job and NOT the person: a
 * performer seeing a lead had no business knowing who the customer was until
 * they were hired. The only reader now is an operator whose entire job is to
 * reply, and an enquiry nobody can answer is one that wastes both people's
 * time — there is no automatic matching to fall back on.
 *
 * All three are optional and blank falls back to the account. A blank field
 * means "the address on my account is fine", not "do not contact me".
 */

export type PerformerType =
  | 'band'
  | 'singer'
  | 'dj'
  | 'instrumentalist'
  | 'anchor'
  | 'comedian'
  | 'dance_crew'
  | 'magician'
  | 'other';

export type Occasion =
  | 'wedding'
  | 'corporate'
  | 'birthday'
  | 'festival'
  | 'college'
  | 'private'
  | 'other';

/**
 * Where an enquiry is in the operator's queue.
 *
 * `new` is the only state that means somebody is waiting on us. `cancelled`
 * is the CUSTOMER's — they withdrew it — and is kept apart from `closed_lost`
 * on purpose: one is a lost deal and the other is a request that stopped
 * existing, and averaging them reports a worse conversion than the truth.
 */
export type EnquiryStatus =
  | 'new'
  | 'in_progress'
  | 'closed_won'
  | 'closed_lost'
  | 'cancelled';

export type Enquiry = {
  id: string;
  performer_type: PerformerType;
  occasion: Occasion;
  city: string;
  /** `yyyy-mm-dd`. A date, not an instant — a booking is for a day. */
  event_date: string;
  budget_min_minor: number;
  budget_max_minor: number;
  guests: number | null;
  notes: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  status: EnquiryStatus;
  /** Resolved on the server: five states, and a client that has to know all
   *  five labels is one that will get a label wrong. */
  status_display: string;
  /**
   * Always 0 — nothing quotes any more. It stays on the shape because removing
   * a field breaks a client for no gain, and it is computed rather than
   * hard-coded so that if quoting ever returns this reports the truth on the
   * same day.
   */
  quote_count: number;
  created_at: string;
};

export type CreateEnquiryInput = {
  performer_type: PerformerType;
  occasion: Occasion;
  city: string;
  event_date: string;
  /** Minor units (paise). A RANGE, because that is how people think about a
   *  budget — a single number invites every reply to be exactly it. */
  budget_min_minor: number;
  budget_max_minor: number;
  guests?: number | null;
  notes?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
};

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => value && search.set(key, value));
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
};

export const fetchMyEnquiries = (params: { cursor?: string } = {}) =>
  api.get<Paginated<Enquiry>>(`/hire/enquiries${query(params)}`);

export const createEnquiry = (input: CreateEnquiryInput) =>
  api.post<Enquiry>('/hire/enquiries', input);

/** Withdraw it. Allowed while nobody has closed it — including once an
 *  operator has picked it up, because somebody whose plans changed should not
 *  have to phone in to say so. */
export const withdrawEnquiry = (enquiryId: string) =>
  api.delete<Enquiry>(`/hire/enquiries/${encodeURIComponent(enquiryId)}`);

export const PERFORMER_TYPE_LABELS: Record<PerformerType, string> = {
  band: 'Band',
  singer: 'Singer',
  dj: 'DJ',
  instrumentalist: 'Instrumentalist',
  anchor: 'Anchor',
  comedian: 'Stand-up',
  dance_crew: 'Dance crew',
  magician: 'Magician',
  other: 'Something else',
};

export const OCCASION_LABELS: Record<Occasion, string> = {
  wedding: 'Wedding',
  corporate: 'Corporate event',
  birthday: 'Birthday',
  festival: 'Festival',
  college: 'College event',
  private: 'Private party',
  other: 'Something else',
};

/** The eight the picker offers. `other` is reachable from the form's own
 *  "something else" row rather than sitting in the grid as a ninth tile. */
export const ENTRY_TYPES: readonly PerformerType[] = [
  'band',
  'singer',
  'dj',
  'instrumentalist',
  'anchor',
  'comedian',
  'dance_crew',
  'magician',
];
