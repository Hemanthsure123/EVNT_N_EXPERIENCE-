'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Ticket } from 'lucide-react';
import {
  AnimatePresence,
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
} from 'framer-motion';
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
import { formatFromPrice } from '@/lib/discovery/format';
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
import { EventWidgetContent, EventWidgetSummary } from './event-widget-content';
import { DeckBrandHeader } from './deck-brand-header';
import { Lightbox, type LightboxImage } from './lightbox';
import { SharedPoster } from './shared-poster';

/**
 * THE MOBILE EVENT PAGE.
 *
 * Tapping a card anywhere on the site opens this over the page;
 * `/events/{slug}-{uuid}` opens it too, so a link somebody was SENT lands on
 * the same surface a link somebody tapped does.
 *
 * ── ONE EVENT AT A TIME, AND NO SIDEWAYS SWIPE BETWEEN THEM ───────────────
 *
 * This was a horizontal DECK: every event in the list mounted side by side on
 * a track, and a sideways swipe anywhere on the page moved to the previous or
 * next one. It is gone at the owner's instruction, and with it the gesture
 * code, the track and the neighbour pages drawn for the length of a swipe.
 * The one horizontal gesture left on this surface is the hero GALLERY's, which
 * is a native scroller of its own — so a sideways movement means exactly one
 * thing wherever it starts.
 *
 * `events` is still a list, because the similar-events rail switches to
 * another event in place rather than navigating away. That is a PRESS, and it
 * swaps the page and starts it at the top — the reader chose a different
 * event, and landing halfway down it would be landing somewhere they have not
 * been.
 *
 * ── IT IS A SCROLLING PAGE, NOT A BOTTOM SHEET ────────────────────────────
 *
 * This used to be a draggable sheet over an anchored poster: a snap ladder
 * (`sheet-snap.ts`), a vertical drag that handed travel back and forth with the
 * content scroller, a gesture plate that made the whole screen draggable, a
 * grab handle, and a transform written to the sheet node every frame with the
 * ticket bar counter-translated to stay on screen.
 *
 * All of it is gone. The page is an ordinary vertical scroller: the poster is
 * IN the flow rather than behind it, so scrolling moves the artwork away like
 * any other page, and the browser owns every gesture with nothing intercepting
 * it.
 *
 * ── AND THE POSTER DOCKS INSTEAD OF LEAVING ───────────────────────────────
 *
 * Scrolling past the hero moves it into the booking bar as a circular
 * thumbnail, and scrolling back to the top returns it. It is ONE element in two
 * places — a framer `layoutId` handoff — never a second copy cross-faded
 * against the first, which is what would let the two disagree about which event
 * is on screen. Both ends live inside the page, so they are measured against
 * the same ancestor and nothing outside it can put a stray offset into the
 * delta.
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

/**
 * THE HERO GALLERY'S DEPTH, as a slide leaves the centre.
 *
 * Applied in proportion to how far the slide is from resting — never as a
 * switch — so the picture under the finger follows it exactly and a reversed
 * swipe reverses the effect in the same frame. Small on purpose: enough that
 * the outgoing photograph visibly steps back as the next one arrives, not so
 * much that a poster's own edges shrink away from the frame it is shown in.
 */
const SLIDE_DEPTH_SCALE = 0.06;
const SLIDE_DEPTH_FADE = 0.3;

/** How long the gallery's blurred backdrop takes to cross-fade to a new slide. */
const BACKDROP_FADE_MS = 450;

