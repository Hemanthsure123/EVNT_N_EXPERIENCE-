'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, Ticket } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from 'framer-motion';
import type { PanInfo } from 'framer-motion';
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
 * ── THE DRAG IS A REAL DRAG ───────────────────────────────────────────────
 *
 * The sheet is one element, always full-viewport tall, translated down by a
 * motion value. Dragging moves that value directly, so the surface tracks the
 * finger pixel for pixel and STAYS where it is let go — then springs to the
 * nearest of three resting heights.
 *
 * That is the whole reason it is a translate and not a height. The previous
 * version animated between two CSS classes on a 300ms transition: the sheet
 * ignored the gesture entirely, jumped when the finger lifted, and could not
 * rest anywhere in between. `resolveSnap` (a pure, tested module) decides where
 * it lands, projecting the release position along the release velocity so a
 * flick carries instead of springing back under the thumb that threw it.
 *
 * ── THREE GESTURES THAT MUST NEVER BE CONFUSED ────────────────────────────
 *
 *   horizontal swipe -> previous / next event
 *   vertical drag    -> expand / collapse / dismiss
 *   vertical scroll  -> move through the event's content
 *
 * Two mechanisms keep them apart. `dragDirectionLock` fixes the axis at the
 * moment the gesture commits, so a diagonal cannot do both. And the sheet drag
 * is started MANUALLY (`dragListener={false}` + `useDragControls`): a gesture
 * beginning inside the scrolling content only becomes a sheet drag when it is
 * clearly horizontal, or when it is downward AND the content is already at the
 * top. Otherwise the browser scrolls, natively, with nothing intercepting it.
 *
 * Starting a drag from the handle or the poster always drags the sheet — those
 * are the grab areas, and there is nothing to scroll there.
 *
 * ── THE PAGE BEHIND IT DOES NOT MOVE ──────────────────────────────────────
 *
 * `useScrollLock` pins the body while this is open and restores the exact feed
 * position on close. `overscroll-contain` on the scroller stops a fling at the
 * end of the content chaining into whatever is underneath.
 *
 * ── AND IT IS ALWAYS DARK ─────────────────────────────────────────────────
 *
 * The `dark` class on the sheet re-points the design tokens for its whole
 * subtree, which is what lets it reuse the page's own sections — the fact grid,
 * the countdown, the lightbox, the FAQ accordion, the policy lists — instead of
 * forking a dark copy of each.
 */

const SPRING = { type: 'spring', stiffness: 340, damping: 36, mass: 0.9 } as const;
/** Past this much horizontal travel (or this much flick), switch events. */
const SWIPE_DISTANCE = 64;
const SWIPE_VELOCITY = 420;
/** How far a gesture must move before it is allowed to commit to an axis. */
const COMMIT_SLOP = 12;

