import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import { EventPosterArt } from '@/components/illustrations/poster';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { availabilityBadge } from '@/lib/discovery/availability';
import { categoryBySlug, inferCategory } from '@/lib/discovery/categories';
import { formatEventDateTime, formatFromPrice, machineDate } from '@/lib/discovery/format';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';
import { AvailabilityBadge } from './availability-badge';

/**
 * The showcase's card. A cousin of `EventCard`, not a variant of it.
 *
 * ── WHY A SECOND CARD RATHER THAN A PROP ──────────────────────────────────
 *
 * `EventCard` is the unit of a GRID: it is responsive down to a 96px row on a
 * phone, it carries a save button, and its width comes from the column it
 * lands in. This one lives in a rail that moves, which changes three things
 * that a `variant="showcase"` prop would have had to fight rather than express:
 *
 *  1. **Fixed width, every breakpoint.** A marquee translates by a percentage
 *     of its own track; a card that reflows changes the track's width and the
 *     loop stops meeting itself. So the width is a `clamp()` and not a grid
 *     fraction.
 *  2. **No save button.** Every card is duplicated for the seamless loop, so an
 *     interactive control would exist twice with one state — press the visible
 *     heart and its twin does not move. The whole card is one link instead,
 *     which duplicates harmlessly.
 *  3. **Text over the poster, not under it.** Under a moving card the eye never
 *     settles long enough to read a stacked block; composited on the image with
 *     a gradient scrim, title and date arrive together as one shape.
 *
 * The scrim is the reason (3) is safe here and is refused on `EventCard`: this
 * card ALWAYS has one, so the contrast of white-on-image is a fixed number
 * rather than a hope about which poster was uploaded.
 */
export function ShowcaseCard({
  event,
  priority = false,
}: {
  event: EventCardData;
  /** Only the first few. These are the LCP candidates on the front page. */
  priority?: boolean;
}) {
  const category = categoryBySlug(event.category) ?? inferCategory(event);
  const badge = availabilityBadge(event);
  const price = formatFromPrice(event.from_price);

  return (
    <Link
      href={eventPath(event)}
      className={cn(
        'group relative flex aspect-[3/4] w-[15rem] shrink-0 overflow-hidden rounded-2xl border border-border bg-sunken shadow-lg sm:w-[17rem]',
        'transition duration-base ease-out hover:-translate-y-1 hover:shadow-xl',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      )}
    >
      {event.poster_url ? (
        <Image
          src={event.poster_url}
          alt=""
          fill
          // The card is a fixed 240/272px wide, so the browser needs no
          // viewport arithmetic — telling it the real number stops it fetching
          // a full-width source for a quarter-width box.
          sizes="(min-width: 640px) 272px, 240px"
          priority={priority}
          className="object-cover transition-transform duration-slow ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        <EventPosterArt slug={category?.slug ?? ''} seed={event.id} className="absolute inset-0" />
      )}

      {/* The scrim. Two stops rather than a single fade: a linear wash over the
          whole card greys the artwork, where a dark foot and a clear top keeps
          the poster readable AND the text legible. */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-overlay/85 via-overlay/25 to-transparent"
        aria-hidden
      />

      <div className="relative mt-auto flex w-full flex-col gap-1.5 p-4">
        {badge ? <AvailabilityBadge badge={badge} className="w-fit" /> : null}
        <h3 className="line-clamp-2 text-body-lg font-semibold text-white">{event.title}</h3>
        <p className="flex items-center gap-1.5 text-caption text-white/85">
          <CalendarDays className="size-3.5 shrink-0" aria-hidden />
          <time dateTime={machineDate(event.starts_at)}>{formatEventDateTime(event.starts_at)}</time>
        </p>
        <p className="flex items-center gap-1.5 text-caption text-white/85">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {event.venue}
            {event.city ? `, ${event.city}` : ''}
          </span>
        </p>
        {price ? (
          <p className="text-caption font-semibold text-white">
            {price === 'Free' ? 'Free' : `from ${price}`}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/** The loading shape. Same box, so nothing shifts when the real cards land. */
export function ShowcaseCardSkeleton() {
  return (
    <div
      className="aspect-[3/4] w-[15rem] shrink-0 animate-pulse rounded-2xl border border-border bg-muted sm:w-[17rem]"
      aria-hidden
    />
  );
}
