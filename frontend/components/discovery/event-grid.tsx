import * as React from 'react';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { EventCard, EventCardSkeleton } from './event-card';
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
/**
 * Kept in step with the grid's column count above, or every card downloads a
 * poster sized for a layout it is not in. The narrower columns mean smaller
 * files, which is most of the reason the denser grid is not also heavier.
 *
 * `96px` at the smallest rung is unchanged: below `sm` the card is still a
 * compact row with a thumbnail, not a portrait tile.
 */
export const GRID_SIZES =
  '(min-width: 1536px) 19vw, (min-width: 1024px) 24vw, (min-width: 640px) 31vw, 96px';

/** Reveal is a one-shot fade+rise; staggering by position reads as one motion
 * rather than ten. Capped, or the last card of page 5 would wait a second. */
const STAGGER_MS = 45;
const STAGGER_STEPS = 4;
/** Start of row three at 3-up — below the fold at every supported width. */
const PROMO_INDEX = 6;

export function EventGrid({
  events,
  priorityCount = 0,
  promo,
  className,
}: {
  events: EventCardData[];
  /** How many leading posters to mark `priority` (the above-the-fold row). */
  priorityCount?: number;
  /** An extra cell woven into the grid — renders nothing when it renders null. */
  promo?: React.ReactNode;
  className?: string;
}) {
  // Only ever inserted once there are enough real results around it for the
  // grid to still read as a grid.
  const showPromo = Boolean(promo) && events.length > PROMO_INDEX;

  return (
    <ul
      className={cn(
        // ── DENSITY IS WHAT CONTROLS CARD HEIGHT ──────────────────────────
        // The card was reported as far too tall, and the poster's 3:4 crop was
        // not the cause — the COLUMN COUNT was. Three columns on a 1440px
        // screen give each card ~400px of width, and 3:4 of 400 is a 533px
        // poster before a word of text. BookMyShow and District fit five or six
        // across at that width, which is why their cards read as compact: the
        // ratio is similar, the card is simply narrower.
        //
        // So the grid gets denser instead of the picture getting a second crop
        // — one event, one shape, at every breakpoint — and a screenful now
        // shows twelve events instead of six.
        // Below `sm` the card is a COMPACT ROW (a 96px thumbnail beside the
        // facts — see event-card.tsx), so one column there is already five
        // events per screen. Two columns of that row would be unreadable. The
        // density change starts where the card becomes a portrait tile.
        // ── CARDS HAVE A WIDTH, NOT A COLUMN COUNT ─────────────────────────
        //
        // This was a fixed ladder (3 / 4 / 5 columns). A fixed count divides
        // whatever width is available, so a page with TWO results rendered two
        // cards ~440px wide — a 3:4 poster of that width is 590px of image
        // before a word of text, which is what "the cards are too large" was
        // describing. It only looked right when a page happened to be full.
        //
        // `auto-fill` + `minmax` fixes the CARD instead: every card is between
        // 190 and 240px at every width and on every result count, and the grid
        // simply fits as many as the row holds. Two results are two compact
        // cards, not two posters.
        // The class had drifted back to a fixed ladder while the reasoning
        // above still described `auto-fill`, so a 1280px screen rendered 290px
        // cards — wider than the 240px ceiling this comment argues for, and the
        // exact "the cards are too large" complaint it was written to fix. The
        // skeleton below never drifted, so the loading state and the loaded
        // state were laying out differently.
        //
        // The ceiling is enforced by the grid now rather than asserted by a
        // comment: a card is between 190 and 240px at every width and on every
        // result count, and `justify-between` spreads the leftover instead of
        // stretching the cards into it.
        'grid grid-cols-1 gap-3 sm:gap-5 lg:gap-6',
        'sm:grid-cols-[repeat(auto-fill,minmax(11.875rem,15rem))] sm:justify-between',
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
            {/* `allEvents` + `index` are what make the mobile widget a DECK
                rather than a single card blown up. Without them every tap
                opened a one-event stack, so swiping left or right inside the
                widget had nowhere to go — the gesture worked and simply never
                changed anything, which reads as broken rather than as "you are
                at the end". Passing the rendered page is also honest about the
                bounds: you can swipe through exactly the events this grid is
                showing you. */}
            {index < priorityCount ? (
              // Never reveal the LCP row: an element that starts at opacity 0
              // is not eligible to be the Largest Contentful Paint.
              <EventCard
                event={event}
                sizes={GRID_SIZES}
                priority
                allEvents={events}
                index={index}
              />
            ) : (
              <Reveal className="h-full" delayMs={(index % STAGGER_STEPS) * STAGGER_MS}>
                <EventCard event={event} sizes={GRID_SIZES} allEvents={events} index={index} />
              </Reveal>
            )}
          </li>
        </React.Fragment>
      ))}
    </ul>
  );
}

export function EventGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11.875rem,15rem))] sm:gap-5 lg:gap-6"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <EventCardSkeleton key={i} />
      ))}
    </div>
  );
}
