'use client';

import * as React from 'react';
import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * The home page's quick-filter row, and the one thing about it that needs JS.
 *
 * ── WHY THIS IS ITS OWN CLIENT COMPONENT ──────────────────────────────────
 *
 * `AllEvents` is a server component with no listeners at all, and its own note
 * says why the STICKY behaviour must stay that way: a sticky element is bounded
 * by its containing block, so it follows the reader down the grid and stops at
 * the end of the section with no scroll listener, no measured offsets and no
 * IntersectionObserver to get wrong. None of that changes — the row is still
 * pinned by `position: sticky` and nothing else.
 *
 * What DOES need JS is the horizontal collapse, because it reacts to the row's
 * own `scrollLeft`, which CSS cannot see. Splitting it out keeps the listener
 * in the smallest possible client island and leaves the section, the grid and
 * the data fetch on the server.
 *
 * ── THE COLLAPSE IS PORTED, NOT INVENTED ──────────────────────────────────
 *
 * The browse page's `FilterToolbar` has had exactly this behaviour for a while
 * (its `isFilterMinimised`), and the two rows are the same control in two
 * places — so the threshold (15px), the duration (300ms), the easing and the
 * collapse mechanism (`max-w-0 opacity-0 -ml-1` on the label, never `display`)
 * are copied verbatim rather than re-chosen. Two rows that minimise at
 * different speeds read as a bug in whichever one you meet second.
 *
 * `max-w`, not `hidden`: a width that animates lets the chips after it slide
 * into the freed space, which is the whole effect. `display:none` would make
 * them jump.
 *
 * ── WHAT MUST NOT MOVE ────────────────────────────────────────────────────
 *
 * The row's HEIGHT. It is pinned under the header, so a row that changed height
 * as it collapsed would shift the entire grid underneath it — the same reason
 * this row stays a single scroller at every width instead of wrapping at `sm`.
 * Only the label's width animates; the chip keeps its `h-control`.
 *
 * The icon also stays put. Collapsing to an icon that then re-centres itself is
 * two movements where one was asked for.
 */

/** Matches `FilterToolbar`'s threshold exactly — see the note above. */
const MINIMISE_AT_PX = 15;

export function AllEventsChips({
  chips,
  className,
}: {
  /** Pre-computed on the server: these are real, shareable `/events?…` URLs. */
  chips: readonly { label: string; href: string }[];
  className?: string;
}) {
  const [minimised, setMinimised] = React.useState(false);

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft } = event.currentTarget;
    // Guarded both ways so a scroll that stays inside the dead zone does not
    // set state on every frame — this fires at ~60Hz on a flick.
    if (scrollLeft > MINIMISE_AT_PX && !minimised) setMinimised(true);
    else if (scrollLeft <= MINIMISE_AT_PX && minimised) setMinimised(false);
  };

  return (
    <div
      onScroll={onScroll}
      className={cn(
        // Unchanged from the server version: sticky under the header, bounded
        // by the section's Container, `z-[999]` one below the header's 1000,
        // and an opaque background or the poster grid scrolls through it.
        'sticky top-sticky-top z-[999] -mx-4 flex gap-2.5 overflow-x-auto bg-background px-4 py-2',
        'scrollbar-none lg:top-sticky-top-lg lg:-mx-6 lg:px-6',
        className,
      )}
    >
      <Link
        href="/events"
        // The accessible name is constant. Collapsing the visible label must
        // not rename the control for a screen reader — to anything not looking
        // at the screen, nothing has happened.
        aria-label="Filters"
        className={cn(
          'inline-flex h-control shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface px-4',
          'text-label font-semibold text-foreground',
          'transition-colors duration-fast hover:border-muted-foreground/40 hover:bg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <SlidersHorizontal className="size-4 shrink-0" aria-hidden />
        <span
          aria-hidden
          className={cn(
            'inline-block overflow-hidden whitespace-nowrap transition-all duration-300 ease-out',
            'motion-reduce:transition-none',
            minimised ? '-ml-1 max-w-0 opacity-0' : 'max-w-xs opacity-100',
          )}
        >
          Filters
        </span>
      </Link>

      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.href}
          className={cn(
            'inline-flex h-control shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface px-4',
            'text-label text-foreground transition-colors duration-fast',
            'hover:border-muted-foreground/40 hover:bg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        >
          {chip.label}
        </Link>
      ))}
    </div>
  );
}
