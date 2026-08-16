import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Building2, CalendarDays, MapPin } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { availabilityBadge } from '@/lib/discovery/availability';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDateTime, formatFromPrice, machineDate } from '@/lib/discovery/format';
import { ClayIcon } from '@/components/illustrations/clay';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';
import { AvailabilityBadge } from './availability-badge';
import { categoryTint } from './category-tint';
import { FavouriteButton } from './favourite-button';

/**
 * The same event, laid out for COMPARISON rather than for browsing.
 *
 * A grid is the better shape for "show me what's on" — posters carry the mood,
 * and three across fills the eye. It is the worse shape for "which of these
 * five should I book", because every fact sits at a different height depending
 * on how long the title above it was. This row fixes the columns: date at one
 * x, venue at another, price always at the right edge. Scanning down a column
 * of prices is a different, faster act than hunting for a price on each card.
 *
 * Same data, same badges, same honesty rules as the card — this is a layout
 * choice, not a different feature.
 *
 * The THUMBNAIL stays 3:2. The grid card went portrait because its poster is
 * the whole top of the card and is the thing being scanned; here the image is a
 * 96–224px thumbnail at the left of a fixed-height row, and a portrait crop at
 * that size would make every row half as tall again for no extra information.
 * `aspect-card` is the landscape-thumbnail ratio, which is exactly its job now.
 *
 * The action is the near-black pill (`--cta`), labelled with the token that
 * FLIPS per theme — the old gradient pill was labelled `on-gradient`, which is
 * white in both, and the dark theme's pill is near-white.
 *
 * ── ON A PHONE THIS ROW WAS 242px, WHICH IS THREE TO A SCREEN ─────────────
 *
 * `p-card` twice over, a 128px thumbnail, five stacked facts and a bordered
 * price block that could not sit beside them. It is ~160px now: a 96px
 * thumbnail, `p-3`, the organiser and category dropped (the same two the
 * compact card drops, for the same reason), and no rule above the price row —
 * a hairline separating two things that are 8px apart is decoration.
 *
 * The one thing it keeps that the compact card drops is SAVE, at 44px beside
 * the price — list view exists for deciding between several, and shortlisting
 * without opening anything is the whole point of it. The View pill goes: it is
 * `aria-hidden` decoration on a row that is already one stretched link, and
 * three of price + heart + pill measure 256px in a 238px row.
 */

export const ROW_SIZES = '(min-width: 1024px) 224px, (min-width: 640px) 200px, 96px';

