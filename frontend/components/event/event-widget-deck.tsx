'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Ticket } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEventDeck } from '@/lib/discovery/event-deck-context';
import { useEventWidgetData } from '@/lib/discovery/use-event-widget-data';
import { useScrollLock } from '@/lib/discovery/use-scroll-lock';
import {
  EXPANDED_CARD_FRACTION,
  EXPANDED_SNAP_INDEX,
  INITIAL_SNAP_INDEX,
  POSTER_FRACTION,
  resolveSnap,
  snapPixels,
} from '@/lib/discovery/sheet-snap';
import { formatEventDate, formatEventTime, formatFromPrice } from '@/lib/discovery/format';
import type { EventCard as EventCardData } from '@/lib/api/types';
import {
  DECK_POSTER_ATTR,
  installPosterOriginTracker,
  isUsableSource,
  readCardPoster,
  readDeckPoster,
  type Box,
} from '@/lib/discovery/shared-poster';
import { cn } from '@/lib/utils/cn';
import { EventSubSheets, type SubSheetType } from './event-sub-sheets';
import { EventWidgetContent } from './event-widget-content';
import { SharedPoster } from './shared-poster';

/**
 * The mobile event widget — and on a phone, this IS the event page.
 *
 * ── ONE SURFACE, NOT A DOORWAY TO ANOTHER ─────────────────────────────────
 *
 * Tapping a card opens this; "Book tickets" goes straight to the ticket
 * screen. The standalone `/events/{slug}-{id}` page is never involved on the
 * phone path, because routing through it would put a second, duplicate
 * event-detail experience in the middle of the one this exists to BE — and
 * discard the active event, the drag position and the feed's scroll offset on
 * the way through.
 *
 * ── A DECK, NOT A MODAL ───────────────────────────────────────────────────
 *
 * The events sit in one horizontal TRACK, and the widget shows a slice of it:
 * the active event centred with its neighbours peeking at both edges. That
 * peek is the entire affordance — a panel that fills the screen edge to edge
 * looks like a modal, and nobody swipes a modal. Two real neighbouring
 * posters, six percent of the screen each, say "there are more of these and
 * they move sideways" without a single instruction.
 *
 * The track is positioned by ARITHMETIC, not by CSS scroll-snap: the offset is
 * `-index * (cardWidth + gap)`, both measured in pixels from the live
 * viewport. A scroll container would fight the vertical drag for the same
 * gesture, and its position would be a scroll offset that no spring can
 * animate alongside the sheet's own.
 *
 * ── TWO DRAGGABLES, ONE GESTURE ───────────────────────────────────────────
 *
 * BOTH AXES ARE DRIVEN BY HAND. A single commit function watches the first
 * few pixels of movement and hands the gesture to exactly one of them:
 *
 *   mostly horizontal          -> the track   (previous / next event)
 *   downward, content at top   -> the sheet   (collapse, then dismiss)
 *   upward, content at top,
 *     and not yet full screen  -> the sheet   (expand)
 *   anything else              -> neither; the browser scrolls the content
 *
 * That is why a horizontal swipe still changes events at FULL SCREEN, which
 * the alternative — one draggable with `dragDirectionLock` — could not do
 * without also letting the sheet slide sideways. The axis decision never
 * consults the snap state; only the vertical rules do.
 *
 * The track is moved by writing `transform` on the element directly rather
 * than through a framer motion value, for two reasons. Framer was silently
 * re-setting that value after the effect that positioned it — the track landed
 * on a different, non-integer offset on every run, so the active card was never
 * quite centred and the peek was lopsided. And a hand-written transform costs
 * no React render per frame: the move handler writes one string, and the
 * settle is a CSS transition rather than a spring driven from JavaScript.
 *
 * The VERTICAL axis is hand-driven for a different reason. It used framer's
 * `dragControls`, which has to be handed a live pointer event to start — fine
 * from the handle, where the gesture begins on `pointerdown`, and unreliable
 * from the content, where it can only be started once a few pixels of movement
 * have proved the gesture is a drag rather than a scroll. Under real touch
 * that second case simply did not start: dragging DOWN from the content to
 * collapse the sheet did nothing at all, while the same gesture on the handle
 * worked, which is the most confusing possible half-working state.
 *
 * One implementation, window listeners for both, and the two axes now behave
 * identically wherever the finger lands.
 *
 * ── THE DRAG IS A REAL DRAG ───────────────────────────────────────────────
 *
 * Both axes move motion values directly, so each surface tracks the finger
 * pixel for pixel and STAYS where it is let go, then springs to a resting
 * position. `resolveSnap` (a pure, tested module) picks the vertical one,
 * projecting the release position along the release velocity so a flick
 * carries instead of springing back under the thumb that threw it; the
 * horizontal release is projected the same way to pick the landing card.
 *
 * The predecessor animated between two CSS classes on a 300ms transition: the
 * sheet ignored the gesture entirely, jumped when the finger lifted, and could
 * not rest anywhere in between.
 *
 * ── THE PAGE BEHIND IT DOES NOT MOVE ──────────────────────────────────────
 *
 * `useScrollLock` pins the body while this is open and restores the exact feed
 * position on close. `overscroll-contain` on the content stops a fling at
 * either end chaining into whatever is underneath.
 *
 * ── IT FOLLOWS THE THEME; IT USED TO BE ALWAYS DARK ───────────────────────
 *
 * A literal `dark` class sat on every card in the track, re-pointing the design
 * tokens for the whole subtree. It was there for a good reason — it is what
 * lets the widget reuse the page's own sections (the fact grid, the countdown,
 * the lightbox, the FAQ accordion, the policy lists) instead of forking a dark
 * copy of each — but the effect was that a visitor who had chosen the light
 * theme got a black event page and nothing else on the site behaved that way.
 *
 * The reuse argument survives without the override: those sections are built
 * from the same tokens, so they render correctly in whichever theme is active.
 * What the override was really protecting was the SCRIM — a dark sheet over a
 * dark backdrop needs no separation. In light theme the card is white on a
 * dimmed page instead, which is what every other sheet in the product does.
 */

/**
 * ── ONE CLOCK FOR THE WHOLE ARRIVAL, AND IT USED TO BE TWO ────────────────
 *
 * Opening the deck moves three things: the poster clone flying from the card,
 * the sheet rising under it, and the scrim taking the feed away behind both.
 * They were driven by two different kinds of animation — the poster and the
 * scrim by a `220ms` cubic-bezier, the sheet by this spring — and a spring at
 * `stiffness 340 / damping 36 / mass 0.9` needs the better part of half a
 * second to visually settle a 300px displacement.
 *
 * So the picture landed, and THEN the panel finished climbing. Nothing was
 * dropping frames; the two halves of one movement were simply running on two
 * clocks, which is exactly what "the poster expands first and then the sheet
 * slides up" describes. Nobody perceives that as two animations — they
 * perceive it as one slow one.
 *
 * Everything that moves during an open or a close now shares this duration
 * and `TRANSITION_EASE` — same numbers, one curve, started in the same frame.
 * The spring is gone entirely, including from the release of a drag: the
 * brief asks for one timing configuration shared by the image and the panel,
 * and a CSS transition cannot be a spring. What a flick still decides is
 * WHERE the sheet lands (`resolveSnap` projects along the release velocity to
 * pick the snap); what it no longer decides is the shape of the last 200ms.
 */
const FLIGHT_MS = 220;
/**
 * ── AND ONE DRIVER, WHICH IS THE OTHER HALF OF IT ─────────────────────────
 *
 * Sharing a duration is not enough if the two halves are driven by different
 * machinery. The poster clone is a Web Animations API animation, so it runs on
 * the COMPOSITOR: once started it is immune to whatever the main thread is
 * doing. The sheet was `animate(y, ...)` on a framer motion value, which is a
 * requestAnimationFrame tween on the MAIN thread — and framer only hands a
 * value to the compositor when it is a named CSS property on an element it
 * owns, which a standalone `y` value is not.
 *
 * Opening this deck is the busiest moment the main thread ever has: a fetch is
 * dispatched, and a whole event page renders. Measured in a real browser, the
 * sheet's tween got ONE frame in its entire 220ms — it jumped from its start
 * to its end in a single step while the clone above it animated perfectly
 * smoothly, because only one of them needed the main thread. That is not a
 * timing bug and no amount of matching durations fixes it.
 *
 * So the sheet is driven exactly the way the horizontal track already is (see
 * `applyTrack`): a `transform` written straight onto the node with a CSS
 * transition to settle it. Compositor-driven, no React render per frame, and
 * no motion value to be starved. `y` is gone as a motion value entirely —
 * `sheetYRef` is the commanded position and `readSheetY` reads the live
 * interpolated one, which is the same pair `readTrackX` already uses.
 *
 * One consequence worth stating: the release of a DRAG used to settle on a
 * spring. A CSS transition cannot be a spring, and the brief asks for the
 * image and the panel to share one timing configuration, so there is now
 * exactly one curve and one duration for every vertical movement. The
 * velocity a finger imparts is still honoured — `resolveSnap` projects along
 * it to choose WHERE to land; what it no longer does is colour how the sheet
 * gets there.
 */
/**
 * The one curve. Typed as a mutable tuple because that is what framer's
 * `ease` accepts, and shared by every open/close animation, the track's CSS
 * settle and the scrim — a second copy of these four numbers is how two halves
 * of one movement come to disagree.
 */
const TRANSITION_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
/**
 * The same curve and duration, in the shape framer wants, for the scrim.
 *
 * The scrim is the one thing here still animated by framer, and legitimately:
 * it animates OPACITY, which framer does hand to the compositor (`opacity` is
 * on its accelerated list where a standalone `y` value is not). So it is on
 * the same clock AND the same thread as everything else.
 */
const PAGE_TRANSITION = { duration: FLIGHT_MS / 1000, ease: TRANSITION_EASE };
/** How long the track takes to settle onto a page after a release. */
const SETTLE_MS = 340;
const SETTLE_EASE = `cubic-bezier(${TRANSITION_EASE.join(', ')})`;

/** How far a gesture must travel before it is allowed to commit to an axis. */
const COMMIT_SLOP = 10;
/**
 * How much longer the horizontal component must be before a gesture is read as
 * a swipe rather than a drag. See the commit rule.
 */
const AXIS_DOMINANCE = 1.2;
/**
 * The same, for a gesture that began on the overlay rather than the content.
 * Smaller, because there is no scroller under the finger whose scroll it
 * might be stealing — the only thing to protect against is a tap, and a tap
 * does not travel eight pixels.
 */
const OVERLAY_SLOP = 8;
/**
 * The gap between pages in the track, in px.
 *
 * Zero, because the pages are the full width of the viewport and a gap would
 * be a black seam sliding through the middle of a swipe. It stays a named
 * constant rather than being deleted: `stride` is `cardWidth + gap`, and a
 * pager that has quietly stopped accounting for a gap is a pager that
 * mis-centres the moment anybody wants one back.
 */
const CARD_GAP = 0;
/**
 * How far a horizontal drag must go, as a share of one card stride, before a
 * release ADVANCES rather than springs back — when there is no flick to carry it.
 *
 * It was implicitly HALF a stride, because the rule was `Math.round(-x / stride)`:
 * a slow drag had to cross ~176px of a 390px screen to change card, while the
 * vertical axis on the same surface commits at a fraction of that. A quarter
 * reads as "I clearly meant it" without making a hesitant drag jump.
 */
