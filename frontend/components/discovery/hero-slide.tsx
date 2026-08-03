import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CalendarDays, Flame, MapPin } from 'lucide-react';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { inferCategory } from '@/lib/discovery/categories';
import { demandSignal } from '@/lib/discovery/demand';
import {
  formatEventDate,
  formatEventTime,
  formatFromPrice,
  machineDate,
} from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { FavouriteButton } from './favourite-button';
import { ShareButton } from './share-button';

/**
 * The featured banner — the page's visual focal point, closer to a streaming
 * service's hero than to an event card.
 *
 * ONE unified image with everything composited on top of it; no split blocks,
 * no inner card.
 *
 * ── ONE SCRIM, NOT FOUR LAYERS ────────────────────────────────────────────
 *
 * Legibility over an arbitrary organizer poster used to come from a stack:
 * brightness pulled down, a vertical scrim, a violet→pink ambient wash, a
 * vignette and a grain. Only the scrim was doing the work. The wash was the
 * brand asserting itself over somebody's photograph — exactly what an
 * image-forward product must not do — and the vignette and grain were paying a
 * paint cost to make the photo worse. What remains is a single bottom-anchored
 * ramp, deep enough that white text clears AA over any poster.
 *
 * Text is `on-gradient`, which stays light in both themes because what's
 * beneath it is a photograph, not the page. This banner is one of the very few
 * places that token is still correct — on a filled BUTTON it is a bug, because
 * the primary action inverts to a near-white pill in dark theme.
 *
 * THE ACTION IS THE BLACK PILL (`--cta`), like every other primary action in
 * the product: near-black on white in light, near-white on dark in dark, fully
 * rounded, generous horizontal padding. It reads as the one thing to press
 * even sitting on a photograph, which a violet gradient competing with the
 * artwork behind it did not.
 *
 * Reading order is deliberate — category, urgency, title, why, where, when,
 * price, action — with real spacing between groups so it scans rather than
 * reads as a block.
 *
 * A Server Component apart from the two secondary actions, which are their own
 * client islands: saving and sharing shouldn't hydrate the banner.
 *
 * Content NOT shown, because the backend has no such data: an interested count,
 * attendee avatars, and a verified-organizer badge. Inventing social proof on a
 * page that asks for money is the one thing a ticketing product must not do.
 */

const HERO_SIZES = '(min-width: 1024px) 720px, 100vw';

