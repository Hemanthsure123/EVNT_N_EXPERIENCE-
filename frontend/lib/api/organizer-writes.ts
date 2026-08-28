import { api } from './client';
import type { EventDetail, TicketTier } from './types';

/**
 * The writes an organizer performs.
 *
 * These deliberately do NOT live in `lib/api/organizer.ts`: every one of them
 * is owned by the module that owns the rule — creating an event is `events`,
 * a tier is `ticketing`, a refund is `payments`. The dashboard is a client of
 * those modules, not a parallel API. Keeping the split visible here is what
 * stops someone adding a "convenience" organizer-scoped write later that
 * bypasses a publish gate or an inventory lock.
 *
 * **Optimistic locking.** `updateEvent` and `updateTicketType` both take the
 * `version` the client last read. If someone else edited in between, the
 * backend answers `409 stale_event_version` / `stale_ticket_type_version`
 * rather than silently clobbering their change — so callers must handle 409 by
 * re-reading, not by retrying with the same version.
 */

export type CreateEventInput = {
  organization_id: string;
  title: string;
  description?: string;
  venue: string;
  city: string;
  /** ISO 8601. The backend rejects anything not in the future. */
  starts_at: string;
  ends_at?: string | null;
  /**
   * Where the venue is: which Google place, and the pin.
   *
   * All three are written together by the venue picker and cleared together
   * (`''`, `null`, `null`). The serializer enforces both-or-neither on the
   * coordinate pair and 400s a lone value — half a pair would put the marker on
   * the Greenwich meridian rather than nowhere.
   */
  place_id?: string;
  latitude?: number | null;
  longitude?: number | null;
};

/**
 * The content fields.
 *
 * Every one is optional and blank-able, matching the columns: an organizer who
 * does not know the age policy leaves it empty and the event page omits the
 * row. A required field is how "All ages" ends up on an 18+ event.
 */
export type EventContentFields = {
  short_description: string;
  /** Null, never 0 — "0 minutes" is a claim; null renders as nothing. */
  duration_minutes: number | null;
  language: string;
  age_restriction: string;
  accessibility_notes: string;
  /**
   * The organiser's own rules, replaced WHOLESALE — an empty array clears
   * them, an absent key leaves them alone.
   *
   * Wholesale rather than per-row because these entries have no server
   * identity to preserve: there is nothing to diff and no per-row patch to get
   * wrong. Capped at 12 by the server.
   */
  policies: { title: string; body: string }[];
  seo_title: string;
  seo_description: string;
};

/** Everything creatable is editable except the owning organisation — which
 *  includes the venue's place and pin, because a column the event page renders
 *  must be reachable by a PATCH or it is decoration. */
export type UpdateEventInput = Partial<Omit<CreateEventInput, 'organization_id'>> &
  Partial<EventContentFields> & {
    version: number;
  };

export const createEvent = (input: CreateEventInput) => api.post<EventDetail>('/events', input);

export const updateEvent = (eventId: string, input: UpdateEventInput) =>
  api.patch<EventDetail>(`/events/${encodeURIComponent(eventId)}`, input);

/**
 * Upload the cover image.
 *
 * `poster` is a DRF `FileField`, so this one call has to be multipart while
 * every other write on the event is JSON — hence a separate function rather
 * than an optional field on `updateEvent`. It still carries `version`, because
 * it is the same optimistic-locked PATCH: uploading a poster bumps the event
 * just like any other edit, and a stale version is still a 409.
 */
export const uploadPoster = (eventId: string, version: number, poster: File) => {
  const form = new FormData();
  form.append('version', String(version));
  form.append('poster', poster);
  return api.patch<EventDetail>(`/events/${encodeURIComponent(eventId)}`, form);
};

/**
 * Draft -> live. The backend runs every registered publish check first
 * (`apps/events/publish_checks.py`) — today that means "has at least one ticket
 * type", registered by `ticketing`. A failure comes back as a `DomainError`
 * naming the unmet check, which is exactly what the wizard's final step shows.
 */
export const publishEvent = (eventId: string) =>
  api.post<EventDetail>(`/events/${encodeURIComponent(eventId)}/publish`, {});

/**
 * Retire an event. Draft, rejected or finished only.
 *
 * A POST rather than a PATCH because it is a lifecycle transition with
 * source-state rules — `status` is deliberately not in the update serializer's
 * editable set, so this is the only route to `archived`.
 *
 * There is NO `deleteEvent`, and there should not be: an event is referenced
 * by bookings, tickets and a settlement, all `PROTECT`ed at the database, so a
 * delete would either fail outright or orphan real money. A bulk bar offering
 * Delete would be offering an operation the platform cannot perform.
 */
export const archiveEvent = (eventId: string) =>
  api.post<EventDetail>(`/events/${encodeURIComponent(eventId)}/archive`, {});

/**
 * Copy an event into a fresh draft.
 *
 * Returns the NEW event, not the source — the caller needs its id to navigate
 * to, and answering with the original would look like nothing happened.
 *
 * The copy has NO TICKET TYPES: they belong to `ticketing`, whose dependency
 * points at `events` and not back, so the clone cannot reach across to
 * duplicate tier rows. The practical consequence is that the copy cannot be
 * published until a tier is added — the publish check `ticketing` registers —
 * which is why the caller tells the organizer on the way in rather than
 * letting them discover it at the gate.
 */
export const duplicateEvent = (eventId: string) =>
  api.post<EventDetail>(`/events/${encodeURIComponent(eventId)}/duplicate`, {});

