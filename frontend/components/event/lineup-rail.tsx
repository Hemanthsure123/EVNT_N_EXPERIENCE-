'use client';

import * as React from 'react';
import { UserRound } from 'lucide-react';
import type { EventCrewEntry } from '@/lib/api/event-content';
import { RemoteImage } from '@/components/ui/remote-image';
import {
  PEEK_RAIL_SURFACE,
  PEEK_RAIL_TRACK,
  centredRailPadding,
  loopedIndex,
  peekRailItem,
  peekRailItemState,
  peekRailSurfaceState,
  useSnapRail,
} from '@/lib/discovery/peek-rail';
import { cn } from '@/lib/utils/cn';

/**
 * Who is taking the stage.
 *
 * ── SECONDARY, NOT TERTIARY ───────────────────────────────────────────────
 *
 * The event page sorts information three ways: what decides whether to book is
 * primary and always visible, what supports the decision is secondary and
 * compact, and reference material is one press away behind a disclosure row.
 *
 * A lineup is SECONDARY. For a club night or a festival the names ARE the
 * product — somebody is buying because of who is playing — so hiding it behind
 * "See all" would file the reason for the purchase next to the refund policy.
 *
 * ── ABSENT, NOT EMPTY ─────────────────────────────────────────────────────
 *
 * Most events have no crew. The section does not render at all in that case —
 * a heading over an empty rail reads as a lineup that has not been announced,
 * which is a claim nobody made.
 *
 * ── CIRCLES, NOT CARDS ────────────────────────────────────────────────────
 *
 * A rectangle with a border is the shape this codebase uses for a THING — an
 * event, a ticket tier, a venue — and these are PEOPLE. A circle is the shape
 * every product on a phone uses for a person, so the section reads as a lineup
 * at a glance rather than as four more cards.
 *
 * ── THE LAYOUT DEPENDS ON HOW MANY THERE ARE ──────────────────────────────
 *
 * Three or more is a CAROUSEL: the middle face is centred and scaled up, its
 * neighbours peek in from both edges, and scrolling past either end wraps
 * around. One or two is a ROW: left-aligned from the gutter, snapping to the
 * start, nothing scaled.
 *
 * That is not a preference. A centred carousel needs something either side of
 * the middle to BE a carousel — with one face it is a portrait marooned in the
 * middle of the screen with a void each side, and with two, centring the first
 * pushes half the second off the edge on arrival. Both read as a broken layout
 * rather than as a design. The decision lives in `railModeFor` so this rail and
 * the home page's cannot disagree about it.
 *
 * ── THE MOTION IS THE FEATURED RAIL'S, NOT A LOOKALIKE ────────────────────
 *
 * Scale, lift, opacity, elevation, easing, duration, the wrap and the
 * active-index hook all come from `lib/discovery/peek-rail`, which is where the
 * home page's "Featured events" carousel keeps them. The same constants and the
 * same hook, so the two cannot drift into feeling like two different products.
 * Sizes are local, because a poster is 68vw and a face is a third of that.
 *
 * ── NO BOOKMARK ON THE AVATAR ─────────────────────────────────────────────
 *
 * The reference this is drawn from puts a save control on each performer. It is
 * deliberately absent: nothing in this system stores a saved PERSON, and a
 * heart that quietly forgets is worse than no heart.
 *
 * There is no auto-advance either. These are NAMES, which have to be read; the
 * codebase's own auto-rail says a rail carrying something you read needs its
 * pause control back, and the honest version of that is not to move at all.
 */

/** The face's share of the viewport, below `sm`. */
const ITEM_VW = 34;

