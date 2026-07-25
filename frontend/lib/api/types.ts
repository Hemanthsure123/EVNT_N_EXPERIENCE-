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
  starts_at: string; // ISO 8601
  poster_url: string;
  from_price: number | null;
  tickets_available: number | null;
  organization_id: string;
  organization_name: string;
};

export type TokenPair = {
  access: string;
  refresh: string;
};
