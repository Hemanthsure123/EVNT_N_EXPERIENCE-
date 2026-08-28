'use client';

import * as React from 'react';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * A horizontal rail that advances on its own.
 *
 * ── AUTO-MOTION NEEDS A STOP, AND THAT IS NOT OPTIONAL ────────────────────
 *
 * WCAG 2.2.2 is explicit: anything that moves automatically for more than five
 * seconds needs a mechanism to pause it. This is not a nicety on a page whose
 * job is reading event names — content that slides away mid-word is unusable
 * for anyone who reads slowly, and actively hostile to anyone with a
 * vestibular disorder. So there are three stops, and all three are real:
 *
 *   1. A visible pause/play button.
 *   2. Hover and keyboard FOCUS both pause it — focus especially, or tabbing
 *      to a card would move the card out from under the focus ring.
 *   3. `prefers-reduced-motion: reduce` means it never starts at all.
 *
 * ── WHY `scrollBy`, NOT A TRANSFORM ANIMATION ─────────────────────────────
 *
 * The rail is a real scroll container, so it stays draggable, swipeable and
 * keyboard-scrollable, and the browser's own scroll anchoring keeps a card
 * aligned. A CSS `translateX` marquee would look identical and take all of
 * that away — a visitor who grabs it mid-slide would be fighting the
 * animation instead of scrolling.
 *
 * Touching it hands control over PERMANENTLY: once somebody scrolls the rail
 * themselves, the timer stops for good rather than yanking them back a few
 * seconds later. An auto-advance that resumes over the top of a deliberate
 * action is the single most irritating thing a carousel does.
 *
 * ── THE INTERVAL ──────────────────────────────────────────────────────────
 *
 * 4 seconds per card. Fast enough to read as alive, slow enough to finish a
 * two-line title. It also loops back to the start rather than stopping at the
 * end, so the section never sits in a dead state a visitor cannot explain.
 */

const STEP_MS = 4000;

export function AutoRail({
  children,
  label,
  className,
}: {
  children: React.ReactNode;
  /** Names the rail for assistive tech AND the pause button. */
  label: string;
  className?: string;
}) {
  const trackRef = React.useRef<HTMLUListElement>(null);
  const [playing, setPlaying] = React.useState(true);
  // Distinct from `playing`: a transient hover should not flip the button's
  // pressed state, and a deliberate pause should survive the pointer leaving.
  const [held, setHeld] = React.useState(false);

  React.useEffect(() => {
    const track = trackRef.current;
    if (!track || !playing || held) return;

    // Read the preference INSIDE the effect: a visitor can change it while the
    // page is open, and this component may mount before they do.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduce.matches) return;

    const id = window.setInterval(() => {
      const first = track.firstElementChild as HTMLElement | null;
      if (!first) return;
      // The card's own width plus the gap, measured rather than assumed — the
      // rail is responsive and a hard-coded step would drift at every
      // breakpoint and land mid-card.
      const gap = Number.parseFloat(getComputedStyle(track).columnGap || '0') || 0;
      const step = first.getBoundingClientRect().width + gap;
      const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
      track.scrollBy({ left: atEnd ? -track.scrollLeft : step, behavior: 'smooth' });
    }, STEP_MS);

    return () => window.clearInterval(id);
  }, [playing, held]);

  return (
    <div className={cn('relative flex flex-col gap-3', className)}>
      <ul
        ref={trackRef}
        aria-label={label}
        // `onScroll` is deliberately NOT used to stop it — `scrollBy` fires
        // that too, so the rail would pause itself on its own first tick.
        // Pointer and wheel are what a person does; the timer is not.
        onPointerDown={() => setPlaying(false)}
        onWheel={() => setPlaying(false)}
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocusCapture={() => setHeld(true)}
        onBlurCapture={() => setHeld(false)}
        className={cn(
          // `scroll-pl-*` MATCHING the padding. Without it the browser snaps
          // the first card's start to the SCROLLPORT edge, which ignores
          // padding — so the rail silently sat at `scrollLeft: 24` on load and
          // the first card was a padding-width left of the heading above it.
          // Measured, not guessed: the alignment spec caught exactly 24px.
          '-mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-5 overflow-x-auto px-4 pb-2',
          'lg:scroll-pl-6',
          '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'lg:-mx-6 lg:px-6',
        )}
      >
        {children}
      </ul>

      <button
        type="button"
        onClick={() => setPlaying((on) => !on)}
        aria-pressed={!playing}
        className={cn(
          'inline-flex h-9 w-fit items-center gap-2 self-end rounded-full border border-border bg-surface px-pill text-label text-muted-foreground',
          'transition-colors duration-fast hover:bg-muted hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        {playing ? (
          <Pause className="size-4" aria-hidden />
        ) : (
          <Play className="size-4" aria-hidden />
        )}
        {playing ? `Pause ${label.toLowerCase()}` : `Play ${label.toLowerCase()}`}
      </button>
    </div>
  );
}