export function LineupRail({ crew, className }: { crew: EventCrewEntry[]; className?: string }) {
  const { ref, activeIndex, mode, looping, scrollable } = useSnapRail<HTMLUListElement>(
    crew.length,
    { loop: true },
  );
  const { domCount, realFor } = loopedIndex(crew.length, looping);

  if (crew.length === 0) return null;

  const centred = mode === 'centred';

  return (
    <section aria-labelledby="lineup-heading" className={cn('flex flex-col gap-1', className)}>
      <h3 id="lineup-heading" className="text-body font-extrabold text-foreground">
        Who&rsquo;s taking the stage
      </h3>

      <ul
        ref={ref}
        style={
          centred
            ? // Symmetrical, and computed from the item's own width so the
              // first and last faces can reach the centre exactly like every
              // other one.
              { paddingLeft: centredRailPadding(ITEM_VW), paddingRight: centredRailPadding(ITEM_VW) }
            : undefined
        }
        className={cn(
          PEEK_RAIL_TRACK,
          'gap-3',
          // `-mx-4` bleeds the track to the screen edges while the heading above
          // keeps the container's padding, which is what makes the neighbours
          // PEEK rather than be clipped by a box.
          '-mx-4',
          // A ROW starts at the gutter, like every other list on the site.
          centred ? null : 'px-4',
          // From `sm` this sits inside a `max-w-2xl` column on the desktop event
          // page, where a viewport-relative size would draw 480px faces.
          'sm:mx-0 sm:px-1',
        )}
      >
        {Array.from({ length: domCount }, (_, domIndex) => {
          const index = realFor(domIndex);
          const person = crew[index];
          if (!person) return null;
          // A clone is scenery for the wrap — never announced, never counted.
          const isClone = looping && (domIndex === 0 || domIndex === domCount - 1);
          // Everything is active when nothing scrolls: dimming faces that are
          // all fully on screen is emphasis with nothing behind it.
          const isActive = !scrollable || index === activeIndex;
          return (
            <li
              key={isClone ? `clone-${domIndex}` : person.id}
              data-lineup-card
              aria-hidden={isClone || undefined}
              style={{ width: `${ITEM_VW}vw` }}
              className={cn(
                'sm:!w-[8.5rem]',
                peekRailItem(mode),
                peekRailItemState(isActive, mode),
              )}
            >
              <figure className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    // `rounded-full` on the CLIPPING box, so the photograph is
                    // the circle rather than a square behind a mask — a border
                    // and a ring both follow the same shape this way.
                    'relative aspect-square w-full overflow-hidden rounded-full bg-muted ring-1 ring-border',
                    PEEK_RAIL_SURFACE,
                    peekRailSurfaceState(isActive, mode),
                  )}
                >
                  {/* `RemoteImage`, not a raw `<img>`: it already owns the two
                      things this needs — a storage host that may not be in
                      `remotePatterns`, and a url that 404s — and it draws the
                      fallback in both cases rather than a broken-image glyph. */}
                  <RemoteImage
                    src={person.photo_url}
                    alt={person.photo_alt_text || ''}
                    className="size-full object-cover"
                    fallback={
                      // A grey disc reads as a failed image. Most crew will
                      // have no photo on day one, so this state is drawn on
                      // purpose.
                      <span
                        aria-hidden
                        className="flex size-full items-center justify-center bg-gradient-to-br from-primary/15 via-muted to-muted text-muted-foreground"
                      >
                        <UserRound className="size-8" />
                      </span>
                    }
                  />
                </div>
                <figcaption className="flex w-full flex-col items-center gap-0.5 text-center">
                  <span className="w-full truncate text-body-sm font-bold text-foreground">
                    {person.name}
                  </span>
                  {person.role ? (
                    <span className="w-full truncate text-caption text-muted-foreground">
                      {person.role}
                    </span>
                  ) : null}
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>

      {/* Dots only for a carousel, and only when there is something to page
          through. One dot under one face is a control for a decision nobody
          has, and a row of two that are both on screen needs no indicator. */}
      {centred && scrollable ? (
        <div className="flex items-center justify-center gap-1.5">
          <span className="sr-only" aria-live="polite">
            {`${activeIndex + 1} of ${crew.length}`}
          </span>
          {crew.map((person, index) => (
            <span
              key={person.id}
              aria-hidden
              className={cn(
                'h-1.5 rounded-full transition-all duration-200',
                index === activeIndex ? 'w-5 bg-foreground' : 'w-1.5 bg-border-strong',
              )}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
