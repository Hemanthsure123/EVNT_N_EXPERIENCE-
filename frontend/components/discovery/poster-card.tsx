'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { EventPosterArt } from '@/components/illustrations/poster';
import type { EventCard as EventCardModel } from '@/lib/api/types';
import { availabilityBadge } from '@/lib/discovery/availability';
import { categoryBySlug, inferCategory } from '@/lib/discovery/categories';
import { formatFromPrice } from '@/lib/discovery/format';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';
import { AvailabilityBadge } from './availability-badge';
import { categoryTint } from './category-tint';
import { FavouriteButton } from './favourite-button';
import { DateBadge } from './date-badge';

/**
 * ── THE POSTER IS THE CARD ────────────────────────────────────────────────
 *
 * One tall artwork, then three lines of plain text under it on the page
 * itself: title, where, from-price. No frame, no border, no elevation, no
 * hover lift — the chrome is gone and the picture carries the whole card.
 *
 * That is the entire difference from `EventCard`, which is still what the
 * BROWSE grid uses. This one exists beside it rather than replacing it,
 * because the two answer different questions. Browse is a working surface —
 * you are comparing twenty events on date, price and availability, so its card
 * puts a category chip, a date row, an organiser line and an availability
 * badge in a bordered container you can scan down a column of. The front page
 * is a shop window: nothing is being compared yet, and the job of the card is
 * to make one event worth looking at.
 *
 * ── PORTRAIT AT EVERY WIDTH ───────────────────────────────────────────────
 *
 * `EventCard` collapses to a 96px-thumbnail ROW below `sm`, which is right for
 * a filterable list and wrong here: on a phone this is the hero content, and a
 * thumbnail beside two lines of text is a search result, not a shop window.
 * One shape, one crop, every breakpoint.
 *
 * ── WHAT IS STILL ON IT, AND WHY ──────────────────────────────────────────
 *
 * Only the two things that change a decision rather than describe the event:
 * the availability badge (over the poster, where a "3 left" is read before the
 * title) and the save control. Both are the SAME components the browse card
 * uses, so an event reads identically wherever it appears and there is one
 * implementation of "is this nearly gone".
 *
 * A poster-less event gets `EventPosterArt` — the category's pastel plate with
 * a modelled object on it, seeded by the event id so a screenful reads as a
 * set of related covers rather than twenty identical tiles. Most events in a
 * young catalogue have no poster, so this is the common case, not the
 * fallback.
 */
import { useEventDeck } from '@/lib/discovery/event-deck-context';

export interface PosterCardProps {
  event: EventCardModel;
  /** `sizes` for the poster. Pass the grid's real column widths. */
  sizes?: string;
  /** LCP candidates only — everything else must not compete for bandwidth. */
  priority?: boolean;
  className?: string;
  allEvents?: EventCardModel[];
  index?: number;
}

export function PosterCard({
  event,
  sizes = '(min-width: 1024px) 33vw, (min-width: 640px) 45vw, 90vw',
  priority = false,
  className,
  allEvents,
  index = 0,
}: PosterCardProps) {
  const { openDeck } = useEventDeck();
  const badge = availabilityBadge(event);
  const category = categoryBySlug(event.category) ?? inferCategory(event);
  const price = formatFromPrice(event.from_price);
  const tint = categoryTint(category?.slug);

  const handleMobileTap = () => {
    openDeck(allEvents && allEvents.length > 0 ? allEvents : [event], index);
  };

  return (
    <article
      className={cn(
        'group/poster relative flex h-full flex-col gap-3',
        // Touch compression. The pattern already exists on EventCard and the
        // mood tiles; the two home-page cards were the ones without it, so the
        // busiest surface on the phone was the one that felt dead on press.
        'transition-transform duration-fast active:scale-[0.98]',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        className,
      )}
    >
      <div
        data-event-poster={event.id}
        className="relative aspect-portrait w-full overflow-hidden rounded-2xl bg-muted"
      >
        {event.poster_url ? (
          <Image
            src={event.poster_url}
            alt=""
            fill
            sizes={sizes}
            priority={priority}
            loading={priority ? undefined : 'lazy'}
            className={cn(
              'object-cover transition-transform duration-slow ease-out',
              'group-hover/poster:scale-[1.03]',
              'motion-reduce:transition-none motion-reduce:group-hover/poster:scale-100',
            )}
          />
        ) : (
          <EventPosterArt slug={category?.slug ?? ''} seed={event.id} className={tint.surface} />
        )}

        {badge ? (
          <div className="absolute left-3 top-3">
            <AvailabilityBadge badge={badge} />
          </div>
        ) : null}

        <div className="absolute right-2 top-2 z-10">
          <FavouriteButton eventId={event.id} title={event.title} />
        </div>

        {/* BOTTOM-left. The top-left is the availability badge's and the
            top-right is the heart's, and three overlays in two corners is how a
            card starts hiding its own artwork. */}
        <DateBadge startsAt={event.starts_at} className="bottom-2 left-2" />
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="line-clamp-2 text-body font-bold leading-snug tracking-tight text-foreground">
          {/* Desktop link navigation */}
          <Link
            href={eventPath(event)}
            className="hidden sm:inline after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
          >
            {event.title}
          </Link>
          {/* Mobile tap trigger for District Event Deck */}
          <button
            type="button"
            onClick={handleMobileTap}
            className="sm:hidden text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
          >
            {event.title}
          </button>
        </h3>

        {/* The date is NOT a text line here any more — it is the badge on the
            artwork above. Four stacked grey lines under a title (date, venue,
            city, price) is most of the card's height spent on the two things
            read last, and the date is the one that gets truncated first on a
            phone. */}
        <p className="truncate text-body-sm text-muted-foreground">
          {event.venue}
          {event.city ? ` | ${event.city}` : ''}
        </p>

        {/* Null is NOT zero. `from_price` stays null until ticketing has costed
            the event, and "₹0 onwards" on a show nobody has priced is a
            promise the checkout will break. The line is simply absent. */}
        {price ? (
          <p className="text-body-sm font-semibold text-foreground">
            {price === 'Free' ? 'Free' : `${price} onwards`}
          </p>
        ) : null}
      </div>
    </article>
  );
}
