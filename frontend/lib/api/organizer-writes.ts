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

export type CreateTicketTypeInput = {
  name: string;
  /** Minor units (paise). */
  price: number;
  quantity: number;
  sale_start?: string | null;
  sale_end?: string | null;
  max_per_order?: number;
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
