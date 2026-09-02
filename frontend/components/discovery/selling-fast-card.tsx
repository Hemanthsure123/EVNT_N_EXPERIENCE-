'use client';

import * as React from 'react';
import Image from 'next/image';
import { CalendarDays, Flame, MapPin } from 'lucide-react';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { inferCategory } from '@/lib/discovery/categories';
import { demandSignal } from '@/lib/discovery/demand';
import { formatEventDate, formatFromPrice, machineDate } from '@/lib/discovery/format';
import { ClayIcon } from '@/components/illustrations/clay';
import Link from 'next/link';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';
import { categoryTint } from './category-tint';
import { Countdown } from './countdown';

/**
 * A genuinely scarce event.
 *
 * Every urgency claim on this card is a real number: `seats left` is the
 * remaining-ticket count the `ticketing` module maintains, and the countdown is
 * arithmetic on the event's own start time. There is no booked-percentage bar
 * (capacity isn't in the payload, so it could only be guessed) and no fake
 * "N people viewing".
 *
 * Cards only reach this component after `sellingFast()` has confirmed the
 * signal, so it renders nothing on its own judgement.
 */

import { useEventDeck } from '@/lib/discovery/event-deck-context';

const CARD_SIZES = '(min-width: 768px) 320px, 70vw';

export function SellingFastCard({
  event,
  allEvents,
  index = 0,
}: {
  event: EventCardData;
  /**
   * The list this card belongs to, so the widget opens as a deck you can swipe
   * rather than a single dead-end card — and so "More from {organiser}" has
   * something to work from. Absent falls back to `[event]`, which is correct
   * for a card that genuinely has no siblings.
   */
  allEvents?: EventCardData[];
  index?: number;
}) {
  const { openDeck } = useEventDeck();
  const signal = demandSignal(event);
  if (!signal) return null;

  const category = inferCategory(event);
  const price = formatFromPrice(event.from_price);
  const tint = categoryTint(category?.slug);

  return (
    <div
      className={cn(
        // `relative`, so the title's stretched link covers the card.
        'group/urgent relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-md',
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
            className={cn(
              'object-cover',
              'transition-transform duration-slow ease-spring group-hover/urgent:scale-[1.03]',
              'motion-reduce:transition-none motion-reduce:group-hover/urgent:scale-100',
            )}
          />
        ) : (
          <div
            className={cn('absolute inset-0 flex items-center justify-center', tint.surface)}
            aria-hidden
          >
            <ClayIcon slug={category?.slug ?? ''} className="size-16" />
          </div>
        )}

        {/* URGENCY IS SEMANTIC, NOT DECORATIVE. This was a solid pink fill from
            `--accent` — a brand hue standing in for "hurry". It is the warning
            tint now, which is the token that MEANS this, is opaque so it reads
            on any poster, and clears AA at 7.70:1 in both themes. */}
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-warning-subtle px-3 py-1 text-caption font-semibold text-warning-subtle-foreground shadow-sm">
          <Flame className="size-3.5" aria-hidden />
          Selling fast
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-card lg:p-card-lg">
        {/* ── A REAL LINK, NOT A DIV WITH AN onClick ──────────────────────
            The card root was `<div onClick>`: unfocusable, announced as
            nothing by a screen reader, impossible to open in a new tab or
            long-press, invisible to a crawler, and unreachable by keyboard —
            on the shelf that exists to move the events closest to selling out.
            It also carried `focus-visible:ring` classes that could never fire,
            because a div is never focused.

            Same split as every other card here: a stretched LINK from `sm` up,
            and the mobile widget below it. */}
        <h3 className="line-clamp-2 text-body-lg font-semibold leading-tight text-foreground">
          <Link
            href={eventPath(event)}
            className="hidden after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background sm:inline"
          >
            {event.title}
          </Link>
          <button
            type="button"
            onClick={() => openDeck(allEvents && allEvents.length > 0 ? allEvents : [event], index)}
            className="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none sm:hidden"
          >
            {event.title}
          </button>
        </h3>

        <p className="inline-flex items-center gap-2 text-body-sm text-muted-foreground">
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          <time dateTime={machineDate(event.starts_at)}>{formatEventDate(event.starts_at)}</time>
        </p>
        <p className="inline-flex items-center gap-2 text-body-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            {event.venue}, {event.city}
          </span>
        </p>

        <div className="mt-auto flex flex-col gap-2 pt-3">
          {/* Real remaining-ticket count, straight from the event row. */}
          <p className="inline-flex items-center gap-2 text-label text-warning-subtle-foreground">
            <span className="inline-block size-2 rounded-full bg-warning" aria-hidden />
            {signal.seatsLeft === 1 ? 'Last ticket left' : `Only ${signal.seatsLeft} left`}
          </p>

          {signal.startsSoon ? (
            <Countdown startsAt={event.starts_at} className="text-caption text-muted-foreground" />
          ) : null}

          {price ? (
            <p className="text-body font-semibold tabular-nums text-foreground">
              {price === 'Free' ? 'Free' : `${price} onwards`}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
