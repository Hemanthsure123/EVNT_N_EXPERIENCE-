'use client';

import * as React from 'react';
import { UserRound } from 'lucide-react';
import type { EventCrewEntry } from '@/lib/api/event-content';
import { RemoteImage } from '@/components/ui/remote-image';
import {
  PEEK_RAIL_ITEM,
  PEEK_RAIL_SURFACE,
  PEEK_RAIL_TRACK,
  peekRailItemState,
  peekRailSurfaceState,
  useCenteredIndex,
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
 * It is not primary either: it does not answer "can I go", which is what the
 * date, the venue, the price and the countdown are for.
 *
 * ── ABSENT, NOT EMPTY ─────────────────────────────────────────────────────
 *
 * Most events have no crew. The section does not render at all in that case —
 * a heading over an empty rail reads as a lineup that has not been announced,
 * which is a claim nobody made.
 *
 * ── CIRCLES, NOT CARDS ────────────────────────────────────────────────────
 *
 * This was a row of 3:4 portrait cards in bordered containers with the name in
 * a figcaption below. It is a row of circular avatars now, and the change is
 * not only cosmetic: a rectangle with a border is the shape this codebase uses
 * for a THING — an event, a ticket tier, a venue — and these are PEOPLE. A
 * circle is the shape every product on a phone uses for a person, so the
 * section reads as a lineup at a glance rather than as four more cards.
 *
 * It also costs less height. The card version was a 3:4 photograph plus a
 * two-line caption inside a border, which on a 664px phone was most of a
 * screen for a section that is secondary by design.
 *
 * ── THE MOTION IS THE FEATURED RAIL'S, NOT A LOOKALIKE ────────────────────
 *
 * Scale, lift, opacity, elevation, easing and duration all come from
 * `lib/discovery/peek-rail`, which is where the home page's "Featured events"
 * carousel keeps them. Not a second set of classes tuned to match: the same
 * constants and the same `useCenteredIndex` hook, so the two rails cannot
 * drift into feeling like two different products. Sizes are local, because a
 * poster is 68vw and a face is a third of that — the geometry is what differs
 * and the behaviour is what is shared.
 *
 * ── NO BOOKMARK ON THE AVATAR ─────────────────────────────────────────────
 *
 * The reference this is drawn from puts a save control on each performer. It
 * is deliberately absent: nothing in this system stores a saved PERSON, and a
 * heart that quietly forgets is worse than no heart. If saving performers is
 * ever wanted, it needs a table first.
 *
 * ── A REAL SCROLLER, NOT A TRANSFORM CAROUSEL ─────────────────────────────
 *
 * `overflow-x-auto` with CSS scroll-snap, so the rail is draggable,
 * swipeable, keyboard-scrollable and works with a trackpad without a line of
 * JavaScript doing the moving. The dots follow the scroll rather than driving
 * it — they are an indicator, and making them the source of truth is how a
 * carousel ends up fighting the finger that is already scrolling it.
 *
 * There is no auto-advance. These are NAMES, which have to be read; the
 * codebase's own auto-rail says a rail carrying something you read needs its
 * pause control back, and the honest version of that is not to move at all.
 */
export function LineupRail({ crew, className }: { crew: EventCrewEntry[]; className?: string }) {
  const { ref, activeIndex, scrollable } = useCenteredIndex<HTMLUListElement>(crew.length);

  if (crew.length === 0) return null;

  return (
    <section aria-labelledby="lineup-heading" className={cn('flex flex-col gap-1', className)}>
      <h3 id="lineup-heading" className="text-body font-extrabold text-foreground">
        Who&rsquo;s taking the stage
      </h3>

      <ul
        ref={ref}
        className={cn(
          PEEK_RAIL_TRACK,
          'gap-3',
          // ── THE SAME ARITHMETIC THE FEATURED RAIL USES ─────────────────
          //
          // 33vw either side + a 34vw avatar = exactly 100vw, so the FIRST and
          // LAST faces can reach the centre like every other one — which is
          // what makes the active state reachable at the ends instead of the
          // rail opening with its first item permanently dimmed. Both numbers
          // are the same unit on purpose: a vw padding against a px-capped
          // item stops agreeing as the phone widens.
          //
          // `-mx-4` bleeds the track to the screen edges while the heading
          // above keeps the container's padding, which is what makes the
          // neighbours PEEK rather than be clipped by a box.
          '-mx-4 px-[33vw]',
          // From `sm` this is inside a `max-w-2xl` column on the desktop event
          // page, where a viewport-relative size would draw 480px faces. Fixed
          // from here, and usually not scrolling at all — see `scrollable`.
          'sm:mx-0 sm:px-1',
        )}
      >
        {crew.map((person, index) => {
          // Everything is active when nothing scrolls: dimming four faces that
          // are all fully on screen is emphasis with nothing behind it.
          const isActive = !scrollable || index === activeIndex;
          return (
            <li
              key={person.id}
              data-lineup-card
              className={cn('w-[34vw] sm:w-[8.5rem]', PEEK_RAIL_ITEM, peekRailItemState(isActive))}
            >
              <figure className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    // `rounded-full` on the clipping box, so the photograph is
                    // the circle rather than a square behind a mask — a border
                    // and a ring both follow the same shape this way.
                    'relative aspect-square w-full overflow-hidden rounded-full bg-muted ring-1 ring-border',
                    PEEK_RAIL_SURFACE,
                    peekRailSurfaceState(isActive),
                  )}
                >
                  {/* `RemoteImage`, not a raw `<img>`: it already owns the two
                      things this needs — a storage host that may not be in
                      `remotePatterns`, and a url that 404s — and it draws the
                      fallback in both cases rather than a broken-image glyph.
                      The name renders directly below, so the picture is
                      decorative unless the organiser wrote real alt text. */}
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

      {/* Dots only when there is something to page through. One dot under one
          card is a control for a decision nobody has. */}
      {crew.length > 1 ? (
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
