'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Ticket } from 'lucide-react';
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from 'framer-motion';
import { useEventDeck } from '@/lib/discovery/event-deck-context';
import { useEventWidgetData } from '@/lib/discovery/use-event-widget-data';
import { useScrollLock } from '@/lib/discovery/use-scroll-lock';
import {
  EXPANDED_CARD_FRACTION,
  EXPANDED_SNAP_INDEX,
  INITIAL_SNAP_INDEX,
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

const SPRING = { type: 'spring', stiffness: 340, damping: 36, mass: 0.9 } as const;
/**
 * How long the poster takes to travel between a card and the hero.
 *
 * Short on purpose. This is a booking app, not a presentation: the transition
 * has to explain WHICH event was selected and then get out of the way, and
 * anything past about a third of a second starts to read as the interface
 * making the reader wait. It is also the scrim's duration, so the list fading
 * and the poster arriving are one movement rather than two.
 */
const FLIGHT_MS = 220;
/**
 * How far back a neighbouring card sits when it is fully off-centre.
 *
 * These are the values the static classes carried; what changed is that they
 * are now the ENDPOINTS of an interpolation rather than a state a card snaps
 * between. Keeping the numbers identical means the resting appearance of the
 * deck is unchanged — only the way it gets there is.
 */
const PEEK_SCALE = 0.97;
const PEEK_OPACITY = 0.7;
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
/** Fraction of the viewport the active card occupies while the deck is inset. */
const CARD_FRACTION = 0.88;
/** Gap between cards in the track, in px, while the deck is inset. */
const CARD_GAP = 10;
/**
 * The gap between cards once the sheet is expanded. Wider cards and a tighter
 * gap, NOT full-bleed: the neighbours stay in frame so the deck is still a deck
 * at its tallest. The width itself is `EXPANDED_CARD_FRACTION`, which lives in
 * `sheet-snap` because the pre-hydration cover reads it too.
 */
const EXPANDED_CARD_GAP = 6;
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
  const [snapIndex, setSnapIndex] = React.useState(INITIAL_SNAP_INDEX);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [ctaHeight, setCtaHeight] = React.useState(0);

  const y = useMotionValue(0);
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
   * ── EXPANDING IS NOT A CHANGE OF IDENTITY ──────────────────────────────
   *
   * This used to go full-bleed at the top snap — `viewport.width`, zero gap,
   * square corners — because the top snap WAS the whole screen. It is not any
   * more (see `SHEET_SNAP_FRACTIONS`), and the transformation was always the
   * wrong instinct: a card that becomes a page mid-gesture takes its
   * neighbours with it, so the swipe that was carrying somebody through a deck
   * silently stops being available at exactly the moment they are most
   * engaged.
   *
   * It widens instead. Same object, more of it — the neighbours stay in the
   * frame, narrower, so the deck is still legibly a deck.
   */
  const cardWidth = Math.round(
    viewport.width * (isExpanded ? EXPANDED_CARD_FRACTION : CARD_FRACTION),
  );
  const gap = isExpanded ? EXPANDED_CARD_GAP : CARD_GAP;
  const stride = cardWidth + gap;
  const railPadding = Math.round((viewport.width - cardWidth) / 2);
  const restingX = React.useCallback((index: number) => -index * stride, [stride]);

  /**
   * ── THE CARD IS AS TALL AS WHAT YOU CAN SEE ────────────────────────────
   *
   * The sheet is a full-viewport element translated DOWN by `y`, so at any
   * snap below full screen its bottom edge sits `y` pixels past the bottom of
   * the screen. A card of `100dvh` inside it therefore hangs off the bottom by
   * exactly that much — and the sticky "Book tickets" bar, anchored to the
   * card's bottom, went with it. At the resting snap the primary call to
   * action was 113px below the visible area: present in the DOM, clickable by
   * a test that scrolls, and invisible to a person.
   *
   * So the card's height is `100dvh - y`, published as a CSS variable written
   * straight from the motion value. One `setProperty` per frame on one
   * element, inherited by the cards — no React render, and the bottom of the
   * card is the bottom of the screen at every snap and all the way through a
   * drag.
   */
  useMotionValueEvent(y, 'change', (value) => {
    sheetRef.current?.style.setProperty('--deck-y', `${Math.max(value, 0)}px`);
  });

  /** Writes the sheet's translate while a finger is on it. */
  const applySheet = React.useCallback(
    (offset: number) => {
      y.set(offset);
    },
    [y],
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
      const transition =
        settle && !reduceMotion ? 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
      const transform = `translate3d(${offset}px, 0, 0)`;
      for (const node of [trackRef.current, posterTrackRef.current]) {
        if (!node) continue;
        node.style.transition = transition;
        node.style.transform = transform;
      }

      /**
       * ── PROMINENCE IS INTERPOLATED, NOT SWITCHED ──────────────────────
       *
       * The neighbours used to carry a STATIC `scale-[0.97] opacity-70` class
       * with a 300ms transition, so an incoming card sat at its dimmed size
       * for the whole swipe and then cross-faded once the index flipped. That
       * is the `drag -> wait -> change -> animate` shape: the visual state
       * lagged the finger by an entire gesture, and reversing mid-swipe made
       * two cards animate the wrong way at once.
       *
       * The same `offset` that positions the track also says exactly where
       * each card is relative to the centre, so the state is DERIVED from it
       * in the same frame. A card halfway in is halfway bright. Reversing
       * direction reverses it immediately, because there is nothing running
       * that has to be cancelled first — the only thing moving is the finger.
       *
       * Writes only: `transform` and `opacity`, both compositor properties,
       * and no `getBoundingClientRect` anywhere near a gesture.
       */
      const track = trackRef.current;
      if (!track || stride <= 0) return;
      const centre = -offset / stride;
      const cells = track.querySelectorAll<HTMLElement>('[data-deck-card]');
      const cellTransition =
        settle && !reduceMotion
          ? 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1), opacity 340ms cubic-bezier(0.22, 1, 0.36, 1)'
          : 'none';
      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index];
        // Clamped at one card's distance: everything further out is simply
        // "not the one", and letting it keep shrinking would make a long list
        // fade to nothing at the edges for no reason.
        const distance = Math.min(Math.abs(index - centre), 1);
        cell.style.transition = cellTransition;
        cell.style.transform = `scale(${1 - distance * (1 - PEEK_SCALE)})`;
        cell.style.opacity = String(1 - distance * (1 - PEEK_OPACITY));
      }
    },
    [reduceMotion, stride],
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
    return () => observer.disconnect();
  }, [isOpen]);

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
    from: Box;
    to: Box;
    direction: 'in' | 'out';
    src: string;
    alt: string;
  } | null>(null);

  /**
   * ── WHERE THE SHEET IS ON ITS FIRST PAINTED FRAME ──────────────────────
   *
   * `y` is a motion value initialised to 0, and until now it was first set
   * inside the passive enter effect below — which runs AFTER the browser has
   * painted. On the very first open of a session that painted one frame with
   * the sheet at translateY(0): a full-height card covering the whole screen,
   * poster hidden, at the resting position of nothing. From the feed nobody
   * ever saw it, because a previous close had left `y` off-screen. From a
   * shared link it is the first frame the reader sees, on the platform's
   * most-shared URL.
   *
   * A layout effect runs before paint. A deep link lands the sheet directly at
   * its expanded snap — it IS the page, and the brief is explicit that it must
   * not arrive minimized and wait for a gesture. A feed open parks it below
   * the viewport, where the passive effect then decides how it enters.
   */
  React.useLayoutEffect(() => {
    if (!isOpen || viewport.height === 0) return;
    const snaps = snapPixels(viewport.height);
    if (openOptionsRef.current.expanded) {
      setSnapIndex(EXPANDED_SNAP_INDEX);
      y.set(snaps[EXPANDED_SNAP_INDEX]);
      return;
    }
    y.set(viewport.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, viewport.height]);

  // Enter: from just below the viewport up to the resting snap, with the
  // tapped event already centred.
  React.useEffect(() => {
    if (!isOpen || viewport.height === 0) return;
    justOpenedRef.current = true;
    // Opened already expanded — a deep link. There is no card on the page to
    // fly from and no entrance to play; the layout effect above has placed it.
    if (openOptionsRef.current.expanded) return;
    const resting = snapPixels(viewport.height)[INITIAL_SNAP_INDEX];
    setSnapIndex(INITIAL_SNAP_INDEX);
    if (reduceMotion) {
      y.set(resting);
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
      y.set(Math.min(viewport.height, destination.top + destination.height));
    } else {
      y.set(viewport.height);
    }

    const controls = animate(y, resting, SPRING);
    return () => controls.stop();
    // `currentIndex` is deliberately absent: this runs on OPEN, and re-running
    // it when the reader swipes would drop the sheet back to its entry height.
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

  React.useEffect(() => {
    if (!isOpen) {
      setActiveSubSheet(null);
      // The flight belongs to the deck, not to the layer that draws it. Clearing
      // it here is what makes `SharedPoster`'s cleanup able to be a plain
      // cancel — an interrupted transition can never leave the real hero
      // hidden, because the only thing that hides it is this state.
      setFlight(null);
    }
  }, [isOpen]);

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
      setSnapIndex(index);
      if (reduceMotion) y.set(target);
      else animate(y, target, SPRING);
    },
    [snaps, y, reduceMotion],
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
        from: target,
        to: source,
        direction: 'out',
        src: leaving.poster_url,
        alt: leaving.title,
      });
      // The sheet drops only as far as the poster's lower edge, so the two
      // finish together rather than the panel disappearing and leaving the
      // image to travel alone.
      animate(y, Math.min(viewport.height, source.top + source.height), SPRING);
      return;
    }

    animate(y, viewport.height, { ...SPRING, onComplete: finishClose });
  }, [finishClose, viewport.height, viewport.width, y, reduceMotion]);

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
      const base = y.get();
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
          // `y.get()` IS the live, resistance-damped position — the term that
          // used to be added here was multiplied by zero, so it described
          // nothing and only made the line look like it accounted for travel.
          y: y.get(),
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
    [applySheet, dismiss, snapTo, snaps, viewport.height, y],
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
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : FLIGHT_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
        // Decoration only. Its tap-to-close moved to the gesture plate below,
        // where it can be guarded against the click that follows a drag.
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/80 via-black/70 to-black/85 backdrop-blur-md"
        aria-hidden
      />

      {/* The poster in flight between the card and the hero. Mounted only for
          the length of one transition, and it removes itself. */}
      {flight ? (
        <SharedPoster
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
                className="absolute inset-x-0 top-0 h-[68dvh] overflow-hidden rounded-3xl bg-muted"
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
      <motion.div
        ref={sheetRef}
        // The variable is seeded here rather than in a class, because the
        // project's lint rule (correctly) refuses raw px in Tailwind arbitrary
        // values — and this one is not a design token, it is a live readout of
        // the sheet's own translate.
        style={{ y, ...({ '--deck-y': '0px' } as React.CSSProperties) }}
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
                  height: 'calc(100dvh - var(--deck-y, 0px))',
                }}
                className="shrink-0"
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
                    // ── ALL FOUR CORNERS, IN EVERY STATE ─────────────────
                    // It was `rounded-t-3xl` only, so the card met the bottom
                    // of the screen with two hard corners and the neighbours
                    // either side read as square slabs rather than as cards.
                    // The bottom rounding is invisible on the ACTIVE card
                    // (its CTA bar sits on the screen edge) and is exactly
                    // what makes the peeking ones look like objects.
                    //
                    // It used to square off at the top snap, because the top
                    // snap was the whole screen. The sheet no longer reaches
                    // the top, so there is no state in which this is a page
                    // rather than a card — and no radius animation to run.
                    'rounded-3xl border border-border',
                    // The neighbours are context, not content: dimmed and set
                    // back a little so the centre reads as the one in focus.
                    // Those two values now live in `PEEK_SCALE`/`PEEK_OPACITY`
                    // and are applied as INLINE styles, because they are
                    // interpolated per frame rather than toggled per index.
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
                      ctaHeight={ctaHeight}
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
                    <NeighbourCard event={event} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

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
 * A NEIGHBOUR's content sheet — a blank panel and its title, nothing more.
 *
 * It used to render the poster itself. It must not any more: the anchored
 * layer behind now draws a poster for EVERY event in the track, so a neighbour
 * drawing its own would be the same artwork twice, the lower copy sliding over
 * the upper one on every drag.
 *
 * About six percent of this is ever on screen, which is why it is a title on a
 * surface rather than an event page: twenty of those mounted at once would
 * cost a fetch and a subtree each for a sliver.
 */
