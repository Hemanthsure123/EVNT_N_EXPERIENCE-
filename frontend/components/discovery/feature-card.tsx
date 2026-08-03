import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { availabilityBadge } from '@/lib/discovery/availability';
import { inferCategory } from '@/lib/discovery/categories';
import {
  formatEventDate,
  formatEventTime,
  formatFromPrice,
  machineDate,
} from '@/lib/discovery/format';
import { ClayIcon } from '@/components/illustrations/clay';
import { cn } from '@/lib/utils/cn';
import { AvailabilityBadge } from './availability-badge';
import { categoryTint } from './category-tint';
import { FavouriteButton } from './favourite-button';

/**
 * The LARGE horizontal card used by the page's primary content row.
 *
 * Wider and image-led on purpose: this row is where someone actually chooses,
 * so each card gets room for the four facts that decide it — what, when, where,
 * how much — instead of the compressed grid treatment. Everything shown is read
 * straight off the event: there is no rating and no "interested" count because
 * the backend has neither, and inventing them on a ticketing product would be
 * making up social proof.
 *
 * It stays LANDSCAPE while the grid card went portrait: this is a rail card at
 * 78vw / 20rem / 26rem, and a 3:4 crop at 26rem wide would be 35rem tall — one
 * card would be most of a laptop screen. The ratio follows the slot, not a rule.
 *
 * THE CHROME IS OFF THE PHOTOGRAPH, as it is on the grid card: the category and
 * the availability badge are in the text block on a plain surface, where their
 * contrast is a fixed number rather than a hope about the image. Only the save
 * control still sits on the poster.
 *
 * ── IT IS NOT COMPACTED INTO A ROW, AND THAT IS ON PURPOSE ───────────────
 *
 * The grid card became a 96px-thumbnail row below `sm` because a column of
 * portrait cards is one per screen. This one lives in a PAGED RAIL: it is 78vw
 * wide, it scrolls sideways, and exactly one of it is meant to be on screen at
 * a time. There is nothing to compare it against vertically, so turning it
 * into a row would remove the photograph without buying back any scroll.
 *
 * What it does get is the same tightening every other surface got — `p-card`
 * with 8px stacks and one rung off the title and the price below `sm` — which
 * takes ~40px off the ~447px card. That is the difference between the rail's
 * controls sitting on the fold and sitting under it.
 *
 * A Server Component apart from the save button, which is its own client island.
 */

const CARD_SIZES = '(min-width: 768px) 480px, 85vw';

