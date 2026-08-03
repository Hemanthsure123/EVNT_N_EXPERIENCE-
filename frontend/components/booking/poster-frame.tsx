import * as React from 'react';
import Image from 'next/image';
import { ClayIcon } from '@/components/illustrations/clay';
import { type CategorySlug, inferCategory } from '@/lib/discovery/categories';
import { cn } from '@/lib/utils/cn';

/**
 * The event's picture, wherever the funnel shows it.
 *
 * ── THE NO-POSTER CASE IS THE DEFAULT CASE ────────────────────────────────
 *
 * Most events in this catalogue have no `poster_url`. Both places the funnel
 * rendered one — the summary card's thumbnail and the review step's event row —
 * previously fell back to `bg-gradient-to-br from-muted to-border`: a two-stop
 * ramp across a 4% luminance range, which on a white canvas is an empty grey
 * rectangle. An empty frame reads as an image that FAILED TO LOAD, which is
 * worse than no frame at all.
 *
 * So the fallback is the target language's category tile instead: the soft
 * pastel wash keyed to the inferred category (`bg-tint-<slug>`, a token pair
 * that flips with the theme) behind the 3D clay icon for that category. It says
 * something true about the event — the same inference already drives the
 * category chip beside it — rather than reserving space for nothing.
 *
 * The tints are looked up through a literal map because Tailwind scans source
 * text: `bg-tint-${slug}` built at runtime is a class that never gets generated.
 *
 * Sizing is the CALLER's: `className` shapes the frame (it is `relative`, so an
 * aspect utility or fixed size both work) and `iconClassName` sizes the clay
 * tile, because a 64px thumbnail and a 128px poster want very different glyphs.
 */

const TINT: Record<CategorySlug, string> = {
  concerts: 'bg-tint-concerts',
  comedy: 'bg-tint-comedy',
  workshops: 'bg-tint-workshops',
  sports: 'bg-tint-sports',
  festivals: 'bg-tint-festivals',
  nightlife: 'bg-tint-nightlife',
  'food-drink': 'bg-tint-food-drink',
  tech: 'bg-tint-tech',
};

export function PosterFrame({
  event,
  sizes,
  className,
  iconClassName,
}: {
  event: { title: string; venue?: string; poster_url?: string | null };
  /** `next/image` sizes hint — required, so no frame ships an unbounded image. */
  sizes: string;
  className?: string;
  iconClassName?: string;
}) {
  const category = inferCategory(event);

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-lg border border-border',
        category ? TINT[category.slug] : 'bg-sunken',
        className,
      )}
    >
      {event.poster_url ? (
        <Image src={event.poster_url} alt="" fill sizes={sizes} className="object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          {/* `title=""` marks the tile decorative: the event's name is already
              the heading beside it, and a second announcement of the category
              is noise on a screen reader. */}
          <ClayIcon slug={category?.slug ?? 'neutral'} title="" className={iconClassName} />
        </span>
      )}
    </div>
  );
}