export function EventWidgetDeck() {
  const { isOpen, events, currentIndex, closeDeck, setCurrentIndex } = useEventDeck();
  const reduceMotion = useReducedMotion();

  const currentEvent = events[currentIndex] ?? events[0] ?? null;

  // Every hook runs on every render, open or closed — the early return is at the
  // bottom. `null` tells the data hook to fetch nothing.
  const { detail, content, tiers } = useEventWidgetData(
    isOpen && currentEvent ? currentEvent.id : null,
  );
  useScrollLock(isOpen);

  const [activeSubSheet, setActiveSubSheet] = React.useState<SubSheetType>(null);
  const [snapIndex, setSnapIndex] = React.useState(INITIAL_SNAP_INDEX);
  const [viewport, setViewport] = React.useState(0);
  const [ctaHeight, setCtaHeight] = React.useState(0);
  const [pastHero, setPastHero] = React.useState(false);

  const y = useMotionValue(0);
  const x = useMotionValue(0);
  const dragControls = useDragControls();
  const axisRef = React.useRef<'x' | 'y' | null>(null);
  const gestureRef = React.useRef<{ x: number; y: number; committed: 'sheet' | 'scroll' | null }>({
    x: 0,
    y: 0,
    committed: null,
  });
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const ctaRef = React.useRef<HTMLDivElement>(null);

  // Measured, never assumed: a phone's viewport height changes under the sheet
  // when the URL bar collapses, and a sheet pinned to a stale pixel value ends
  // up floating above the bottom edge or clipped below it.
  React.useEffect(() => {
    const measure = () => setViewport(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const snaps = React.useMemo(() => snapPixels(viewport), [viewport]);

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

  // Enter: from just below the viewport up to the resting snap.
  React.useEffect(() => {
    if (!isOpen || viewport === 0) return;
    const resting = snapPixels(viewport)[INITIAL_SNAP_INDEX];
    setSnapIndex(INITIAL_SNAP_INDEX);
    x.set(0);
    if (reduceMotion) {
      y.set(resting);
      return;
    }
    y.set(viewport);
    const controls = animate(y, resting, SPRING);
    return () => controls.stop();
  }, [isOpen, viewport, x, y, reduceMotion]);

  React.useEffect(() => {
    if (!isOpen) setActiveSubSheet(null);
  }, [isOpen]);

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
    if (reduceMotion || viewport === 0) {
      closeDeck();
      return;
    }
    animate(y, viewport, { ...SPRING, onComplete: closeDeck });
  }, [closeDeck, viewport, y, reduceMotion]);

  const handleDragEnd = React.useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const axis = axisRef.current;
      axisRef.current = null;
      gestureRef.current.committed = null;

      if (axis === 'x') {
        animate(x, 0, SPRING);
        const forward = info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY;
        const back = info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY;
        if (forward) goTo(currentIndex + 1);
        else if (back) goTo(currentIndex - 1);
        return;
      }

      const resolution = resolveSnap({
        y: y.get(),
        velocity: info.velocity.y,
        snaps,
        viewportHeight: viewport,
      });
      if (resolution.shouldClose) {
        dismiss();
        return;
      }
      snapTo(resolution.index);
    },
    [currentIndex, dismiss, goTo, snapTo, snaps, viewport, x, y],
  );

  /** Always a sheet drag — the handle and the poster have nothing to scroll. */
  const startSheetDrag = React.useCallback(
    (event: React.PointerEvent) => {
      gestureRef.current.committed = 'sheet';
      dragControls.start(event);
    },
    [dragControls],
  );

  /**
   * Inside the scrolling content, a gesture is only allowed to become a sheet
   * drag if it is clearly horizontal, or clearly downward from the very top.
   * Everything else is left to the browser, so the content scrolls natively.
   */
  const onContentPointerDown = React.useCallback((event: React.PointerEvent) => {
    gestureRef.current = { x: event.clientX, y: event.clientY, committed: null };
  }, []);

  const onContentPointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture.committed) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.abs(dx) < COMMIT_SLOP && Math.abs(dy) < COMMIT_SLOP) return;

      const claim = () => {
        gesture.committed = 'sheet';
        dragControls.start(event);
      };

      // Horizontal always belongs to the deck — there is nothing to scroll
      // sideways inside the content.
      if (Math.abs(dx) > Math.abs(dy)) {
        claim();
        return;
      }

      const atTop = (scrollerRef.current?.scrollTop ?? 0) <= 0;
      const atFull = snapIndex === FULL_SNAP_INDEX;
      // Downward from the top: collapse. There is nothing above the first line
      // to scroll to, so the only thing that gesture can mean is "put it away".
      if (dy > 0 && atTop) {
        claim();
        return;
      }
      // Upward from the top, while there is still room to grow: expand. This is
      // what makes the whole surface draggable rather than just the handle —
      // and it stops exactly when the sheet is full, at which point an upward
      // drag is a request to read further and belongs to the scroller.
      if (dy < 0 && atTop && !atFull) {
        claim();
        return;
      }
      gesture.committed = 'scroll';
    },
    [dragControls, snapIndex],
  );

  if (!isOpen || !currentEvent) return null;

  const price = formatFromPrice(currentEvent.from_price);
  const isFull = snapIndex === FULL_SNAP_INDEX;

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

      <motion.div
        drag
        // Manual start only — see the header. Without this, every touch inside
        // the content would drag the sheet and the page could never scroll.
        dragListener={false}
        dragControls={dragControls}
        dragDirectionLock
        onDirectionLock={(axis) => {
          axisRef.current = axis;
        }}
        dragConstraints={{
          top: 0,
          bottom: snaps[snaps.length - 1] ?? 0,
          left: -140,
          right: 140,
        }}
        // Downward and sideways rubber-band generously (both are gestures with
        // somewhere to go); upward barely moves, because 0 is full screen and
        // there is nothing above it.
        dragElastic={{ top: 0.02, bottom: 0.55, left: 0.35, right: 0.35 }}
        onDragEnd={handleDragEnd}
        style={{ x, y }}
        aria-label={currentEvent.title}
        className={cn(
          'dark absolute inset-x-0 top-0 flex h-[100dvh] touch-pan-y flex-col overflow-hidden bg-background text-foreground shadow-2xl',
          // The rounded top and its hairline belong to a sheet that is resting
          // BELOW the top of the screen; at full screen it is the screen.
          isFull ? 'rounded-none' : 'rounded-t-3xl border-t border-border',
        )}
      >
        {/* Grab handle. A real affordance, and the always-draggable area. */}
        <div
          onPointerDown={startSheetDrag}
          className="flex w-full shrink-0 cursor-grab justify-center pb-1 pt-2.5 active:cursor-grabbing"
        >
          <span className="h-1.5 w-12 rounded-full bg-border-strong" aria-hidden />
        </div>

        {/* The controls float OVER the sheet rather than sitting on the hero,
            because the hero scrolls away — pinned to the poster, Back and Save
            would scroll off with it and leave no way out but a gesture.
            Floating over the CONTENT, though, they sit on top of whatever is
            underneath, so once the poster is gone the bar takes a background
            and the event's name, which is also the thing you want on screen
            when you are deep in a long page. */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-5 z-20 flex items-center gap-3 px-3 pb-2 pt-1 transition-colors duration-200',
            pastHero && 'border-b border-border bg-background/95 backdrop-blur-md',
          )}
        >
          <button
            type="button"
            onClick={dismiss}
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
            {currentEvent.title}
          </span>
          <FavouriteButton
            eventId={currentEvent.id}
            title={currentEvent.title}
            className={cn(
              'pointer-events-auto size-10 shrink-0 rounded-full transition-transform active:scale-90',
              pastHero ? 'text-foreground' : 'bg-black/50 text-white backdrop-blur-md',
            )}
          />
        </div>

        {/* Content, INCLUDING the hero.
            The hero used to be pinned outside this scroller, which meant a
            4:3 photograph held ~60% of the screen permanently and the whole
            event — schedule, tickets, gallery, organiser, similar events —
            was read through the ~35% left underneath it. Inside the scroller
            it behaves like the top of a page: it is the first thing you see
            and it moves out of the way once you have seen it.

            `overscroll-contain` stops a fling at either end chaining into the
            locked page behind. */}
        <div
          ref={scrollerRef}
          onPointerDown={onContentPointerDown}
          onPointerMove={onContentPointerMove}
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: ctaHeight ? `${ctaHeight + 16}px` : '7rem' }}
        >
          <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={currentEvent.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
                className="absolute inset-0"
              >
                {currentEvent.poster_url ? (
                  <Image
                    src={currentEvent.poster_url}
                    alt={currentEvent.title}
                    fill
                    priority
                    sizes="100vw"
                    className="object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Ticket className="size-12" aria-hidden />
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
            {/* A scrim under the floating controls, so a white poster cannot
                swallow them. */}
            <div
              className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/55 to-transparent"
              aria-hidden
            />
          </div>

          <EventWidgetContent
            key={currentEvent.id}
            event={currentEvent}
            detail={detail}
            content={content}
            tiers={tiers}
            pool={events}
            onOpenSheet={setActiveSubSheet}
            onSelectEvent={(id) => {
              const index = events.findIndex((candidate) => candidate.id === id);
              if (index >= 0) goTo(index);
            }}
          />
        </div>

        {/* Sticky ticket bar. Safe-area aware, and the content above is padded
            by its measured height so nothing can hide behind it. */}
        <div
          ref={ctaRef}
          className="absolute inset-x-0 bottom-0 z-30 border-t border-border bg-background px-4 pt-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          {/* NO EMI banner. This platform has no EMI arrangement and no column
              saying whether one applies — a claim about somebody's money, on
              the checkout surface, backed by nothing. */}
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
              href={`/booking/${currentEvent.id}`}
              onClick={closeDeck}
              className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-cta px-7 text-body-sm font-extrabold text-cta-foreground shadow-lg transition-transform active:scale-95"
            >
              Book tickets
            </Link>
          </div>
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