export function FeatureCard({
  event,
  priority = false,
}: {
  event: EventCardData;
  priority?: boolean;
}) {
  const badge = availabilityBadge(event);
  const category = inferCategory(event);
  const price = formatFromPrice(event.from_price);
  const CategoryIcon = category?.icon;
  const tint = categoryTint(category?.slug);
  const soldOut = event.tickets_available === 0;

  return (
    <div className="group/card relative h-full">
      <Link
        href={`/events/${event.id}`}
        className={cn(
          // `border-border` is load-bearing on a white canvas: `bg-surface` IS
          // the page colour in light theme, so the hairline plus the shadow is
          // the only thing that makes the card an object.
          'flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-md',
          'transition duration-base ease-spring hover:-translate-y-1 hover:shadow-lg',
          'motion-reduce:hover:translate-y-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <div className="relative aspect-card w-full shrink-0 overflow-hidden bg-muted">
          <div className="absolute inset-0 bg-gradient-to-br from-muted to-border" aria-hidden />
          {event.poster_url ? (
            <Image
              src={event.poster_url}
              alt=""
              fill
              sizes={CARD_SIZES}
              priority={priority}
              className={cn(
                'object-cover',
                'transition-transform duration-slow ease-spring group-hover/card:scale-[1.03]',
                'motion-reduce:transition-none motion-reduce:group-hover/card:scale-100',
              )}
            />
          ) : (
            <div
              className={cn('absolute inset-0 flex items-center justify-center', tint.surface)}
              aria-hidden
            >
              <ClayIcon slug={category?.slug ?? ''} className="size-20" />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-card sm:gap-3 lg:p-card-lg">
          {badge || category ? (
            <div className="flex flex-wrap items-center gap-2">
              {badge ? <AvailabilityBadge badge={badge} /> : null}
              {category ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption',
                    tint.surface,
                    tint.ink,
                  )}
                >
                  {CategoryIcon ? <CategoryIcon className="size-3" aria-hidden /> : null}
                  {category.label}
                </span>
              ) : null}
            </div>
          ) : null}

          <h3 className="line-clamp-2 text-body-lg font-semibold leading-tight text-foreground sm:text-h4 sm:font-semibold">
            {event.title}
          </h3>

          <div className="flex flex-col gap-1 text-body-sm text-muted-foreground sm:gap-1.5">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-4 shrink-0" aria-hidden />
              <time dateTime={machineDate(event.starts_at)}>
                {formatEventDate(event.starts_at)} · {formatEventTime(event.starts_at)}
              </time>
            </span>
            <span className="inline-flex items-center gap-2">
              <MapPin className="size-4 shrink-0" aria-hidden />
              <span className="truncate">
                {event.venue}, {event.city}
              </span>
            </span>
          </div>

          <div className="mt-auto flex items-end justify-between gap-4 pt-1 sm:pt-2">
            <div className="flex flex-col gap-0.5">
              {price === 'Free' ? (
                <p className="text-body-lg font-semibold text-success-subtle-foreground sm:text-h4">
                  Free
                </p>
              ) : price ? (
                <p className="text-body-lg font-semibold tabular-nums text-foreground sm:text-h4">
                  {price}
                  <span className="ml-1 text-body-sm font-normal text-muted-foreground">
                    onwards
                  </span>
                </p>
              ) : (
                <p className="text-body-sm text-muted-foreground">Pricing soon</p>
              )}
              <p className="truncate text-caption text-foreground-subtle">
                {event.organization_name}
              </p>
            </div>

            <span
              className={cn(
                // A fully-rounded pill that fills to the near-black action
                // colour on hover. It rests as the quiet neutral so a rail of
                // three cards does not show three primary actions at once.
                'inline-flex h-control-sm shrink-0 items-center gap-2 rounded-full px-pill text-label',
                'transition duration-fast ease-out',
                soldOut
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-secondary text-secondary-foreground group-hover/card:bg-cta group-hover/card:text-cta-foreground',
              )}
            >
              {soldOut ? 'Sold out' : 'View event'}
              {soldOut ? null : (
                <ArrowRight
                  className="size-4 transition-transform duration-fast ease-out group-hover/card:translate-x-1 motion-reduce:group-hover/card:translate-x-0"
                  aria-hidden
                />
              )}
            </span>
          </div>
        </div>
      </Link>

      {/* Outside the link so the toggle can't be mistaken for navigation.
          44px on touch — this is a real control on a poster, and the rest of
          the card getting tighter is not a reason for it to get smaller. */}
      <FavouriteButton
        eventId={event.id}
        title={event.title}
        className="absolute right-3 top-3 size-11 sm:right-4 sm:top-4 sm:size-9"
      />
    </div>
  );
}

export function FeatureCardSkeleton() {
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-md"
      aria-hidden
    >
      <div className="skeleton aspect-card w-full" />
      <div className="flex flex-1 flex-col gap-2 p-card sm:gap-3 lg:p-card-lg">
        <div className="skeleton h-5 w-24 rounded-full" />
        <div className="skeleton h-6 w-4/5 rounded-md" />
        <div className="skeleton h-4 w-3/5 rounded-md" />
        <div className="skeleton h-4 w-2/3 rounded-md" />
        <div className="mt-auto flex items-end justify-between gap-4 pt-1 sm:pt-2">
          <div className="skeleton h-7 w-24 rounded-md" />
          <div className="skeleton h-9 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}
