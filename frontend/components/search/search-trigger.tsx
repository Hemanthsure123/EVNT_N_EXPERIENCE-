'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { RollingHint, useRollingTerm } from './rolling-placeholder';
import { useSearchOverlay } from './search-context';

/**
 * Triggers for the deep-search overlay. All of them warm the overlay's chunk on
 * hover/focus, so the palette is already downloaded by the time it's opened.
 *
 * ── THE HEADER BAR IS THE ONLY SEARCH AFFORDANCE NOW ──────────────────────
 *
 * The front page used to carry a second, larger one inside its hero. The hero
 * is gone (see `components/discovery/showcase.tsx`), and rather than lose the
 * rolling trending suggestions with it, they moved UP into this bar — which is
 * on every route, so the suggestion now reaches somebody browsing a category
 * or reading an event page, not only somebody who happened to be on the home
 * page and had not scrolled.
 *
 * That reverses an earlier decision here, which said this control must not roll
 * because it is persistent chrome. Two things changed and both matter:
 *
 *  1. **It is no longer the second bar.** The objection was really about two
 *     moving hints on one screen. There is one.
 *  2. **It stops where movement would be wrong.** Not everywhere — during
 *     CHECKOUT, where somebody is entering payment details and a word cycling
 *     in the corner of the eye is the definition of an unwanted distraction.
 *     `prefers-reduced-motion` stops it everywhere, via the shared clock.
 *
 * ── THE MAGNIFIER IS THE ONE VIOLET IN THE HEADER ─────────────────────────
 *
 * The light-first language spends the brand accent on WAYFINDING only — the
 * search glyph, a date on an event page, a selected hairline — and never on a
 * button fill. So the leading magnifier is `text-primary` at rest rather than a
 * grey that only becomes violet on hover, which is a colour nobody using a
 * touch screen ever saw.
 */

/** The sentence used when there is nothing to roll, and as the spoken label. */
const DEFAULT_HINT = 'Search events, artists, venues or cities';

/**
 * Routes where the hint holds still.
 *
 * The booking funnel only. Everything else on this site is discovery, which is
 * exactly what a suggestion is for.
 */
function useMotionAllowed(): boolean {
  const pathname = usePathname() ?? '/';
  return !pathname.includes('/book');
}

/**
 * The header's search affordance — looks like a field, behaves like a button.
 *
 * It is fluid, not fixed: the header's centre column hands it whatever the
 * brand, nav and actions leave behind, which is ~425px at xl and ~240px at lg.
 * A fixed width here is what made the old header overlap its own nav, so the
 * things that would need one — the rolling hint and the shortcut key — shorten
 * and disappear on the way down instead of forcing the row wider.
 */
export function HeaderSearchTrigger({ className }: { className?: string }) {
  const { triggerProps, preload, terms } = useSearchOverlay();
  const barRef = React.useRef<HTMLButtonElement>(null);
  // Capture-phase toggle. A bare `onClick` reads state Radix has already
  // changed — see the note on `triggerProps` in search-context.tsx.
  const press = triggerProps(() => null);
  const motionAllowed = useMotionAllowed();

  /**
   * Hovering or focusing stops the roll.
   *
   * Somebody who has reached for this control is about to read the suggestion
   * or press past it, and either way a word that changes under the cursor is a
   * moving target. It resumes on the way out.
   */
  const [engaged, setEngaged] = React.useState(false);
  const { index } = useRollingTerm(terms, motionAllowed && !engaged);
  const labels = React.useMemo(() => terms.map((entry) => entry.label), [terms]);

  return (
    <button
      ref={barRef}
      type="button"
      onPointerDownCapture={press.onPointerDownCapture}
      onClick={press.onClick}
      onPointerEnter={() => {
        setEngaged(true);
        preload();
      }}
      onPointerLeave={() => setEngaged(false)}
      onFocus={() => {
        setEngaged(true);
        preload();
      }}
      onBlur={() => setEngaged(false)}
      // The stable sentence, never the animated one. The moving text is
      // `aria-hidden`; an accessible name that changes every three seconds
      // cannot be read out or acted on.
      aria-label={DEFAULT_HINT}
      className={cn(
        // `h-control` is the 44px touch-target floor, named so it cannot drift.
        'group flex h-control w-full items-center gap-2.5 rounded-full border border-input bg-surface px-4 text-body-sm text-muted-foreground shadow-sm transition duration-fast ease-out',
        'hover:border-border-strong hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-primary" aria-hidden />
      <RollingHint
        terms={labels}
        index={index}
        fallback={DEFAULT_HINT}
        className="min-w-0 flex-1 text-left"
      />
      {/* A shortcut nobody can see is a shortcut nobody uses — but it is the
          first thing to go when the field is short, because it costs width the
          hint needs more. */}
      <kbd
        className="hidden size-6 shrink-0 items-center justify-center rounded-md border border-border bg-sunken font-sans text-caption text-muted-foreground xl:inline-flex"
        aria-hidden
      >
        /
      </kbd>
    </button>
  );
}
