'use client';

/**
 * Freeze the page behind an overlay, and put the reader back exactly where they
 * were when it closes.
 *
 * ── WHY `overflow: hidden` ALONE IS NOT ENOUGH ────────────────────────────
 *
 * On iOS Safari `overflow: hidden` on `body` does not stop touch scrolling —
 * the page keeps moving under the sheet, which is the exact complaint this
 * exists to fix. The reliable technique is to take the body out of flow with
 * `position: fixed` and offset it by the current scroll position, so the page
 * stays visually where it was while being physically unscrollable.
 *
 * ── WHICH MEANS THE SCROLL POSITION MUST BE RESTORED BY HAND ──────────────
 *
 * `position: fixed` resets the document's scroll to 0. If you only undo the
 * style on close, the reader is thrown back to the top of a feed they had
 * scrolled a long way down — which is worse than the bug being fixed, because
 * it loses their place silently every single time. So the offset is captured on
 * lock and `window.scrollTo` restores it on release.
 *
 * `scrollRestoration` is set to manual for the duration so the browser's own
 * restore cannot fight ours on a back-navigation.
 *
 * Nested locks are counted rather than stacked: a sub-sheet opening over the
 * widget must not unlock the page when IT closes. Only the outermost release
 * restores the scroll position.
 */

import * as React from 'react';

let lockCount = 0;
let restoreScrollY = 0;
let restore: (() => void) | null = null;

function lock(): void {
  lockCount += 1;
  if (lockCount > 1) return;

  const { body } = document;
  const scrollY = window.scrollY;
  restoreScrollY = scrollY;

  const previous = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
    // Kept because some browsers apply their own restoration on history moves.
    scrollRestoration: history.scrollRestoration,
  };

  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  try {
    history.scrollRestoration = 'manual';
  } catch {
    // Not settable in every context; the styles above still do the work.
  }

  restore = () => {
    body.style.position = previous.position;
    body.style.top = previous.top;
    body.style.left = previous.left;
    body.style.right = previous.right;
    body.style.width = previous.width;
    body.style.overflow = previous.overflow;
    try {
      history.scrollRestoration = previous.scrollRestoration;
    } catch {
      // As above.
    }
    // Instant, not smooth: this is a restoration, not a navigation, and an
    // animated scroll here reads as the page jumping on its own.
    window.scrollTo(0, restoreScrollY);
  };
}

function release(): void {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0) return;
  restore?.();
  restore = null;
}

/**
 * @param active Lock while true, release when it goes false or the component
 *   unmounts. Safe to mount many of these — the count is shared.
 */
export function useScrollLock(active: boolean): void {
  React.useEffect(() => {
    if (!active) return;
    lock();
    return release;
  }, [active]);
}
