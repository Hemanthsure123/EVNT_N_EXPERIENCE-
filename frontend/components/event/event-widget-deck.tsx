'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, Ticket } from 'lucide-react';
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from 'framer-motion';
import { FavouriteButton } from '@/components/discovery/favourite-button';
import { useEventDeck } from '@/lib/discovery/event-deck-context';
import { useEventWidgetData } from '@/lib/discovery/use-event-widget-data';
import { useScrollLock } from '@/lib/discovery/use-scroll-lock';
import {
  FULL_SNAP_INDEX,
  INITIAL_SNAP_INDEX,
  resolveSnap,
  snapPixels,
} from '@/lib/discovery/sheet-snap';
import { formatFromPrice } from '@/lib/discovery/format';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { EventSubSheets, type SubSheetType } from './event-sub-sheets';
import { EventWidgetContent } from './event-widget-content';

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
 * ── AND IT IS ALWAYS DARK ─────────────────────────────────────────────────
 *
 * The `dark` class re-points the design tokens for the whole subtree, which is
 * what lets it reuse the page's own sections — the fact grid, the countdown,
 * the lightbox, the FAQ accordion, the policy lists — instead of forking a
 * dark copy of each.
 */

const SPRING = { type: 'spring', stiffness: 340, damping: 36, mass: 0.9 } as const;
/** How far a gesture must travel before it is allowed to commit to an axis. */
const COMMIT_SLOP = 10;
/** Fraction of the viewport the active card occupies while the deck is inset. */
const CARD_FRACTION = 0.88;
/** Gap between cards in the track, in px, while the deck is inset. */
const CARD_GAP = 10;
/** Seconds of travel to project a horizontal release along, to pick a card. */
const FLICK_PROJECTION = 0.14;