export function EventRow({
  event,
  priority = false,
  className,
}: {
  event: EventCardData;
  priority?: boolean;
  className?: string;
}) {
  const badge = availabilityBadge(event);
  const category = inferCategory(event);
  const price = formatFromPrice(event.from_price);
  const CategoryIcon = category?.icon;
  const tint = categoryTint(category?.slug);

  return (
    <div className={cn('group/row relative', className)}>
      <Card
        interactive
        className={cn(
          'flex flex-row items-stretch overflow-hidden',
          'transition duration-base ease-spring group-hover/row:shadow-lg',
          'motion-reduce:transition-none',
        )}
      >
        <div className="relative aspect-card w-24 shrink-0 overflow-hidden bg-muted sm:w-48 lg:w-56">
          <div className="absolute inset-0 bg-gradient-to-br from-muted to-border" aria-hidden />
          {event.poster_url ? (
            <Image
              src={event.poster_url}
              alt=""
              fill
              sizes={ROW_SIZES}
              priority={priority}
              loading={priority ? undefined : 'lazy'}
              className={cn(
                'object-cover transition-transform duration-slow ease-out',
                'group-hover/row:scale-[1.06]',
                'motion-reduce:transition-none motion-reduce:group-hover/row:scale-100',
              )}
            />
          ) : (
            // The category's pastel plate with its clay object on it, exactly
            // as the grid card does — one look for "this event has no poster",
            // not two.
            <div
              className={cn('absolute inset-0 flex items-center justify-center', tint.surface)}
              aria-hidden
            >
              <ClayIcon slug={category?.slug ?? ''} className="size-10 sm:size-12" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-6 sm:p-card-lg">
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:gap-1.5">
            {/* Same rule as the compact card: when only the category chip
                would be left it is the whole row that goes, not an empty one
                that still pays for its gap. */}
            <div className={cn('flex flex-wrap items-center gap-2', !badge && 'hidden sm:flex')}>
              {badge ? <AvailabilityBadge badge={badge} /> : null}
              {category ? (
                <span
                  className={cn(
                    'hidden items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption sm:inline-flex',
                    tint.surface,
                    tint.ink,
                  )}
                >
                  {CategoryIcon ? <CategoryIcon className="size-3" aria-hidden /> : null}
                  {category.label}
                </span>
              ) : null}
            </div>

            <h3 className="line-clamp-2 text-body font-semibold leading-tight text-foreground sm:text-body-lg">
              <Link
                href={eventPath(event)}
                className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
              >
                {event.title}
              </Link>
            </h3>

            <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
              <CalendarDays className="size-4 shrink-0" aria-hidden />
              <time dateTime={machineDate(event.starts_at)} className="truncate">
                {formatEventDateTime(event.starts_at)}
              </time>
            </p>
            <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0" aria-hidden />
              <span className="truncate">
                {event.venue}, {event.city}
              </span>
            </p>
            <p className="hidden items-center gap-1.5 text-caption text-foreground-subtle sm:flex">
              <Building2 className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{event.organization_name}</span>
            </p>
          </div>

          {/* The comparison column: fixed width, right-aligned, so price and
              action line up down the page regardless of title length. The rule
              above it is a `sm`-and-up affordance — on the compact row the two
              blocks are 8px apart and a hairline between them reads as a seam
              in the card rather than as a division of it. */}
          <div className="flex shrink-0 items-center justify-between gap-3 sm:w-40 sm:flex-col sm:items-end sm:justify-center sm:border-l sm:border-border sm:pl-6">
            {price === 'Free' ? (
              <p className="text-body font-semibold text-success-subtle-foreground">Free</p>
            ) : price ? (
              <p className="text-body-sm text-muted-foreground sm:text-right">
                from{' '}
                <span className="text-body font-semibold tabular-nums text-foreground">
                  {price}
                </span>
              </p>
            ) : (
              <p className="text-body-sm text-muted-foreground">Pricing soon</p>
            )}

            <div className="flex items-center gap-2">
              <FavouriteButton
                eventId={event.id}
                title={event.title}
                className="relative z-10 size-11 border-border bg-surface text-muted-foreground hover:text-foreground sm:size-9"
              />
              {/* Absent below `sm`, and it has to be: at 238px of row the
                  price, a 44px heart and a 112px pill do not fit, and this is
                  the one of the three that is pure decoration — it is
                  `aria-hidden`, and the whole row is already one stretched
                  link to the same place. */}
              <span
                className="hidden h-control-sm items-center gap-1.5 rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition duration-base group-hover/row:bg-cta-hover motion-reduce:transition-none sm:inline-flex"
                aria-hidden
              >
                View
                <ArrowRight className="size-3.5" aria-hidden />
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function EventRowSkeleton() {
  return (
    <div
      className="flex overflow-hidden rounded-xl border border-border bg-surface shadow-md"
      aria-hidden
    >
      <div className="skeleton aspect-card w-24 shrink-0 sm:w-48 lg:w-56" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-6 sm:p-card-lg">
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:gap-2">
          <div className="skeleton hidden h-5 w-24 rounded-full sm:block" />
          <div className="skeleton h-5 w-3/4 rounded-md" />
          <div className="skeleton h-4 w-2/5 rounded-md" />
          <div className="skeleton h-4 w-1/2 rounded-md" />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 sm:w-40 sm:flex-col sm:items-end">
          <div className="skeleton h-6 w-20 rounded-md" />
          <div className="skeleton h-11 w-24 rounded-full sm:h-9" />
        </div>
      </div>
    </div>
  );
}
