'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * A rail that drifts on its own and is a normal scroller the moment you touch it.
 *
 * ── WHY THIS IS A SCROLL CONTAINER AND NOT A CSS TRANSLATE ────────────────
 *
 * It used to be a `transform: translateX(-50%)` animation over a track holding
 * two copies of the cards. That looked right and had a defect that made the
 * whole component useless: the copies were `inert` so assistive technology and
 * the tab order would not see them twice — and `inert` also blocks POINTER
 * events. With the set repeated to fill a wide viewport, most of what was on
 * screen at any moment was an inert copy, so clicking a card usually did
 * nothing at all. The rail looked interactive and was not.
 *
 * The fix is not a smaller `inert` region. It is that a rail of links should be
 * a SCROLLER: `overflow-x: auto` with the cards laid out once, advanced by
 * writing `scrollLeft`. Then every card on screen is a real card, the browser
 * gives drag, wheel, trackpad, touch and keyboard scrolling for free, and
 * arrows are one `scrollBy` rather than an offset fought against a running
 * animation.
 *
 * ── THE SEAM ──────────────────────────────────────────────────────────────
 *
 * One duplicate set still follows the real one, so the loop has no visible
 * gap: when the scroll position passes the width of one set it is reduced by
 * exactly that width, which lands on an identical frame and is invisible.
 *
 * The duplicate is `aria-hidden` and its focusables are given `tabindex="-1"`,
 * so a screen reader announces each event once and tab never lands on a copy.
 * It is deliberately NOT `inert`: that is what broke clicking, and a copy that
 * is momentarily on screen must be clickable or the rail has dead patches.
 * Both copies point at the same event, so a click on either is correct.
 *
 * ── IT STOPS WHEN SOMEBODY IS LOOKING AT IT ───────────────────────────────
 *
 *  - **Hover** — the pointer is over a card somebody is about to click. A rail
 *    that keeps moving under the cursor is one you have to chase.
 *  - **Focus within** — a keyboard user has tabbed in, and focus must not
 *    slide out from under its own ring.
 *  - **Tab hidden** — no sense spending battery moving what nobody can see.
 *  - **While being scrolled by hand** — and for a moment after, so releasing a
 *    drag does not immediately fight the person who just moved it.
 *
 * Under `prefers-reduced-motion` it never advances by itself. It is still a
 * scroller and the arrows still work, so nothing is lost but the drift.
 */

/** Pixels per second. ~28 reads as a slow drift; past ~60 it reads as agitated. */
const DEFAULT_SPEED = 28;

/** How long a manual scroll suppresses the drift after it stops. */
const RESUME_DELAY_MS = 2000;

/** Enough to fill an ultrawide from a single card; a backstop, not a target. */
const MAX_COPIES = 12;

