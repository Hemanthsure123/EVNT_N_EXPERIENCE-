import { NextResponse, type NextRequest } from 'next/server';
import { API_BASE_URL } from '@/lib/api/config';
import { eventRefSegment, parseEventRef } from '@/lib/events/ref';

/**
 * ── ONE JOB: SEND A LEGACY `/events/{uuid}` LINK TO ITS CANONICAL URL ─────
 *
 * Event URLs are `/events/{slug}-{uuid}`. Every link shared before slugs
 * existed, every ticket email and every organizer bookmark is the bare
 * `/events/{uuid}` form. Those must keep working — they do, the uuid is what
 * resolves the event — and they should also consolidate onto one URL rather
 * than sitting in the index as a duplicate of it.
 *
 * ── WHY THIS IS MIDDLEWARE AND NOT THE PAGE ───────────────────────────────
 *
 * It was written in the page first, then in `generateMetadata`, and NEITHER
 * emits a real HTTP redirect here. `app/(site)/loading.tsx` gives the route
 * group a Suspense boundary, so Next flushes the shell before the page (or its
 * metadata) resolves. A `redirect()` thrown after that cannot set a status
 * code: Next encodes it into the RSC stream as a CLIENT-side navigation
 * instead. A browser follows that and everything looks correct — and Googlebot
 * sees `200 OK` on the old URL with the app shell and no content, which is the
 * precise opposite of what a canonicalisation redirect is for. Verified with
 * `curl`, not assumed: the page-level version returned 200 with
 * `NEXT_REDIRECT…;308;` buried in the payload.
 *
 * Middleware runs BEFORE any of that, so it can return a genuine 308.
 *
 * ── AND IT COSTS THE HOT PATH NOTHING ─────────────────────────────────────
 *
 * The obvious objection to middleware here is that resolving a slug needs an
 * API call, and putting one in front of every `/events/*` request would add
 * latency to the site's most important page to serve a cold path.
 *
 * So it doesn't. A canonical URL already carries its slug, and this can tell
 * that from the URL alone: a segment that is EXACTLY a 36-character uuid has no
 * slug, and one that is longer already has one. Only the first kind is looked
 * up. A visitor arriving from search, from a card, or from anywhere inside the
 * app hits `next()` immediately with zero added work.
 *
 * A stale slug (`/events/old-name-{uuid}` after a rename) is deliberately NOT
 * redirected — it would need the same lookup on a URL that already looks
 * canonical, and it is covered by the `rel=canonical` tag the page emits.
 *
 * ── IT FAILS OPEN, ALWAYS ─────────────────────────────────────────────────
 *
 * Every failure — a down API, a timeout, a malformed payload, an event with no
 * slug — falls through to `next()`. The bare-uuid URL renders perfectly well on
 * its own; it is the URL the platform served for its entire life. Breaking a
 * working page to improve its URL would be a bad trade at any exchange rate.
 */

/** A bare uuid is 36 characters. Anything longer already carries a slug. */
const UUID_LENGTH = 36;

/**
 * Middleware is on the request path, so this must be short. If the API cannot
 * answer in this long, serving the un-redirected page is the right outcome.
 */
const LOOKUP_TIMEOUT_MS = 1500;

export const config = {
  // Only event detail URLs. Not `/events` itself, not the API, not assets —
  // a matcher that fires on everything is how middleware becomes a tax.
  //
  // `:ref+` (one-or-more), NOT `:ref`. The plain form compiles to a regexp
  // matching `/events` and nothing under it — checked in
  // `.next-e2e/server/middleware-manifest.json`, where it came out as
  // `^\/events(?:\/(.json))?$`. A matcher that silently matches the wrong
  // paths is invisible: the middleware simply never runs and everything looks
  // like it works, which is exactly how this was nearly shipped inert.
  matcher: ['/events/:ref+'],
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const ref = request.nextUrl.pathname.slice('/events/'.length);

  // Already slugged (or not an event ref at all) — nothing to do, no I/O.
  if (ref.length !== UUID_LENGTH) return NextResponse.next();

  const id = parseEventRef(ref);
  if (!id) return NextResponse.next();

  try {
    // No `next: { revalidate }` here: the Next data cache is not available in
    // middleware, and passing the option would read as caching that is not
    // happening. The backend's own `s-maxage=60` on this endpoint is what
    // absorbs the load, and only non-canonical URLs reach this line at all.
    const response = await fetch(`${API_BASE_URL}/api/v1/events/${id}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return NextResponse.next();

    const event = (await response.json()) as { id?: string; slug?: string };
    if (!event?.id) return NextResponse.next();

    const canonical = eventRefSegment({ id: event.id, slug: event.slug });
    // No slug (a title with no ASCII to slug, or a row the backfill has not
    // reached): the bare URL IS canonical. Redirecting would be a loop.
    if (canonical === ref) return NextResponse.next();

    const target = request.nextUrl.clone();
    target.pathname = `/events/${canonical}`;
    // `clone()` keeps the search params, which is load-bearing: the booking
    // funnel's "Change tickets" link carries the tier selection in
    // `?sel=`, and dropping it would silently empty a basket mid-checkout.
    return NextResponse.redirect(target, 308);
  } catch {
    // Deliberately silent and deliberately non-fatal. See the note above.
    return NextResponse.next();
  }
}
