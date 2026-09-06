'use client';

import * as React from 'react';
import Image from 'next/image';
import {
  flipTransform,
  restrain,
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

  /**
   * A LAYOUT effect, so the flight starts in the frame this first paints.
   *
   * As a passive effect it ran after the browser had painted, which put the
   * clone's first moving frame a whole paint behind the sheet's — measured on
   * a production build, the sheet had all but finished arriving before this
   * animation began. `fill: 'both'` also means the un-started clone would
   * paint once at identity, i.e. at full hero size, before jumping back to its
   * starting transform.
   */
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    // The FULL flip — see `ORIGIN_RESTRAINT`, which is 1. The clone starts at
    // the card's width, in the card's place, and grows into the hero: one
    // continuous object rather than a picture appearing near its final size.
    const collapsed = toCss(restrain(flipTransform(from, to)));
    const expanded = 'translate3d(0px, 0px, 0) scale(1)';
    const start = direction === 'in' ? collapsed : expanded;
    const end = direction === 'in' ? expanded : collapsed;

    // The Web Animations API rather than a React state machine: it runs off
    // the main thread for transform and opacity, it cannot be interrupted by a
    // re-render, and `finished` gives one settlement callback that fires
    // whether the animation completed or was cancelled.
    // ── ARRIVING IS OPAQUE; ONLY THE RETURN FADES ──────────────────────
    //
    // The arrival used to ramp 0.4 -> 1, because at a third of the journey the
    // movement was too small to read on its own and the fade was carrying it.
    // Playing the whole flip means the movement IS the transition, and a fade
    // on top of it would be the one thing that stops it reading as a single
    // object: a solid poster that grows is a shared element, the same poster
    // arriving translucent is a cross-fade that happens to move.
    //
    // The RETURN still fades out. It ends on a card in a list that may have
    // re-rendered or scrolled, and the uniform scale leaves the height about a
    // third out at that end, so it must not have to land pixel-perfect on
    // something the reader can compare it against.
    const animation = node.animate(
      [
        { transform: start, opacity: 1 },
        { transform: end, opacity: direction === 'in' ? 1 : 0 },
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
        // change at the handover. The deck's poster is full-bleed and square
        // now — rounded corners on a full-width image anchored to the top of
        // the screen are two wedges of background in the display's corners —
        // so this is square too. It is the DESTINATION's shape that matters:
        // the clone is positioned at the hero's box and ends at identity, so
        // any radius the card had is what the flight is travelling away from.
        borderRadius: 0,
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