export function EventWidgetDeck() {
  const { isOpen, events, currentIndex, closeDeck, setCurrentIndex } = useEventDeck();
  const reduceMotion = useReducedMotion();

  const currentEvent = events[currentIndex] ?? events[0] ?? null;

  // Every hook runs on every render, open or closed — the early return is at
  // the bottom. `null` tells the data hook to fetch nothing.
  const { detail, content, tiers } = useEventWidgetData(
    isOpen && currentEvent ? currentEvent.id : null,
  );
  useScrollLock(isOpen);

  const [activeSubSheet, setActiveSubSheet] = React.useState<SubSheetType>(null);
  const [snapIndex, setSnapIndex] = React.useState(INITIAL_SNAP_INDEX);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [ctaHeight, setCtaHeight] = React.useState(0);
  const [pastHero, setPastHero] = React.useState(false);

  const y = useMotionValue(0);
  const gestureRef = React.useRef({ x: 0, y: 0, committed: false });
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const ctaRef = React.useRef<HTMLDivElement>(null);
  /** True when the gesture that just ended actually moved the sheet, so the
   *  click a drag emits on release does not ALSO step a snap. */
  const draggedRef = React.useRef(false);
  const trackRef = React.useRef<HTMLDivElement>(null);
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

  const isFull = snapIndex === FULL_SNAP_INDEX;
  const snaps = React.useMemo(() => snapPixels(viewport.height), [viewport.height]);
  // At full screen the card IS the screen: no peek, no gap, no rounded top.
  const cardWidth = isFull ? viewport.width : Math.round(viewport.width * CARD_FRACTION);
  const gap = isFull ? 0 : CARD_GAP;
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

  /** Writes the track's position. `settle` turns the CSS transition on. */
  const applyTrack = React.useCallback(
    (offset: number, settle: boolean) => {
      const node = trackRef.current;
      if (!node) return;
      node.style.transition =
        settle && !reduceMotion ? 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
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
  }, [isOpen]);

  // Enter: from just below the viewport up to the resting snap, with the
  // tapped event already centred.
  React.useEffect(() => {
    if (!isOpen || viewport.height === 0) return;
    const resting = snapPixels(viewport.height)[INITIAL_SNAP_INDEX];
    setSnapIndex(INITIAL_SNAP_INDEX);
    setPastHero(false);
    justOpenedRef.current = true;
    if (reduceMotion) {
      y.set(resting);
      return;
    }
    y.set(viewport.height);
    const controls = animate(y, resting, SPRING);
    return () => controls.stop();
    // `currentIndex` is deliberately absent: this runs on OPEN, and re-running
    // it when the reader swipes would drop the sheet back to its entry height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, viewport.height]);

  React.useEffect(() => {
    if (!isOpen) setActiveSubSheet(null);
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
    setPastHero(false);
  }, [currentEvent?.id]);

  // One boolean, flipped on a threshold crossing. A passive listener that only
  // calls `setState` when the answer actually changes costs a comparison per
  // frame and nothing else — no layout read, no re-render while scrolling.
  React.useEffect(() => {
    const node = scrollerRef.current;
    if (!node || !isOpen) return;
    const onScroll = () => {
      const past = node.scrollTop > node.clientWidth * 0.55;
      setPastHero((current) => (current === past ? current : past));
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [isOpen, currentEvent?.id]);

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
        horizontal || (atTop && (dy > 0 || (dy < 0 && snapIndex !== FULL_SNAP_INDEX)));

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

  const dismiss = React.useCallback(() => {
    if (reduceMotion || viewport.height === 0) {
      closeDeck();
      return;
    }
    animate(y, viewport.height, { ...SPRING, onComplete: closeDeck });
  }, [closeDeck, viewport.height, y, reduceMotion]);

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
      const startY = event.clientY;
      let lastY = event.clientY;
      let lastAt = event.timeStamp;
      let velocity = 0;
      draggedRef.current = false;

      const move = (moveEvent: PointerEvent) => {
        const elapsed = moveEvent.timeStamp - lastAt;
        if (elapsed > 0) {
          velocity = ((moveEvent.clientY - lastY) / elapsed) * 1000;
          lastY = moveEvent.clientY;
          lastAt = moveEvent.timeStamp;
        }
        const travelled = moveEvent.clientY - startY;
        if (Math.abs(travelled) > 4) draggedRef.current = true;
        // Above the top snap there is nothing to reveal, so resistance is
        // heavy; below the resting one there is (a dismissal), so it is light.
        let next = base + travelled;
        if (next < 0) next *= 0.12;
        applySheet(next);
      };

      const end = (endEvent: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        gestureRef.current.committed = false;
        const resolution = resolveSnap({
          y: y.get() + (endEvent.clientY - startY) * 0,
          velocity,
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
  const beginSwipe = React.useCallback(
    (event: React.PointerEvent) => {
      if (stride === 0) return;
      swipeRef.current = {
        startX: event.clientX,
        base: restingX(currentIndex),
        lastX: event.clientX,
        lastAt: event.timeStamp,
        velocity: 0,
      };

      const move = (moveEvent: PointerEvent) => {
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
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        const swipe = swipeRef.current;
        swipeRef.current = null;
        gestureRef.current.committed = false;
        if (!swipe) return;

        // Projected along the release velocity, exactly like the vertical
        // snap: a quick flick that has barely moved still lands on the next
        // card, instead of springing back under the thumb that threw it.
        const travelled = endEvent.clientX - swipe.startX;
        const projected = swipe.base + travelled + swipe.velocity * FLICK_PROJECTION;
        const nearest = Math.round(-projected / stride);
        const clamped = Math.max(0, Math.min(nearest, events.length - 1));
        if (clamped === currentIndex) applyTrack(restingX(clamped), true);
        else goTo(clamped);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    [applyTrack, currentIndex, events.length, goTo, restingX, stride],
  );

  /** The handle always drags the SHEET — nothing scrolls there. */
  const startSheetDrag = React.useCallback(
    (event: React.PointerEvent) => {
      gestureRef.current.committed = true;
      beginVerticalDrag(event);
    },
    [beginVerticalDrag],
  );

  /**
   * Tap the handle to step one snap taller — or, at full screen, back down.
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
    if (snapIndex === FULL_SNAP_INDEX) snapTo(INITIAL_SNAP_INDEX);
    else snapTo(snapIndex - 1);
  }, [snapIndex, snapTo]);

  const onContentPointerDown = React.useCallback((event: React.PointerEvent) => {
    gestureRef.current = { x: event.clientX, y: event.clientY, committed: false };
  }, []);

  const onContentPointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture.committed) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.abs(dx) < COMMIT_SLOP && Math.abs(dy) < COMMIT_SLOP) return;

      // Horizontal always belongs to the deck, AT EVERY SNAP STATE — there is
      // nothing to scroll sideways inside the content, and a full-screen event
      // that can no longer be swiped past is the thing this deck exists not to
      // be.
      if (Math.abs(dx) > Math.abs(dy)) {
        gesture.committed = true;
        beginSwipe(event);
        return;
      }

      const atTop = (scrollerRef.current?.scrollTop ?? 0) <= 0;
      // Downward from the top: collapse. There is nothing above the first line
      // to scroll to, so the only thing that gesture can mean is "put it away".
      if (dy > 0 && atTop) {
        gesture.committed = true;
        beginVerticalDrag(event);
        return;
      }
      // Upward from the top, while there is still room to grow: expand. This is
      // what makes the whole surface draggable rather than just the handle —
      // and it stops exactly when the sheet is full, at which point an upward
      // drag is a request to read further and belongs to the scroller.
      if (dy < 0 && atTop && !isFull) {
        gesture.committed = true;
        beginVerticalDrag(event);
        return;
      }
      // Neither: the browser scrolls the content, natively, uninterrupted.
      gesture.committed = true;
    },
    [beginSwipe, beginVerticalDrag, isFull],
  );

  if (!isOpen || !currentEvent) return null;

  const price = formatFromPrice(currentEvent.from_price);

  return (
    <div className="fixed inset-0 z-modal sm:hidden" role="dialog" aria-modal="true">
      {/* Dimmed AND blurred, so nothing bleeds through the active surface. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={dismiss}
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        aria-hidden
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
                  className={cn(
                    'dark relative flex h-full flex-col overflow-hidden bg-background text-foreground shadow-2xl transition-[border-radius] duration-200',
                    isFull ? 'rounded-none' : 'rounded-t-3xl border-t border-border',
                    // The neighbours are context, not content: dimmed so the
                    // centre reads as the one in focus.
                    active ? 'opacity-100' : 'opacity-60',
                  )}
                >
                  {active ? (
                    <ActiveCard
                      event={event}
                      detail={detail}
                      content={content}
                      tiers={tiers}
                      events={events}
                      isFull={isFull}
                      pastHero={pastHero}
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
                      onDismiss={dismiss}
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

function NeighbourCard({ event }: { event: EventCardData }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-muted">
      <Poster event={event} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" aria-hidden />
      <p className="absolute inset-x-3 bottom-6 line-clamp-2 text-body-sm font-bold text-white">
        {event.title}
      </p>
    </div>
  );
}

function ActiveCard({
  event,
  detail,
  content,
  tiers,
  events,
  isFull,
  pastHero,
  ctaHeight,
  price,
  scrollerRef,
  ctaRef,
  onStartSheetDrag,
  onContentPointerDown,
  onContentPointerMove,
  onOpenSheet,
  onSelectEvent,
  onDismiss,
  onLeave,
  onHandleTap,
}: {
  event: EventCardData;
  detail: React.ComponentProps<typeof EventWidgetContent>['detail'];
  content: React.ComponentProps<typeof EventWidgetContent>['content'];
  tiers: React.ComponentProps<typeof EventWidgetContent>['tiers'];
  events: readonly EventCardData[];
  isFull: boolean;
  pastHero: boolean;
  ctaHeight: number;
  price: string | null;
  scrollerRef: React.RefObject<HTMLDivElement>;
  ctaRef: React.RefObject<HTMLDivElement>;
  onStartSheetDrag: (event: React.PointerEvent) => void;
  onContentPointerDown: (event: React.PointerEvent) => void;
  onContentPointerMove: (event: React.PointerEvent) => void;
  onOpenSheet: (sheet: NonNullable<SubSheetType>) => void;
  onSelectEvent: (id: string) => void;
  onDismiss: () => void;
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
        aria-label={isFull ? 'Collapse event' : 'Expand event'}
        className="flex h-11 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1.5 w-12 rounded-full bg-border-strong" aria-hidden />
      </button>

      {/* The controls float OVER the card rather than sitting on the hero,
          because the hero scrolls away — pinned to the poster, Back and Save
          would scroll off with it and leave no way out but a gesture. Floating
          over the CONTENT, though, they sit on top of whatever is underneath,
          so once the poster is gone the bar takes a background and the event's
          name, which is also what you want on screen deep in a long page. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-5 z-20 flex items-center gap-3 px-3 pb-2 pt-1 transition-colors duration-200',
          pastHero && 'border-b border-border bg-background/95 backdrop-blur-md',
        )}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Back to events"
          className={cn(
            'pointer-events-auto flex size-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90',
            pastHero ? 'text-foreground' : 'bg-black/50 text-white backdrop-blur-md',
          )}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground transition-opacity duration-200',
            pastHero ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden
        >
          {event.title}
        </span>
        <FavouriteButton
          eventId={event.id}
          title={event.title}
          className={cn(
            'pointer-events-auto size-10 shrink-0 rounded-full transition-transform active:scale-90',
            pastHero ? 'text-foreground' : 'bg-black/50 text-white backdrop-blur-md',
          )}
        />
      </div>

      {/* Content, INCLUDING the hero. The hero used to be pinned outside this
          scroller, which meant a 4:3 photograph held ~60% of the screen
          permanently and the whole event was read through what was left.
          Inside the scroller it behaves like the top of a page. */}
      <div
        ref={scrollerRef}
        onPointerDown={onContentPointerDown}
        onPointerMove={onContentPointerMove}
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: ctaHeight ? `${ctaHeight + 16}px` : '7rem' }}
      >
        {/* The hero deliberately has NO drag handler of its own. It lives
            inside the scroller, so it inherits the commit logic there — which
            means a swipe across the poster changes event, and a drag up or
            down from it moves the sheet. Starting the SHEET drag here
            unconditionally (as it did) made a horizontal swipe across the
            biggest, most obvious grab area do nothing at all. */}
        <div
          className={cn(
            'relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted',
            !isFull && 'rounded-t-3xl',
          )}
        >
          <Poster event={event} priority />
          {/* A scrim under the floating controls, so a white poster cannot
              swallow them. */}
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/55 to-transparent"
            aria-hidden
          />
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
