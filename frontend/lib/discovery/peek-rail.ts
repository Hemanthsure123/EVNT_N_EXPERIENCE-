'use client';

import * as React from 'react';

/**
 * THE PEEKING RAIL — one motion and one set of rules, shared by every rail.
 *
 * The home page's "Featured events" carousel established the look: a snapped
 * horizontal scroller where the item nearest the CENTRE is scaled up, lifted,
 * fully opaque and elevated, and its neighbours sit back slightly dimmed and
 * peeking in from both edges. The event page's lineup rail ("Who's taking the
 * stage") uses the identical thing.
 *
 * ── WHY IT IS A MODULE AND NOT A SECOND COPY ──────────────────────────────
 *
 * Two hand-written copies of a transition are two things that drift: somebody
 * tunes the duration on the home page, the lineup keeps the old one, and a
 * product that felt coherent stops. The classes, the layout DECISION and the
 * active-index hook live here so both rails are literally the same behaviour
 * rather than two implementations that currently agree.
 *
 * Sizes deliberately do NOT live here. A poster is 68vw and a face is a third
 * of that; the motion is what is shared, and folding the geometry in would make
 * this a component pretending to be a constant.
 */

/**
 * ── THE LAYOUT IS A FUNCTION OF HOW MANY THERE ARE ────────────────────────
 *
 * A centred carousel needs something either side of the middle to be a
 * carousel. With one item there is no centre to be in — the item simply sits in
 * the middle of the screen with a void each side, which reads as a layout bug.
 * With two, centring the first leaves the second half off screen and the rail
 * opens looking broken.
 *
 * So three is the floor, and below it the rail is an ordinary left-aligned row
 * that starts at the container's gutter like every other list on the site.
 */
export const CENTRED_RAIL_MIN_ITEMS = 3;

export type RailMode = 'centred' | 'start';

export const railModeFor = (count: number): RailMode =>
  count >= CENTRED_RAIL_MIN_ITEMS ? 'centred' : 'start';

/**
 * The side padding a CENTRED rail needs, as a vw string.
 *
 * `(100 - itemWidthVw) / 2` either side, so the FIRST and LAST items can reach
 * the centre exactly like every other one. Both numbers are the same unit on
 * purpose: a vw padding against a px-capped item stops agreeing as the phone
 * widens, which put card one about 12px left of centre at 390px and 27px off on
 * a Pro Max the last time they disagreed.
 */
export const centredRailPadding = (itemWidthVw: number): string =>
  `${(100 - itemWidthVw) / 2}vw`;

/**
 * The scroll track.
 *
 * `py-6`, and it belongs to the MOTION rather than to the layout: the active
 * item is scaled 5% and lifted 6px — roughly 9px of ink above its own box — and
 * `overflow-x-auto` clips vertically as well as horizontally, so a tighter
 * track cuts the shadow off and the elevation reads flatter than it is drawn.
 *
 * `relative`, because `useSnapRail` compares each child's `offsetLeft` against
 * this element's `scrollLeft`. `offsetLeft` is measured from the nearest
 * POSITIONED ancestor, so without it the two are in different coordinate spaces
 * and the active item is only correct by the accident of the rail sitting at
 * page-x 0.
 *
 * `snap-x snap-mandatory`: native CSS snapping, so the rail is draggable,
 * swipeable, keyboard-scrollable and works with a trackpad without a line of
 * JavaScript doing the moving.
 *
 * ── `touch-pan-x`, AND IT IS NOT `pan-y` ──────────────────────────────────
 *
 * The complaint was that casual VERTICAL scrolling over one of these rails
 * dragged it sideways to the next event. The instinct is `touch-action:
 * pan-y`, and it would be exactly wrong: `pan-y` declares that this element
 * handles only VERTICAL panning, which on a horizontally scrolling rail means
 * it can no longer be scrolled at all.
 *
 * `pan-x` is the one that does what was asked. It tells the browser this
 * element handles horizontal panning and NOTHING else, so a gesture with any
 * meaningful vertical component is passed straight to the ancestor scroller
 * rather than being arbitrated against the rail. Sideways still works, and it
 * now takes a deliberately sideways movement.
 */
export const PEEK_RAIL_TRACK =
  'relative flex snap-x snap-mandatory items-center overflow-x-auto scroll-smooth py-6 ' +
  'touch-pan-x ' +
  'scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** Centred: every item can reach the middle. Start: an ordinary row. */
