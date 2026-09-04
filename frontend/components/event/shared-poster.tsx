'use client';

import * as React from 'react';
import Image from 'next/image';
import {
  flipTransform,
  toCss,
  type Box,
} from '@/lib/discovery/shared-poster';

/**
 * The poster, in flight between a card and the event detail.
 *
 * ── A CLONE, NOT THE REAL ELEMENT ─────────────────────────────────────────
 *
 * The card's poster lives inside a scrolling list; the deck's lives inside a
 * `position: fixed` overlay with its own horizontal track already carrying a
 * transform. Animating either one directly means either fighting that track or
 * pulling an element out of a scroll container mid-gesture.
 *
 * So this is a throwaway layer that exists for one animation and then unmounts
 * — the "temporary transition layer" the brief allows, and the option with no
 * way to leave the underlying components in a bad state if it is interrupted.
 * Nothing else in the deck knows it exists beyond one boolean.
 *
 * ── WHY THERE IS NO FLASH ─────────────────────────────────────────────────
 *
 * It renders the SAME `poster_url` the card just rendered, so the browser
 * serves it from cache and the first frame is painted, not fetched. `sizes` is
 * pinned to the DESTINATION width because that is the resolution the deck's
 * own hero will ask for a moment later — asking for the card's smaller variant
 * here would mean two fetches and a visible upgrade halfway through.
 *
 * ── AND WHY IT LANDS EXACTLY ──────────────────────────────────────────────
 *
 * It is positioned at the DESTINATION geometry and transformed back to the
 * source. At the end of the forward animation its transform is identity, which
 * makes it pixel-identical to the real hero underneath — so handing over is
 * invisible, with no cross-fade to tune and no frame where both are wrong.
 */
export function SharedPoster({
  src,
  alt,
  from,
  to,
  direction,
  durationMs,
  onDone,
}: {
  src: string;
  alt: string;
  /** The card's poster box, in viewport coordinates. */
  from: Box;
  /** The deck's hero box, in viewport coordinates. */
  to: Box;
  /** `in` plays card → hero; `out` plays hero → card. */
  direction: 'in' | 'out';
  durationMs: number;
  onDone: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const done = React.useRef(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const collapsed = toCss(flipTransform(from, to));
    const expanded = 'translate3d(0px, 0px, 0) scale(1)';
    const start = direction === 'in' ? collapsed : expanded;
    const end = direction === 'in' ? expanded : collapsed;

    // The Web Animations API rather than a React state machine: it runs off
    // the main thread for transform and opacity, it cannot be interrupted by a
    // re-render, and `finished` gives one settlement callback that fires
    // whether the animation completed or was cancelled.
    const animation = node.animate(
      [
        { transform: start, opacity: direction === 'in' ? 1 : 1 },
        { transform: end, opacity: direction === 'in' ? 1 : 0.92 },
      ],
      {
        duration: durationMs,
        // The deck's own settle easing, so the poster and the sheet that
        // follows it are moving on the same curve rather than two.
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
      },
    );

    const settle = () => {
      if (done.current) return;
      done.current = true;
      onDone();
    };
    animation.addEventListener('finish', settle);

    /**
     * ── THE CLEANUP MUST NOT SETTLE, AND THAT IS NOT A DETAIL ───────────
     *
     * It used to `cancel()` and then hand back, on the reasonable-sounding
     * grounds that an interrupted flight should not leave the real poster
     * hidden behind a layer nobody removes.
     *
     * In development that made the animation never run AT ALL. React's strict
     * mode mounts every effect, tears it down, and mounts it again — so the
     * teardown fired `onDone`, the parent cleared the flight, and the layer
     * unmounted before the second mount could draw a frame. The transition
     * looked exactly like the old one, which is the worst way for this to
     * fail: silently, and only where you develop it.
     *
     * The listener is removed BEFORE cancelling so a strict remount is just a
     * remount. Nothing is orphaned by that, because the deck clears its own
     * `flight` when it closes — the state belongs to the thing that owns the
     * transition, not to a layer that is only scenery.
     */
    return () => {
      animation.removeEventListener('finish', settle);
      animation.cancel();
    };
    // Deliberately runs once per mount. `from`/`to` are captured at the moment
    // the transition was decided; re-reading them mid-flight would mean the
    // animation chasing a layout that is itself moving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      // A handle for the browser checks, which assert the thing this component
      // exists for: that the poster STARTS on the card and LANDS on the hero.
      // Neither is provable from a screenshot, and both are exactly what
      // regresses silently if the geometry drifts.
      data-shared-poster
      // `fixed` and sized to the DESTINATION, so identity is the resting hero.
      // `pointer-events-none` throughout: this is scenery, and a layer that
      // swallowed a tap during its 300ms would make the back button feel dead.
      style={{
        position: 'fixed',
        top: to.top,
        left: to.left,
        width: to.width,
        height: to.height,
        willChange: 'transform',
        // Matches the hero's own corner treatment, so the shape does not
        // change at the handover.
        borderRadius: '1.5rem',
        overflow: 'hidden',
      }}
      className="pointer-events-none z-modal bg-muted"
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={`${Math.round(to.width)}px`}
        className="object-cover"
        draggable={false}
        priority
      />
    </div>
  );
}