export function EventWidgetDeck() {
  const { isOpen, events, currentIndex, closeDeck, setCurrentIndex, openOptions } = useEventDeck();
  const router = useRouter();
  const pathname = usePathname();
  const openOptionsRef = React.useRef(openOptions);
  openOptionsRef.current = openOptions;
  const isOpenRef = React.useRef(isOpen);
  isOpenRef.current = isOpen;
  // (Mirrors because the history and keyboard listeners below are bound once
  // per open and must read the live values, not the ones from that render.)
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
   * Deck-level rather than inside the page because the CLOSE reads it too: the
   * poster flies back to its card from wherever it currently is, and the
   * attribute that marks it follows this flag.
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
  /** Which photograph the full-screen viewer is showing, or null. */
  const [lightboxAt, setLightboxAt] = React.useState<number | null>(null);

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

  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const ctaRef = React.useRef<HTMLDivElement>(null);
  const heroRef = React.useRef<HTMLDivElement>(null);
  /** True once this open has been placed and its entrance played. */
  const enteredRef = React.useRef(false);

  // Measured, never assumed: a phone's viewport changes when the URL bar
  // collapses or it is rotated.
  React.useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

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
    // `currentEvent?.id` because switching events remounts the page, bar and
    // all, and the observer would otherwise be watching a node that has left
    // the screen.
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
    // A fresh open starts at the top of the event, undocked.
    dockedRef.current = false;
    setDocked(false);
    setLightboxAt(null);
    blurOpacity.set(1);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [isOpen, blurOpacity]);

  /**
   * THE SCROLL LISTENER, and it watches the page's own scroller.
   *
   * Not `window.scrollY`: the deck is a fixed overlay and the document behind
   * it is scroll-locked, so the window never moves.
   */
  const onScroll = React.useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
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
   * Switch to another event in the list — a press on the similar-events rail.
   *
   * The page is keyed by the event, so the switch is a fresh mount with its
   * scroller at the top. The dock and the backdrop are reset in the SAME render
   * as the index: reset afterwards, the first frame of the new page would have
   * its poster in the bar and framer would fly it up into the hero on arrival —
   * a transition for something nobody did.
   */
  const goTo = React.useCallback(
    (index: number) => {
      if (index < 0 || index >= events.length || index === currentIndex) return;
      dockedRef.current = false;
      setDocked(false);
      blurOpacity.set(1);
      setLightboxAt(null);
      setCurrentIndex(index);
    },
    [events.length, currentIndex, setCurrentIndex, blurOpacity],
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

      {/* The page. A gentle rise replaces the sheet's slide — the deck has to
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
        {/* ONE PAGE, keyed by the event. A switch from the similar-events
            rail is a fresh mount — a scroller at the top and a hero holding
            its poster — rather than the previous event's page re-rendered
            with new data at the old offset. */}
        <div style={{ height: '100dvh' }} className="relative w-full">
          <ActivePage
            key={currentEvent.id}
            event={currentEvent}
            detail={detail}
            content={content}
            tiers={tiers}
            events={events}
            docked={docked}
            dockTransition={dockTransition}
            hidePoster={flight !== null}
            blurOpacity={blurOpacity}
            onOpenPoster={setLightboxAt}
            images={lightboxImages}
            ctaHeight={ctaHeight}
            scrollerRef={scrollerRef}
            ctaRef={ctaRef}
            heroRef={heroRef}
            onScroll={onScroll}
            onOpenSheet={setActiveSubSheet}
            onSelectEvent={(id) => {
              const next = events.findIndex((candidate) => candidate.id === id);
              if (next >= 0) goTo(next);
            }}
            onLeave={closeDeck}
          />
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
  const slideRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const frameRef = React.useRef<number | null>(null);
  const reduceMotion = useReducedMotion();
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
   * with CSS scroll-snap — the browser owns the gesture, the momentum, the
   * rubber-band at the ends and the snap, and none of it costs a render.
   *
   * ── AND IT MOVES LIKE ONE OBJECT, NOT A STRIP OF PICTURES ─────────────
   *
   * Two things made the swipe feel mechanical. A fast flick could carry past
   * two or three photographs and stop wherever momentum ran out; `snap-always`
   * (`scroll-snap-stop: always`) stops at the next one, every time. And every
   * slide was drawn flat at full size for the whole journey, so the only thing
   * moving was a seam between two rectangles. Each slide now takes a little
   * DEPTH from its distance to the centre — slightly smaller and dimmer on its
   * way out, back to full on arrival, with the blurred backdrop showing in the
   * gap — written straight to the node from a `requestAnimationFrame`, so it
   * tracks the finger in the frame the browser moved the strip and costs no
   * React render.
   *
   * The snap stays the BROWSER's. Its deceleration is tuned per device, and a
   * JavaScript tween layered over a native scroller is how a gallery ends up
   * fighting the finger that is driving it.
   *
   * The index is still tracked, for one reader: the backdrop, which has to be
   * the colours of the picture actually on screen. Derived from `scrollLeft`
   * rather than an observer, because every slide is exactly the track's width
   * and division is cheaper and exact.
   */
  const paint = React.useCallback(() => {
    frameRef.current = null;
    const node = railRef.current;
    if (!node || node.clientWidth === 0) return;
    const position = node.scrollLeft / node.clientWidth;
    const next = Math.round(position);
    setSlide((previous) => (previous === next ? previous : next));
    if (reduceMotion) return;
    slideRefs.current.forEach((element, index) => {
      if (!element) return;
      const distance = Math.min(Math.abs(index - position), 1);
      // Cleared at rest rather than left at `scale(1)`, so a resting poster is
      // laid out exactly as it would be with no effect at all.
      if (distance < 0.001) {
        element.style.transform = '';
        element.style.opacity = '';
        return;
      }
      element.style.transform = `scale(${1 - SLIDE_DEPTH_SCALE * distance})`;
      element.style.opacity = String(1 - SLIDE_DEPTH_FADE * distance);
    });
  }, [reduceMotion]);

  // One paint per frame however many scroll events the browser delivers in it.
  const onRailScroll = React.useCallback(() => {
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(paint);
  }, [paint]);

  React.useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // The rail unmounts while the poster is docked and remounts at the FIRST
  // slide, which is also what the thumbnail flying back into it shows. The
  // index follows, so the backdrop is never the colours of a photograph that
  // is no longer there.
  React.useEffect(() => {
    if (docked) setSlide(0);
  }, [docked]);

  /**
   * A drag ends in a `click`, and every slide is a button.
   *
   * Without this, swiping to the next photograph opens the full-screen viewer
   * on release. The threshold is the distance nobody's thumb moves while
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
            frame before it decodes, the gap around a slide stepping back
            mid-swipe, and the whole box once the poster has docked into the
            booking bar — was a flat slab of `bg-muted`, which on a light theme
            reads as a skin-toned rectangle where the event's artwork should
            be.

            It CROSS-FADES between slides. It used to swap in one frame at the
            midpoint of the swipe, which is exactly when the gap around the
            stepping-back slides shows it. */}
        {backdrop ? (
          <motion.div
            aria-hidden
            style={{ opacity: blurOpacity }}
            className="pointer-events-none absolute inset-0"
          >
            <AnimatePresence initial={false}>
              <motion.div
                key={backdrop}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : BACKDROP_FADE_MS / 1000,
                  ease: TRANSITION_EASE,
                }}
                className="absolute inset-0"
              >
                <Image
                  src={backdrop}
                  alt=""
                  fill
                  sizes="100vw"
                  // `blur-sm` (4px), not `blur-2xl` (40px): soft enough that
                  // nothing behind the poster competes with it, light enough
                  // that it reads as the same photograph rather than as fog.
                  // The scale exists only to push the blur's soft edge outside
                  // the clip, and 4px needs far less room than 40.
                  className="scale-110 object-cover blur-sm saturate-150"
                />
              </motion.div>
            </AnimatePresence>
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
                onScroll={onRailScroll}
                className={cn(
                  'flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden',
                  // `touch-pan-x`: this element handles sideways and nothing
                  // else, so a vertical drag over the artwork scrolls the PAGE
                  // instead of being arbitrated against the gallery. It is
                  // the ONLY horizontal gesture on this surface.
                  'touch-pan-x overscroll-x-contain',
                  'scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                )}
              >
                {slides.map((image, index) => (
                  <button
                    key={`${image.url}#${index}`}
                    ref={(element) => {
                      slideRefs.current[index] = element;
                    }}
                    type="button"
                    onPointerDown={onSlidePointerDown}
                    onPointerMove={onSlidePointerMove}
                    onClick={() => openSlide(index)}
                    aria-label={
                      index === 0
                        ? `View ${event.title} poster full size`
                        : image.alt || `View photo ${index + 1} full size`
                    }
                    // Rounded like the frame, so a slide stepping back
                    // mid-swipe reads as a card rather than as a square
                    // cut-out; at rest the frame's own clip makes the two
                    // radii one edge.
                    style={{ borderRadius: HERO_RADIUS_PX }}
                    className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <SlideImage
                      src={image.url}
                      // Only the FIRST is priority. Marking a whole gallery
                      // high-priority makes every image compete for the same
                      // connections and delays the one that IS the LCP element.
                      priority={index === 0}
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
 * One photograph in the hero gallery, faded in once it has decoded.
 *
 * The slides after the first load lazily, so a quick swipe could land on a
 * picture that appeared in one frame, all at once, over the backdrop. It
 * fades up instead. The FIRST slide never fades: it is the shared-poster
 * transition's destination, and the handover is pixel-identical only if the
 * picture underneath is already fully there.
 */
function SlideImage({ src, priority }: { src: string; priority: boolean }) {
  const [loaded, setLoaded] = React.useState(priority);
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes="100vw"
      priority={priority}
      onLoad={() => setLoaded(true)}
      className={cn(
        'object-cover transition-opacity duration-500 ease-out',
        loaded ? 'opacity-100' : 'opacity-0',
      )}
      draggable={false}
    />
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
  layoutId,
  transition,
  barRef,
  onLeave,
}: {
  event: EventCardData;
  /**
   * `null` while the tiers are still in flight: nothing is known about the
   * sale window yet, and the bar draws its ordinary label rather than
   * guessing a refusal.
   */
  tiers: TicketTier[] | null | undefined;
  docked: boolean;
  layoutId: string;
  transition: { duration: number; ease: [number, number, number, number] };
  barRef?: React.RefObject<HTMLDivElement>;
  onLeave?: () => void;
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
        ) : null}

        <div className="flex min-w-0 flex-col">
          <span className="truncate text-h4 font-extrabold tabular-nums text-foreground">
            {price === null ? 'See tickets' : price === 'Free' ? 'Free entry' : price}
          </span>
          {price !== null && price !== 'Free' ? (
            <span className="text-caption font-semibold text-muted-foreground">onwards</span>
          ) : null}
        </div>

        {!bookable ? (
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
  onOpenSheet: (sheet: NonNullable<SubSheetType>) => void;
  onSelectEvent: (id: string) => void;
  /** Closes WITHOUT the exit animation — for navigating away. */
  onLeave: () => void;
}) {
  /**
   * The shared id is scoped to the EVENT.
   *
   * A constant would make every switch between events a match: framer would
   * see the id leave the outgoing page and arrive in the incoming one and fly
   * the old poster into the new page. Per event, a switch is an unmount and a
   * separate mount with nothing in common.
   */
  const layoutId = `deck-poster-${event.id}`;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── AN ORDINARY SCROLLER ──────────────────────────────────────────
          `overflow-y-auto`, and that is the whole story: no pointer handlers,
          no touch listeners, nothing between the finger and the browser. */}
      <div
        ref={scrollerRef}
        data-deck-scroller
        onScroll={onScroll}
        className="flex-1 overflow-y-auto overscroll-contain"
        // The bar's measured height PLUS the gap it now floats above, so the
        // last section clears it exactly. A hard-coded `pb-28` is either a void
        // or a clipped final row on some device.
        style={{ paddingBottom: `${(ctaHeight || 96) + 32}px` }}
      >
        {/* ── BRANDING, AND IT STAYS ─────────────────────────────────────
            First in the scroller and `sticky`, so it pins to the top of THIS
            box as everything below it scrolls underneath. See `DeckBrandHeader`
            for why it is sticky here rather than fixed. */}
        <DeckBrandHeader />
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
        {/* WHAT it is, WHERE and WHEN. */}
        <EventWidgetSummary event={event} content={content} onOpenSheet={onOpenSheet} />
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
