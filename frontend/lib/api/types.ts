/**
 * Hand-aligned response types for the reads used NOW. The full typed surface is
 * generated from the backend OpenAPI schema via `npm run gen:api` (writes
 * lib/api/schema.d.ts) — regenerate that once the backend contract is frozen and
 * migrate these hand-written shapes to the generated ones.
 */

/** The cursor-paginated list envelope (backend core.pagination). */
export type Paginated<T> = {
  data: T[];
  meta: {
    count?: number | null;
    next: string | null;
    previous: string | null;
  };
};

/** GET /events, /events/{id} card (backend EventCardSerializer). Money is in
 * minor units (paise); `from_price` / `tickets_available` are null until
 * ticketing populates them. */
export type EventCard = {
  id: string;
  title: string;
  venue: string;
  city: string;
  /** Google place id. Empty when the organizer typed the venue freehand. */
  place_id?: string;
  /** Null unless the organizer pinned a real place — never render a marker
   *  without BOTH. (0, 0) is a real spot in the Atlantic. */
  latitude?: number | string | null;
  longitude?: number | string | null;
  starts_at: string; // ISO 8601
  poster_url: string;
  from_price: number | null;
  tickets_available: number | null;
  organization_id: string;
  organization_name: string;
};

/** GET /events/{id} (backend EventDetailSerializer). The conversion layer (the
 * next slice) is what really consumes this — discovery only needs enough for
 * the placeholder route and its metadata. */
export type EventDetail = EventCard & {
  description: string;
  ends_at: string | null;
  status: string;
  version: number;
  created_at: string;
  /**
   * Content fields. Every one is `""` or `null` unless an organizer filled it
   * in — they are NOT optional on the wire, the serializer always sends them.
   * Blank means "the organizer did not say", and the page omits the row rather
   * than guessing: a default of "2 hours" or "All ages" would be a claim
   * nobody made, and an age policy is exactly the wrong thing to invent.
   */
  short_description: string;
  duration_minutes: number | null;
  language: string;
  age_restriction: string;
  accessibility_notes: string;
  seo_title: string;
  seo_description: string;
};

/**
 * GET /events/{id}/ticket-types (backend TicketTypeSerializer). Money is minor
 * units. `available` = quantity − sold − reserved, computed server-side.
 *
 * These numbers are DISPLAY values read from a 5-second cache. The backend
 * makes the actual reserve decision under a per-tier row lock (see the
 * "cache-for-display, decide-under-lock" rule in the repo's CLAUDE.md), so
 * "3 left" here is a nudge, never a promise — the booking flow re-checks.
 */
export type TicketTier = {
  id: string;
  event_id: string;
  name: string;
  /** Minor units (paise). */
  price: number;
  quantity: number;
  sold: number;
  available: number;
  sale_start: string | null;
  sale_end: string | null;
  max_per_order: number;
  is_on_sale: boolean;
  version: number;
  created_at: string;
};

/** GET /auth/me, and the `user` half of register/login (backend UserSerializer). */
export type User = {
  id: string;
  email: string;
  full_name: string;
  is_organizer: boolean;
  /** Platform operator. Gates the admin console; every admin API still checks. */
  is_staff: boolean;
  /**
   * Whether the address has been PROVEN. Registration creates an account with
   * this false and issues NO session — verifying is what signs you in — so the
   * UI needs it to decide whether to show the verify screen to a returning
   * session.
   */
  email_verified: boolean;
  date_joined: string;
};

export type AuthResponse = {
  user: User;
  tokens: TokenPair;
};

/**
 * POST /auth/register. Deliberately has NO tokens.
 *
 * Handing out a session at sign-up would make verification optional in
 * practice — keep the token, never open the email. `POST /auth/verify-email`
 * returns the session instead.
 */
export type RegistrationResponse = {
  user: User;
  verification_required: boolean;
  message: string;
};

/** One line of a booking (backend BookingItemSerializer). Money is minor units. */
export type BookingItem = {
  ticket_type_id: string;
  ticket_type_name: string;
  quantity: number;
  unit_price: number;
};

/**
 * A booking (backend BookingSummary/BookingDetailSerializer).
 *
 * `total_amount` is what the customer pays. `platform_fee` is the platform's cut
 * taken OUT of that total at settlement — NOT a surcharge on top of it. Adding
 * it to the total on screen would overstate the price by exactly the fee.
 *
 * `hold_expires_at` is a real deadline: the backend's sweeper releases the
 * reserved inventory when it passes.
 */
export type Booking = {
  id: string;
  event_id: string;
  event_title?: string;
  status: 'reserved' | 'paid' | 'cancelled' | 'expired';
  total_amount: number;
  platform_fee: number;
  hold_expires_at: string | null;
  payment_order_id: string | null;
  items?: BookingItem[];
  created_at: string;
};

/** POST /bookings — the booking plus everything Razorpay Checkout needs. */
export type CreateBookingResponse = {
  booking: Booking;
  payment: {
    order_id: string | null;
    amount_minor: number;
    currency: string;
    /** The PUBLIC Razorpay key, from the server. Empty when none is configured. */
    key_id: string;
  };
};

export type TokenPair = {
  access: string;
  refresh: string;
};