export function HeroSlide({
  event,
  description,
  priority = false,
}: {
  event: EventCardData;
  /** One sentence on why to attend — from the event's own detail payload. */
  description?: string;
  priority?: boolean;
}) {
  const category = inferCategory(event);
  const price = formatFromPrice(event.from_price);
  const demand = demandSignal(event);
  const CategoryIcon = category?.icon;

  return (
    <li className="group/slide w-full shrink-0">
      <div className="relative aspect-poster w-full overflow-hidden bg-muted sm:aspect-feature">
        {event.poster_url ? (
          <Image
            src={event.poster_url}
            alt=""
            fill
            sizes={HERO_SIZES}
            priority={priority}
            className={cn(
              'object-cover',
              'transition-transform duration-slow ease-spring group-hover/slide:scale-[1.03]',
              'motion-reduce:transition-none motion-reduce:group-hover/slide:scale-100',
            )}
          />
        ) : (
          // The ONE place a brand gradient is still right: it is standing in
          // for a photograph that does not exist, and white text is composited
          // straight onto it. A pastel here (what a poster-less CARD gets)
          // would make every label on this banner unreadable.
          <div
            className={cn(
              'absolute inset-0 bg-gradient-to-br',
              category?.tone ?? 'from-violet-600 to-violet-900',
            )}
            aria-hidden
          />
        )}

        {/* The single legibility scrim. Bottom-anchored, three stops, and
            deeper at the base than the old four-layer stack was in total —
            everything on this banner sits in its lower half. */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-overlay via-overlay/60 to-overlay/10"
          aria-hidden
        />

        {/* Secondary actions — outside the main link, so neither reads as
            navigation. */}
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
          <ShareButton title={event.title} path={`/events/${event.id}`} />
          <FavouriteButton eventId={event.id} title={event.title} />
        </div>

        <Link
          href={`/events/${event.id}`}
          className={cn(
            'absolute inset-0 flex flex-col justify-end gap-6 p-6 sm:p-8',
            'transition-[opacity] duration-carousel ease-spring',
            // Content fades and rises as the slide settles; the CTA lands last.
            'group-data-[active=false]/slide:opacity-0',
            'motion-reduce:transition-none motion-reduce:group-data-[active=false]/slide:opacity-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          )}
        >
          <div
            className={cn(
              'flex flex-col gap-4',
              'transition-transform duration-carousel ease-spring',
              'group-data-[active=false]/slide:translate-y-3',
              'motion-reduce:transition-none motion-reduce:group-data-[active=false]/slide:translate-y-0',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {category ? (
                <span className="glass-media inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption text-on-gradient">
                  {CategoryIcon ? <CategoryIcon className="size-3.5" aria-hidden /> : null}
                  {category.label}
                </span>
              ) : null}

              {/* Urgency, and ONLY when the remaining-ticket count is real. */}
              {demand ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning px-3 py-1 text-caption text-warning-foreground">
                  <Flame className="size-3.5" aria-hidden />
                  {demand.seatsLeft === 1
                    ? 'Last ticket left'
                    : `Only ${demand.seatsLeft} seats left`}
                </span>
              ) : null}
            </div>

            <h3 className="max-w-2xl text-balance text-h2 text-on-gradient md:text-display">
              {event.title}
            </h3>

            {description ? (
              <p className="line-clamp-2 max-w-xl text-body text-on-gradient/80">{description}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-sm text-on-gradient/75">
              <span className="inline-flex items-center gap-2">
                <MapPin className="size-4 shrink-0" aria-hidden />
                <span className="truncate">
                  {event.venue}, {event.city}
                </span>
              </span>
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="size-4 shrink-0" aria-hidden />
                <time dateTime={machineDate(event.starts_at)}>
                  {formatEventDate(event.starts_at)} · {formatEventTime(event.starts_at)}
                </time>
              </span>
            </div>
          </div>

          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-4',
              'transition-opacity duration-carousel ease-spring',
              // The action settles last.
              'delay-100 group-data-[active=false]/slide:opacity-0 group-data-[active=false]/slide:delay-0',
              'motion-reduce:transition-none motion-reduce:group-data-[active=false]/slide:opacity-100',
            )}
          >
            {price ? (
              <p className="flex flex-col">
                <span className="text-caption uppercase tracking-wide text-on-gradient/60">
                  {price === 'Free' ? 'Entry' : 'From'}
                </span>
                <span className="text-h3 font-semibold tabular-nums text-on-gradient">
                  {price === 'Free' ? 'Free' : price}
                </span>
              </p>
            ) : (
              <span />
            )}

            <span
              className={cn(
                // `cta-foreground`, NOT `on-gradient`: this is a filled button,
                // and in dark theme the pill is near-WHITE — white-on-white.
                'inline-flex h-control-lg items-center gap-2 rounded-full bg-cta px-pill-lg text-label text-cta-foreground shadow-lg',
                'transition duration-fast ease-spring group-hover/slide:-translate-y-0.5 group-hover/slide:bg-cta-hover group-hover/slide:shadow-xl',
                'motion-reduce:group-hover/slide:translate-y-0',
              )}
            >
              View event
              <ArrowRight
                className="size-4 transition-transform duration-fast ease-out group-hover/slide:translate-x-1 motion-reduce:group-hover/slide:translate-x-0"
                aria-hidden
              />
            </span>
          </div>
        </Link>
      </div>
    </li>
  );
}
