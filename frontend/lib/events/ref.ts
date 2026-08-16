/**
 * Event URL refs: `/events/{slug}-{uuid}`.
 *
 * ── THE UUID IS THE IDENTITY; THE SLUG IS TEXT ────────────────────────────
 *
 * Every event URL ends in the event's UUID, always, in the same 36 characters.
 * The slug in front of it is keywords for a human and for a crawler, and it
 * carries no meaning the system depends on. That one decision is why:
 *
 *   - no link can ever break. A renamed event's old URL still contains the
 *     same UUID, so it resolves and redirects to the new one.
 *   - two events with the same title need no disambiguating suffix, no unique
 *     constraint on a 200k-row table, and no slug-history table.
 *   - `/events/sitemap` and every future word-route under `/events/` is safe:
 *     an event titled "Sitemap" is `sitemap-{uuid}`, which cannot shadow it.
 *   - the OLD `/events/{uuid}` URL is not a legacy scheme to be supported
 *     alongside a new one — it is this scheme with an empty slug. One code
 *     path, not two.
 *
 * ── PARSING IS A FIXED-WIDTH TAIL, NOT A SPLIT ────────────────────────────
 *
 * Take the LAST 36 characters and test them against the UUID shape. Splitting
 * on the last hyphen would be ambiguous — a slug is full of hyphens, and
 * "cafe-1234" looks like hex — whereas a fixed tail plus a strict pattern is
 * decidable. An event whose title is itself a UUID parses to the trailing one,
 * which is the correct answer.
 *
 * ── PURE, SO IT RUNS ON THE EDGE ──────────────────────────────────────────
 *
 * No React, no Node APIs, no `next/*` import. `opengraph-image.tsx` runs under
 * `runtime = 'edge'` and has to strip a ref before it fetches, and a shared
 * implementation is the only way the canonical tag, the JSON-LD `url`, the
 * sitemap and the OG card can be guaranteed to agree.
 *
 * ── THE SLUG IS NEVER DERIVED HERE ────────────────────────────────────────
 *
 * It arrives on the wire from the backend, which computes it once on write. A
 * second implementation on this side would drift, and a canonical tag that
 * disagrees with the sitemap is an SEO fault nobody notices for months.
 */

const UUID_LENGTH = 36;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The minimum an event needs to build its own URL. */
export type EventRefSource = { id: string; slug?: string | null };

/**
 * The event id inside a `/events/[id]` segment, or `null` if there isn't one.
 *
 * `null` means 404. It never throws and never guesses — a segment that is not
 * a ref is not a mangled event, it is a request for a page that does not exist.
 */
export function parseEventRef(ref: string | undefined | null): string | null {
  if (!ref) return null;
  const tail = ref.slice(-UUID_LENGTH);
  if (!UUID_PATTERN.test(tail)) return null;
  // A ref is either the bare uuid or `{slug}-{uuid}`. Anything else glued
  // directly onto the front (no separator) is not a ref we ever emitted.
  const prefix = ref.slice(0, -UUID_LENGTH);
  if (prefix && !prefix.endsWith('-')) return null;
  return tail;
}

/**
 * The canonical `[id]` segment for an event.
 *
 * Falls back to the bare id when `slug` is absent or empty — which covers a
 * frontend deployed ahead of the backend that sends the field, a row the
 * backfill has not reached, and a title with no ASCII to slug. All three
 * produce exactly the URL the platform served before slugs existed.
 */
export function eventRefSegment(event: EventRefSource): string {
  const slug = (event.slug ?? '').trim();
  return slug ? `${slug}-${event.id}` : event.id;
}

/** The canonical site-relative path for an event page. */
export function eventPath(event: EventRefSource): string {
  return `/events/${eventRefSegment(event)}`;
}
