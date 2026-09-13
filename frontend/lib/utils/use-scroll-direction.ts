'use client';

import * as React from 'react';

/**
 * WHICH WAY THE PAGE IS MOVING — for chrome that gets out of the way.
 *
 * ── WHAT IT RETURNS, AND WHY IT IS NOT JUST 'up' | 'down' ────────────────
 *
 * `'up' | 'down' | null`, where `null` means "nothing has been decided yet".
 * A bar that hides on `'down'` and shows on `'up'` needs a third answer for
 * the first render, before anybody has scrolled: forcing one of the two there
 * makes the caller pick a default, and both defaults are wrong — `'down'`
 * hides the navigation on arrival, `'up'` is a claim about a gesture that has
 * not happened.
 *
 * ── THE THRESHOLD IS THE WHOLE HOOK ──────────────────────────────────────
 *
 * Without one, a bar wired to this FLICKERS. Momentum scrolling on iOS and a
 * trackpad's rubber-band both emit a handful of one- and two-pixel events in
 * the opposite direction as they settle, and each one is a direction change to
 * a naive implementation — which is a 320ms slide, cancelled, and started
 * again. `THRESHOLD` is the distance a real gesture covers and a settle does
 * not.
 *
 * ── AND IT REFUSES TO DECIDE NEAR THE TOP ────────────────────────────────
 *
 * Within `TOP_ZONE` of the top it always answers `'up'`. Two reasons: a
 * browser's overscroll bounce at position 0 reports downward movement that the
 * reader did not make, and a page that has just been navigated to should not
 * open with its navigation hidden because the restore jumped the scroll.
 *
 * ── PASSIVE, AND MEASURED IN A FRAME ─────────────────────────────────────
 *
 * The listener is `{ passive: true }` — it never calls `preventDefault`, and
 * saying so is what lets the browser scroll without waiting to find out. The
 * comparison itself is deferred to a `requestAnimationFrame`, so a flick that
 * fires forty scroll events in a frame does one comparison rather than forty,
 * and `scrollY` is read at most once per painted frame instead of forcing a
 * layout read per event.
 */

/** How far the page must move in one direction before it counts as a gesture. */
const THRESHOLD = 8;

/** Inside this much of the top, the answer is always `'up'`. */
const TOP_ZONE = 64;

export type ScrollDirection = 'up' | 'down' | null;

export function useScrollDirection(): ScrollDirection {
  const [direction, setDirection] = React.useState<ScrollDirection>(null);

  React.useEffect(() => {
    // `let`, not state: this is the PREVIOUS offset, read and written inside a
    // rAF callback. Putting it in state would re-render on every frame of a
    // scroll to store a number nothing renders.
    let last = window.scrollY;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const current = window.scrollY;

      if (current <= TOP_ZONE) {
        last = current;
        setDirection('up');
        return;
      }

      if (Math.abs(current - last) < THRESHOLD) return;

      setDirection(current > last ? 'down' : 'up');
      last = current;
    };

    const onScroll = () => {
      // One comparison per painted frame, however many events arrive.
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return direction;
}