function NeighbourCard({ event }: { event: EventCardData }) {
  /**
   * Shaped like the TOP of an active card — handle, title, date line — rather
   * than a title alone on a gradient.
   *
   * On release the incoming neighbour is swapped for a full `ActiveCard` in the
   * same frame the index changes. When the neighbour looked nothing like the
   * card that replaces it, that swap read as a REPLACE: a slab with three lines
   * of text became a page with a handle, rows and a CTA bar in one frame. When
   * the neighbour already carries the same first hundred pixels, the swap only
   * fills in what was below the fold, and the eye reads the card as having
   * been there all along.
   *
   * Still no data fetch and no subtree: twenty of these are mounted at once.
   */
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 justify-center pb-1 pt-2.5" aria-hidden>
        <span className="h-1.5 w-12 rounded-full bg-border-strong" />
      </div>
      <div className="flex flex-col gap-1.5 px-5 pt-5">
        <p className="line-clamp-2 text-h3 font-extrabold leading-tight text-foreground">
          {event.title}
        </p>
        {event.starts_at ? (
          <p className="text-body-sm font-semibold text-primary">
            {formatEventDate(event.starts_at)}
            {formatEventTime(event.starts_at) ? ` · ${formatEventTime(event.starts_at)}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ActiveCard({
  event,
  detail,
  content,
  tiers,
  events,
  isExpanded,
  ctaHeight,
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
  ctaHeight: number;
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
        style={{ paddingBottom: ctaHeight ? `${ctaHeight + 16}px` : '7rem' }}
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
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
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
