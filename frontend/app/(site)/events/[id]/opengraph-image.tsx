import { ImageResponse } from 'next/og';
import { fetchEventDetail } from '@/lib/api/events';
import { formatEventDateLong, formatFromPrice } from '@/lib/discovery/format';
import { parseEventRef } from '@/lib/events/ref';
import { OG_CONTENT_TYPE, OG_SIZE, OgCard, ogFonts } from '@/lib/seo/og-card';

/**
 * ── THE EVENT'S OWN SHARE CARD ────────────────────────────────────────────
 *
 * This is the highest-value image on the platform. The distribution model for a
 * gig is one person pasting a link into a group chat, and until now that paste
 * rendered as a bare URL — no title, no date, no price, nothing to click
 * toward. Every other surface on the site is downstream of this one working.
 *
 * It carries exactly the four facts that decide whether somebody taps: WHAT it
 * is (title), WHEN (the date, as the eyebrow — the single most common reason a
 * shared event is dismissed is "I'm busy that day"), WHERE (venue and city),
 * and WHAT IT COSTS.
 *
 * ── EVERY FIELD DEGRADES ON ITS OWN ───────────────────────────────────────
 *
 * `from_price` is a denormal `ticketing` maintains and is NULL until a tier
 * exists — which is not the same as free. `formatFromPrice` already encodes
 * that distinction, so the badge is simply omitted when it returns null rather
 * than rendering "₹0" or "Free" for an event whose tiers have not been created.
 * The same rule the cards and the event page follow.
 *
 * ── A FETCH FAILURE MUST NOT 500 ──────────────────────────────────────────
 *
 * A crawler hitting this route when the API is briefly down would otherwise
 * return a 500 to WhatsApp's or Twitter's fetcher, and those cache negative
 * results for a long time — one bad minute could mean a dead preview for the
 * rest of an on-sale. On any error it falls back to the generic site card,
 * which is always better than no card.
 */

/**
 * Edge, for the reason documented at length in `app/icon.tsx`. It matters more
 * here than on the static cards: this route runs per crawler request, so it
 * renders close to whoever asked and never occupies a Node server while a
 * social platform's fetcher waits.
 */
export const runtime = 'edge';

export const alt = 'Event on Curatix';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function EventOpengraphImage({ params }: { params: { id: string } }) {
  const fonts = await ogFonts();

  let title = 'Live on Curatix';
  let subtitle = 'Book tickets and get in with a single scan.';
  let eyebrow: string | undefined;
  let badge: string | undefined;

  try {
    // ── STRIP THE SLUG BEFORE FETCHING ────────────────────────────────────
    // `params.id` is a REF (`{slug}-{uuid}`), and the API's routes are
    // `<uuid:event_id>` — handing it the whole ref 404s, the `catch` below
    // swallows that silently, and EVERY event's share preview quietly degrades
    // to the generic site card with nothing logged anywhere. `parseEventRef`
    // is pure precisely so it can run here, under the edge runtime.
    const id = parseEventRef(params.id);
    if (!id) throw new Error('not an event ref');
    const event = await fetchEventDetail(id);
    title = event.title;
    // Venue and city, joined only when both are present — "Phoenix Marketcity ·
    // " with a dangling separator is the classic template tell.
    subtitle = [event.venue, event.city].filter(Boolean).join(' · ') || subtitle;
    eyebrow = formatEventDateLong(event.starts_at);
    badge = formatFromPrice(event.from_price) ?? undefined;
    // A card that says "From Free" reads badly; the price formatter returns the
    // bare word for zero, which is the right label on its own.
    if (badge && badge !== 'Free') badge = `From ${badge}`;
  } catch {
    // Deliberately silent: the generic card above is the fallback, and a
    // logged error per crawler hit on a cold API is noise, not signal.
  }

  return new ImageResponse(
    <OgCard title={title} subtitle={subtitle} eyebrow={eyebrow} badge={badge} />,
    {
      ...size,
      fonts,
    },
  );
}
