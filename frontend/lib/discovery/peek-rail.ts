'use client';

import * as React from 'react';

/**
 * THE PEEKING RAIL — one motion, shared by every rail that uses it.
 *
 * The home page's "Featured events" carousel established this: a snapped
 * horizontal scroller where the card nearest the CENTRE is scaled up, lifted,
 * fully opaque and elevated, and its neighbours sit back slightly dimmed. It
 * is the platform's house gesture for "a row of things, one of which you are
 * looking at".
 *
 * ── WHY IT IS A MODULE AND NOT A SECOND COPY ──────────────────────────────
 *
 * The lineup rail ("Who's taking the stage") now uses the same motion. Two
 * hand-written copies of a transition are two things that drift: somebody
 * tunes the duration on the home page, the lineup keeps the old one, and a
 * product that felt coherent stops. The classes and the active-index hook live
 * here so both rails are literally the same behaviour rather than two
 * implementations that currently agree.
 *
 * Sizes deliberately do NOT live here. A poster is 68vw and an avatar is a
 * third of that; the motion is what is shared, and folding the geometry in
 * would make this a component pretending to be a constant.
 */

/**
 * The scroll track.
 *
 * `py-6`, not `py-4`, and it belongs to the MOTION rather than to the layout:
 * the active item is scaled 5% and lifted 6px — roughly 9px of ink above its
 * own box — and `overflow-x-auto` clips vertically as well as horizontally, so
 * a tighter track cuts the shadow off and the elevation reads flatter than it
 * is drawn.
 *
 * `relative`, because `useCenteredIndex` compares each child's `offsetLeft`
 * against this element's `scrollLeft`. `offsetLeft` is measured from the
 * nearest POSITIONED ancestor, so without it the two are in different
 * coordinate spaces and the active item is only correct by the accident of the
 * rail sitting at page-x 0.
 */
export const PEEK_RAIL_TRACK =
  'relative flex snap-x snap-mandatory items-center overflow-x-auto scroll-smooth py-6 ' +
  'scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * Every item, active or not.
 *
 * The `motion-reduce` pair is not optional decoration: these are the largest
 * moving elements on their screens, and every other animated surface in this
 * repo carries the same guard.
 */
export const PEEK_RAIL_ITEM =
  'shrink-0 snap-center transition-all duration-300 ease-out ' +
  'motion-reduce:transition-none motion-reduce:transform-none';

/**
 * The prominence itself — position, scale and opacity, the way a deck of cards
 * says which one is on top.
 *
 * NO RING, and that is a rule rather than an omission. The featured rail
 * carried `ring-2 ring-primary/40` once, which drew an outline around the
 * centre card so it read as a UI component in a SELECTED state rather than as
 * a thing you are looking at. An outline is the language of a control you have
 * focused; the focus ring still exists, on the button itself, where it belongs.
 */
export const peekRailItemState = (isActive: boolean): string =>
  isActive
    ? 'scale-105 -translate-y-1.5 opacity-100 z-10'
    : 'scale-95 translate-y-1 opacity-75 z-0';

/** The elevation, on the item's own surface so the shadow follows its shape. */
export const PEEK_RAIL_SURFACE = 'transition-shadow duration-300 motion-reduce:transition-none';

export const peekRailSurfaceState = (isActive: boolean): string =>
  isActive ? 'shadow-xl' : 'shadow-sm';

export type CenteredRail<T extends HTMLElement> = {
  /** Attach to the scroll track. */
  ref: React.RefObject<T>;
  /** Index of the child nearest the track's centre. */
  activeIndex: number;
  /**
   * Whether the track actually overflows.
   *
   * A rail whose items all fit has no centre to be nearest to — every item is
   * equally on screen. Dimming four of five avatars that are all fully visible
   * is emphasis with nothing behind it, so callers render everything active in
   * that case. It matters because this rail is mounted at desktop widths too,
   * where the featured carousel it borrows from never was.
   */
  scrollable: boolean;
};

/**
 * Which child is nearest the centre of the track.
 *
 * Closest-to-centre from a passive `scroll` listener, NOT an
 * `IntersectionObserver` with a threshold: an observer answers "is this mostly
 * visible", which is a different question and returns true for two neighbours
 * at once on a rail whose items are narrower than half the viewport — so the
 * active index flickers between them. It also cannot answer at all when
 * nothing crosses the threshold, which is every item on a rail of small
 * circles.
 *
 * The listener is `{ passive: true }` and does one read per scroll event with
 * no writes, so it never blocks the gesture.
 */
export function useCenteredIndex<T extends HTMLElement>(itemCount: number): CenteredRail<T> {
  const ref = React.useRef<T>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  // ── STARTS TRUE, AND THAT IS ABOUT THE FIRST PAINT ────────────────────
  //
  // Overflow can only be MEASURED, so the server and the first client frame
  // have to guess. Guessing `false` renders every item active — full scale,
  // full elevation — and the measure one frame later then animates seven
  // cards back down over 300ms, on the mobile home page's first screen.
  //
  // Guessing `true` renders exactly what the rail rendered before this hook
  // existed: item 0 active, the rest sat back. A rail that turns out to fit
  // corrects the other way, which costs one quiet frame on a section below
  // the fold instead of a visible settle on the busiest screen of the site.
  const [scrollable, setScrollable] = React.useState(true);

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;

    // A 1px tolerance: sub-pixel layout makes `scrollWidth` exceed
    // `clientWidth` by a fraction on tracks that do not actually scroll.
    setScrollable(el.scrollWidth - el.clientWidth > 1);

    const children = Array.from(el.children) as HTMLElement[];
    if (children.length === 0) return;

    const centre = el.scrollLeft + el.clientWidth / 2;
    let closest = 0;
    let smallest = Infinity;
    children.forEach((child, index) => {
      const distance = Math.abs(centre - (child.offsetLeft + child.clientWidth / 2));
      if (distance < smallest) {
        smallest = distance;
        closest = index;
      }
    });
    setActiveIndex(closest);
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    // Re-measured on resize as well as on scroll: `scrollable` is a fact about
    // the viewport, and a rail that fits in landscape does not fit in portrait.
    window.addEventListener('resize', measure);
    measure();
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
    // `itemCount` re-runs the initial measure when the rail's contents change,
    // which is what makes `scrollable` correct after data arrives rather than
    // only on the first paint.
  }, [measure, itemCount]);

  return { ref, activeIndex, scrollable };
}