const ADVANCE_FRACTION = 0.25;
/** A flick faster than this advances even if the finger barely moved. px/s. */
const ADVANCE_VELOCITY = 350;
/**
 * A velocity sample older than this is treated as ZERO.
 *
 * Velocity was a single instantaneous reading from the last `pointermove`. If
 * the finger paused for 300ms before lifting, no move fired, the stale reading
 * from before the pause survived, and the deck advanced on a gesture that had
 * visibly stopped. The vertical axis had the identical defect. A finger that
 * has been still for more than a few frames has no velocity, whatever the last
 * event said.
 */
const VELOCITY_STALE_MS = 90;

/** The release velocity, unless the finger had already come to rest. */
function liveVelocity(velocity: number, lastAt: number, now: number): number {
  return now - lastAt > VELOCITY_STALE_MS ? 0 : velocity;
}

export function EventWidgetDeck() {
  const { isOpen, events, currentIndex, closeDeck, setCurrentIndex, openOptions } = useEventDeck();
  const router = useRouter();
  const pathname = usePathname();
  // Mirrors, so callbacks read the latest values without re-binding on every
  // render — the gesture handlers are captured by window listeners for the
  // life of a drag and must not go stale mid-gesture.
  const openOptionsRef = React.useRef(openOptions);
  openOptionsRef.current = openOptions;
  const isOpenRef = React.useRef(isOpen);
  isOpenRef.current = isOpen;
  /** Set once a FEED open has pushed a history entry, so back can close it. */
  const pushedHistoryRef = React.useRef(false);
  /** The URL the deck was opened on, so a route-origin close knows it has left. */
  const openedPathRef = React.useRef<string | null>(null);
  const reduceMotion = useReducedMotion();

  const currentEvent = events[currentIndex] ?? events[0] ?? null;
  /**
   * The current event, readable without becoming a dependency.
   *
   * The enter effect must not list `currentIndex` — re-running it on a swipe
   * would drop the sheet back to its entry height mid-read, which is why that
   * effect already carries an eslint-disable saying so. A ref lets it read the
   * event it is opening on without joining that argument.
   */
  const currentEventRef = React.useRef(currentEvent);
  currentEventRef.current = currentEvent;

  // Every hook runs on every render, open or closed — the early return is at
  // the bottom. `null` tells the data hook to fetch nothing.
  const { detail, content, tiers } = useEventWidgetData(
    isOpen && currentEvent ? currentEvent.id : null,
  );
  useScrollLock(isOpen);

  // Records which card was last pressed, so the RETURN flies back to the one
  // the reader actually touched rather than to whichever copy of that event
  // happens to come first in the document. Installed from here because the
  // deck is mounted for the life of the site shell, so it is installed exactly
  // once and is listening before any card can be pressed.
  React.useEffect(() => installPosterOriginTracker(), []);

  const [activeSubSheet, setActiveSubSheet] = React.useState<SubSheetType>(null);
  /** True from the moment a close is committed, so the scrim can leave with
   *  the sheet — and so nothing can half-rescue a close already in flight. */
  const [leaving, setLeaving] = React.useState(false);
  const closingRef = React.useRef(false);
  const [snapIndex, setSnapIndex] = React.useState(INITIAL_SNAP_INDEX);
  /**
   * The snap the sheet is on, readable from imperative code — and written
   * BEFORE the state, never from the render.
   *
   * It was `snapIndexRef.current = snapIndex` on every render, which is a
   * frame behind by construction: a layout effect that calls `setSnapIndex`
   * and a layout effect that READS the snap can land in the same commit, and
   * the second one then acts on the value the first one just replaced. That
   * is what sent every shared link to the resting stop instead of the
   * maximized one — the placement effect chose EXPANDED, the re-placement
   * effect ran in the same commit, read the stale INITIAL, and wrote it.
   *
   * So `applySnapIndex` is the only writer and it updates the ref first.
   */
  const snapIndexRef = React.useRef(INITIAL_SNAP_INDEX);
  const applySnapIndex = React.useCallback((index: number) => {
    snapIndexRef.current = index;
    setSnapIndex(index);
  }, []);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [ctaHeight, setCtaHeight] = React.useState(0);

  /**
   * The sheet's COMMANDED translate, in px from the top of the viewport.
   *
   * A ref and not a motion value: the sheet is driven by a transform written
   * straight onto the node with a CSS transition, exactly as the horizontal
   * track is, so nothing needs to re-render or tick when it moves. See the
   * note on `FLIGHT_MS` for why the motion value had to go.
   *
   * While a transition is running this is the DESTINATION; `readSheetY` reads
   * the interpolated position, which is the only place the live value exists.
   */
  const sheetYRef = React.useRef(0);
  /**
   * The gesture in progress. `origin` is where the finger LANDED — on the
   * scrolling content, or on the overlay (poster, scrim, empty space) — and it
   * is what lets one commit rule serve both: the content path has a scroller
   * under the finger that may want the vertical movement, the overlay path
   * never does. `pointerId` stops a second finger, or a descendant that has
   * already claimed this one, from arming the same gesture twice.
   */
  const gestureRef = React.useRef<{
    x: number;
    y: number;
    committed: boolean;
    origin: 'content' | 'overlay';
    pointerId: number;
  }>({ x: 0, y: 0, committed: false, origin: 'content', pointerId: -1 });
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const ctaRef = React.useRef<HTMLDivElement>(null);
  /** True when the gesture that just ended actually moved the sheet, so the
   *  click a drag emits on release does not ALSO step a snap. */
  const draggedRef = React.useRef(false);
  const trackRef = React.useRef<HTMLDivElement>(null);
  /** The anchored poster layer behind the sheet — see `applyTrack`. */
  const posterTrackRef = React.useRef<HTMLDivElement>(null);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  /** True for the first positioning pass of an open, so the deck does not
   *  slide sideways into place while it is sliding up. */
  const justOpenedRef = React.useRef(true);
  /** True once this open has been placed and its entrance played — see the
   *  entrance layout effect for why a resize must not replay it. */
  const enteredRef = React.useRef(false);
  /** The live horizontal drag, or null. A ref, so moving costs no render. */
  const swipeRef = React.useRef<{
    startX: number;
    base: number;
    lastX: number;
    lastAt: number;
    velocity: number;
  } | null>(null);

  // Measured, never assumed: a phone's viewport changes under the sheet when
  // the URL bar collapses or it is rotated, and a deck pinned to a stale pixel
  // value ends up mis-centred or clipped.
  React.useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const isExpanded = snapIndex === EXPANDED_SNAP_INDEX;
  const snaps = React.useMemo(() => snapPixels(viewport.height), [viewport.height]);
  /**
   * ── ONE WIDTH, AT EVERY SNAP ───────────────────────────────────────────
   *
   * This was `0.88` inset and `0.96` expanded, so the event somebody opened
   * was never the whole screen and, worse, CHANGED WIDTH when the sheet was
   * expanded. That second half is the "layout jumping on the first swipe":
   * a drag upward ends in `snapTo`, `isExpanded` flips, the stride is
   * remeasured, and the centring effect slides the entire track sideways
   * under a finger that only ever moved vertically. Two animations the reader
   * did not ask for, arriving one frame after the one they did.
   *
   * A page is the viewport, at every stop, with no gap. The stride is
   * therefore a constant for the life of an open, so expanding is purely a
   * vertical movement and the horizontal track never has to be re-derived.
   */
  const cardWidth = Math.round(viewport.width * EXPANDED_CARD_FRACTION);
  const gap = CARD_GAP;
  const stride = cardWidth + gap;
  const railPadding = 0;
  /**
   * How much of the page hangs below the bottom of the screen at this snap.
   *
   * The page is a constant `100dvh` inside a sheet translated down by `y`, so
   * its last `y` pixels are off screen. The content's bottom padding has to
   * clear them as well as the CTA bar, or the final section stops exactly at
   * the screen edge and reads as truncated.
   *
   * Deliberately taken from the SNAP and not from the live `y`: a padding that
   * tracked the drag would be a layout write per frame, which is the whole
   * thing this component just stopped doing. It is only ever consulted at the
   * very end of a long scroll, and it is correct again the moment the sheet
   * comes to rest.
   */
  const bottomInset = snaps[snapIndex] ?? 0;
  const restingX = React.useCallback((index: number) => -index * stride, [stride]);

  /**
   * ── THE CTA IS PULLED BACK ONTO THE SCREEN; THE CARD IS NOT RESIZED ────
   *
   * The sheet is a full-viewport element translated DOWN by `y`, so its bottom
   * edge sits `y` pixels past the bottom of the screen and the sticky "Book
   * tickets" bar anchored to it went with it — at the resting snap the primary
   * call to action was over a hundred pixels below the visible area.
   *
   * The fix for that was to publish `y` as a CSS variable and give the card
   * `height: calc(100dvh - var(--deck-y))`. It put the CTA back on screen and
   * it was the single most expensive thing in this component: `height` is a
   * LAYOUT property, so every frame of every drag — and every frame of the
   * opening animation — relaid out the whole event page inside that card,
   * on the main thread, while the finger was moving. That is what "heavy" and
   * "laggy" were.
   *
   * Only one element ever needed to move, so only one element moves. The bar
   * is translated back up by exactly the sheet's own offset, which puts it in
   * precisely the place the resize used to, and `transform` is a compositor
   * property: no layout, no paint, no style invalidation on anything it does
   * not own. The card itself is a constant `100dvh` and is never measured
   * again.
   *
   * Written straight to the node rather than through a custom property on the
   * sheet, because changing an inherited custom property invalidates style for
   * every descendant — which is most of what the resize was costing.
   */
  /**
   * Writes the sheet's position, and the CTA bar's counter-offset, in one go.
   *
   * BOTH get the same transition, and that is what keeps the bar pinned. The
   * bar's offset is `-y`, so while the two interpolate along the identical
   * curve their sum is constant and the bar does not move relative to the
   * screen at all — no per-frame arithmetic, no motion value, and correct at
   * every point of the settle rather than only at its ends.
   */
  const writeSheetY = React.useCallback(
    (value: number, settle: boolean) => {
      sheetYRef.current = value;
      const transition = settle && !reduceMotion ? `transform ${FLIGHT_MS}ms ${SETTLE_EASE}` : 'none';
      // ── BOTH PROPERTIES, ON BOTH NODES, EVERY TIME ──────────────────────
      //
      // There was a "only write `transition` when the string changes" guard
      // here, memoising the last value in a ref. It was wrong, because the two
      // nodes do not live equally long: the sheet survives an open, while the
      // CTA bar is a NEW element after every horizontal page change and starts
      // at `transition: none`. One cache for two lifetimes desynchronises the
      // moment `seedCtaOffset` touches the fresh bar — the cache then says
      // "220ms", the bar says "none", the next settle skips the write, and the
      // sheet eases while the bar JUMPS. That is precisely the invariant this
      // function exists to hold.
      //
      // And the guard bought nothing: the `transform` write on the next line
      // already dirties the same element's style in the same frame, so the
      // second property costs no additional recalc.
      const sheet = sheetRef.current;
      if (sheet) {
        sheet.style.transition = transition;
        sheet.style.transform = `translate3d(0, ${value}px, 0)`;
      }
      const cta = ctaRef.current;
      if (cta) {
        cta.style.transition = transition;
        cta.style.transform = `translate3d(0, ${-Math.max(value, 0)}px, 0)`;
      }
    },
    [reduceMotion],
  );

  /**
   * Copies the sheet's current position and transition onto the CTA bar.
   *
   * For the bar that arrives with a new page: the node is fresh, so it starts
   * at `transform: none` and would sit below the screen until something moved
   * it. It must NOT go through `writeSheetY` — that re-commands the sheet, and
   * a swipe landing while a vertical settle is still running would cut that
   * settle short and snap the sheet to its target.
   */
  const seedCtaOffset = React.useCallback(() => {
    const cta = ctaRef.current;
    if (!cta) return;
    // `none`, always. A fresh node computes to `transform: none`, so giving it
    // a settle's transition here would ANIMATE it from identity to its offset
    // — the ticket bar sliding up from below the fold on every page change.
    // It has to be in place in the frame it mounts, not eased into place.
    cta.style.transition = 'none';
    // The COMMANDED offset, not the live one. If a vertical settle happens to
    // be running when a page change lands, the bar is seeded at the settle's
    // destination and is therefore wrong by a shrinking amount that reaches
    // zero when the sheet arrives; seeding it at the live position would be
    // right for one frame and then wrong by the whole delta.
    cta.style.transform = `translate3d(0, ${-Math.max(sheetYRef.current, 0)}px, 0)`;
  }, []);

  /**
   * The sheet's LIVE translate — mid-transition included.
   *
   * The same trick, and for the same reason, as `readTrackX`: during a CSS
   * transition the computed transform is the INTERPOLATED value, and that is
   * the only place it exists. One computed read, on the pointerdown that
   * starts a gesture, never per frame.
   */
  const readSheetY = React.useCallback((fallback: number) => {
    const node = sheetRef.current;
    if (!node || typeof window === 'undefined') return fallback;
    try {
      const transform = window.getComputedStyle(node).transform;
      if (!transform || transform === 'none') return fallback;
      const matrix = new DOMMatrixReadOnly(transform);
      return Number.isFinite(matrix.m42) ? matrix.m42 : fallback;
    } catch {
      // DOMMatrix is missing in some test environments, and a browser handing
      // back something unparseable is not worth a thrown gesture.
      return fallback;
    }
  }, []);

  /**
   * ── WHY A GESTURE MUST TAKE THE SHEET, NOT JOIN IT ─────────────────────
   *
   * The entrance was `animate(y, ...)` on a motion value, and the drag wrote
   * that same value with `y.set()`. A motion value does not stop a running
   * animation because somebody set it — the animation writes over the set
   * value on its very next frame.
   *
   * That is "the first swipe does not maximise". The entrance is still
   * settling for the first fraction of a second of the deck being open, which
   * is exactly when a thumb arrives, and every pixel the drag wrote was
   * overwritten before it could be painted. The sheet sat still while the
   * finger moved and then jumped to wherever the animation had reached. It
   * was not a gesture that failed to commit; it was a gesture that was never
   * allowed to move anything.
   *
   * `settleSheetY` and `freezeSheetY` are the two halves of the answer: one
   * owns the settle, the other takes it away and pins the sheet at the
   * position it is CURRENTLY painted at. There is no window in which the deck
   * is animating and deaf.
   */
  /**
   * Moves the sheet to `target`, settling on the compositor.
   *
   * `onDone` is delivered from `transitionend` rather than from a timer: a
   * timer that agrees with the duration today is a timer that disagrees with
   * it the next time somebody retunes `FLIGHT_MS`, and this callback commits
   * a CLOSE — the one place a few frames early means unmounting a deck that
   * is still visibly on screen.
   */
  /**
   * Drops a pending completion watcher.
   *
   * ── WHY THIS IS NOT OPTIONAL ──────────────────────────────────────────
   *
   * The only settle that carries an `onDone` is the DISMISS, and its callback
   * closes the deck — a route-origin one NAVIGATES. A transition that is
   * CANCELLED, which is what happens if a finger grabs the sheet during the
   * ~200ms of a close, never fires `transitionend`. Left attached, that
   * listener would sit on a node still on screen and fire on the next ordinary
   * snap, running the abandoned close in the middle of a gesture.
   *
   * `transitioncancel` is the browser's own answer to that and is listened for
   * below. This exists so the guarantee does not REST on it: a watcher is
   * superseded by whatever supersedes its settle — a new settle, a gesture
   * taking the sheet, or the deck closing — whether or not the event arrives.
   * The failure it prevents is a navigation nobody asked for, which is worth
   * not depending on an event to avoid.
   */
  const settleWatcherRef = React.useRef<(() => void) | null>(null);
  const clearSettleWatcher = React.useCallback(() => {
    settleWatcherRef.current?.();
    settleWatcherRef.current = null;
  }, []);

  const settleSheetY = React.useCallback(
    (target: number, onDone?: () => void) => {
      clearSettleWatcher();
      const node = sheetRef.current;
      const from = readSheetY(sheetYRef.current);
      writeSheetY(target, true);
      if (!onDone) return;
      // Nothing to transition — no `transitionend` will ever come.
      if (!node || reduceMotion || Math.abs(target - from) < 0.5) {
        onDone();
        return;
      }
      const detach = () => {
        node.removeEventListener('transitionend', finish);
        node.removeEventListener('transitioncancel', abandon);
      };
      // A descendant's own transition bubbles to here, so BOTH the target and
      // the property are checked — a button's `transition-transform` finishing
      // is not this settle finishing.
      const finish = (event: TransitionEvent) => {
        if (event.target !== node || event.propertyName !== 'transform') return;
        detach();
        settleWatcherRef.current = null;
        onDone();
      };
      const abandon = (event: TransitionEvent) => {
        if (event.target !== node || event.propertyName !== 'transform') return;
        detach();
        settleWatcherRef.current = null;
      };
      node.addEventListener('transitionend', finish);
      node.addEventListener('transitioncancel', abandon);
      settleWatcherRef.current = detach;
    },
    [clearSettleWatcher, readSheetY, reduceMotion, writeSheetY],
  );

  /**
   * Hands the sheet to a finger: pin it exactly where it LOOKS like it is.
   *
   * This is the fix for "the first swipe does not maximise". A settle was
   * still running for the first fraction of a second of the deck being open —
   * which is exactly when a thumb arrives — and the drag used to read the
   * COMMANDED position while the transition kept driving the element. The
   * sheet either ignored the finger or jumped. Freezing at the interpolated
   * value means a gesture can interrupt an arrival at any point and the sheet
   * is already under the thumb when it does.
   */
  const freezeSheetY = React.useCallback(() => {
    // The gesture supersedes whatever the settle was going to do next — see
    // `clearSettleWatcher`. Without this a grab during a close leaves the
    // close's callback armed on the sheet, to fire on some later snap.
    clearSettleWatcher();
    const live = readSheetY(sheetYRef.current);
    writeSheetY(live, false);
    return live;
  }, [clearSettleWatcher, readSheetY, writeSheetY]);

  /** Forces the pending transform to be committed, so the NEXT one animates. */
  const flushSheet = React.useCallback(() => {
    void sheetRef.current?.offsetHeight;
  }, []);

  /** Writes the sheet's translate while a finger is on it. */
  const applySheet = React.useCallback(
    (offset: number) => {
      writeSheetY(offset, false);
    },
    [writeSheetY],
  );

  /**
   * Writes BOTH tracks' positions. `settle` turns the CSS transition on.
   *
   * ── WHY TWO TRACKS ────────────────────────────────────────────────────
   *
   * The poster is anchored and the content sheet slides over it, which means
   * they cannot live in the same element: the sheet translates on Y and the
   * poster must not. So there are two horizontal tracks — one behind holding
   * the posters, one inside the Y-translating sheet holding the content — and
   * they are given the SAME x here, in the same frame, from the same call.
   *
   * One writer rather than two effects, because a single frame in which the
   * poster and its own content are at different x is a visible tear, and two
   * independent writers is exactly how that happens.
   */
  const applyTrack = React.useCallback(
    (offset: number, settle: boolean) => {
      const transition = settle && !reduceMotion ? `transform ${SETTLE_MS}ms ${SETTLE_EASE}` : 'none';
      const transform = `translate3d(${offset}px, 0, 0)`;
      for (const node of [trackRef.current, posterTrackRef.current]) {
        if (!node) continue;
        node.style.transition = transition;
        node.style.transform = transform;
      }
      /**
       * ── AND NOTHING ELSE, WHICH IS THE POINT ──────────────────────────
       *
       * There was a second half here: a `querySelectorAll` over every cell,
       * once per frame of a swipe, interpolating a `scale(0.97)` and an
       * `opacity(0.7)` onto the neighbours so a card halfway in was halfway
       * bright. It was written for a deck whose neighbours PEEKED — six
       * percent of each showing at the rim, where dimming them read as depth.
       *
       * A page is the full viewport now, so there is no rim. Scaling the
       * incoming page down would open a black wedge down both sides of it for
       * the length of every swipe, and fading it would show the poster
       * through the panel — the interpolation would be actively visible as a
       * defect rather than invisible as polish. So it is gone, along with a
       * DOM query and up to twenty style writes per animation frame on the
       * one code path where the finger is already on the glass.
       *
       * Full-screen pagers do not do this. Pages slide.
       */
    },
    [reduceMotion],
  );

  // The bottom padding under the content is the REAL height of the sticky bar
  // plus the safe area, so the last section clears it exactly. A hard-coded
  // `pb-28` is either a gap or a clipped final row on some device.
  React.useEffect(() => {
    const node = ctaRef.current;
    if (!node || !isOpen) return;
    const observer = new ResizeObserver(() => setCtaHeight(node.offsetHeight));
    observer.observe(node);
    setCtaHeight(node.offsetHeight);
    // The bar is a fresh node after a swipe (the incoming page's `ActiveCard`
    // replaces the outgoing one), so it starts at `transform: none` and would
    // sit `y` pixels below the screen until the next frame of a drag moved it.
    // Seeded here, where the ref is known to point at the live one.
    return () => observer.disconnect();
    // `currentEvent?.id` because that swap also left the observer watching the
    // OLD bar, so `ctaHeight` — and therefore the content's bottom padding —
    // was measured from a node no longer on screen.
  }, [isOpen, currentEvent?.id]);

  /**
   * Put the incoming page's ticket bar in place BEFORE the browser paints it.
   *
   * A horizontal page change unmounts the outgoing `ActiveCard` and mounts a
   * new one, so `ctaRef` points at a fresh node with no transform — which puts
   * it at the bottom of the PAGE, `bottomInset` px below the screen. As a
   * passive effect this seeding ran after paint, so every swipe showed one
   * frame with no ticket bar at all, on the surface whose whole job is to sell
   * a ticket. None of the other layout effects cover it: they are keyed on
   * `isOpen` and the viewport, and an index change moves neither.
   */
  React.useLayoutEffect(() => {
    if (!isOpen) return;
    seedCtaOffset();
  }, [isOpen, currentEvent?.id, seedCtaOffset]);

  /**
   * ── THE POSTER IS A SHARED ELEMENT, NOT A NEW IMAGE ────────────────────
   *
   * Before this, opening the deck slid the SHEET up from the bottom while the
   * hero appeared instantly at its full 62dvh — so the artwork of the event
   * somebody had just tapped had no relationship to the card they tapped. The
   * eye read it as "the card went away and a page arrived", which is exactly
   * what it was.
   *
   * Now a clone of that poster flies from the card's box to the hero's box
   * while the sheet follows it up. `flight` holds the two measured rects for
   * the life of one animation and nothing else; when it is null the deck
   * behaves precisely as it did before, which is the fallback for every case
   * where a source cannot be found — a seeded open from an account ticket, a
   * card scrolled out of view, reduced motion.
   */
  const [flight, setFlight] = React.useState<{
    /** Distinct per flight, so a new one can never reuse the old layer. */
    id: number;
    from: Box;
    to: Box;
    direction: 'in' | 'out';
    src: string;
    alt: string;
  } | null>(null);
  const flightIdRef = React.useRef(0);

  /**
   * ── WHERE THE SHEET IS ON ITS FIRST PAINTED FRAME ──────────────────────
   *
   * The sheet's transform starts unset, and it was first written inside the
   * passive enter effect below — which runs AFTER the browser has painted. On
   * the very first open of a session that painted one frame with the sheet at
   * translate zero: a full-height card covering the whole screen, poster
   * hidden, at the resting position of nothing. From the feed nobody ever saw
   * it, because a previous close had left it off-screen. From a shared link it
   * is the first frame the reader sees, on the platform's most-shared URL.
   *
   * A layout effect runs before paint. A deep link lands the sheet directly at
   * its expanded snap — it IS the page, and the brief is explicit that it must
   * not arrive minimized and wait for a gesture. A feed open parks it below
   * the viewport, where the entrance effect then decides how it enters.
   */
  React.useLayoutEffect(() => {
    // Reset here rather than in a passive effect, so a close and an immediate
    // reopen cannot land in the same tick with the flag still set.
    if (!isOpen) {
      enteredRef.current = false;
      return;
    }
    if (viewport.height === 0 || enteredRef.current) return;
    justOpenedRef.current = true;
    const snaps = snapPixels(viewport.height);
    if (openOptionsRef.current.expanded) {
      applySnapIndex(EXPANDED_SNAP_INDEX);
      writeSheetY(snaps[EXPANDED_SNAP_INDEX], false);
      // Placed, with no entrance to play — so the arrival is over.
      enteredRef.current = true;
      return;
    }
    writeSheetY(viewport.height, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, viewport.height]);

  // A LAYOUT effect, so the neighbours are already dimmed and set back in the
  // first frame the deck paints. `applyTrack` runs again from the ordinary
  // effects a frame later, which is fine — it is idempotent for the same offset.
  React.useLayoutEffect(() => {
    if (!isOpen || viewport.width === 0) return;
    applyTrack(restingX(currentIndex), false);
    // Only on open and on a viewport change. `currentIndex` is handled by the
    // centring effect, which also knows whether to settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, viewport.width]);

  /**
   * The ENTRANCE, and it is a LAYOUT effect for a measured reason.
   *
   * It was a passive effect, which runs after the browser has painted, so
   * `setFlight` landed one paint late: the clone mounted, and only then did
   * its own animation start. Measured on a production build, the sheet had
   * finished arriving at t~250ms while the poster clone had not begun to move
   * until t~231ms. Two movements, visibly sequential — which is exactly the
   * "the poster goes first and then the sheet follows" this exists to fix, and
   * no amount of matching durations closes a gap that is a React commit wide.
   *
   * A state update inside a LAYOUT effect is flushed synchronously before the
   * browser paints, so `SharedPoster` mounts and starts in the SAME frame the
   * sheet's transition does. One frame, one start, one movement.
   *
   * It is declared AFTER the `applyTrack` layout effect on purpose: the deck's
   * hero is measured here, and until the track has been positioned the active
   * page's poster is still a screen-width or more off to the side. Measuring
   * before that would fly the clone to a box nobody can see.
   */
  React.useLayoutEffect(() => {
    if (!isOpen || viewport.height === 0) return;
    /**
     * ── ONCE PER OPEN, NOT ONCE PER VIEWPORT HEIGHT ────────────────────
     *
     * This effect lists `viewport.height` because it needs a measured
     * viewport to compute the resting snap from. It must not RUN again when
     * that number changes, and on a phone it changes constantly: the URL bar
     * collapses on the first scroll. Without this guard that ordinary event
     * re-parked the sheet below the screen and replayed the whole arrival —
     * collapsing a sheet the reader had expanded and re-flying the poster,
     * mid-read. The effect below re-places the sheet on a resize instead.
     */
    if (enteredRef.current) return;
    enteredRef.current = true;
    justOpenedRef.current = true;
    // Opened already expanded — a deep link. There is no card on the page to
    // fly from and no entrance to play; the layout effect above has placed it.
    if (openOptionsRef.current.expanded) return;
    const resting = snapPixels(viewport.height)[INITIAL_SNAP_INDEX];
    applySnapIndex(INITIAL_SNAP_INDEX);
    if (reduceMotion) {
      writeSheetY(resting, false);
      return;
    }

    // Measured in the same frame the deck mounts, while the list behind is
    // still laid out exactly as it was when the card was tapped. One
    // `getBoundingClientRect` per element, once — never inside a gesture.
    const opening = currentEventRef.current;
    const source = opening?.poster_url ? readCardPoster(opening.id) : null;
    const destination = readDeckPoster();
    const canFly =
      source !== null &&
      destination !== null &&
      isUsableSource(source, viewport.height, viewport.width);

    if (canFly && opening) {
      setFlight({
        id: (flightIdRef.current += 1),
        from: source,
        to: destination,
        direction: 'in',
        src: opening.poster_url,
        alt: opening.title,
      });
      // The sheet starts from the hero's lower edge rather than from off the
      // bottom of the screen. It has less distance to cover than the poster,
      // so both arrive together instead of the panel racing ahead of the image
      // it is supposed to be carrying.
      writeSheetY(Math.min(viewport.height, destination.top + destination.height), false);
    } else {
      writeSheetY(viewport.height, false);
    }

    // The start position has to be COMMITTED before the target is written, or
    // the browser sees a single style change and there is nothing to
    // transition between. One forced reflow, at open time, never per frame.
    flushSheet();
    settleSheetY(resting);
    // `currentIndex` is deliberately absent: this runs on OPEN, and re-running
    // it when the reader swipes would drop the sheet back to its entry height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, viewport.height]);

  /**
   * A viewport change RE-PLACES the sheet; it does not re-open it.
   *
   * The snaps are fractions of the viewport, so when a phone's URL bar
   * collapses every one of them moves. The sheet is at an absolute pixel
   * offset, so left alone it would be at the old snap's position against the
   * new geometry — a gap under the ticket bar, or the poster covered by a few
   * pixels more than the reader chose.
   *
   * Instantly, and at the snap the reader is ACTUALLY on: this is the
   * viewport correcting itself, not a movement anybody asked to watch.
   */
  React.useLayoutEffect(() => {
    /**
     * ── `viewport.height` AND NOTHING ELSE ─────────────────────────────
     *
     * This listed `isOpen` too, and that broke every shared link. Opening
     * changes `isOpen`, so the effect ran during the open — after the
     * placement effect had called `setSnapIndex(EXPANDED_SNAP_INDEX)` but
     * BEFORE that state reached a render. It therefore read the previous
     * snap and wrote it, and a deep-linked deck that is supposed to arrive
     * maximized arrived at the resting stop instead. Caught by the deep-link
     * check, which is why that check exists.
     *
     * A re-placement is a response to the VIEWPORT moving and to nothing
     * else. `isOpen` and the snap are read from refs so they are the live
     * values rather than whichever render this closure belongs to.
     */
    if (!isOpenRef.current || !enteredRef.current || viewport.height === 0) return;
    const target = snapPixels(viewport.height)[snapIndexRef.current];
    if (target !== undefined) writeSheetY(target, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.height]);

  React.useEffect(() => {
    if (!isOpen) {
      clearSettleWatcher();
      closingRef.current = false;
      setLeaving(false);
      setActiveSubSheet(null);
      // The flight belongs to the deck, not to the layer that draws it. Clearing
      // it here is what makes `SharedPoster`'s cleanup able to be a plain
      // cancel — an interrupted transition can never leave the real hero
      // hidden, because the only thing that hides it is this state.
      setFlight(null);
    }
  }, [isOpen, clearSettleWatcher]);

  // Keep the active card centred when the index changes (a swipe, a tap on a
  // similar-events card) and when the card WIDTH changes (entering or leaving
  // full screen), because the stride changes with it.
  React.useEffect(() => {
    if (!isOpen || viewport.width === 0) return;
    // `settle: false` on the very first frame of an open, so the tapped card is
    // ALREADY centred when the sheet slides up rather than sliding sideways
    // into place afterwards.
    applyTrack(restingX(currentIndex), swipeRef.current === null && !justOpenedRef.current);
    justOpenedRef.current = false;
  }, [isOpen, currentIndex, restingX, viewport.width, applyTrack]);

  // A new event starts at the top of its own content — carrying the previous
  // event's scroll offset into it lands you halfway down a page you have not
  // seen. The snap height is deliberately kept: that is the reader's choice,
  // not the event's.
  React.useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [currentEvent?.id]);

  // ── THE `pastHero` SCROLL LISTENER IS GONE ──────────────────────────────
  //
  // It watched the content scroller for the poster leaving the top of the
  // screen, and switched the floating controls from white-on-artwork to
  // ink-on-surface at that point. The poster does not scroll any more: it is
  // anchored behind the sheet, and whether it is visible is a function of
  // where the SHEET is, which `isExpanded` already answers. A listener computing
  // an answer another value already holds is one more thing to keep in sync.

  /**
   * ── CLAIM THE GESTURE BEFORE THE BROWSER DOES ──────────────────────────
   *
   * `touch-action` is NOT inherited, so the `touch-none` on the sheet does
   * nothing for the scrolling content inside it: that element computes to
   * `auto`, and the browser decides on the FIRST touchmove that a vertical
   * gesture belongs to its own panning. It then fires `pointercancel` and
   * stops delivering pointer events entirely.
   *
   * The symptom was precise and baffling: dragging the handle collapsed the
   * sheet, and the identical drag started two centimetres lower did nothing at
   * all — no movement, no snap, no error. Exactly one `pointermove` arrived
   * and the rest of the gesture went to a scroll that had nowhere to go,
   * because the content was already at the top.
   *
   * A non-passive `touchmove` that calls `preventDefault()` in the cases the
   * commit rule is about to claim keeps the browser out of it and the pointer
   * stream alive. It is deliberately narrow — horizontal, or vertical from a
   * content top that has nothing above it — so ordinary scrolling is still the
   * browser's, natively, with nothing intercepting it.
   */
  React.useEffect(() => {
    const node = scrollerRef.current;
    if (!node || !isOpen) return;

    let startX = 0;
    let startY = 0;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < COMMIT_SLOP && Math.abs(dy) < COMMIT_SLOP) return;

      const horizontal = Math.abs(dx) > Math.abs(dy);
      const atTop = node.scrollTop <= 0;
      const claimsIt =
        horizontal || (atTop && (dy > 0 || (dy < 0 && snapIndex !== EXPANDED_SNAP_INDEX)));

      // `cancelable` guards the case where the browser has already committed to
      // scrolling — calling `preventDefault` there is a no-op that logs a
      // console warning on every frame.
      if (claimsIt && event.cancelable) event.preventDefault();
    };

    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
    };
  }, [isOpen, snapIndex, currentEvent?.id]);

  const goTo = React.useCallback(
    (index: number) => {
      if (index < 0 || index >= events.length) return;
      setCurrentIndex(index);
    },
    [events.length, setCurrentIndex],
  );

  const snapTo = React.useCallback(
    (index: number) => {
      const target = snaps[index];
      if (target === undefined) return;
      applySnapIndex(index);
      settleSheetY(target);
    },
    [applySnapIndex, settleSheetY, snaps],
  );

  /**
   * Close, collapsing the poster back toward the card it came from.
   *
   * The source is looked up FRESH rather than remembered from the open,
   * because the reader may have swiped: the thing that should shrink is the
   * event they are looking at now, not the one they originally tapped. It also
   * means a list that has re-rendered underneath is handled for free.
   *
   * Every branch that cannot fly falls through to the plain slide the deck has
   * always done — reduced motion, an event with no poster, a card scrolled out
   * of view, a seeded open from a surface with no card at all. That is the
   * graceful handling the brief asks for, and it is the same code path that
   * shipped before any of this existed.
   */
  /**
   * What happens once the close animation has finished — the ONE place that
   * decides where the reader ends up.
   *
   * From the feed: the page underneath is still there, so simply close, and
   * pop the history entry the open pushed (see below) so the browser's own
   * back stack stays honest.
   *
   * From a route (a shared link): there is no feed underneath — the page
   * under the deck is the standalone event page, which on a phone must never
   * be shown. So closing NAVIGATES to the list instead, and the deck stays
   * mounted over the outgoing page until the new route has arrived (see the
   * pathname effect), which is what keeps the old page from ever painting.
   *
   * This is deliberately NOT triggered by `closeDeck` itself, which the
   * "Book tickets" link calls on its way to checkout. Wiring navigation to the
   * close STATE would race two client navigations on the money path — one to
   * the booking, one back to the list.
   */
  const finishClose = React.useCallback(() => {
    if (openOptionsRef.current.origin === 'route') {
      // REPLACE, not push. Push would leave the event URL in the stack behind
      // the list, so browser back returns to it, `DeckBoot` mounts fresh and
      // reopens the deck, and closing pushes the list again — the reader can
      // never get PAST the event they arrived on.
      router.replace('/events');
      return;
    }
    closeDeck();
    if (pushedHistoryRef.current) {
      pushedHistoryRef.current = false;
      window.history.back();
    }
  }, [closeDeck, router]);

  const dismiss = React.useCallback(() => {
    // Idempotent: Escape twice, or a drag-dismiss landing on a tap, must not
    // start a second close over the first.
    if (closingRef.current) return;
    closingRef.current = true;
    setLeaving(true);
    if (reduceMotion || viewport.height === 0) {
      finishClose();
      return;
    }

    const leaving = currentEventRef.current;
    const target = leaving?.poster_url ? readCardPoster(leaving.id) : null;
    const source = readDeckPoster();
    const canFly =
      target !== null &&
      source !== null &&
      isUsableSource(target, viewport.height, viewport.width);

    if (canFly && leaving) {
      setFlight({
        id: (flightIdRef.current += 1),
        from: target,
        to: source,
        direction: 'out',
        src: leaving.poster_url,
        alt: leaving.title,
      });
      // ── ALL THE WAY OFF, LIKE THE OTHER BRANCH ──────────────────────
      //
      // This used to stop at the poster's lower edge, on the reasoning that a
      // shorter journey made the sheet and the clone finish together. They
      // finish together now because they share a duration, and stopping there
      // meant the card was still covering the bottom 19% of the screen,
      // opaque, at the moment the whole deck unmounted. The close ended in a
      // hard cut — which is the "closing repeats the two-step lag" half of
      // the complaint, and it was the sheet never actually leaving.
      settleSheetY(viewport.height);
      return;
    }

    settleSheetY(viewport.height, finishClose);
  }, [settleSheetY, finishClose, viewport.height, viewport.width, reduceMotion]);

  // ── THE THREE NON-POINTER WAYS OUT ─────────────────────────────────────
  //
  // The back arrow is gone, so these are no longer conveniences — without
  // them the deck is a dialog with no keyboard exit at all.

  // Escape. The deck is a hand-rolled `role="dialog"`, not a library one, so
  // nothing gave it this for free.
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, dismiss]);

  // Hardware / browser back. A FEED open pushes one history entry so that
  // back closes the deck rather than navigating the page underneath while
  // the deck stays up — which is what it did. A ROUTE open pushes nothing:
  // the URL already is the event, and back leaving it is correct.
  React.useEffect(() => {
    if (!isOpen || openOptionsRef.current.origin === 'route') return;
    window.history.pushState({ eeDeck: true }, '');
    pushedHistoryRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  React.useEffect(() => {
    const onPop = () => {
      if (!isOpenRef.current || openOptionsRef.current.origin === 'route') return;
      pushedHistoryRef.current = false;
      closeDeck();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [closeDeck]);

  // A route-origin deck closes only once the NEXT route is on screen, so the
  // standalone page it was covering never gets a frame of its own.
  React.useEffect(() => {
    if (!isOpen) {
      openedPathRef.current = null;
      return;
    }
    if (openedPathRef.current === null) {
      openedPathRef.current = pathname;
      return;
    }
    if (openOptionsRef.current.origin === 'route' && pathname !== openedPathRef.current) {
      closeDeck();
    }
  }, [isOpen, pathname, closeDeck]);

  /**
   * The vertical gesture, start to finish.
   *
   * Window listeners, like the horizontal one — a drag that begins on the
   * handle and travels up the screen leaves that element almost immediately,
   * and a React handler bound to it stops hearing about the gesture the moment
   * it does.
   */
  const beginVerticalDrag = React.useCallback(
    (event: React.PointerEvent) => {
      // Pin the sheet at the position it VISUALLY holds, cancelling any
      // settle still in flight — see the note on `freezeSheetY`. It returns
      // that position, which is what the drag has to start from.
      const base = freezeSheetY();
      const pointerId = event.pointerId;
      // A finger on the artwork or the scrim has no article under it. Without
      // this the overlay path would scroll the content it is nowhere near —
      // the poster would move the sheet AND spin the text behind it.
      const ownsScroller = gestureRef.current.origin === 'content';
      let lastY = event.clientY;
      let lastAt = event.timeStamp;
      let velocity = 0;
      draggedRef.current = false;

      /**
       * ── THE SHEET AND THE CONTENT ARE ONE GESTURE ────────────────────────
       *
       * This used to be `applySheet(base + travelled)` and nothing else, so a
       * drag that began on the content OWNED the whole gesture: it raised the
       * sheet to its ceiling and then just sat there resisting, while the
       * article underneath — the thing the reader was reaching for — never
       * moved. You had to lift your finger and swipe a second time to read.
       *
       * Which is exactly the complaint: "it only maximises when I drag the
       * handle". The handle worked because the handle is all it ever does.
       *
       * A finger moving up now spends its travel in order — first raising the
       * sheet until it hits the ceiling, then scrolling the content with
       * whatever is left — and a finger moving down spends it the other way,
       * scrolling back to the top before the sheet begins to close. That is
       * the nested-scroll behaviour every native bottom sheet has, and it is
       * why one continuous movement can take you from a resting card to the
       * bottom of the page and back.
       *
       * Deltas, not `clientY - startY`: the two consumers hand travel back and
       * forth, so an absolute offset from the start of the gesture stops
       * describing either of them after the first handoff.
       */
      const ceiling = snaps[EXPANDED_SNAP_INDEX] ?? 0;
      let sheetY = base;
      /**
       * The gesture's ORIGIN, not the point at which it was allowed to commit.
       *
       * Committing costs `COMMIT_SLOP` (or `OVERLAY_SLOP`) of travel spent
       * proving which axis was meant, and starting from the commit point threw
       * that away: the sheet arrived ten pixels behind the finger and stayed
       * there for the rest of the drag. Only the content path paid it, which
       * is why dragging the handle always felt tighter than dragging the page.
       */
      let previousY =
        gestureRef.current.pointerId === pointerId ? gestureRef.current.y : event.clientY;

      const move = (moveEvent: PointerEvent) => {
        // A second finger's moves are not this gesture's. Both listeners are
        // on `window`, so without the filter a two-finger touch drives one
        // drag from two sources.
        if (moveEvent.pointerId !== pointerId) return;
        const elapsed = moveEvent.timeStamp - lastAt;
        if (elapsed > 0) {
          velocity = ((moveEvent.clientY - lastY) / elapsed) * 1000;
          lastY = moveEvent.clientY;
          lastAt = moveEvent.timeStamp;
        }
        if (Math.abs(moveEvent.clientY - event.clientY) > 4) draggedRef.current = true;

        let delta = moveEvent.clientY - previousY;
        previousY = moveEvent.clientY;
        const scroller = scrollerRef.current;

        if (delta < 0) {
          // UP. The sheet rises to its ceiling first; the remainder scrolls.
          const room = sheetY - ceiling;
          if (room > 0) {
            const used = Math.max(delta, -room);
            sheetY += used;
            delta -= used;
          }
          if (delta < 0 && scroller && ownsScroller) scroller.scrollTop -= delta;
        } else if (delta > 0) {
          // DOWN. Unwind the scroll first — a sheet that starts closing while
          // there is still text above the fold is a sheet that closes by
          // accident.
          if (scroller && ownsScroller && scroller.scrollTop > 0) {
            const used = Math.min(delta, scroller.scrollTop);
            scroller.scrollTop -= used;
            delta -= used;
          }
          sheetY += delta;
        }

        // Past the ceiling there is nothing left to reveal, so resistance is
        // heavy; below the resting position there is (a dismissal), so it is
        // light and the sheet follows the finger.
        applySheet(sheetY < ceiling ? ceiling + (sheetY - ceiling) * 0.12 : sheetY);
      };

      const end = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        gestureRef.current.committed = false;
        gestureRef.current.pointerId = -1;
        const resolution = resolveSnap({
          // `sheetYRef` IS the live, resistance-damped position: no
          // transition is running during a drag, so the commanded value and
          // the painted one are the same number. (The term that used to be
          // added here was multiplied by zero, so it described nothing and
          // only made the line look like it accounted for travel.)
          y: sheetYRef.current,
          // A finger that paused before lifting has no velocity, whatever the
          // last `pointermove` measured — see `liveVelocity`.
          velocity: liveVelocity(velocity, lastAt, endEvent.timeStamp),
          snaps,
          viewportHeight: viewport.height,
        });
        if (resolution.shouldClose) dismiss();
        else snapTo(resolution.index);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    [applySheet, dismiss, freezeSheetY, snapTo, snaps, viewport.height],
  );

  /**
   * The horizontal gesture, start to finish.
   *
   * Window-level listeners rather than React handlers, so the swipe survives
   * the pointer leaving the card it started on — which it always does, because
   * the card is moving out from under the finger.
   */
  /**
   * Where the track is RIGHT NOW, mid-settle included.
   *
   * `beginSwipe` used to take `restingX(currentIndex)` as its base — the
   * position the track is heading FOR. Start a second swipe during the 340ms
   * settle and the first `move` wrote that final offset with the transition
   * switched off, so the deck jumped up to a whole card before it began
   * following the finger. A swipe interrupting a swipe is the commonest thing
   * a person does to a carousel they are browsing quickly.
   *
   * One computed read, once per gesture, on pointerdown — never per frame.
   * During a CSS transition the computed transform is the INTERPOLATED value,
   * which is exactly the number wanted and the only place it exists.
   */
  const readTrackX = React.useCallback(
    (fallback: number) => {
      const node = trackRef.current;
      if (!node || typeof window === 'undefined') return fallback;
      try {
        const transform = window.getComputedStyle(node).transform;
        if (!transform || transform === 'none') return fallback;
        const matrix = new DOMMatrixReadOnly(transform);
        return Number.isFinite(matrix.m41) ? matrix.m41 : fallback;
      } catch {
        // DOMMatrix is missing in some test environments, and a browser that
        // hands back something unparseable is not worth a thrown gesture.
        return fallback;
      }
    },
    [],
  );

  const beginSwipe = React.useCallback(
    (event: React.PointerEvent) => {
      if (stride === 0) return;
      const pointerId = event.pointerId;
      swipeRef.current = {
        startX: event.clientX,
        base: readTrackX(restingX(currentIndex)),
        lastX: event.clientX,
        lastAt: event.timeStamp,
        velocity: 0,
      };

      draggedRef.current = false;
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const swipe = swipeRef.current;
        if (!swipe) return;
        // The click that follows a drag must be suppressed for THIS axis as
        // much as for the vertical one. It was not: `draggedRef` was written
        // only inside `beginVerticalDrag`, so a horizontal swipe begun on the
        // overlay ended in a `click` that the overlay read as "dismiss" — the
        // reader swiped to the next event and the deck closed on it.
        if (Math.abs(moveEvent.clientX - swipe.startX) > 4) draggedRef.current = true;
        const elapsed = moveEvent.timeStamp - swipe.lastAt;
        if (elapsed > 0) {
          swipe.velocity = ((moveEvent.clientX - swipe.lastX) / elapsed) * 1000;
          swipe.lastX = moveEvent.clientX;
          swipe.lastAt = moveEvent.timeStamp;
        }
        // Rubber-band past both ends, so the first and last event feel like
        // ends of a deck rather than a broken gesture.
        let offset = swipe.base + (moveEvent.clientX - swipe.startX);
        const min = restingX(Math.max(events.length - 1, 0));
        if (offset > 0) offset *= 0.35;
        else if (offset < min) offset = min + (offset - min) * 0.35;
        applyTrack(offset, false);
      };

      const end = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        const swipe = swipeRef.current;
        swipeRef.current = null;
        gestureRef.current.committed = false;
        gestureRef.current.pointerId = -1;
        if (!swipe) return;

        /**
         * The release rule, and both halves of it are deliberate.
         *
         * A flick that has barely moved still carries — that is what
         * `liveVelocity` is for, and it is what makes a fast swipe feel
         * responsive rather than ignored. A slow drag commits once it has
         * covered `ADVANCE_FRACTION` of a stride, which is far less than the
         * half a stride the old `Math.round` demanded and is the difference
         * between "it follows me" and "it resists me". Either one is enough;
         * neither alone is required.
         *
         * One card at a time. A projection that would skip two cards is the
         * flick projection outrunning what a person can see, and landing two
         * events away from where the finger was is disorienting rather than
         * fast.
         */
        const travelled = endEvent.clientX - swipe.startX;
        const velocity = liveVelocity(swipe.velocity, swipe.lastAt, endEvent.timeStamp);
        const farEnough = Math.abs(travelled) >= stride * ADVANCE_FRACTION;
        const fastEnough =
          Math.abs(velocity) >= ADVANCE_VELOCITY && Math.sign(velocity) === Math.sign(travelled);
        const direction = travelled < 0 ? 1 : travelled > 0 ? -1 : 0;
        const next =
          direction !== 0 && (farEnough || fastEnough) ? currentIndex + direction : currentIndex;
        const clamped = Math.max(0, Math.min(next, events.length - 1));
        if (clamped === currentIndex) applyTrack(restingX(clamped), true);
        else goTo(clamped);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    [applyTrack, currentIndex, events.length, goTo, readTrackX, restingX, stride],
  );

  /** The handle always drags the SHEET — nothing scrolls there. */
  const startSheetDrag = React.useCallback(
    (event: React.PointerEvent) => {
      // The WHOLE record, not just `committed`. The overlay now sits under the
      // handle in the same stacking context; a handle press that left the
      // pointer id unset would let the overlay arm a second vertical drag on
      // the same finger, and two drags each holding their own `base` drive the
      // sheet at double speed.
      gestureRef.current = {
        x: event.clientX,
        y: event.clientY,
        committed: true,
        origin: 'content',
        pointerId: event.pointerId,
      };
      beginVerticalDrag(event);
    },
    [beginVerticalDrag],
  );

  /**
   * Tap the handle to step one snap taller — or, at its tallest, back down.
   *
   * Guarded on `draggedRef`, which `handleSheetDragEnd` sets: a drag ends with
   * a click event too, and without the guard every drag would also step the
   * sheet one further than the finger asked for.
   */
  const handleTap = React.useCallback(() => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (snapIndex === EXPANDED_SNAP_INDEX) snapTo(INITIAL_SNAP_INDEX);
    else snapTo(snapIndex - 1);
  }, [snapIndex, snapTo]);

  const onContentPointerDown = React.useCallback((event: React.PointerEvent) => {
    gestureRef.current = {
      x: event.clientX,
      y: event.clientY,
      committed: false,
      origin: 'content',
      pointerId: event.pointerId,
    };
  }, []);

  /**
   * ── THE OVERLAY IS A GESTURE SURFACE, NOT A DEAD ZONE ──────────────────
   *
   * Only two elements could start a vertical drag: the handle and the content
   * scroller. Everything above the sheet — the artwork, the scrim, the empty
   * space either side — was a poster layer with `pointer-events: none` over a
   * scrim whose only handler was `onClick={dismiss}`. So an upward swipe that
   * began on the picture did nothing while the finger moved and, on release,
   * fired the click and CLOSED the deck. Not ignored: the opposite of what
   * was asked.
   *
   * A finger landing here has no scroller under it, so there is nothing to
   * arbitrate with: any upward movement is the sheet's, any downward movement
   * is the sheet's, and sideways is the deck's. The slop is smaller than the
   * content's because there is no scroll to protect — a tap is still a tap,
   * because a tap does not move eight pixels.
   */
  const onOverlayPointerDown = React.useCallback((event: React.PointerEvent) => {
    // A descendant (the handle, the scroller) that already claimed this finger
    // wins. React bubbles child-first, so its record is already written.
    if (gestureRef.current.pointerId === event.pointerId && gestureRef.current.committed) return;
    gestureRef.current = {
      x: event.clientX,
      y: event.clientY,
      committed: false,
      origin: 'overlay',
      pointerId: event.pointerId,
    };
    draggedRef.current = false;
  }, []);

  /** Tap the overlay to leave — unless that "tap" was the end of a drag. */
  const onOverlayClick = React.useCallback(() => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    // On a shared link there is no feed to go back to, and a mis-tap on the
    // artwork ejecting the reader from the URL they were sent is the wrong
    // outcome. Escape, a downward drag and the browser's back all still leave.
    if (openOptionsRef.current.origin === 'route') return;
    dismiss();
  }, [dismiss]);

  /**
   * The gesture has already moved further than a tap ever does.
   *
   * ── WHY IT IS SET HERE AND NOT ONLY IN THE DRAG ───────────────────────
   *
   * Both `begin*` helpers write `draggedRef.current = false` on entry and only
   * raise it from their own window `pointermove` — which needs a move AFTER the
   * gesture committed. A finger that travels the slop in one event and lifts
   * (a short flick on the artwork, and every synthetic drag a test performs)
   * therefore released with the flag still false, the plate's click fired, and
   * the DECK CLOSED on a swipe.
   *
   * Committing is itself proof of travel — `COMMIT_SLOP` / `OVERLAY_SLOP` px of
   * it — so the flag is raised at that moment. It is raised AFTER the helper
   * runs, because the helper clears it.
   */
  const markDragged = React.useCallback(() => {
    draggedRef.current = true;
  }, []);

  const commitGesture = React.useCallback(
    (event: React.PointerEvent) => {
      /**
       * ── A CLOSE IN FLIGHT IS NOT NEGOTIABLE ──────────────────────────
       *
       * Only ONE of the two dismiss paths could ever be called off. The
       * non-flying one settles with an `onDone`, which `freezeSheetY` can
       * supersede; the flying one is committed by the poster clone's own
       * animation finishing, and no gesture cancels that. So a grab during a
       * flying close pulled the sheet back under the finger and then closed
       * anyway a moment later — a rescue that visibly worked and then did not.
       *
       * Refusing the gesture is the honest version. Leaving IS what was just
       * asked for, ~200ms ago, and the alternative is two exit paths with
       * different rules on the surface that sells a ticket.
       */
      if (closingRef.current) return;
      const gesture = gestureRef.current;
      if (gesture.committed || gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      const slop = gesture.origin === 'overlay' ? OVERLAY_SLOP : COMMIT_SLOP;
      if (Math.abs(dx) < slop && Math.abs(dy) < slop) return;

      // Horizontal always belongs to the deck, AT EVERY SNAP STATE — there is
      // nothing to scroll sideways inside the content, and a full-screen event
      // that can no longer be swiped past is the thing this deck exists not to
      // be.
      //
      // A MARGIN, not a bare comparison. The poster is a large empty surface
      // and a thumb pivots from a knuckle, so an upward swipe over it draws an
      // arc that crosses 45 degrees for a frame or two near the start. On a
      // bare `>` that frame decides the gesture, and "I swiped up and it
      // changed the event" is the commonest way this reads as broken.
      if (Math.abs(dx) > Math.abs(dy) * AXIS_DOMINANCE) {
        gesture.committed = true;
        beginSwipe(event);
        markDragged();
        return;
      }

      // From the overlay every vertical movement is the sheet's — there is no
      // scroller under the finger whose turn it might be. No `atTop` gate and
      // no `isExpanded` gate: at the ceiling an upward drag simply meets the
      // resistance the drag handler already applies, which is the honest
      // answer to "it will not go any further".
      if (gesture.origin === 'overlay') {
        gesture.committed = true;
        beginVerticalDrag(event);
        markDragged();
        return;
      }

      const atTop = (scrollerRef.current?.scrollTop ?? 0) <= 0;
      // Downward from the top: collapse. There is nothing above the first line
      // to scroll to, so the only thing that gesture can mean is "put it away".
      if (dy > 0 && atTop) {
        gesture.committed = true;
        beginVerticalDrag(event);
        markDragged();
        return;
      }
      // Upward from the top, while there is still room to grow: expand. This is
      // what makes the whole surface draggable rather than just the handle —
      // and it stops exactly when the sheet is full, at which point an upward
      // drag is a request to read further and belongs to the scroller.
      if (dy < 0 && atTop && !isExpanded) {
        gesture.committed = true;
        beginVerticalDrag(event);
        markDragged();
        return;
      }
      // Neither: the browser scrolls the content, natively, uninterrupted.
      gesture.committed = true;
    },
    [beginSwipe, beginVerticalDrag, isExpanded, markDragged],
  );
  const onContentPointerMove = commitGesture;
  const onOverlayPointerMove = commitGesture;

  if (!isOpen || !currentEvent) return null;

  const price = formatFromPrice(currentEvent.from_price);

  return (
    <div className="fixed inset-0 z-modal sm:hidden" role="dialog" aria-modal="true">
      {/* Dimmed AND blurred, so nothing bleeds through the active surface.

          The DURATION is what changed: it used to take framer's default and
          land well before the sheet, so the list was gone before the selected
          event had arrived — the two halves of one movement running on
          different clocks. Matched to the poster's flight, it reads as the
          list receding BEHIND the event rather than being switched off in
          front of it, which is the "reduce prominence progressively" the brief
          asks for. The blur itself is untouched: it is the existing look, and
          this change is about timing, not about redesigning the scrim. */}
      <motion.div
        initial={{ opacity: 0 }}
        /* ── IT FADES OUT TOO, AND `exit` NEVER DID ────────────────────────
           `exit` only runs under an `AnimatePresence`, and nothing renders one
           around this component — it simply returns null when the deck closes.
           So the scrim was declared to fade and instead vanished in one frame,
           at full opacity, on top of a sheet that had also stopped short. The
           close ended as a cut.

           Driven by state instead, on the same duration and curve as the sheet
           and the clone. `opacity` is one of the properties framer hands to
           the compositor, so this stays off the main thread like the rest. */
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0 : PAGE_TRANSITION.duration, ease: TRANSITION_EASE }}
        // Decoration only. Its tap-to-close moved to the gesture plate below,
        // where it can be guarded against the click that follows a drag.
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/80 via-black/70 to-black/85 backdrop-blur-md"
        aria-hidden
      />

      {/* The poster in flight between the card and the hero. Mounted only for
          the length of one transition, and it removes itself. */}
      {flight ? (
        <SharedPoster
          /* ── A NEW FLIGHT IS A NEW LAYER, AND THAT IS A HANG FIX ───────
             `SharedPoster` starts its animation in a MOUNT-ONLY effect and
             latches a `done` flag, so React reusing one instance for a second
             flight means: no new animation, and a `settle()` that no-ops
             against a completion callback captured on the first mount.

             Reachable, and it strands the deck. Dismiss inside the ~220ms
             entrance and the state goes 'in' -> 'out' with the layer still
             mounted: the close's `onDone` — the ONLY thing that calls
             `finishClose` on the poster-flight path — never runs. The sheet
             settles onto the poster's lower edge and stops there, open,
             with no exit having happened.

             Keying by flight id makes every flight its own element, so the
             effect and the `done` latch are fresh by construction rather than
             by everyone remembering that this component is mount-only. */
          key={flight.id}
          src={flight.src}
          alt={flight.alt}
          from={flight.from}
          to={flight.to}
          direction={flight.direction}
          durationMs={FLIGHT_MS}
          onDone={() => {
            setFlight(null);
            // The close is committed HERE rather than on the sheet's spring,
            // so the deck survives exactly as long as the picture that is
            // still moving across it. Unmounting on the spring instead would
            // cut the poster off mid-flight.
            if (flight.direction === 'out') finishClose();
          }}
        />
      ) : null}

      {/* ── THE POSTER LAYER: ANCHORED, BEHIND THE SHEET ───────────────────
          The artwork used to live INSIDE the scroller, so a drag or a scroll
          carried it away and the top of the screen went blank. Here it is a
          sibling of the sheet rather than a descendant, which is the whole
          trick: the sheet translates on Y and this does not, so dragging the
          sheet down reveals more of the SAME picture in the SAME place, and
          dragging it up covers it. That is what the poster staying put means.

          It still moves on X with the content — one writer, `applyTrack`,
          gives both tracks the same transform in the same frame — so a
          horizontal swipe changes poster and content together.

          `pointer-events-none`: every gesture belongs to the sheet above,
          including the ones that begin over the artwork. A poster that
          swallowed touches would be a dead zone across the top third of the
          screen. */}
      <div
        // Hidden ONLY while a clone is flying, so there is never a moment with
        // two copies of the same photograph on screen. It is opacity rather
        // than `display`, because unmounting would make the browser re-decode
        // the image on the way back in — the visible flash this whole
        // transition exists to avoid.
        style={{ opacity: flight ? 0 : 1 }}
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          ref={posterTrackRef}
          style={{ paddingLeft: railPadding, paddingRight: railPadding, willChange: 'transform' }}
          className="flex h-full items-stretch"
        >
          {events.map((event, index) => (
            <div
              key={event.id}
              style={{ width: cardWidth, marginRight: index === events.length - 1 ? 0 : gap }}
              className="relative shrink-0 overflow-hidden"
              aria-hidden
            >
              {/* Tall enough that the sheet can be dragged well down without
                  running off the bottom of the artwork. */}
              {/* Rounded to match the card in front of it, so the artwork
                  does not show square shoulders past a rounded sheet. */}
              <div
                // Read by `readDeckPoster` to get the destination geometry for
                // the shared-poster transition — measured, never recomputed
                // from the constants above, so it stays correct on any
                // viewport (and if the poster's height ever changes).
                {...(index === currentIndex ? { [DECK_POSTER_ATTR]: '' } : {})}
                // NO rounding, and the height comes from `POSTER_FRACTION`
                // rather than an `h-[81dvh]` class. Rounded corners on a
                // full-width poster anchored to the top of the screen are two
                // black wedges in the top corners of the display; and the
                // height has already been a literal that drifted from this
                // constant once, in four files.
                style={{ height: `${POSTER_FRACTION * 100}dvh` }}
                className="absolute inset-x-0 top-0 overflow-hidden bg-muted"
              >
                <Poster event={event} priority={index === currentIndex} />
                {/* NO scrim across the top of the artwork. It existed to keep
                    the floating back arrow and heart legible over a pale
                    poster; both are gone, so all it does now is darken the
                    top quarter of the one image the page is about. */}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── THE GESTURE PLATE ──────────────────────────────────────────────
          Sits between the artwork and the sheet in DOM order, so it is BELOW
          the sheet, the handle, the scroller, the CTA and every sub-sheet —
          each of those keeps its own touches exactly as before — and above
          the poster layer, which is `pointer-events-none` on purpose. Its live
          hit region is therefore precisely the strip that used to be dead: the
          picture, the scrim, the space either side. A drag beginning anywhere
          there now moves the sheet; a sideways one changes event; a tap
          leaves. `touch-none` keeps the browser from taking the gesture for
          its own scrolling first.

          The back arrow and the favourite button that used to float here are
          gone — see the keyboard and history effects for the exits that
          replace the arrow, and the account area for saving. */}
      <div
        aria-hidden
        onPointerDown={onOverlayPointerDown}
        onPointerMove={onOverlayPointerMove}
        onClick={onOverlayClick}
        className="absolute inset-0 touch-none"
      />

      {/* The SHEET. Drags on Y only; it is transparent, because the visible
          panels are the cards inside the track. */}
      {/* The SHEET. A plain div, not a `motion.div`: its transform is
          written straight onto the node by `writeSheetY` and settled with a
          CSS transition, so it animates on the compositor and costs no React
          render per frame — the same treatment, for the same reason, as the
          horizontal track inside it.

          NOTHING here may name `transform` or `transition`. React re-applies
          the inline styles it owns on every render, so a `transform` in this
          object would land on top of whatever the gesture had just written,
          mid-drag. It owns `willChange` and nothing else. */}
      <div
        ref={sheetRef}
        style={{ willChange: 'transform' }}
        className="absolute inset-x-0 top-0 h-[100dvh] touch-none overflow-hidden"
      >
        {/* The TRACK. Positioned by hand — see the note at the top. */}
        <div
          ref={trackRef}
          style={{ paddingLeft: railPadding, paddingRight: railPadding, willChange: 'transform' }}
          className="flex h-full items-stretch"
        >
          {events.map((event, index) => {
            const active = index === currentIndex;
            return (
              <div
                key={event.id}
                style={{
                  width: cardWidth,
                  marginRight: index === events.length - 1 ? 0 : gap,
                  // A CONSTANT. It used to be `calc(100dvh - var(--deck-y))`,
                  // which relaid out the whole event page on every frame of
                  // every drag — see `writeSheetY` for what replaced it.
                  height: '100dvh',
                  // ── THE ACTIVE PAGE PAINTS ABOVE ITS NEIGHBOURS ─────────
                  //
                  // `shadow-deck` is `0 40px 90px` — a 90px blur, so it
                  // spreads about 45px sideways. When the pages PEEKED that
                  // fell on a dimmed backdrop and read as depth. Full-bleed,
                  // the pages abut exactly, and the next one is a LATER
                  // sibling: its shadow painted over the active page's right
                  // edge, a visible dark gradient down the last ~45px of every
                  // screen. Measured in a screenshot before it was believed.
                  //
                  // Raising the active page puts both neighbours underneath,
                  // so nothing can cast onto the page being read. During a
                  // swipe the outgoing page passes over the incoming one,
                  // which is what two cards moving past each other look like.
                  zIndex: active ? 1 : 0,
                }}
                className="relative shrink-0"
                aria-hidden={active ? undefined : true}
              >
                <div
                  data-deck-card={active ? 'active' : 'peek'}
                  // The peeking strips are part of "the sides". They sit
                  // INSIDE the sheet, so the gesture plate behind it never
                  // sees them — a drag begun on the sliver of the next event
                  // did nothing at all. They carry no controls and no
                  // scroller, so the overlay rule applies to them exactly.
                  onPointerDown={active ? undefined : onOverlayPointerDown}
                  onPointerMove={active ? undefined : onOverlayPointerMove}
                  // NO inline transform/opacity here, deliberately. There was
                  // one, meant as a first-paint value for `applyTrack` to take
                  // over — but React re-applies inline styles on every render,
                  // so each index flip re-landed both properties instantly
                  // while the cell's transition was still `none`, and the
                  // settle cross-fade never ran. `applyTrack` is the ONLY
                  // writer; the layout effect gives the first paint its values
                  // before the browser draws.
                  className={cn(
                    'relative flex h-full flex-col overflow-hidden bg-background text-foreground shadow-deck',
                    // ── THE TOP TWO CORNERS ONLY ─────────────────────────
                    // All four were rounded and there was a border all the
                    // way round, because the neighbours PEEKED and those
                    // edges were the thing that made a sliver read as a card
                    // rather than as a slab.
                    //
                    // A page is the full width of the viewport now, so the
                    // side and bottom edges are off the screen: a border
                    // there is a hairline nobody can see, and a bottom radius
                    // is two wedges of black under a CTA bar that sits on the
                    // screen edge. What is left is the one edge that is
                    // actually visible — the top, meeting the artwork — which
                    // is the shape every bottom sheet has.
                    'rounded-t-3xl border-t border-border',
                  )}
                >
                  {active ? (
                    <ActiveCard
                      event={event}
                      detail={detail}
                      content={content}
                      tiers={tiers}
                      events={events}
                      isExpanded={isExpanded}
                      deckIndex={currentIndex}
                      ctaHeight={ctaHeight}
                      bottomInset={bottomInset}
                      price={price}
                      scrollerRef={scrollerRef}
                      ctaRef={ctaRef}
                      onStartSheetDrag={startSheetDrag}
                      onContentPointerDown={onContentPointerDown}
                      onContentPointerMove={onContentPointerMove}
                      onOpenSheet={setActiveSubSheet}
                      onSelectEvent={(id) => {
                        const next = events.findIndex((candidate) => candidate.id === id);
                        if (next >= 0) goTo(next);
                      }}
                      onLeave={closeDeck}
                      onHandleTap={handleTap}
                    />
                  ) : (
                    // A NEIGHBOUR. Only about six percent of it is ever on
                    // screen, so it renders the poster and nothing else —
                    // twenty full event pages mounted at once would cost a
                    // fetch and a subtree each for a sliver of artwork.
                    <NeighbourCard event={event} bottomInset={bottomInset} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <EventSubSheets
        sheetType={activeSubSheet}
        onClose={() => setActiveSubSheet(null)}
        event={currentEvent}
        detail={detail}
        content={content}
        pool={events}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

function Poster({ event, priority }: { event: EventCardData; priority?: boolean }) {
  if (!event.poster_url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
        <Ticket className="size-12" aria-hidden />
      </div>
    );
  }
  return (
    <Image
      src={event.poster_url}
      alt={event.title}
      fill
      priority={priority}
      sizes="100vw"
      className="object-cover"
      draggable={false}
    />
  );
}

/**
 * A NEIGHBOUR's content sheet — everything the LIST already knows, and no more.
 *
 * It used to render the poster itself. It must not any more: the anchored
 * layer behind now draws a poster for EVERY event in the track, so a neighbour
 * drawing its own would be the same artwork twice, the lower copy sliding over
 * the upper one on every drag.
 *
 * ── IT GREW WHEN THE PEEK WENT AWAY ───────────────────────────────────────
 *
 * When neighbours peeked, about six percent of this was ever on screen and a
 * handle plus a title was more than enough. A page is the full viewport now,
 * so the incoming event is entirely visible for the whole length of a swipe —
 * and a screen that is blank below the title for that half-second reads as the
 * next event having failed to load, which is the opposite of the confidence a
 * pager is supposed to give.
 *
 * So it carries the same first screen as an active card: handle, title, date,
 * venue, and the ticket bar with the real price. On release the swap for the
 * real `ActiveCard` then only fills in what was below the fold, and the eye
 * reads the page as having been there all along.
 *
 * ── AND IT STILL DOES NOT FETCH ───────────────────────────────────────────
 *
 * Every field here is on the `EventCard` the list already handed us. Twenty of
 * these are mounted at once, so there is no request, no `useEventWidgetData`,
 * and no event-page subtree — the cost of a neighbour is a handful of DOM
 * nodes, exactly as before.
 */
function NeighbourCard({
  event,
  bottomInset,
}: {
  event: EventCardData;
  /** See the active page's `bottomInset` — the page hangs below the screen. */
  bottomInset: number;
}) {
  const price = formatFromPrice(event.from_price);
  const when = event.starts_at
    ? [formatEventDate(event.starts_at), formatEventTime(event.starts_at)]
        .filter(Boolean)
        .join(' · ')
    : null;
  const where = [event.venue, event.city].filter(Boolean).join(', ');

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-11 shrink-0 items-center justify-center" aria-hidden>
        <span className="h-1.5 w-12 rounded-full bg-border-strong" />
      </div>
      <div className="flex flex-col gap-1.5 px-5 pt-4">
        <p className="line-clamp-2 text-h3 font-extrabold leading-tight text-foreground">
          {event.title}
        </p>
        {when ? <p className="text-body-sm font-semibold text-primary">{when}</p> : null}
        {where ? (
          <p className="line-clamp-1 text-body-sm text-muted-foreground">{where}</p>
        ) : null}
      </div>
      {/* The same bar the active page carries, so the swap on release does not
          make a control appear. Not a link and not focusable: this page is
          `aria-hidden` and is on its way past. */}
      <div
        className="absolute inset-x-0 border-t border-border bg-background px-4 pt-3"
        // A plain `bottom`, not the active bar's per-frame transform: this
        // page is only ever on screen during a horizontal swipe, where `y` is
        // not moving, so the snap's inset is the whole answer.
        style={{
          bottom: bottomInset,
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
        }}
        aria-hidden
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-h4 font-extrabold tabular-nums text-foreground">
              {price === null ? 'See tickets' : price === 'Free' ? 'Free entry' : price}
            </span>
            {price !== null && price !== 'Free' ? (
              <span className="text-caption font-semibold text-muted-foreground">onwards</span>
            ) : null}
          </div>
          <span className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-cta px-7 text-body-sm font-extrabold text-cta-foreground">
            Book tickets
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Where you are in the deck, and that there is a deck at all.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 *
 * The neighbours used to peek a few percent in at both edges, and that peek
 * was the ENTIRE affordance: two real posters at the rim saying "there are
 * more of these and they move sideways", with no instruction and no chrome.
 * Full-bleed pages are what was asked for and they are unarguably better to
 * read, but they took the hint with them — a page that fills the screen looks
 * like a page, and nobody swipes a page.
 *
 * Dots are the one pagination signal that needs no explaining, and every
 * number in them is real: the deck's own `currentIndex` and `events.length`.
 * Nothing is invented, which is the rule everywhere else on this platform.
 *
 * ── WHY A WINDOW ─────────────────────────────────────────────────────────
 *
 * A browse deck is twenty events and a rail can be more. Twenty dots is not a
 * position indicator, it is a texture. Five, sliding so the active one stays
 * near the middle, says "there are more either side" at any length — and at
 * three events it just shows three, because a window wider than the deck
 * would claim events that are not there.
 *
 * ── AND WHY IT IS `aria-hidden` ──────────────────────────────────────────
 *
 * Swiping the deck is a pointer gesture with no keyboard or screen-reader
 * equivalent — there are no previous/next buttons, by the owner's decision to
 * strip floating controls from this surface. Announcing a position somebody
 * cannot act on is noise, so this stays decoration until there is an operable
 * control to attach it to, which is the clean place to add one.
 */
function DeckPager({ index, total }: { index: number; total: number }) {
  // Absent, not empty: one event is not a deck.
  if (total < 2) return null;
  const size = Math.min(5, total);
  // Slid so the active dot sits mid-window wherever the deck allows it, and
  // clamped at both ends so the window never runs past the real events.
  const start = Math.max(0, Math.min(index - Math.floor(size / 2), total - size));
  return (
    <span
      aria-hidden
      // `pointer-events-none`: it sits over the handle's 44px grab area, and a
      // pager that swallowed the drag would break the control it is next to.
      className="pointer-events-none absolute right-4 top-0 flex h-11 items-center gap-1"
    >
      {Array.from({ length: size }, (_, offset) => start + offset).map((dot) => (
        <span
          key={dot}
          className={cn(
            'h-1.5 rounded-full transition-[width,background-color] duration-base ease-out',
            dot === index ? 'w-4 bg-foreground' : 'w-1.5 bg-border-strong',
          )}
        />
      ))}
    </span>
  );
}

function ActiveCard({
  event,
  detail,
  content,
  tiers,
  events,
  isExpanded,
  deckIndex,
  ctaHeight,
  bottomInset,
  price,
  scrollerRef,
  ctaRef,
  onStartSheetDrag,
  onContentPointerDown,
  onContentPointerMove,
  onOpenSheet,
  onSelectEvent,
  onLeave,
  onHandleTap,
}: {
  event: EventCardData;
  detail: React.ComponentProps<typeof EventWidgetContent>['detail'];
  content: React.ComponentProps<typeof EventWidgetContent>['content'];
  tiers: React.ComponentProps<typeof EventWidgetContent>['tiers'];
  events: readonly EventCardData[];
  isExpanded: boolean;
  /** Which event of the deck this is, for the pager. */
  deckIndex: number;
  ctaHeight: number;
  /** Pixels of the page that sit below the screen at the current snap. */
  bottomInset: number;
  price: string | null;
  scrollerRef: React.RefObject<HTMLDivElement>;
  ctaRef: React.RefObject<HTMLDivElement>;
  onStartSheetDrag: (event: React.PointerEvent) => void;
  onContentPointerDown: (event: React.PointerEvent) => void;
  onContentPointerMove: (event: React.PointerEvent) => void;
  onOpenSheet: (sheet: NonNullable<SubSheetType>) => void;
  onSelectEvent: (id: string) => void;
  /** Closes WITHOUT the exit animation — for navigating away. */
  onLeave: () => void;
  onHandleTap: () => void;
}) {
  return (
    <>
      {/* ── THE HANDLE IS A CONTROL, NOT A DECORATION ────────────────────
          The pill is 6px tall. Its grab area was the 20px strip around it,
          which on a real thumb is a target you miss more often than you hit —
          and missing it did nothing at all, so the handle read as painted on.

          It is a BUTTON now, 44px tall (the brief's minimum target), spanning
          the card's full width. The pill inside is unchanged; what grew is the
          part your thumb has to find.

          It answers to BOTH gestures, which is the other half of the fix:

            DRAG  — `onPointerDown` hands the gesture straight to the sheet, so
                    the surface follows the finger from the first pixel.
            TAP   — `onClick` steps one snap taller. A control that only
                    responds to a drag is a control most people conclude is
                    broken, because the first thing anyone does to a small
                    horizontal bar is press it.

          The two do not fight: a press that turns into a drag is claimed by
          the drag, and `dragged` records that so the click that follows a drag
          release does not also step the sheet. */}
      <button
        type="button"
        onPointerDown={onStartSheetDrag}
        onClick={onHandleTap}
        aria-label={isExpanded ? 'Collapse event' : 'Expand event'}
        className="flex h-11 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1.5 w-12 rounded-full bg-border-strong" aria-hidden />
      </button>
      <DeckPager index={deckIndex} total={events.length} />

      {/* Content ONLY. The hero has moved out to the anchored layer behind
          this sheet — see the note there. It has been both ways: pinned
          outside the scroller it held ~60% of the screen permanently and the
          whole event was read through what was left; inside the scroller it
          scrolled away and the top of the screen went blank. Anchored BEHIND a
          sheet that slides over it is the third arrangement and the one the
          reference uses: the artwork is always in the same place, and how much
          of it you can see is the reader's choice, made by dragging. */}
      <div
        ref={scrollerRef}
        data-deck-scroller
        onPointerDown={onContentPointerDown}
        onPointerMove={onContentPointerMove}
        className="flex-1 overflow-y-auto overscroll-contain"
        // The bar's real height, PLUS the part of the page that is below the
        // screen at this snap — see `bottomInset`. The old value cleared only
        // the bar, which was right when the page was resized to the visible
        // area and leaves the last section under the fold now that it is not.
        style={{ paddingBottom: `${(ctaHeight || 112) + bottomInset + 16}px` }}
      >
        <EventWidgetContent
          key={event.id}
          event={event}
          detail={detail}
          content={content}
          tiers={tiers}
          pool={events}
          onOpenSheet={onOpenSheet}
          onSelectEvent={onSelectEvent}
        />
      </div>

      {/* Sticky ticket bar. Safe-area aware, and the content above is padded by
          its measured height so nothing can hide behind it. */}
      <div
        ref={ctaRef}
        className="absolute inset-x-0 bottom-0 z-30 border-t border-border bg-background px-4 pt-3"
        // `transform` and `transition` are written straight onto this node
        // by `writeSheetY`, never from here: it is anchored to the bottom of
        // the PAGE, which hangs below the screen, and is pulled back up by
        // exactly that much on the same curve the sheet uses, so it stays
        // pinned to the screen edge throughout a settle rather than only at
        // its ends. `willChange` keeps it on its own compositor layer.
        style={{
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
          willChange: 'transform',
        }}
      >
        {/* NO EMI banner. This platform has no EMI arrangement and no column
            saying whether one applies — a claim about somebody's money, on the
            checkout surface, backed by nothing. */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-h4 font-extrabold tabular-nums text-foreground">
              {price === null ? 'See tickets' : price === 'Free' ? 'Free entry' : price}
            </span>
            {price !== null && price !== 'Free' ? (
              <span className="text-caption font-semibold text-muted-foreground">onwards</span>
            ) : null}
          </div>
          {/* Straight to the ticket screen. Never back through the old
              standalone event page. */}
          <Link
            href={`/booking/${event.id}`}
            // `onLeave`, not `onDismiss`: dismiss animates and closes the deck
            // in the animation's completion callback, and this component
            // unmounts the moment the route changes — so the callback never
            // ran and the deck was still "open" when you came back.
            onClick={onLeave}
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-cta px-7 text-body-sm font-extrabold text-cta-foreground shadow-lg transition-transform active:scale-95"
          >
            Book tickets
          </Link>
        </div>
      </div>
    </>
  );
}
