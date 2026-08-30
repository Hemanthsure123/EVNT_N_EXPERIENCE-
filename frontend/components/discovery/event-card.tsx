import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Building2, CalendarDays, MapPin } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { availabilityBadge } from '@/lib/discovery/availability';
import { categoryBySlug, inferCategory } from '@/lib/discovery/categories';
import { formatEventDateTime, formatFromPrice, machineDate } from '@/lib/discovery/format';
import { EventPosterArt } from '@/components/illustrations/poster';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';
import { AvailabilityBadge } from './availability-badge';
import { categoryTint } from './category-tint';
import { FavouriteButton } from './favourite-button';

/**
 * The unit of discovery. A Server Component — it holds no state, so it renders
 * inside RSC rows with zero client JS, and still composes into the client-side
 * results grid. Only the save button is an island.
 *
 * ── PORTRAIT POSTER, CHROME BELOW IT ──────────────────────────────────────
 *
 * The card is a 3:4 photograph with the text underneath it, not a 3:2 photo
 * with badges composited on top. Two things follow from that, and both are the
 * point rather than a side effect:
 *
 * 1. **The photography is the colour.** A poster is what someone is actually
 *    scanning for, and it now runs full-bleed to the card's edges with nothing
 *    laid over it except the save control. The scrim that used to stop a pale
 *    poster swallowing the chips is gone, because there are no chips on the
 *    poster to protect.
 * 2. **Every fact is on a plain surface.** The date, the availability badge,
 *    the category and the price sit on `bg-surface` with real ink, so their
 *    contrast is a fixed, verifiable number instead of a hope about whatever
 *    image landed behind them. The date medallion went with them: it existed to
 *    make a row of cards comparable at a glance, and a fixed-position date LINE
 *    under a fixed-height poster does the same job without riding the artwork.
 *
 * ── BELOW `sm` IT IS A COMPACT ROW, AND THAT IS THE SAME CARD ─────────────
 *
 * The smallest breakpoint here is `sm: 640px`, so on a phone every grid falls
 * back to one column — and one column of a 3:4 poster plus its text block is
 * 358 + 477 + 254 = **731px**, taller than the 390×844 viewport it is being
 * read in. Literally one card per screen, on the page whose entire job is
 * letting somebody compare several.
 *
 * So under `sm` the same markup lays out as a ROW: the poster keeps its 3:4
 * crop but is pinned to 96px on the left, and the facts sit beside it. ~140px
 * a card, five on a screen. From `sm` up — where the grid is genuinely
 * multi-column and a poster is photography rather than a thumbnail — it is the
 * tall portrait card, unchanged.
 *
 * ONE component and ONE `<img>`, restructured with `flex-row sm:flex-col`,
 * rather than rendering a row and a card and hiding one. A hidden `next/image`
 * is still fetched, so the CSS-swap version would download two posters per
 * event on the slowest connection in the product. `sizes` carries the same
 * information to the browser (`96px` under 640, a column width above it), so a
 * phone now pulls a thumbnail-sized source instead of a full-width one.
 *
 * What the row drops, and why: the CATEGORY chip (the availability badge is
 * the one that changes a decision — "Sold out" — and the category is already
 * implied by the poster), the ORGANISER line, and the arrow medallion (there
 * is no hover on touch, so its fill-on-hover affordance never fires, and the
 * whole row is one tap target). Nothing that answers "when", "where", "how
 * much" or "can I still go" is dropped at any width.
 *
 * READING ORDER, and why it's this one: poster, then status, then title, then
 * date, then venue, then organiser, then price. Someone scanning a grid is
 * answering "is this for me?" (picture), "can I still go?" (badge), "when?",
 * "is it near me?" (venue), "do I trust this?" (organiser), "can I afford it?"
 * — in that order. Price is last because it's the final question before the
 * click, not the first.
 *
 * WHAT THIS CARD DELIBERATELY DOESN'T SHOW: an interested/attending count, a
 * rating, a "trending" or "verified" flag. None of them exist on the platform —
 * there is no interest tracking, no review system, and no verification flag on
 * the card payload. Every badge here is computed from a column the backend
 * actually maintains (`tickets_available`, `from_price`). See BACKLOG.md.
 *
 * THERE IS NO "VIEW" BUTTON any more. The whole card is already one stretched
 * link, so a second control inside it was a decorative promise of a second
 * destination — and as a violet gradient pill repeated twenty times down a
 * white page it was also the loudest thing in the grid. What remains is a
 * quiet arrow that fills to the near-black action colour on hover: the same
 * affordance, at the weight a repeated element deserves.
 *
 * Performance notes:
 * - The poster box has a fixed `aspect-portrait` and the image is `fill`, so the
 *   card's height is known before the image arrives: **zero CLS**, always.
 * - The reserved box paints a token surface (`bg-muted` under a soft gradient)
 *   that the photo replaces as it decodes — the blur-up effect without
 *   shipping a second encoded placeholder image per card.
 * - `sizes` is passed by the caller, because the right value depends on the
 *   layout the card is in (rail vs grid vs list) and a wrong `sizes` is the
 *   single most common way next/image over-downloads.
 */

