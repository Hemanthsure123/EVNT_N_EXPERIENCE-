import { ImageResponse } from 'next/og';
import { OG_CONTENT_TYPE, OG_SIZE, OgCard, ogFonts } from '@/lib/seo/og-card';

/**
 * The site-wide share card. Next uses it for every route that does not define
 * its own — so this is what a shared `/`, `/events`, `/hire`, a city landing
 * page or a legal page looks like in a chat.
 *
 * `/events/[id]` overrides it with the event's own card, because a link to a
 * specific gig that previews as the generic site card is the one case where the
 * default is actively unhelpful.
 */

/** Edge, for the reason documented at length in `app/icon.tsx`. */
export const runtime = 'edge';

export const alt = 'Curatix — discover and book live events across India';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Live events"
        title="Find something worth leaving the house for."
        // Kept under `truncate`'s 96-character subtitle budget ON PURPOSE. The
        // first draft ran to 104 and rendered as "…booked in seconds, entered…"
        // — the truncation worked exactly as designed, on copy that should not
        // have needed it. A share card is the one surface where an ellipsis is
        // never a graceful degradation, because it is the whole message.
        subtitle="Concerts, comedy, workshops, sports and festivals across India. Booked in seconds."
      />
    ),
    { ...size, fonts: await ogFonts() },
  );
}
