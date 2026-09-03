'use client';

import * as React from 'react';
import { UserRound } from 'lucide-react';
import type { EventCrewEntry } from '@/lib/api/event-content';
import { RemoteImage } from '@/components/ui/remote-image';
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
 * ── NO BOOKMARK ON THE CARD ───────────────────────────────────────────────
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
export function LineupRail({
  crew,
  className,
}: {
  crew: EventCrewEntry[];
  className?: string;
}) {
  const scroller = React.useRef<HTMLUListElement>(null);
  const [active, setActive] = React.useState(0);

  /**
   * The active card, from an `IntersectionObserver` rather than a scroll
   * handler.
   *
   * A per-frame `onScroll` reading `scrollLeft` and dividing by a card width
   * is the version that breaks: it assumes every card is the same width, it
   * runs on the main thread during the gesture, and it disagrees with itself
   * at the ends of the rail where a partially-visible card is still "current".
   * The observer is told what "mostly on screen" means once, and reports it.
   */
  React.useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const cards = Array.from(node.querySelectorAll('[data-lineup-card]'));
    if (cards.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = cards.indexOf(entry.target);
            if (index >= 0) setActive(index);
          }
        }
      },
      { root: node, threshold: 0.6 },
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [crew.length]);

  if (crew.length === 0) return null;

  return (
    <section aria-labelledby="lineup-heading" className={cn('flex flex-col gap-3', className)}>
      <h3 id="lineup-heading" className="text-body font-extrabold text-foreground">
        Who&rsquo;s taking the stage
      </h3>

      <ul
        ref={scroller}
        // `-mx-4 px-4` bleeds the rail to the screen edges while keeping the
        // first and last card aligned with the text above — which is what
        // makes the neighbours PEEK instead of being cut off by a container.
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {crew.map((person) => (
          <li
            key={person.id}
            data-lineup-card
            className="w-[62%] max-w-[15rem] shrink-0 snap-center sm:w-[13rem]"
          >
            <figure className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
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
                    // A grey box reads as a failed image. Most crew will have
                    // no photo on day one, so this state is drawn on purpose.
                    <span
                      aria-hidden
                      className="flex size-full items-center justify-center bg-gradient-to-br from-primary/15 via-muted to-muted text-muted-foreground"
                    >
                      <UserRound className="size-10" />
                    </span>
                  }
                />
              </div>
              <figcaption className="flex flex-col gap-0.5 px-3 py-2.5">
                <span className="truncate text-body-sm font-bold text-foreground">
                  {person.name}
                </span>
                {person.role ? (
                  <span className="truncate text-caption text-muted-foreground">
                    {person.role}
                  </span>
                ) : null}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>

      {/* Dots only when there is something to page through. One dot under one
          card is a control for a decision nobody has. */}
      {crew.length > 1 ? (
        <div className="flex items-center justify-center gap-1.5">
          <span className="sr-only" aria-live="polite">
            {`${active + 1} of ${crew.length}`}
          </span>
          {crew.map((person, index) => (
            <span
              key={person.id}
              aria-hidden
              className={cn(
                'h-1.5 rounded-full transition-all duration-200',
                index === active ? 'w-5 bg-foreground' : 'w-1.5 bg-border-strong',
              )}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
