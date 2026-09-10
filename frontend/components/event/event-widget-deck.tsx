'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Ticket } from 'lucide-react';
import { type MotionValue, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { useEventDeck } from '@/lib/discovery/event-deck-context';
import { useEventWidgetData } from '@/lib/discovery/use-event-widget-data';
import { useScrollLock } from '@/lib/discovery/use-scroll-lock';
import {
  DECK_EDGE_PADDING_PX,
  HERO_ASPECT_H,
  HERO_ASPECT_W,
  HERO_RADIUS_PX,
  THUMB_RADIUS_PX,
  THUMB_SIZE_PX,
  shouldDock,
} from '@/lib/discovery/deck-metrics';
import { formatEventDate, formatEventTime, formatFromPrice } from '@/lib/discovery/format';
import { bookingCtaLabel, canStartBooking, summariseTiers } from '@/lib/discovery/tiers';
import type { EventCard as EventCardData, TicketTier } from '@/lib/api/types';
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
import {
  EventWidgetContent,
  EventWidgetSummary,
  sectionTabsFor,
} from './event-widget-content';
import { SectionTabs } from './section-tabs';
import { BrandMark } from '@/components/shell/brand-mark';
import { Lightbox, type LightboxImage } from './lightbox';
import { SharedPoster } from './shared-poster';

/**
 * THE MOBILE EVENT PAGE.
 *
 * A horizontal deck of events. Tapping a card anywhere on the site opens this
 * over the page; `/events/{slug}-{uuid}` opens it too, so a link somebody was
 * SENT lands on the same surface a link somebody tapped does.
 *
 * ── IT IS A SCROLLING PAGE NOW, NOT A BOTTOM SHEET ────────────────────────
 *
 * This used to be a draggable sheet over an anchored poster: a snap ladder
 * (`sheet-snap.ts`), a vertical drag that handed travel back and forth with the
 * content scroller, a gesture plate that made the whole screen draggable, a
 * grab handle, and a transform written to the sheet node every frame with the
 * ticket bar counter-translated to stay on screen.
 *
 * All of it is gone. Each page is an ordinary vertical scroller: the poster is
 * IN the flow rather than behind it, so scrolling moves the artwork away like
 * any other page, and the browser owns every vertical gesture with nothing
 * intercepting it. What is left of the gesture code is one axis — horizontal,
 * for the deck — and it commits only when a movement is decisively sideways.
 *
 * ── AND THE POSTER DOCKS INSTEAD OF LEAVING ───────────────────────────────
 *
 * Scrolling past the hero moves it into the booking bar as a circular
 * thumbnail, and scrolling back to the top returns it. It is ONE element in two
 * places — a framer `layoutId` handoff — never a second copy cross-faded
 * against the first, which is what would let the two disagree about which event
 * is on screen.
 *
 * The pair lives INSIDE the active page on purpose. The page track carries an
 * imperative `translate3d` that framer knows nothing about; measuring one end
 * of the handoff inside that transform and the other outside it puts a whole
 * page-width into the delta. Both ends share the ancestor, so it cancels.
 */

/**
 * How long the poster's flight between a card and the hero takes.
 *
 * Everything that moves during an open or a close shares it — the scrim, the
 * page, the clone — so the arrival reads as one movement rather than as three
 * things starting at once and finishing whenever.
 */
const FLIGHT_MS = 220;

/** The house curve: fast out, long settle. */
const TRANSITION_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const PAGE_TRANSITION = { duration: FLIGHT_MS / 1000, ease: TRANSITION_EASE };

/** How long the poster takes to dock into the bar, or to come back out. */
const DOCK_MS = 320;

/** How long the track takes to settle onto a page after a release. */
const SETTLE_MS = 340;
const SETTLE_EASE = `cubic-bezier(${TRANSITION_EASE.join(', ')})`;

/** How far a gesture must travel before it is allowed to commit to an axis. */
// RAISED FROM 10. The direction of a gesture is at its noisiest in the first
// few pixels, and deciding on ten of them decides on the noise — which is the
// "casual scrolling changes the event" report. Sixteen is still well under
// the distance anybody would call a swipe, and it is measured on EITHER axis,
// so an ordinary scroll is not delayed by it.
const COMMIT_SLOP = 16;

/**
 * How much more horizontal than vertical a movement must be to be a swipe.
 *
 * A MARGIN, not a bare comparison. A thumb pivots from a knuckle, so a vertical
 * swipe over a large poster draws an arc that crosses 45 degrees for a frame or
 * two near the start; on a bare `>` that frame decides the gesture, and "I
 * scrolled and it changed the event" is the commonest way this reads as broken.
 */
// RAISED FROM 1.2. At 1.2 the margin is about 50 degrees off vertical, which
// a thumb arc clears on an ordinary scroll. At 1.8 the movement has to be
// roughly 61 degrees from vertical: still a comfortable diagonal, no longer
// an accident.
const AXIS_DOMINANCE = 1.8;

/** Pages abut exactly — a full-screen pager has no rim to peek through. */
const CARD_GAP = 0;

/** How far a slow drag must travel, as a fraction of a page, to advance. */
const ADVANCE_FRACTION = 0.25;
/** A flick faster than this advances even if the finger barely moved. px/s. */
const ADVANCE_VELOCITY = 350;
/** A finger that has been still for longer than this has no velocity left. */
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
  // happens to come first in the document.
  React.useEffect(() => installPosterOriginTracker(), []);

  const [activeSubSheet, setActiveSubSheet] = React.useState<SubSheetType>(null);
  /** True from the moment a close is committed, so the scrim can leave with
   *  the page — and so nothing can half-rescue a close already in flight. */
  const [leaving, setLeaving] = React.useState(false);
  const closingRef = React.useRef(false);
  const closeTimerRef = React.useRef<number | null>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [ctaHeight, setCtaHeight] = React.useState(0);

  /**
   * IS THE POSTER DOCKED IN THE BOOKING BAR.
   *
   * Deck-level rather than per page, and that is what makes a swipe while
   * scrolled behave: the incoming page mounts already docked instead of
   * flashing its hero for the frame before its own scroll listener has run.
   */
  const [docked, setDocked] = React.useState(false);
  const dockedRef = React.useRef(false);
  /**
   * How opaque the hero's blurred backdrop is, 1 at the top and 0 once the
   * poster has scrolled its own height away.
   *
   * A MotionValue, NOT state. This is written on every scroll event; as
   * state it would re-render the whole event page — content, lineup rail,
   * gallery and all — dozens of times a second on the one code path where
   * the finger is already on the glass. A MotionValue writes straight to the
   * node's style and re-renders nothing.
   */
  const blurOpacity = useMotionValue(1);
  /**
   * True when the gesture that just ended actually moved.
   *
   * The hero is a tap target now (it opens the lightbox), and a horizontal
   * swipe that begins on the poster ends with a `click` on release. Without
   * this, swiping to the next event opens a full-screen photograph on the way
   * past — the same class of bug the old gesture plate had, arriving from the
   * other direction.
   */
  const draggedRef = React.useRef(false);
  /** Which photograph the full-screen viewer is showing, or null. */
  const [lightboxAt, setLightboxAt] = React.useState<number | null>(null);
  /**
   * The scroll offset carried from page to page.
   *
   * ── THIS REVERSES A DECISION, AND THE REASON IS THE BRIEF ─────────────
   *
   * There was an effect here doing `scrollerRef.current?.scrollTo({ top: 0 })`
   * on every event change, justified as "a new event starts at the top of its
   * own content — carrying the previous event's scroll offset into it lands you
   * halfway down a page you have not seen".
   *
   * That is a real objection and it loses to an explicit requirement: swiping
   * while the thumbnail is docked has to keep it docked and swap its picture,
   * not throw the reader back to the top and re-expand a poster they had
   * deliberately scrolled past. It is also less arbitrary than it was — every
   * page here has the identical structure, hero then the same section order, so
   * the same offset lands on the same KIND of thing rather than somewhere
   * random. Written before paint (see the layout effect), so the incoming page
   * is never seen at the wrong offset.
   */
  const scrollTopRef = React.useRef(0);

  /**
   * THE POSTER FIRST, THEN THE GALLERY.
   *
   * One list, because the brief is that clicking ANY image opens the same
   * viewer — so the poster and the gallery have to be positions in a single
   * sequence, or arrowing right from the poster would land nowhere.
   */
  const lightboxImages = React.useMemo<LightboxImage[]>(() => {
    const list: LightboxImage[] = [];
    if (currentEvent?.poster_url) {
      list.push({ url: currentEvent.poster_url, alt: currentEvent.title });
    }
    for (const item of content?.media ?? []) {
      if (item.kind !== 'gallery') continue;
      list.push({ url: item.url, alt: item.alt_text || currentEvent?.title || '' });
    }
    return list;
  }, [content, currentEvent]);

  const openPoster = React.useCallback((index: number) => {
    // A swipe ends in a click. Consume it rather than opening a photograph
    // the reader was scrolling past.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setLightboxAt(index);
  }, []);

  const gestureRef = React.useRef<{
    x: number;
    y: number;
    committed: boolean;
    pointerId: number;
  }>({ x: 0, y: 0, committed: false, pointerId: -1 });
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const ctaRef = React.useRef<HTMLDivElement>(null);
  const heroRef = React.useRef<HTMLDivElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  /** True for the first positioning pass of an open, so the deck does not
   *  slide sideways into place while it is arriving. */
  const justOpenedRef = React.useRef(true);
  /** True once this open has been placed and its entrance played. */
  const enteredRef = React.useRef(false);
  /** The live horizontal drag, or null. A ref, so moving costs no render. */
  const swipeRef = React.useRef<{
    startX: number;
    base: number;
    lastX: number;
    lastAt: number;
    velocity: number;
  } | null>(null);

  // Measured, never assumed: a phone's viewport changes when the URL bar
  // collapses or it is rotated.
  React.useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  /**
   * ── ONE WIDTH, AND IT IS THE VIEWPORT ──────────────────────────────────
   *
   * A page is the whole screen with no gap, so the stride is a constant for the
   * life of an open and the horizontal track never has to be re-derived.
   */
  const cardWidth = viewport.width;
  const gap = CARD_GAP;
  const stride = cardWidth + gap;
  const restingX = React.useCallback((index: number) => -index * stride, [stride]);

  const applyTrack = React.useCallback(
    (offset: number, settle: boolean) => {
      const node = trackRef.current;
      if (!node) return;
      node.style.transition =
        settle && !reduceMotion ? `transform ${SETTLE_MS}ms ${SETTLE_EASE}` : 'none';
      node.style.transform = `translate3d(${offset}px, 0, 0)`;
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
    return () => observer.disconnect();
    // `currentEvent?.id` because a swipe replaces the bar with the incoming
    // page's, and the observer would otherwise be watching a node that has
    // left the screen.
  }, [isOpen, currentEvent?.id]);

  /**
   * ── THE POSTER IS A SHARED ELEMENT, NOT A NEW IMAGE ────────────────────
   *
   * A clone of the tapped card's poster flies from the card's box to the hero's
   * while the page fades up behind it. `flight` holds the two measured rects
   * for the life of one animation and nothing else; when it is null the deck
   * behaves exactly as it would have, which is the fallback for every case
   * where a source cannot be found — a seeded open from an account ticket, a
   * card scrolled out of view, reduced motion.
   */
  const [flight, setFlight] = React.useState<{
    id: number;
    from: Box;
    to: Box;
    direction: 'in' | 'out';
    src: string;
    alt: string;
  } | null>(null);
  const flightIdRef = React.useRef(0);

  // A LAYOUT effect, so the track is positioned in the first frame the deck
  // paints rather than sliding into place after it.
  React.useLayoutEffect(() => {
    if (!isOpen || viewport.width === 0) return;
    applyTrack(restingX(currentIndex), false);
    // Only on open and on a viewport change. `currentIndex` is handled by the
    // centring effect below, which also knows whether to settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, viewport.width]);

  /**
   * The ENTRANCE, and it is a LAYOUT effect for a measured reason.
   *
   * A state update inside a layout effect is flushed before the browser paints,
   * so `SharedPoster` mounts and starts in the SAME frame the page's own
   * transition does. As a passive effect the clone mounted a paint late and the
   * two movements were visibly sequential — the poster going first and the page
   * following, which is the thing this exists to fix.
   */
  React.useLayoutEffect(() => {
    if (!isOpen) {
      enteredRef.current = false;
      return;
    }
    if (viewport.height === 0 || enteredRef.current) return;
    enteredRef.current = true;
    justOpenedRef.current = true;
    // A deep link has no card on the page to fly from; the page's own fade is
    // the whole arrival.
    if (openOptionsRef.current.expanded || reduceMotion) return;

    // Measured in the same frame the deck mounts, while the list behind is
    // still laid out exactly as it was when the card was tapped. One
    // `getBoundingClientRect` per element, once — never inside a gesture.
    const opening = currentEventRef.current;
    const source = opening?.poster_url ? readCardPoster(opening.id) : null;
    const destination = readDeckPoster();
    if (
      opening?.poster_url &&
      source !== null &&
      destination !== null &&
      isUsableSource(source, viewport.height, viewport.width)
    ) {
      setFlight({
        id: (flightIdRef.current += 1),
        from: source,
        to: destination,
        direction: 'in',
        src: opening.poster_url,
        alt: opening.title,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, viewport.height]);

  React.useEffect(() => {
    if (isOpen) return;
    closingRef.current = false;
    setLeaving(false);
    setActiveSubSheet(null);
    // The flight belongs to the deck, not to the layer that draws it. Clearing
    // it here is what lets `SharedPoster`'s cleanup be a plain cancel.
    setFlight(null);
    // A fresh open starts at the top of the first event, undocked.
    scrollTopRef.current = 0;
    dockedRef.current = false;
    setDocked(false);
    setLightboxAt(null);
    blurOpacity.set(1);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [isOpen, blurOpacity]);

  // Keep the active page on screen when the index changes — a swipe, or a tap
  // on a card in the similar-events rail.
  React.useEffect(() => {
    if (!isOpen || viewport.width === 0) return;
    // `settle: false` on the very first frame of an open, so the tapped event
    // is ALREADY in place rather than sliding in from the side afterwards.
    applyTrack(restingX(currentIndex), swipeRef.current === null && !justOpenedRef.current);
    justOpenedRef.current = false;
  }, [isOpen, currentIndex, restingX, viewport.width, applyTrack]);

  /**
   * Carry the scroll offset onto the incoming page BEFORE it is painted.
   *
   * A page change mounts a fresh scroller at zero. As a passive effect this
   * correction would land after paint, so every swipe made while scrolled would
   * show one frame of the new event's hero at full size with the thumbnail
   * gone — a flash of exactly the state the docking animation exists to move
   * away from, on the surface that sells a ticket.
   */
  React.useLayoutEffect(() => {
    if (!isOpen) return;
    const node = scrollerRef.current;
    if (node) node.scrollTop = scrollTopRef.current;
  }, [isOpen, currentEvent?.id]);

  /**
   * THE SCROLL LISTENER, and it watches the page's own scroller.
   *
   * Not `window.scrollY`: the deck is a fixed overlay and the document behind
   * it is scroll-locked, so the window never moves. The offset that matters is
   * the active page's, which is also the one that has to be carried across a
   * swipe.
   */
  const onScroll = React.useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    scrollTopRef.current = node.scrollTop;
    // ── THE BACKDROP FADES AS THE POSTER LEAVES ─────────────────────
    //
    // Linear against the hero's own height, so it is gone exactly when the
    // artwork is. Fading it on a fixed pixel count would leave a blurred
    // wash behind the first paragraph on a tall phone and clear it before
    // the poster had moved on a short one.
    const heroHeight = heroRef.current?.offsetHeight ?? 0;
    blurOpacity.set(
      heroHeight > 0 ? 1 - Math.min(Math.max(node.scrollTop / heroHeight, 0), 1) : 1,
    );
    const next = shouldDock(node.scrollTop, heroHeight, dockedRef.current);
    if (next === dockedRef.current) return;
    dockedRef.current = next;
    setDocked(next);
  }, [blurOpacity]);

  /**
   * ── CLAIM THE HORIZONTAL GESTURE BEFORE THE BROWSER DOES ───────────────
   *
   * `touch-action` is not inherited and the scroller computes to `auto`, so the
   * browser decides on the first `touchmove` that the gesture is its own
   * panning, fires `pointercancel`, and stops delivering pointer events. The
   * symptom is a swipe that moves nothing at all.
   *
   * Deliberately narrow: ONLY a decisively horizontal movement is claimed.
   * Vertical is the browser's, natively, with nothing intercepting it — which
   * is the whole point of the page no longer being a sheet.
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
      // The hero gallery is a scroller of its own. Calling `preventDefault` on
      // its touches would claim them for the deck and the gallery would not
      // move at all — the same exclusion as `onPointerDown`, in the half that
      // talks to the browser rather than to React.
      if ((event.target as Element | null)?.closest?.('[data-hero-gallery]')) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < COMMIT_SLOP && Math.abs(dy) < COMMIT_SLOP) return;
      // `cancelable` guards the case where the browser has already committed to
      // scrolling — `preventDefault` there is a no-op that warns every frame.
      if (Math.abs(dx) > Math.abs(dy) * AXIS_DOMINANCE && event.cancelable) event.preventDefault();
    };

    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
    };
  }, [isOpen, currentEvent?.id]);

  const goTo = React.useCallback(
    (index: number) => {
      if (index < 0 || index >= events.length) return;
      setCurrentIndex(index);
    },
    [events.length, setCurrentIndex],
  );

  /**
   * Where a close actually GOES.
   *
   * Deliberately NOT triggered by `closeDeck` itself, which the "Book tickets"
   * link calls on its way to checkout — wiring navigation to the close STATE
   * would race two client navigations on the money path.
   */
  const finishClose = React.useCallback(() => {
    if (openOptionsRef.current.origin === 'route') {
      // REPLACE, not push. Push would leave the event URL in the stack behind
      // the list, so back returns to it, `DeckBoot` remounts and reopens the
      // deck, and the reader can never get past the event they arrived on.
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
    // Idempotent: Escape twice must not start a second close over the first.
    if (closingRef.current) return;
    closingRef.current = true;
    setLeaving(true);
    if (reduceMotion || viewport.height === 0) {
      finishClose();
      return;
    }

    const going = currentEventRef.current;
    const target = going?.poster_url ? readCardPoster(going.id) : null;
    const source = readDeckPoster();
    if (
      going?.poster_url &&
      target !== null &&
      source !== null &&
      isUsableSource(target, viewport.height, viewport.width)
    ) {
      setFlight({
        id: (flightIdRef.current += 1),
        from: source,
        to: target,
        direction: 'out',
        src: going.poster_url,
        alt: going.title,
      });
      // The clone's own `onDone` commits the close, so the deck survives
      // exactly as long as the picture still moving across it.
      return;
    }

    // Nothing to fly. The page's fade is the whole exit, so the close is
    // committed on its duration.
    closeTimerRef.current = window.setTimeout(finishClose, FLIGHT_MS);
  }, [finishClose, viewport.height, viewport.width, reduceMotion]);

  // ── THE NON-POINTER WAYS OUT ───────────────────────────────────────────
  //
  // There is no floating back arrow on this surface (removed at the owner's
  // instruction) and, with the sheet gone, no drag-down and no tap-the-artwork
  // either. These are not conveniences: they are the exits.

  // Escape. The deck is a hand-rolled `role="dialog"`, not a library one.
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, dismiss]);

  // Hardware / browser back. A FEED open pushes one history entry so that back
  // closes the deck rather than navigating the page underneath while the deck
  // stays up. A ROUTE open pushes nothing: the URL already is the event.
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

  const readTrackX = React.useCallback((fallback: number) => {
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
  }, []);

  const beginSwipe = React.useCallback(
    (event: React.PointerEvent) => {
      if (stride === 0) return;
      const pointerId = event.pointerId;
      // ONE computed read per gesture, never per frame. During a settle this is
      // the only place the interpolated position exists — taking the resting
      // offset instead would teleport the track on the first move.
      swipeRef.current = {
        startX: event.clientX,
        base: readTrackX(restingX(currentIndex)),
        lastX: event.clientX,
        lastAt: event.timeStamp,
        velocity: 0,
      };

      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const swipe = swipeRef.current;
        if (!swipe) return;
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
         * The release rule, and both halves are deliberate. A flick that has
         * barely moved still carries; a slow drag commits once it has covered
         * `ADVANCE_FRACTION` of a page. Either is enough, neither is required.
         * One page at a time — a projection that skips two is the flick
         * outrunning what a person can see.
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

  const onPointerDown = React.useCallback((event: React.PointerEvent) => {
    draggedRef.current = false;
    // ── THE HERO GALLERY OWNS ITS OWN SIDEWAYS ──────────────────────────
    //
    // A horizontal swipe on the page changes EVENT; inside the hero it changes
    // PICTURE. Both cannot claim the same finger, so a gesture that begins in
    // the gallery is left entirely to the browser's native scrolling — the
    // record is cleared rather than armed, and `onPointerMove` bails on the
    // pointer id it does not recognise.
    if ((event.target as Element | null)?.closest?.('[data-hero-gallery]')) {
      gestureRef.current = { x: 0, y: 0, committed: false, pointerId: -1 };
      return;
    }
    gestureRef.current = {
      x: event.clientX,
      y: event.clientY,
      committed: false,
      pointerId: event.pointerId,
    };
  }, []);

  /**
   * ONE AXIS. Horizontal belongs to the deck; everything else belongs to the
   * browser's own scrolling, untouched.
   */
  const onPointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      if (closingRef.current) return;
      const gesture = gestureRef.current;
      if (gesture.committed || gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.abs(dx) < COMMIT_SLOP && Math.abs(dy) < COMMIT_SLOP) return;
      gesture.committed = true;
      // Committing IS proof of travel — `COMMIT_SLOP` px of it — so the tap
      // guard is raised here rather than from the drag's own `pointermove`,
      // which needs a move AFTER the commit and so misses a short flick.
      draggedRef.current = true;
      if (Math.abs(dx) > Math.abs(dy) * AXIS_DOMINANCE) beginSwipe(event);
    },
    [beginSwipe],
  );

  if (!isOpen || !currentEvent) return null;

  const dockTransition = { duration: reduceMotion ? 0 : DOCK_MS / 1000, ease: TRANSITION_EASE };

  return (
    <div className="fixed inset-0 z-modal sm:hidden" role="dialog" aria-modal="true">
      {/* The list receding BEHIND the event, on the same clock as everything
          else that moves during an open. Driven by state rather than by
          `exit`, which only runs under an `AnimatePresence` and there is none
          around this component — declared to fade, it used to vanish in one
          frame at full opacity and the close ended as a cut. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{
          duration: reduceMotion ? 0 : PAGE_TRANSITION.duration,
          ease: TRANSITION_EASE,
        }}
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/80 via-black/70 to-black/85 backdrop-blur-md"
        aria-hidden
      />

      {/* The poster in flight between the card and the hero. Mounted only for
          the length of one transition, and it removes itself. Keyed by flight
          id so a second flight is a fresh element rather than a reused one
          whose mount-only effect has already latched `done`. */}
      {flight ? (
        <SharedPoster
          key={flight.id}
          src={flight.src}
          alt={flight.alt}
          from={flight.from}
          to={flight.to}
          direction={flight.direction}
          durationMs={FLIGHT_MS}
          onDone={() => {
            setFlight(null);
            if (flight.direction === 'out') finishClose();
          }}
        />
      ) : null}

      {/* The pages. A gentle rise replaces the sheet's slide — the deck has to
          ARRIVE as something, and a hard cut onto a full-screen page reads as a
          navigation rather than as an opening. */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: leaving ? 0 : 1, y: leaving ? 24 : 0 }}
        transition={{
          duration: reduceMotion ? 0 : PAGE_TRANSITION.duration,
          ease: TRANSITION_EASE,
        }}
        className="absolute inset-0 overflow-hidden"
      >
        {/* The TRACK. Positioned imperatively by `applyTrack`: a transform
            written straight onto the node animates on the compositor and costs
            no React render per frame.

            NOTHING here may name `transform` or `transition`. React re-applies
            the inline styles it owns on every render, so either would land on
            top of whatever the gesture had just written, mid-drag. */}
        <div
          ref={trackRef}
          style={{ willChange: 'transform' }}
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
                  height: '100dvh',
                  // The active page paints above its neighbours, so nothing can
                  // cast a shadow onto the page being read.
                  zIndex: active ? 1 : 0,
                }}
                className="relative shrink-0"
                aria-hidden={active ? undefined : true}
              >
                {active ? (
                  <ActivePage
                    event={event}
                    detail={detail}
                    content={content}
                    tiers={tiers}
                    events={events}
                    docked={docked}
                    dockTransition={dockTransition}
                    hidePoster={flight !== null}
                    blurOpacity={blurOpacity}
                    onOpenPoster={openPoster}
                    images={lightboxImages}
                    ctaHeight={ctaHeight}
                    scrollerRef={scrollerRef}
                    ctaRef={ctaRef}
                    heroRef={heroRef}
                    onScroll={onScroll}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onOpenSheet={setActiveSubSheet}
                    onSelectEvent={(id) => {
                      const next = events.findIndex((candidate) => candidate.id === id);
                      if (next >= 0) goTo(next);
                    }}
                    onLeave={closeDeck}
                  />
                ) : (
                  <NeighbourPage event={event} docked={docked} />
                )}
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Rendered here rather than inside the page, and it portals out of the
          overlay entirely — see `lightbox.tsx`. */}
      {lightboxAt !== null && lightboxImages.length > 0 ? (
        <Lightbox
          images={lightboxImages}
          index={lightboxAt}
          onIndexChange={setLightboxAt}
          onClose={() => setLightboxAt(null)}
        />
      ) : null}

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
/* Pages                                                                      */
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
 * The hero, inset and rounded — a card rather than a full-bleed slab.
 *
 * The poster used to run edge to edge and corner to corner, anchored behind a
 * sheet. Two things follow from insetting it: the artwork reads as an object on
 * a page instead of as the page's background, and it can round its corners at
 * all — a radius on a full-width element pinned to the top of the display is
 * two wedges of background in the top corners of the screen, which is why the
 * old one deliberately had none.
 *
 * The BOX stays in the flow whether or not the picture is in it. When the
 * poster docks it leaves this container behind, and the container keeps its
 * height so the content below does not jump up by 450px at the moment the
 * reader is scrolling through it.
 */
function Hero({
  event,
  images,
  docked,
  hidePoster,
  layoutId,
  transition,
  boxRef,
  blurOpacity,
  onOpenPoster,
}: {
  event: EventCardData;
  /** The poster FIRST, then the organiser's gallery. */
  images: LightboxImage[];
  docked: boolean;
  /** True while a clone is flying, so the same photograph is never on screen twice. */
  hidePoster: boolean;
  layoutId: string;
  transition: { duration: number; ease: [number, number, number, number] };
  boxRef: React.RefObject<HTMLDivElement>;
  /** 1 at the top of the page, 0 once the poster has scrolled its own height. */
  blurOpacity: MotionValue<number>;
  onOpenPoster: (index: number) => void;
}) {
  const railRef = React.useRef<HTMLDivElement>(null);
  const [slide, setSlide] = React.useState(0);

  const slides: LightboxImage[] =
    images.length > 0
      ? images
      : event.poster_url
        ? [{ url: event.poster_url, alt: event.title }]
        : [];

  /**
   * ── MANUAL, AND NOTHING ELSE ───────────────────────────────────────────
   *
   * This was a four-second crossfade with a pause button and pagination dots.
   * All three are gone: the timer, the `paused` state and the two controls
   * that existed to stop it. What is left is an ordinary horizontal scroller
   * with CSS scroll-snap, which is what a gallery on a phone should have been
   * — the browser owns the gesture, the momentum, the rubber-band at the ends
   * and the snap, and none of it costs a render.
   *
   * The index is still tracked, but only ONE thing reads it now: the blurred
   * backdrop, which has to be the colours of the picture actually on screen.
   * Derived from `scrollLeft` rather than from an observer, because every
   * slide is exactly the track's width and division is cheaper and exact.
   */
  const onRailScroll = React.useCallback(() => {
    const node = railRef.current;
    if (!node || node.clientWidth === 0) return;
    const next = Math.round(node.scrollLeft / node.clientWidth);
    setSlide((previous) => (previous === next ? previous : next));
  }, []);

  /**
   * A drag ends in a `click`, and every slide is a button.
   *
   * Without this, swiping to the next photograph opens the full-screen viewer
   * on release — the same class of bug the deck's own `draggedRef` exists for,
   * one level down. The threshold is the distance nobody's thumb moves while
   * tapping.
   */
  const dragRef = React.useRef({ x: 0, moved: false });
  const onSlidePointerDown = (pointer: React.PointerEvent) => {
    dragRef.current = { x: pointer.clientX, moved: false };
  };
  const onSlidePointerMove = (pointer: React.PointerEvent) => {
    if (Math.abs(pointer.clientX - dragRef.current.x) > 8) dragRef.current.moved = true;
  };
  const openSlide = (index: number) => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    onOpenPoster(index);
  };

  const backdrop = slides[Math.min(slide, Math.max(slides.length - 1, 0))]?.url ?? null;

  return (
    <div style={{ padding: DECK_EDGE_PADDING_PX, paddingBottom: 0 }}>
      <div
        ref={boxRef}
        // ── THE ATTRIBUTE FOLLOWS THE PICTURE ──────────────────────────
        //
        // `readDeckPoster` measures whichever element is marked, and it is used
        // for BOTH ends of the shared-poster transition: the destination when
        // the deck opens, and the SOURCE when it closes. Leaving it on this box
        // unconditionally meant that closing while the poster was docked flew
        // the clone out of an empty container scrolled somewhere above the
        // fold. It is on the hero while the hero holds the poster, and on the
        // thumbnail once the bar does.
        {...(docked ? {} : { [DECK_POSTER_ATTR]: '' })}
        style={{
          aspectRatio: `${HERO_ASPECT_W} / ${HERO_ASPECT_H}`,
          borderRadius: HERO_RADIUS_PX,
          // Opacity rather than unmounting: unmounting would make the browser
          // re-decode the image on the way back in, which is the visible flash
          // the whole transition exists to avoid.
          opacity: hidePoster ? 0 : 1,
        }}
        className="relative w-full overflow-hidden bg-muted"
      >
        {/* ── THE BLURRED BACKDROP ──────────────────────────────────────
            The current slide's own colours, blown up and lightly blurred,
            filling whatever the artwork does not.

            It exists because the box has a FIXED shape and posters do not.
            Anything the picture leaves — a letterbox on an unusual ratio, the
            frame before it decodes, and the whole box once the poster has
            docked into the booking bar — was a flat slab of `bg-muted`, which
            on a light theme reads as a skin-toned rectangle where the event's
            artwork should be. */}
        {backdrop ? (
          <motion.div
            aria-hidden
            style={{ opacity: blurOpacity }}
            className="pointer-events-none absolute inset-0"
          >
            <Image
              key={backdrop}
              src={backdrop}
              alt=""
              fill
              sizes="100vw"
              // `blur-sm` (4px), not `blur-2xl` (40px): soft enough that
              // nothing behind the poster competes with it, light enough that
              // it reads as the same photograph rather than as fog. The scale
              // exists only to push the blur's soft edge outside the clip, and
              // 4px needs far less room than 40.
              className="scale-110 object-cover blur-sm saturate-150"
            />
          </motion.div>
        ) : null}

        {docked ? null : (
          <motion.div
            layoutId={layoutId}
            // `borderRadius` through `style`, not a class: a layout animation
            // scales the element, and framer only corrects a radius it owns.
            style={{ borderRadius: HERO_RADIUS_PX }}
            transition={transition}
            className="absolute inset-0 overflow-hidden"
          >
            {slides.length > 0 ? (
              <div
                ref={railRef}
                // Read by the deck, which must NOT claim a gesture that starts
                // in here: its horizontal swipe changes EVENT, and inside this
                // rail a horizontal swipe changes PICTURE. See `onPointerDown`.
                data-hero-gallery
                onScroll={onRailScroll}
                className={cn(
                  'flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden',
                  // `touch-pan-x`: this element handles sideways and nothing
                  // else, so a vertical drag over the artwork scrolls the PAGE
                  // instead of being arbitrated against the gallery.
                  'touch-pan-x overscroll-x-contain',
                  'scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                )}
              >
                {slides.map((image, index) => (
                  <button
                    key={`${image.url}#${index}`}
                    type="button"
                    onPointerDown={onSlidePointerDown}
                    onPointerMove={onSlidePointerMove}
                    onClick={() => openSlide(index)}
                    aria-label={
                      index === 0
                        ? `View ${event.title} poster full size`
                        : image.alt || `View photo ${index + 1} full size`
                    }
                    className="relative h-full w-full shrink-0 snap-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <Image
                      src={image.url}
                      alt=""
                      fill
                      sizes="100vw"
                      // Only the FIRST is priority. Marking a whole gallery
                      // high-priority makes every image compete for the same
                      // connections and delays the one that IS the LCP element.
                      priority={index === 0}
                      className="object-cover"
                      draggable={false}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                <Ticket className="size-12" aria-hidden />
              </span>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

/**
 * The page's own branding, above the artwork and in the flow.
 *
 * The deck is opened from a feed, from a shared link and from an in-app
 * webview, and in the last two there is no site chrome anywhere on the screen —
 * nothing says whose product this is. This is that, and it is deliberately the
 * cheapest possible version: a mark, a word, and no controls.
 *
 * NOT STICKY, and that is the requirement rather than an oversight. A branding
 * bar pinned to the top of a page whose whole first screen is one photograph
 * spends permanent vertical space on something the reader learns once. It
 * scrolls away with the poster; the TAB bar is the thing that stays.
 *
 * The mark is `BrandMark` — the one definition of it in the codebase, so a
 * brand change lands here without anybody remembering this file exists.
 */
function BrandHeader() {
  return (
    <div className="relative flex items-center justify-center px-4 pb-2 pt-3">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 inline-flex">
        <BrandMark title="Curatix" className="h-6 w-auto" />
      </span>
      {/* Absolutely centred against the SCREEN, not against the space left
          over beside the mark — a flex-centred word shifts right by half the
          logo's width, which is visible the moment anything else joins the
          row. */}
      <span className="text-body font-extrabold tracking-tight text-foreground">Curatix</span>
    </div>
  );
}

/**
 * The sticky booking bar, and the poster's second home.
 *
 * The thumbnail sits on the FAR LEFT, before the price, because that is the
 * order the line reads in: which event, what it costs, the button that commits
 * to it.
 */
function BookingBar({
  event,
  tiers,
  docked,
  /** Present only on the active page: a neighbour must not own the shared id. */
  layoutId,
  transition,
  barRef,
  onLeave,
  inert,
}: {
  event: EventCardData;
  /**
   * `null` while the tiers are still in flight, `undefined` on a neighbour
   * that never asks for them. Both mean the same thing here — nothing is
   * known about the sale window yet — and the bar draws its ordinary label
   * rather than guessing a refusal.
   */
  tiers: TicketTier[] | null | undefined;
  docked: boolean;
  layoutId?: string;
  transition: { duration: number; ease: [number, number, number, number] };
  barRef?: React.RefObject<HTMLDivElement>;
  onLeave?: () => void;
  /** A neighbour's bar is scenery during a swipe — drawn, never pressable. */
  inert?: boolean;
}) {
  const price = formatFromPrice(event.from_price);
  const saleState = tiers ? summariseTiers(tiers).state : null;
  const bookable = saleState === null || canStartBooking(saleState);
  const label = saleState === null ? 'Book tickets' : bookingCtaLabel(saleState);

  return (
    /* ── A FLOATING CARD, NOT A DOCKED BAR ───────────────────────────────
       It was `inset-x-0 bottom-0` with a top border: a full-width strip welded
       to the bottom edge, which reads as browser chrome rather than as part of
       the page. Inset on all four sides with a 24px radius and a real shadow,
       it reads as the last CARD in a page of cards — and the gap underneath is
       what lets the content scroll visibly past it rather than under a lid.

       The entrance is a spring, and it is deliberately the only spring on this
       surface: everything else here moves on the house cubic-bezier. This one
       control appears after the page rather than with it, and a small overshoot
       is what makes that read as arriving rather than as a late render. */
    <motion.div
      ref={barRef}
      initial={{ y: 32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.9 }}
      className="absolute inset-x-4 bottom-4 z-30 rounded-3xl border border-border bg-background px-4 py-3 shadow-xl"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* NO EMI banner. This platform has no EMI arrangement and no column
          saying whether one applies — a claim about somebody's money, on the
          checkout surface, backed by nothing. */}
      <div className="flex items-center gap-3">
        {docked ? (
          layoutId ? (
            <motion.div
              layoutId={layoutId}
              // The poster's whereabouts while it is docked — see the note on
              // the hero's copy of this attribute.
              {...{ [DECK_POSTER_ATTR]: '' }}
              style={{
                borderRadius: THUMB_RADIUS_PX,
                width: THUMB_SIZE_PX,
                height: THUMB_SIZE_PX,
              }}
              transition={transition}
              className="relative shrink-0 overflow-hidden bg-muted"
            >
              <Poster event={event} />
            </motion.div>
          ) : (
            // A neighbour draws the same disc so the bar does not lose an
            // element for the length of a swipe — but WITHOUT the shared id,
            // or framer would try to fly the poster between two pages.
            <span
              aria-hidden
              style={{
                borderRadius: THUMB_RADIUS_PX,
                width: THUMB_SIZE_PX,
                height: THUMB_SIZE_PX,
              }}
              className="relative block shrink-0 overflow-hidden bg-muted"
            >
              <Poster event={event} />
            </span>
          )
        ) : null}

        <div className="flex min-w-0 flex-col">
          <span className="truncate text-h4 font-extrabold tabular-nums text-foreground">
            {price === null ? 'See tickets' : price === 'Free' ? 'Free entry' : price}
          </span>
          {price !== null && price !== 'Free' ? (
            <span className="text-caption font-semibold text-muted-foreground">onwards</span>
          ) : null}
        </div>

        {inert ? (
          <span className="ml-auto inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-cta px-7 text-body-sm font-extrabold text-cta-foreground">
            Book tickets
          </span>
        ) : !bookable ? (
          <span
            aria-disabled="true"
            className="ml-auto inline-flex h-12 shrink-0 cursor-not-allowed items-center justify-center rounded-full border border-border bg-sunken px-7 text-body-sm font-extrabold text-muted-foreground"
          >
            {label}
          </span>
        ) : (
          <Link
            href={`/booking/${event.id}`}
            // `onLeave`, not `onDismiss`: dismiss animates and closes in the
            // animation's completion callback, and this component unmounts the
            // moment the route changes — so that callback never ran and the
            // deck was still "open" when you came back.
            onClick={onLeave}
            className="ml-auto inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-cta px-7 text-body-sm font-extrabold text-cta-foreground shadow-lg transition-transform active:scale-95"
          >
            Book tickets
          </Link>
        )}
      </div>
    </motion.div>
  );
}

function ActivePage({
  event,
  detail,
  content,
  tiers,
  events,
  docked,
  dockTransition,
  hidePoster,
  blurOpacity,
  onOpenPoster,
  images,
  ctaHeight,
  scrollerRef,
  ctaRef,
  heroRef,
  onScroll,
  onPointerDown,
  onPointerMove,
  onOpenSheet,
  onSelectEvent,
  onLeave,
}: {
  event: EventCardData;
  detail: React.ComponentProps<typeof EventWidgetContent>['detail'];
  content: React.ComponentProps<typeof EventWidgetContent>['content'];
  tiers: React.ComponentProps<typeof EventWidgetContent>['tiers'];
  events: readonly EventCardData[];
  docked: boolean;
  dockTransition: { duration: number; ease: [number, number, number, number] };
  hidePoster: boolean;
  blurOpacity: MotionValue<number>;
  onOpenPoster: (index: number) => void;
  images: LightboxImage[];
  ctaHeight: number;
  scrollerRef: React.RefObject<HTMLDivElement>;
  ctaRef: React.RefObject<HTMLDivElement>;
  heroRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onOpenSheet: (sheet: NonNullable<SubSheetType>) => void;
  onSelectEvent: (id: string) => void;
  /** Closes WITHOUT the exit animation — for navigating away. */
  onLeave: () => void;
}) {
  /**
   * The shared id is scoped to the EVENT.
   *
   * A constant would make every page change a match: framer would see the id
   * leave the outgoing page and arrive in the incoming one and fly the poster
   * a screen-width sideways, mid-swipe. Per event, a swipe is an unmount and a
   * separate mount with nothing in common — which is the instant swap the
   * docked thumbnail is supposed to do.
   */
  const layoutId = `deck-poster-${event.id}`;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── AN ORDINARY SCROLLER ──────────────────────────────────────────
          `overflow-y-auto`, and that is the whole vertical story. The pointer
          handlers watch for a decisively horizontal movement and hand it to the
          deck; everything else reaches the browser untouched. */}
      <div
        ref={scrollerRef}
        data-deck-scroller
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        className="flex-1 overflow-y-auto overscroll-contain"
        // The bar's measured height PLUS the gap it now floats above, so the
        // last section clears it exactly. A hard-coded `pb-28` is either a void
        // or a clipped final row on some device.
        style={{ paddingBottom: `${(ctaHeight || 96) + 32}px` }}
      >
        {/* ── BRANDING, AND IT SCROLLS AWAY ──────────────────────────────
            The first thing in the scroller and nothing more than that: no
            `sticky`, no `fixed`, no z-index. It is in the normal flow, so it
            leaves with the first flick and gives the artwork the whole screen
            for the rest of the read — which is the point of putting it above
            the poster rather than over it. */}
        <BrandHeader />
        <Hero
          event={event}
          images={images}
          docked={docked}
          hidePoster={hidePoster}
          layoutId={layoutId}
          transition={dockTransition}
          boxRef={heroRef}
          blurOpacity={blurOpacity}
          onOpenPoster={onOpenPoster}
        />
        {/* WHAT it is, WHERE and WHEN — above the tabs, because the tabs
            navigate WITHIN an event and these three say which one. */}
        <EventWidgetSummary event={event} content={content} onOpenSheet={onOpenSheet} />
        {/* ── THE TABS STICK, AND THEY STICK INSIDE THIS SCROLLER ────────
            Declared between the summary and the content so `position: sticky`
            pins them against the page's own scroll box. They cannot be
            `fixed`: that would resolve against the deck's transformed page
            track and land in the wrong place on every swipe — the same trap
            the lightbox portal exists for. */}
        <div className="px-4">
          <SectionTabs tabs={sectionTabsFor(detail, content)} scrollerRef={scrollerRef} />
        </div>
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

      <BookingBar
        event={event}
        tiers={tiers}
        docked={docked}
        layoutId={layoutId}
        transition={dockTransition}
        barRef={ctaRef}
        onLeave={onLeave}
      />
    </div>
  );
}

/**
 * A NEIGHBOUR — everything the LIST already knows, and no more.
 *
 * A page is the full viewport, so the incoming event is entirely visible for
 * the whole length of a swipe, and a screen that is blank below the title reads
 * as the next event having failed to load. So it carries the same first screen
 * as an active page: the inset hero, the title, the date, the venue and the
 * ticket bar with the real price. On release the swap for the real page fills
 * in what was below the fold, and the eye reads it as having been there all
 * along.
 *
 * Every field is on the `EventCard` the list already handed us — no request, no
 * `useEventWidgetData`, no event-page subtree. Twenty of these are mounted at
 * once and the cost of one is a handful of DOM nodes.
 */
function NeighbourPage({ event, docked }: { event: EventCardData; docked: boolean }) {
  const when = event.starts_at
    ? [formatEventDate(event.starts_at), formatEventTime(event.starts_at)]
        .filter(Boolean)
        .join(' · ')
    : null;
  const where = [event.venue, event.city].filter(Boolean).join(', ');

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      {/* ── A NEIGHBOUR IMITATES THE PAGE IT IS ABOUT TO BECOME ──────────
          Including its SCROLL POSITION. The incoming page mounts with the
          reader's offset carried over, so while the poster is docked it is
          scrolled past its hero — and a neighbour that drew a full-height hero
          box anyway would put 450px of empty container at the top of the screen
          for the length of every swipe, and then close it the instant the swap
          landed. Docked, it simply starts at the title, which is roughly what
          the real page shows at that offset. */}
      {docked ? null : (
        <div style={{ padding: DECK_EDGE_PADDING_PX, paddingBottom: 0 }}>
          <div
            style={{
              aspectRatio: `${HERO_ASPECT_W} / ${HERO_ASPECT_H}`,
              borderRadius: HERO_RADIUS_PX,
            }}
            className="relative w-full overflow-hidden bg-muted"
          >
            {event.poster_url ? (
              <span aria-hidden className="pointer-events-none absolute inset-0">
                <Image
                  src={event.poster_url}
                  alt=""
                  fill
                  sizes="100vw"
                  className="scale-110 object-cover blur-sm saturate-150"
                />
              </span>
            ) : null}
            <Poster event={event} />
          </div>
        </div>
      )}
      <div className={cn('flex flex-col gap-1.5 px-4', docked ? 'pt-4' : 'pt-6')}>
        <p className="line-clamp-2 text-h3 font-extrabold leading-snug tracking-tight text-foreground">
          {event.title}
        </p>
        {when ? <p className="text-body-sm font-semibold text-primary">{when}</p> : null}
        {where ? <p className="line-clamp-1 text-body-sm text-muted-foreground">{where}</p> : null}
      </div>
      <BookingBar
        event={event}
        tiers={undefined}
        docked={docked}
        transition={{ duration: 0, ease: TRANSITION_EASE }}
        inert
      />
    </div>
  );
}
