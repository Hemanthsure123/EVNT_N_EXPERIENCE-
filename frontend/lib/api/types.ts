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
  /**
   * The readable half of the public URL, `/events/{slug}-{id}`.
   *
   * OPTIONAL on purpose. It lets this frontend typecheck and deploy against a
   * backend that has not shipped the column yet, and `eventPath()` falls back
   * to the bare-id URL — which is exactly what the platform served before, so
   * nothing breaks in the gap. Never derived on this side: the backend
   * computes it once on write and sends it, so the canonical tag, the JSON-LD
   * `url` and the sitemap cannot drift apart.
   */
  slug?: string;
  title: string;
  venue: string;
  city: string;
  /**
   * The browse taxonomy, as a real column on `Event`.
   *
   * Empty string means NOT CATEGORISED — a fact, and deliberately distinct
   * from `"other"`, which is an organiser choosing none of the eight. The card
   * renders a chip only when this is a known slug, so an uncategorised event
   * shows none rather than a guess.
   */
  category: string;
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
  /**
   * The ORGANISER's own rules — entry conditions, prohibited items, their
   * refund terms. Always an array (empty for an event that set none), never
   * null.
   *
   * Distinct from the platform policies the event page also renders (every
   * ticket is a signed QR code, no card data is stored). Those are true of
   * every event and are not an organiser's to edit, so they are hard-coded
   * and these are not.
   */
  policies: EventPolicy[];
  seo_title: string;
  seo_description: string;
};

export type EventPolicy = { title: string; body: string };

/**
 * One step of a tier's sale-phase schedule (backend SalePhaseSerializer).
 *
 * `quantity` is a CUMULATIVE `sold + reserved` threshold — "the first N seats
 * of this tier", not "N seats set aside at this price". Null means the phase is
 * bounded only by its deadline. `position` is the schedule order the write sent.
 */
export type SalePhase = {
  id: string;
  name: string;
  /** Minor units (paise). Always at or below the tier's face `price`. */
  price: number;
  ends_at: string | null;
  quantity: number | null;
  position: number;
};

/**
 * The phase that is live right now (backend `TicketTypeSerializer.current_phase`),
 * or null when the tier is at face price.
 *
 * `remaining` is how many seats are still inside the phase's threshold, and is
 * NULL when the phase has no threshold — an unbounded-by-seats phase has no
 * count to report and the backend does not invent one, so neither does any
 * screen that reads this.
 */
export type CurrentPhase = {
  name: string;
  ends_at: string | null;
  remaining: number | null;
};

/**
 * GET /events/{id}/ticket-types (backend TicketTypeSerializer). Money is minor
 * units. `available` = quantity − sold − reserved, computed server-side.
 *
 * These numbers are DISPLAY values read from a 5-second cache. The backend
 * makes the actual reserve decision under a per-tier row lock (see the
 * "cache-for-display, decide-under-lock" rule in the repo's CLAUDE.md), so
 * "3 left" here is a nudge, never a promise — the booking flow re-checks.
 *
 * The same split governs the phase fields: `effective_price` is the number to
 * SHOW, computed from the same pure rule (`apps/ticketing/pricing.py`) the
 * locked reserve uses to decide what to CHARGE. A phase that lapses inside the
 * cache's few seconds is briefly still on screen while the next reserve already
 * bills the next price — which errs the safe way, because the funnel shows the
 * BOOKING's own recorded price before anyone pays.
 */
