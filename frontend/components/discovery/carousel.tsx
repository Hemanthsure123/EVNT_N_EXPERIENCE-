'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useFeatured } from './featured-context';
import { HeroPreviews } from './hero-previews';

/**
 * The featured carousel: track, autoplay, drag, and controls.
 *
 * TRANSFORM-BASED, not scroll-snap. The previous version was an
 * `overflow-x: auto` track, which is cheap and gives swipe for free — but it
 * puts a real scroll container in the hero, and on Windows that renders a
 * full-height scrollbar with stepper arrows directly under the banner. Moving
 * the track with `translateX` removes the scroll container entirely: nothing to
 * style, nothing to hide, and the slide transition becomes the animation rather
 * than a side effect of scrolling.
 *
 * What that costs, and how it's repaid:
 * - Swipe is no longer free -> a pointer-drag handler below, with a distance
 *   threshold so a tap on the CTA is never mistaken for a swipe.
 * - Every slide is in the DOM -> inactive slides are `inert` + `aria-hidden`,
 *   so keyboard focus can't land on an off-screen CTA.
 *
 * The current index lives in `FeaturedProvider`, not here, because the floating
 * island shows the same rotation and the two must never disagree. The SLIDES
 * still come through `children` as server-rendered output, keeping the first
 * poster in the initial HTML.
 *
 * AUTOPLAY stops for every reason it should: pointer over the carousel,
 * keyboard focus inside it, the tab being hidden, `prefers-reduced-motion`, and
 * the user taking manual control (permanently — moving a slide under someone
 * who just chose one is hostile). It never moves focus, so it can't interrupt
 * an interaction. Each condition is covered by an E2E test.
 */

const AUTOPLAY_MS = 5000;
/** Below this, a pointer gesture is a tap, not a swipe. */
const DRAG_THRESHOLD_PX = 48;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

export function Carousel({
  label,
  children,
  className,
}: {
  /** Accessible name for the region, e.g. "Featured events". */
  label: string;
  /** Server-rendered slides, one per event. */
  children: React.ReactNode;
  className?: string;
}) {
  const featured = useFeatured();
  const trackRef = React.useRef<HTMLUListElement>(null);
  const dragStart = React.useRef<number | null>(null);
  const [paused, setPaused] = React.useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const events = React.useMemo(() => featured?.events ?? [], [featured]);
  const count = events.length;
  const index = featured?.index ?? 0;
  const goTo = featured?.goTo;
  const advance = featured?.advance;
  const setAutoplaying = featured?.setAutoplaying;
  const userTookOver = featured?.userTookOver ?? false;

  const autoplaying = count > 1 && !reducedMotion && !userTookOver && !paused;

  // Published so the island's progress bar runs on the same clock.
  React.useEffect(() => {
    setAutoplaying?.(autoplaying);
  }, [autoplaying, setAutoplaying]);

  // Only the visible slide may hold focus — an off-screen CTA in the tab order
  // is a keyboard trap nobody can see.
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    Array.from(track.children).forEach((child, i) => {
      const slide = child as HTMLElement;
      const active = i === index;
      slide.dataset.active = String(active);
      slide.inert = !active;
      slide.setAttribute('aria-hidden', String(!active));
    });
  }, [index, children, count]);

  // No timers while the tab is in the background.
  React.useEffect(() => {
    const sync = () => setPaused(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // Advance, wrapping at the end so the loop is continuous.
  React.useEffect(() => {
    if (!autoplaying || !advance) return;
    const tick = advance;
    const timer = window.setTimeout(() => tick(), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [autoplaying, index, advance]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragStart.current = event.clientX;
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start === null) return;
    const delta = event.clientX - start;
    if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
    goTo?.(index + (delta < 0 ? 1 : -1));
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      className={cn('flex flex-col gap-5', className)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setPaused(false);
      }}
    >
      <div className="group/carousel relative">
        {/* No scroll container: the track moves with a transform, so there is no
            scrollbar anywhere in the hero to style or hide. */}
        <div className="overflow-hidden rounded-2xl">
          <ul
            ref={trackRef}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              dragStart.current = null;
            }}
            className={cn(
              'flex touch-pan-y',
              'transition-transform duration-carousel ease-spring',
              'motion-reduce:transition-none',
            )}
            style={{ transform: `translate3d(-${index * 100}%, 0, 0)` }}
          >
            {children}
          </ul>

          {/*
            The autoplay timer, as a hairline along the banner's base.
            It used to be a row of five full-width bars under the banner — a
            band of chrome as tall as a content row, for information that is
            secondary. On the image's edge it reads the way a story progress bar
            does: present when you look for it, invisible when you don't. The
            fill is re-keyed per slide so it restarts, and per autoplay state so
            pausing freezes it exactly where it is.
          */}
          {count > 1 ? (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-on-gradient/15" aria-hidden>
              <span
                key={`${index}-${autoplaying}`}
                // `on-gradient`, not the brand gradient: this hairline sits on
                // the bottom edge of a PHOTOGRAPH, so it needs the token that
                // stays light in both themes, and it needs to be one colour
                // rather than a ramp that changes meaning halfway along.
                className={cn(
                  'block h-full bg-on-gradient',
                  autoplaying ? 'animate-progress' : 'w-full',
                )}
              />
            </div>
          ) : null}
        </div>

        {count > 1 ? (
          <>
            <NavButton
              side="left"
              onClick={() => goTo?.(index - 1)}
              label="Previous featured event"
              icon={<ChevronLeft className="size-5" aria-hidden />}
            />
            <NavButton
              side="right"
              onClick={() => goTo?.(index + 1)}
              label="Next featured event"
              icon={<ChevronRight className="size-5" aria-hidden />}
            />
          </>
        ) : null}
      </div>

      {goTo ? <HeroPreviews events={events} index={index} goTo={goTo} /> : null}

      {/* Announced politely, so a screen-reader user knows the view changed
          without the movement itself stealing focus. */}
      <p className="sr-only" role="status" aria-live="polite">
        {`Featured event ${index + 1} of ${count}`}
      </p>
    </section>
  );
}

function NavButton({
  side,
  onClick,
  label,
  icon,
}: {
  side: 'left' | 'right';
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'absolute top-1/2 z-10 -translate-y-1/2',
        side === 'left' ? 'left-4' : 'right-4',
        'glass-media inline-flex size-12 items-center justify-center rounded-full border text-on-gradient shadow-lg',
        // Softly present on hover; always present for keyboard users.
        'opacity-0 transition duration-base ease-spring',
        'focus-visible:opacity-100 group-hover/carousel:opacity-100',
        'hover:scale-[1.06] hover:shadow-xl active:scale-95',
        'motion-reduce:opacity-100 motion-reduce:transition-none motion-reduce:hover:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      {icon}
    </button>
  );
}