export const railAlignment = (mode: RailMode): string =>
  mode === 'centred' ? 'justify-start' : 'justify-start';

/**
 * Every item, active or not.
 *
 * The snap alignment follows the MODE: `center` for a carousel, `start` for a
 * row, because a left-aligned rail that snapped its items to the middle would
 * scroll the first one away from the gutter it is supposed to line up with.
 *
 * The `motion-reduce` pair is not optional decoration: these are the largest
 * moving elements on their screens, and every other animated surface in this
 * repo carries the same guard.
 */
export const peekRailItem = (mode: RailMode): string =>
  cnJoin(
    'shrink-0 transition-all duration-300 ease-out',
    'motion-reduce:transition-none motion-reduce:transform-none',
    mode === 'centred' ? 'snap-center' : 'snap-start',
  );

/** Kept for callers that do not vary by mode. */
export const PEEK_RAIL_ITEM = peekRailItem('centred');

/**
 * The prominence itself — position, scale and opacity, the way a deck of cards
 * says which one is on top.
 *
 * NO RING, and that is a rule rather than an omission. The featured rail
 * carried `ring-2 ring-primary/40` once, which drew an outline around the
 * centre card so it read as a UI component in a SELECTED state rather than as
 * a thing you are looking at. An outline is the language of a control you have
 * focused; the focus ring still exists, on the button itself, where it belongs.
 *
 * In `start` mode nothing is emphasised at all. One or two items are both fully
 * on screen, and scaling one of them down is emphasis with nothing behind it.
 */
export const peekRailItemState = (isActive: boolean, mode: RailMode = 'centred'): string => {
  if (mode === 'start') return 'scale-100 opacity-100';
  return isActive
    ? 'scale-110 -translate-y-1.5 opacity-100 z-10'
    : 'scale-95 translate-y-1 opacity-75 z-0';
};

/** The elevation, on the item's own surface so the shadow follows its shape. */
export const PEEK_RAIL_SURFACE = 'transition-shadow duration-300 motion-reduce:transition-none';

export const peekRailSurfaceState = (isActive: boolean, mode: RailMode = 'centred'): string => {
  if (mode === 'start') return 'shadow-sm';
  return isActive ? 'shadow-xl' : 'shadow-sm';
};