export type TicketTier = {
  id: string;
  event_id: string;
  /**
   * Which SESSION this tier sells, for an event that runs more than once —
   * null for the ordinary single-show event, which is the common case.
   *
   * Inventory lives on this row, not on the session: `quantity`/`sold`/
   * `available` are per TIER, so selling out the 18:00 show leaves the 21:00
   * one untouched with no special handling anywhere. That is the whole reason
   * sessions could be added without touching the money path.
   */
  slot_id: string | null;
  name: string;
  /**
   * What this tier IS, in the organiser's words — "Standing, front of the
   * barrier". Blank is the norm: most tiers are self-describing and the panel
   * omits the line rather than rendering an empty paragraph.
   */
  description: string;
  /**
   * What is INCLUDED, as short strings. A list rather than prose because a
   * buyer comparing two tiers wants the difference, not two paragraphs to diff
   * by eye. Always an array; empty for a tier that lists none.
   */
  perks: string[];
  /** The organiser's own order for the panel, with price as the tiebreak. */
  position: number;
  /** Minor units (paise) — the FACE price, i.e. what a phase is a discount off. */
  price: number;
  /**
   * What a buyer pays right now, minor units. Equals `price` when no phase is
   * active. A screen that renders ONE number renders this one.
   */
  effective_price: number;
  current_phase: CurrentPhase | null;
  /**
   * What the price becomes once the current phase ends or exhausts, minor
   * units — the next phase that could still apply, else the face price. NULL
   * when no phase is active: there is nothing after the face price.
   */
  next_price: number | null;
  /** The whole schedule, ascending `position`. Empty when the tier has none. */
  phases: SalePhase[];
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
  /**
   * The SMS destination. Blank means "no number, skip SMS", which is a real and
   * supported state rather than an empty field: `notifications` skips a send
   * cleanly rather than failing when there is nowhere to send it.
   */
  phone: string;
  /**
   * Who they are, when they chose to say. Every one is optional and the UI
   * omits the row rather than guessing — an invented age or a defaulted
   * "Male" is exactly the kind of claim nobody made that this platform
   * refuses to render.
   */
  date_of_birth: string | null;
  /**
   * DERIVED on the server from `date_of_birth`, never stored.
   *
   * An age column is wrong the day after it is written, and this platform
   * displays age restrictions ("18+"), so a stale one would be a correctness
   * problem rather than an untidiness. Null when no date was given.
   */
  age: number | null;
  /**
   * `''` means NEVER ANSWERED. `'prefer_not_to_say'` means asked, and
   * declined — a different state, and the reason onboarding does not
   * re-prompt somebody whose answer clearly meant stop asking.
   */
  gender: Gender | '';
  /** Only meaningful with `gender === 'self_described'`. */
  gender_self_described: string;
  /**
   * What to SHOW, resolved once on the server. A client that has to know the
   * `self_described` pairing is a client that will get it wrong on one of the
   * four screens a profile appears on.
   */
  gender_display: string;
  /**
   * When the welcome flow was ANSWERED — filled in or skipped. Null means it
   * has not been, which is what opens onboarding.
   */
  onboarding_completed_at: string | null;
  date_joined: string;
};

export type Gender =
  | 'woman'
  | 'man'
  | 'non_binary'
  | 'self_described'
  | 'prefer_not_to_say';

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

/**
 * One line of a booking (backend BookingItemSerializer). Money is minor units.
 *
 * `unit_price` is what was RECORDED at reserve time under the tier's row lock —
 * the authoritative charge, not a recomputation. `phase_name` is the sale phase
 * that priced it, null when it billed at the face price, so a line can read
 * "Gold — Early bird" and explain a total that is lower than today's list price.
 */
export type BookingItem = {
  ticket_type_id: string;
  ticket_type_name: string;
  quantity: number;
  unit_price: number;
  phase_name: string | null;
};

/**
 * A booking (backend BookingSummary/BookingDetailSerializer).
 *
 * `total_amount` is what the customer pays, and it CONTAINS the other two:
 *
 *     total_amount = ticket subtotal + platform_fee + donation
 *
 * This comment used to say the opposite — that the fee was taken out of the
 * total at settlement and adding it on screen would overstate the price. That
 * was true of a flat per-ticket fee deducted from the organizer's share. The fee
 * is charged on top now, the organizer receives the full ticket subtotal, and
 * the mistake to avoid has inverted: **never add `platform_fee` or `donation` to
 * `total_amount`**, because they are already inside it. The ticket subtotal is
 * `total_amount - platform_fee - donation`.
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
  /** Optional charitable donation the buyer added. Included in `total_amount`. */
  donation: number;
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