export type EventCardProps = {
  event: EventCardData;
  /** Responsive `sizes` for the poster — REQUIRED to avoid over-fetching. */
  sizes: string;
  /** Set on the LCP candidate only (the first row of cards). */
  priority?: boolean;
  className?: string;
};

export function EventCard({ event, sizes, priority = false, className }: EventCardProps) {
  const badge = availabilityBadge(event);
  // The COLUMN first; inference only where it is still blank.
  //
  // Inference was the only option before `Event.category` existed, and it was
  // wrong in both directions: it matched a concert whose description mentioned
  // a comedian, and missed a stand-up night whose copy never said "comedy".
  // It stays as a fallback rather than being deleted, because a catalogue
  // predating the column is mostly blank and a keyword guess is better than no
  // chip at all — but a stored value always wins over a guess.
  const category = categoryBySlug(event.category) ?? inferCategory(event);
  const price = formatFromPrice(event.from_price);
  const CategoryIcon = category?.icon;
  const tint = categoryTint(category?.slug);

  return (
    <div className={cn('group/card relative h-full', className)}>
      <Card
        interactive
        className={cn(
          // The row on a phone, the portrait card from `sm` — see the note
          // above. `items-stretch` (the flex default) is what makes the 96px
          // poster fill the row's full height when the text runs longer than
          // the 3:4 box it reserves.
          'flex h-full flex-row overflow-hidden sm:flex-col',
          // `relative` so the save control's `sm:absolute` anchors HERE and
          // not to whichever ancestor happens to be positioned. Without it the
          // anchor silently changes on hover — a `translate` makes this card a
          // containing block — and the heart jogs by the border width every
          // time a pointer crosses it.
          'relative',
          'transition duration-base ease-spring',
          // A neutral lift, not the old violet halo — `shadow-glow` is a
          // deeper `shadow-lg` now, and a coloured glow would tint the white
          // page around every hovered card.
          'group-hover/card:-translate-y-1 group-hover/card:shadow-lg',
          'motion-reduce:transform-none motion-reduce:transition-none',
        )}
      >
        {/* 3:4 at every width. Only the WIDTH changes — a second crop would
            mean two different pictures of the same event depending on the
            phone, and `aspect-portrait` here is also the floor that stops a
            short card collapsing to the height of three lines of text. */}
        <div className="relative aspect-portrait w-24 shrink-0 overflow-hidden rounded-xl bg-muted m-2 sm:m-0 sm:aspect-[4/3] sm:w-full sm:rounded-none">
          <div className="absolute inset-0 bg-gradient-to-br from-muted to-border" aria-hidden />
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
                'group-hover/card:scale-[1.06]',
                'motion-reduce:transition-none motion-reduce:group-hover/card:scale-100',
              )}
            />
          ) : (
            <EventPosterArt slug={category?.slug ?? ''} seed={event.id} className={tint.surface} />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:gap-1.5 sm:p-3.5 lg:p-4">
          {badge || category ? (
            <div className={cn('flex flex-wrap items-center gap-1.5', !badge && 'hidden sm:flex')}>
              {badge ? <AvailabilityBadge badge={badge} /> : null}
              {category ? (
                <span
                  className={cn(
                    'hidden items-center gap-1 rounded-full px-2 py-0.5 text-caption sm:inline-flex',
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

          <h3 className="line-clamp-2 pr-7 text-body-sm font-bold leading-snug text-foreground sm:pr-0 sm:text-body">
            <Link
              href={eventPath(event)}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
            >
              {event.title}
            </Link>
          </h3>

          <p className="flex items-center gap-1.5 text-caption font-medium text-primary sm:font-normal sm:text-muted-foreground">
            <CalendarDays className="hidden size-3.5 shrink-0 sm:block" aria-hidden />
            <time dateTime={machineDate(event.starts_at)} className="truncate">
              {formatEventDateTime(event.starts_at)}
            </time>
          </p>

          <p className="flex items-center gap-1.5 text-caption text-muted-foreground sm:text-body-sm">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {event.venue}, {event.city}
            </span>
          </p>

          <p className="hidden items-center gap-1.5 text-caption text-foreground-subtle sm:flex">
            <Building2 className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{event.organization_name}</span>
          </p>

          <div className="mt-auto flex items-end justify-between gap-3 pt-1 sm:border-t sm:border-border sm:pt-4">
            <Price price={price} />

            {/* The favourite button anchors to the top right of the card on mobile & desktop */}
            <FavouriteButton
              eventId={event.id}
              title={event.title}
              className={cn(
                'absolute right-2.5 top-2.5 z-10 size-11 shrink-0 sm:right-3 sm:top-3 sm:size-9',
                'lg:opacity-0 lg:transition-opacity lg:duration-fast',
                'lg:focus-visible:opacity-100 lg:group-focus-within/card:opacity-100 lg:group-hover/card:opacity-100',
                'lg:motion-reduce:opacity-100',
              )}
            />

            {/*
              The quiet way in. It is `aria-hidden` because the stretched link
              above already names the destination, and announcing a second
              target on one card is noise. It occupies its space at every
              width from `sm`, so card heights stay equal, and it fills to the
              primary action colour only while the card is hovered or focused —
              twenty always-black pills in a grid would each claim to be the
              page's one primary action. It is absent on the compact row: there
              is no hover on touch, so it could only ever be a decoration
              beside the price.
            */}
            <span
              className={cn(
                'hidden size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground sm:inline-flex',
                'transition duration-base ease-spring',
                'group-hover/card:border-cta group-hover/card:bg-cta group-hover/card:text-cta-foreground',
                'group-focus-within/card:border-cta group-focus-within/card:bg-cta group-focus-within/card:text-cta-foreground',
                'motion-reduce:transition-none',
              )}
              aria-hidden
            >
              <ArrowRight className="size-4" aria-hidden />
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Price({ price }: { price: string | null }) {
  if (price === 'Free') {
    // "from Free" is nonsense — a free event has one price, not a floor.
    // `success-subtle-foreground`, NOT `success`: the solid success token is a
    // FILL colour and fails AA as text on a surface — axe caught it.
    return <p className="text-body font-semibold text-success-subtle-foreground">Free</p>;
  }
  if (price) {
    return (
      <p className="text-body-sm text-muted-foreground">
        from <span className="text-body font-semibold tabular-nums text-foreground">{price}</span>
      </p>
    );
  }
  // `from_price` is null until ticketing writes the denormal — that's "not
  // priced yet", which is not the same as free.
  return <p className="text-body-sm text-muted-foreground">Pricing soon</p>;
}

/**
 * Content-shaped skeleton — same box, same rhythm, so nothing shifts when the
 * real card lands. It mirrors the card at BOTH shapes: the compact row below
 * `sm` (96px poster on the left, four short bars beside it) and the portrait
 * card above it. `skeletons.tsx`'s `ResultCardSkeleton` is the same geometry
 * and has to move with this one — a mismatched skeleton measured 0.27 CLS
 * once, and a skeleton that is only right at one breakpoint is that bug with a
 * media query in front of it.
 */
export function EventCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-full flex-row overflow-hidden rounded-xl border border-border bg-surface shadow-md sm:flex-col',
        className,
      )}
      aria-hidden
    >
      <div className="skeleton aspect-portrait w-24 shrink-0 sm:w-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:gap-2 sm:p-card lg:p-card-lg">
        <div className="skeleton hidden h-5 w-24 rounded-full sm:block" />
        <div className="skeleton h-5 w-11/12 rounded-md" />
        <div className="skeleton h-5 w-2/3 rounded-md" />
        <div className="skeleton mt-1 h-4 w-3/5 rounded-md" />
        <div className="skeleton h-4 w-4/5 rounded-md" />
        <div className="skeleton hidden h-3 w-2/5 rounded-md sm:block" />
        <div className="mt-auto flex items-center justify-between gap-3 pt-1 sm:border-t sm:border-border sm:pt-4">
          <div className="skeleton h-6 w-20 rounded-md" />
          <div className="skeleton size-11 rounded-full sm:size-9" />
        </div>
      </div>
    </div>
  );
}