/** A local join, so this module needs no dependency on the `cn` helper. */
function cnJoin(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type SnapRail<T extends HTMLElement> = {
  /** Attach to the scroll track. */
  ref: React.RefObject<T>;
  /** Index of the item nearest the track's centre, in REAL item terms. */
  activeIndex: number;
  /** Centred carousel, or left-aligned row. */
  mode: RailMode;
  /** Whether wrap-around clones are in play (see `LOOPING`, below). */
  looping: boolean;
  /**
   * Whether the track actually overflows.
   *
   * A rail whose items all fit has no centre to be nearest to — every item is
   * equally on screen. Dimming four of five avatars that are all fully visible
   * is emphasis with nothing behind it, so callers render everything active in
   * that case. It matters because these rails are mounted at desktop widths
   * too, where the phone-first carousel was never tested.
   */
  scrollable: boolean;
};

/**
 * LOOPING — bi-directional, and it is done with edge CLONES.
 *
 * A native snap rail cannot wrap on its own: `scrollLeft` is bounded by the
 * content, so scrolling left from the first item does nothing at all and the
 * rail reads as jammed rather than as ended.
 *
 * The standard answer, and the one here: render the LAST item before the first
 * and the FIRST item after the last, both `aria-hidden`. Scrolling past either
 * end therefore lands on a real-looking picture, and once the scroll has
 * SETTLED there the rail jumps — instantly, with snapping momentarily off — to
 * the genuine copy at the other end. The jump happens at a rest point and moves
 * the content by exactly one loop's width, so there is nothing on screen to see
 * it by.
 *
 * It is enabled only for a CENTRED rail. Two items with two clones is four
 * things where the reader can see three of them, and the wrap becomes visible.
 */
export type LoopedIndex = {
  /** How many DOM children the caller should render, clones included. */
  domCount: number;
  /** Which real item a DOM position shows. */
  realFor: (domIndex: number) => number;
};

export function loopedIndex(count: number, looping: boolean): LoopedIndex {
  if (!looping || count === 0) {
    return { domCount: count, realFor: (domIndex) => domIndex };
  }
  return {
    domCount: count + 2,
    // 0 is a clone of the last, `count + 1` a clone of the first.
    realFor: (domIndex) => (domIndex - 1 + count) % count,
  };
}

/** How long the rail must be still before a wrap is considered safe. */
const SETTLE_MS = 120;

export function useSnapRail<T extends HTMLElement>(
  count: number,
  options: { loop?: boolean } = {},
): SnapRail<T> {
  const ref = React.useRef<T>(null);
  const mode = railModeFor(count);
  const looping = Boolean(options.loop) && mode === 'centred' && count >= CENTRED_RAIL_MIN_ITEMS;

  const [activeIndex, setActiveIndex] = React.useState(0);
  // ── STARTS TRUE, AND THAT IS ABOUT THE FIRST PAINT ────────────────────
  //
  // Overflow can only be MEASURED, so the server and the first client frame
  // have to guess. Guessing `false` renders every item active — full scale,
  // full elevation — and the measure one frame later then animates the rest
  // back down over 300ms, on the mobile home page's first screen. Guessing
  // `true` renders exactly what the rail rendered before this hook existed.
  const [scrollable, setScrollable] = React.useState(true);
  const settleRef = React.useRef<number | null>(null);

  /** Where `scrollLeft` has to be for this child to sit in the middle. */
  const centreOf = React.useCallback((el: T, child: HTMLElement) => {
    return child.offsetLeft + child.clientWidth / 2 - el.clientWidth / 2;
  }, []);

  const nearest = React.useCallback((el: T): number => {
    const children = Array.from(el.children) as HTMLElement[];
    if (children.length === 0) return 0;
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
    return closest;
  }, []);

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;

    // A 1px tolerance: sub-pixel layout makes `scrollWidth` exceed
    // `clientWidth` by a fraction on tracks that do not actually scroll.
    setScrollable(el.scrollWidth - el.clientWidth > 1);

    const domIndex = nearest(el);
    const { realFor } = loopedIndex(count, looping);
    setActiveIndex(count === 0 ? 0 : realFor(domIndex));

    if (!looping) return;

    // ── THE WRAP, ONCE THE RAIL HAS COME TO REST ──────────────────────
    //
    // Debounced rather than immediate: jumping while the finger is still on
    // the glass fights the gesture, and jumping mid-momentum cancels it.
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      const node = ref.current;
      if (!node) return;
      const children = Array.from(node.children) as HTMLElement[];
      const landed = nearest(node);
      // Only the two clones need correcting.
      const target = landed === 0 ? count : landed === count + 1 ? 1 : null;
      if (target === null) return;
      const child = children[target];
      if (!child) return;
      // `snapType` off for the write, or the browser re-snaps the jump back to
      // where it came from and the rail appears to refuse to wrap.
      const previous = node.style.scrollSnapType;
      const behaviour = node.style.scrollBehavior;
      node.style.scrollSnapType = 'none';
      node.style.scrollBehavior = 'auto';
      node.scrollLeft = centreOf(node, child);
      // Restored on the next frame: doing it synchronously lets the browser
      // coalesce the two writes and snap anyway.
      requestAnimationFrame(() => {
        node.style.scrollSnapType = previous;
        node.style.scrollBehavior = behaviour;
      });
    }, SETTLE_MS);
  }, [centreOf, count, looping, nearest]);

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
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    };
    // `count` re-runs the initial measure when the rail's contents change,
    // which is what makes `scrollable` correct after data arrives rather than
    // only on the first paint.
  }, [measure, count]);

  /**
   * A looping rail OPENS on the first real item, not on the clone before it.
   *
   * A layout effect, so it is positioned before the browser paints — as a
   * passive one the rail's first painted frame is the trailing clone, which is
   * the last event in the list appearing where the first one belongs.
   */
  React.useLayoutEffect(() => {
    if (!looping) return;
    const el = ref.current;
    if (!el) return;
    const child = (Array.from(el.children) as HTMLElement[])[1];
    if (!child) return;
    const behaviour = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = centreOf(el, child);
    el.style.scrollBehavior = behaviour;
  }, [centreOf, looping, count]);

  return { ref, activeIndex, mode, looping, scrollable };
}
