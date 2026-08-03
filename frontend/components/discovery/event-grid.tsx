import * as React from 'react';
import type { EventCard as EventCardData } from '@/lib/api/types';
import type { ViewMode } from '@/lib/discovery/use-view-mode';
import { cn } from '@/lib/utils/cn';
import { EventCard, EventCardSkeleton } from './event-card';
import { EventRow, EventRowSkeleton } from './event-row';
import { Reveal } from './reveal';

/**
 * The results region, in either layout.
 *
 * THREE COLUMNS, not four. Four across at 1280px leaves each card ~296px wide,
 * which is below the width at which a title, a venue line and a price can sit
 * without truncating — so the fourth column was bought with an ellipsis on
 * every card. Three gives ~400px, and the poster becomes photography rather
 * than a thumbnail.
 *
 * Gutters are 24px, rising to 32px at `lg` — the 8pt grid, and the brief's
 * range. Wide gutters do real work here: they're what stops a dense grid of
 * bright posters from reading as one continuous wall. Below `sm` they drop to
 * 12px: the cards are compact rows there (see `event-card.tsx`), and a 24px
 * trough between two 140px rows reads as a gap in the list rather than as air.
 *
 * `sizes` is stated once for the whole grid and matches the column count at
 * each breakpoint, so a phone never downloads a desktop poster. Under 640px
 * that is now a **96px thumbnail**, not a 92vw poster — the single biggest
 * byte saving in this slice, and it only became true once the card stopped
 * rendering a full-width image on a phone.
 *
 * `promo` is an optional extra CELL, not a band across the layout. Anything
 * inserted that way — a subscribe prompt, later an ad slot — reflows with the
 * grid, so when it renders nothing there is no gap left behind. It is placed at
 * `PROMO_INDEX`, the start of the third row.
 *
 * CONTRACT: `promo` must render its own `<li>`, or null. Wrapping it in an
 * `<li>` here would leave an EMPTY GRID CELL behind on every render where the
 * promo decided not to show itself — a hole this component cannot see and
 * therefore cannot close. That bug shipped once and was caught by counting
 * cells: 21 for 20 events.
 */
export const GRID_SIZES =
  '(min-width: 1280px) 400px, (min-width: 1024px) 31vw, (min-width: 640px) 46vw, 96px';

/** Reveal is a one-shot fade+rise; staggering by position reads as one motion
 * rather than ten. Capped, or the last card of page 5 would wait a second. */
const STAGGER_MS = 45;
const STAGGER_STEPS = 4;
/** Start of row three at 3-up — below the fold at every supported width. */
const PROMO_INDEX = 6;

export function EventGrid({
  events,
  priorityCount = 0,
  view = 'grid',
  promo,
  className,
}: {
  events: EventCardData[];
  /** How many leading posters to mark `priority` (the above-the-fold row). */
  priorityCount?: number;
  view?: ViewMode;
  /** An extra cell woven into the grid — renders nothing when it renders null. */
  promo?: React.ReactNode;
  className?: string;
}) {
  // Only ever inserted once there are enough real results around it for the
  // grid to still read as a grid.
  const showPromo = Boolean(promo) && events.length > PROMO_INDEX;

  if (view === 'list') {
    return (
      <ul className={cn('flex flex-col gap-3 sm:gap-4', className)}>
        {events.map((event, index) => (
          <li key={event.id} className={cn(index >= 6 && 'sm:cv-card')}>
            <EventRow event={event} priority={index < Math.min(priorityCount, 2)} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul
      className={cn(
        'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-8',
        className,
      )}
    >
      {events.map((event, index) => (
        <React.Fragment key={event.id}>
          {showPromo && index === PROMO_INDEX ? promo : null}
          {/* `cv-card` lets the browser skip layout/paint for rows scrolled out
              of view — see the note in styles/globals.css. The first screenful
              is exempt so nothing above the fold is ever deferred.
              `sm:` AND NOT BELOW IT, deliberately: the reserved placeholder is
              `--intrinsic-card` (28rem), which is the portrait card's height.
              A phone renders the ~9rem compact row, so applying it there would
              reserve three times each off-screen card's real height and add
              ~4,000px of phantom scroll to a 20-card page — the exact
              complaint this slice exists to fix, reintroduced by the
              optimisation meant to help it. Below `sm` the card is cheap
              enough (no full-width image to decode) that skipping the work
              buys little. */}
          <li className={cn('h-full', index >= 6 && 'sm:cv-card')}>
            {index < priorityCount ? (
              // Never reveal the LCP row: an element that starts at opacity 0
              // is not eligible to be the Largest Contentful Paint.
              <EventCard event={event} sizes={GRID_SIZES} priority />
            ) : (
              <Reveal className="h-full" delayMs={(index % STAGGER_STEPS) * STAGGER_MS}>
                <EventCard event={event} sizes={GRID_SIZES} />
              </Reveal>
            )}
          </li>
        </React.Fragment>
      ))}
    </ul>
  );
}

export function EventGridSkeleton({
  count = 6,
  view = 'grid',
}: {
  count?: number;
  view?: ViewMode;
}) {
  if (view === 'list') {
    return (
      <div className="flex flex-col gap-3 sm:gap-4" aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <EventRowSkeleton key={i} />
        ))}
      </div>
    );
  }
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-8"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <EventCardSkeleton key={i} />
      ))}
    </div>
  );
}