/** What a cancellation actually did. A bare 200 would leave an organiser who
 *  just spent money with no idea how much. */
export type CancelEventResult = {
  event_id: string;
  title: string;
  reason: string;
  refunds_enqueued: number;
  holds_released: number;
  attendees_notified: number;
};

/**
 * Call a LIVE event off, and make good on it.
 *
 * Neither archive nor delete. Archive retires an event nobody holds a ticket
 * to — the server refuses it for `live`. Deletion is an operator's tool for a
 * listing that should not exist. This is the ordinary, awful case: a live
 * event with real bookings that is not going to happen.
 *
 * It refunds every paid booking, releases every hold and emails every ticket
 * holder — so it is not undoable, and the UI asks rather than offering undo.
 * `reason` is REQUIRED and everybody who booked is shown it verbatim.
 *
 * The event page keeps resolving afterwards, showing a cancelled state: people
 * have the link in an email and will open it.
 */
export const cancelEvent = (eventId: string, reason: string) =>
  api.post<CancelEventResult>(`/events/${encodeURIComponent(eventId)}/cancel`, { reason });

/**
 * One step of the sale-phase schedule, as WRITTEN.
 *
 * ARRAY ORDER IS POSITION — there is no `position` field to send, and no id:
 * the schedule is submitted whole and replaced whole, so an edit is "here is
 * the new schedule", never a per-row patch. An empty array CLEARS it.
 *
 * `quantity` is the CUMULATIVE `sold + reserved` threshold at which the phase
 * closes (the first N seats of the tier), not a per-phase allocation.
 *
 * The rules the service enforces, mirrored in the wizard so a save is not the
 * first time an organizer hears them: at most 5 phases, names non-blank, every
 * price at or below the tier's face price, prices non-decreasing across the
 * array, and each phase bounded by `ends_at` or `quantity` (or both) — an
 * unbounded phase never ends, which makes everything after it decoration.
 */
export type SalePhaseInput = {
  name: string;
  /** Minor units (paise), > 0. A free phase is a different product, not a discount. */
  price: number;
  ends_at?: string | null;
  quantity?: number | null;
};

export type CreateTicketTypeInput = {
  name: string;
  /** What this tier IS — "Standing, front of the barrier". Blank is the norm. */
  description?: string;
  /**
   * What is INCLUDED, as short strings, capped at 8 by the server. Blank and
   * duplicate entries are dropped there rather than refused: an organiser who
   * tabbed through an empty row should not have their tier save fail.
   */
  perks?: string[];
  /** The organiser's own order for the panel; price is the tiebreak. */
  position?: number;
  /** Minor units (paise). */
  price: number;
  quantity: number;
  /**
   * Which SESSION this tier sells, for an event that runs more than once.
   * Omitted for the ordinary single-show event.
   *
   * CREATE ONLY, deliberately: `UpdateTicketTypeInput` is a Partial of this,
   * but the server's editable set does not include it. Moving a tier that has
   * sold between sessions would re-point issued tickets at a different show,
   * and the honest fix for a mis-assigned tier is a new tier, not a silent
   * reassignment of somebody's evening.
   */
  slot_id?: string | null;
  sale_start?: string | null;
  sale_end?: string | null;
  max_per_order?: number;
  phases?: SalePhaseInput[];
};

export type UpdateTicketTypeInput = Partial<CreateTicketTypeInput> & { version: number };

export const createTicketType = (eventId: string, input: CreateTicketTypeInput) =>
  api.post<TicketTier>(`/events/${encodeURIComponent(eventId)}/ticket-types`, input);

export const updateTicketType = (ticketTypeId: string, input: UpdateTicketTypeInput) =>
  api.patch<TicketTier>(`/ticket-types/${encodeURIComponent(ticketTypeId)}`, input);

/**
 * There is deliberately NO `deleteTicketType`.
 *
 * `apps/ticketing` exposes GET and PATCH on `/ticket-types/{id}` and nothing
 * else — which is correct on a money path: a tier with `sold > 0` is referenced
 * by issued tickets and by the settlement that will pay them out, so deleting
 * it would orphan real orders. The wizard can only remove a tier it has not
 * saved yet; once created, a tier is edited, not deleted. `BACKLOG.md` covers
 * the archive flag this would need.
 */

/**
 * Refund a captured payment. Organizer/admin only, and idempotent server-side
 * — a payment already refunded is a no-op, and the vendor call carries its own
 * idempotency key, so a double-click cannot double-refund.
 */
export const refundPayment = (paymentId: string, reason = '') =>
  api.post<void>(`/payments/${encodeURIComponent(paymentId)}/refund`, { reason });

/**
 * The gate's verdict. A DENIAL is a 200, not an error — only bad auth raises.
 *
 * Every field except `allowed` and `reason` is nullable, and verified so
 * against the live API: a forged token is rejected before any database access,
 * so there is no ticket, no event and no gate to report back. Typing `gate` as
 * `string` would have put "null" on screen at a turnstile.
 */
export type VerifyResult = {
  allowed: boolean;
  reason: string;
  ticket_id: string | null;
  event_id: string | null;
  ticket_type: string | null;
  used_at: string | null;
  gate: string | null;
};

export const verifyTicket = (input: { event_id: string; qr_token: string; gate?: string }) =>
  api.post<VerifyResult>('/checkin/verify', input);

export type Attendance = { event_id: string; admitted: number; capacity: number };

export const fetchAttendance = (eventId: string) =>
  api.get<Attendance>(`/events/${encodeURIComponent(eventId)}/attendance`);