export function Marquee({
  children,
  speed = DEFAULT_SPEED,
  className,
  ariaLabel,
}: {
  children: React.ReactNode;
  speed?: number;
  className?: string;
  ariaLabel: string;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const setRef = React.useRef<HTMLUListElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);

  const [engaged, setEngaged] = React.useState(false);
  const [tabHidden, setTabHidden] = React.useState(false);
  const [canScroll, setCanScroll] = React.useState(false);
  /**
   * How many copies of the set the track holds, INCLUDING the real one.
   *
   * A rail whose content is narrower than its viewport has nothing to scroll —
   * which is honest, and looks like one lonely card on a wide monitor. A new
   * platform with a single live event is exactly that case, and it is the
   * state this was built in.
   *
   * So the set repeats until it overflows, and then once more so the wrap
   * lands on an identical frame. Two is the floor: one for the content, one
   * for the seam.
   */
  const [copies, setCopies] = React.useState(2);
  /** Suppressed until this timestamp because somebody scrolled by hand. */
  const manualUntil = React.useRef(0);

  React.useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /**
   * The duplicate must not be reachable by tab or announced by a reader.
   *
   * Done here rather than with `inert` because `inert` also blocks clicks —
   * see the note above. Re-run whenever the children change, since the copies
   * are re-created with them.
   */
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.querySelectorAll<HTMLElement>('ul[aria-hidden] a, ul[aria-hidden] button').forEach(
      (node) => node.setAttribute('tabindex', '-1'),
    );
  }, [children, copies]);

  // Measure once and derive both numbers from real widths: how many copies it
  // takes to overflow, and whether there is anything to scroll at all.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    const set = setRef.current;
    if (!viewport || !set) return;

    const measure = () => {
      const oneSet = set.scrollWidth;
      if (oneSet <= 0) return;
      // +1 so the track always OVERFLOWS rather than exactly filling: at
      // exactly 100% the trailing edge is on screen at the wrap, which is the
      // one frame where a seam would show. Capped, so a degenerate measurement
      // mid-layout cannot ask for thousands of nodes.
      const needed = Math.min(MAX_COPIES, Math.max(2, Math.ceil(viewport.clientWidth / oneSet) + 1));
      setCopies((current) => (current === needed ? current : needed));
      setCanScroll(oneSet * needed > viewport.clientWidth + 8);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(set);
    return () => observer.disconnect();
  }, [children]);

  const paused = engaged || tabHidden || !canScroll;

  // The drift. `scrollLeft` is written from a rAF loop with a real elapsed
  // time, so the speed is pixels per SECOND on every refresh rate rather than
  // pixels per frame — which would run twice as fast on a 120Hz display.
  React.useEffect(() => {
    if (paused) return;
    const viewport = viewportRef.current;
    const set = setRef.current;
    if (!viewport || !set) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let last = performance.now();

    const step = (now: number) => {
      const elapsed = now - last;
      last = now;
      if (now >= manualUntil.current) {
        const setWidth = set.scrollWidth;
        let next = viewport.scrollLeft + (speed * elapsed) / 1000;
        // Past one full set, so the identical frame one set back is showing.
        if (setWidth > 0 && next >= setWidth) next -= setWidth;
        viewport.scrollLeft = next;
      }
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [paused, speed]);

  /** One card plus its gap, so an arrow always lands on a card boundary. */
  const stepBy = React.useCallback((direction: 1 | -1) => {
    const viewport = viewportRef.current;
    const set = setRef.current;
    if (!viewport) return;
    const card = set?.firstElementChild as HTMLElement | null;
    const distance = card ? card.getBoundingClientRect().width + 20 : viewport.clientWidth * 0.8;
    // Pressing an arrow is a manual scroll: hold the drift off afterwards, or
    // it resumes mid-glide and the rail appears to overshoot.
    manualUntil.current = performance.now() + RESUME_DELAY_MS;
    viewport.scrollBy({ left: distance * direction, behavior: 'smooth' });
  }, []);

  const items = React.useMemo(
    () =>
      React.Children.map(children, (child, index) => (
        <li key={index} className="flex">
          {child}
        </li>
      )),
    [children],
  );

  const listClass = 'flex shrink-0 items-stretch gap-4 pr-4 sm:gap-5 sm:pr-5';

  return (
    <div
      className={cn('group/rail relative', className)}
      onPointerEnter={() => setEngaged(true)}
      onPointerLeave={() => setEngaged(false)}
      onFocusCapture={() => setEngaged(true)}
      onBlurCapture={() => setEngaged(false)}
    >
      <div
        ref={viewportRef}
        // `scrollbar-none`: the rail is its own affordance (arrows, drag,
        // wheel) and a scrollbar under a row of posters is chrome nobody needs.
        className="marquee-mask scrollbar-none w-full overflow-x-auto overscroll-x-contain"
        onPointerDown={() => {
          manualUntil.current = performance.now() + RESUME_DELAY_MS;
        }}
        onWheel={() => {
          manualUntil.current = performance.now() + RESUME_DELAY_MS;
        }}
      >
        <div ref={trackRef} className="flex w-max">
          {/* The one announced, tabbable set. */}
          <ul ref={setRef} className={listClass} aria-label={ariaLabel}>
            {items}
          </ul>
          {/* Fill and seam copies. Hidden from assistive technology and skipped
              by tab, but CLICKABLE — see the note at the top of this file. */}
          {Array.from({ length: copies - 1 }, (_, index) => (
            <ul key={index} className={listClass} aria-hidden>
              {items}
            </ul>
          ))}
        </div>
      </div>

      {canScroll ? (
        <>
          <RailArrow side="left" onClick={() => stepBy(-1)} />
          <RailArrow side="right" onClick={() => stepBy(1)} />
        </>
      ) : null}
    </div>
  );
}

/**
 * The arrows appear on hover and on keyboard focus, and are always present for
 * a screen reader.
 *
 * Hidden below `sm`: a phone scrolls a rail by swiping, and two 40px targets
 * laid over the cards would cover the posters they are meant to reveal.
 */
function RailArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
      className={cn(
        'absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full sm:inline-flex',
        'border border-border bg-surface/95 text-foreground shadow-lg backdrop-blur',
        'transition duration-fast ease-out hover:bg-surface hover:shadow-xl active:scale-95',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        'opacity-0 group-hover/rail:opacity-100 focus-visible:opacity-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
