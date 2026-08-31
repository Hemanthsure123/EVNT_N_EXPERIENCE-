'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Clock,
  MapPin,
  Share2,
  Ticket,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { FavouriteButton } from '@/components/discovery/favourite-button';
import { useEventDeck } from '@/lib/discovery/event-deck-context';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDateTime, formatFromPrice } from '@/lib/discovery/format';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';

/**
 * District-Style Mobile Event Widget Deck
 *
 * - Floating horizontal carousel stack where selected event sits in focus
 *   with adjacent cards peeking on left and right edges.
 * - Swipe left -> next event, Swipe right -> previous event.
 * - Vertical drag upward -> expands widget to 100% full screen.
 * - Vertical drag downward -> collapses/dismisses back to feed.
 * - NO "Peek" or "Full Screen" text/buttons.
 */
export function EventWidgetDeck() {
  const { isOpen, events, currentIndex, closeDeck, setCurrentIndex } = useEventDeck();
  const [expanded, setExpanded] = React.useState(false);
  const [direction, setDirection] = React.useState(0);

  React.useEffect(() => {
    if (!isOpen) {
      setExpanded(false);
    }
  }, [isOpen]);

  if (!isOpen || events.length === 0) return null;

  const currentEvent = events[currentIndex] ?? events[0];
  const price = formatFromPrice(currentEvent.from_price);
  const category = inferCategory(currentEvent);

  const handleNext = () => {
    if (currentIndex < events.length - 1) {
      setDirection(1);
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const { offset, velocity } = info;

    // Horizontal swipe gesture check
    if (Math.abs(offset.x) > Math.abs(offset.y)) {
      if (offset.x < -50 || velocity.x < -300) {
        handleNext();
      } else if (offset.x > 50 || velocity.x > 300) {
        handlePrev();
      }
      return;
    }

    // Vertical drag gesture check
    if (offset.y < -80 || velocity.y < -300) {
      setExpanded(true);
    } else if (offset.y > 100 || velocity.y > 300) {
      if (expanded) {
        setExpanded(false);
      } else {
        closeDeck();
      }
    }
  };

  const shareEvent = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: currentEvent.title,
          url: window.location.origin + eventPath(currentEvent),
        });
      } catch {
        // Ignored
      }
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex flex-col justify-start pt-3 sm:hidden">
      {/* Dark Layered Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={closeDeck}
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
      />

      {/* Main Draggable Floating Stack Container */}
      <div className="relative z-10 flex h-full w-full flex-col items-center">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={currentEvent.id}
            custom={direction}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            initial={{
              x: direction > 0 ? 250 : direction < 0 ? -250 : 0,
              opacity: 0.5,
              scale: 0.9,
            }}
            animate={{
              x: 0,
              opacity: 1,
              scale: 1,
            }}
            exit={{
              x: direction < 0 ? 250 : direction > 0 ? -250 : 0,
              opacity: 0.5,
              scale: 0.9,
            }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={cn(
              'relative flex w-[90vw] max-w-sm flex-col overflow-hidden bg-surface text-foreground shadow-2xl transition-all duration-300 ease-out',
              expanded
                ? 'fixed inset-0 max-w-none w-full h-[100dvh] rounded-none z-50'
                : 'h-[80vh] max-h-[82vh] rounded-3xl border border-white/10 mt-1',
            )}
          >
            {/* Top Poster Image Area */}
            <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
              {currentEvent.poster_url ? (
                <Image
                  src={currentEvent.poster_url}
                  alt={currentEvent.title}
                  fill
                  priority
                  sizes="90vw"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                  <Ticket className="size-12" />
                </div>
              )}

              {/* Overlaid Top Header Actions */}
              <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 bg-gradient-to-b from-black/60 to-transparent z-20">
                <button
                  type="button"
                  onClick={closeDeck}
                  aria-label="Back to discovery"
                  className="flex size-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-transform active:scale-90"
                >
                  <ArrowLeft className="size-5" />
                </button>

                <div className="flex items-center gap-2">
                  <FavouriteButton
                    eventId={currentEvent.id}
                    title={currentEvent.title}
                    className="size-10 rounded-full bg-black/40 text-white backdrop-blur-md transition-transform active:scale-90"
                  />
                  <button
                    type="button"
                    onClick={shareEvent}
                    aria-label="Share event"
                    className="flex size-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-transform active:scale-90"
                  >
                    <Share2 className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Scrollable Event Content Details */}
            <div className="flex flex-1 flex-col overflow-y-auto p-4 gap-4.5 bg-surface">
              {/* Category Chips */}
              {category ? (
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-caption font-medium text-muted-foreground">
                    {category.label}
                  </span>
                </div>
              ) : null}

              {/* Title & Date */}
              <div className="flex flex-col gap-1">
                <h2 className="text-h3 font-extrabold leading-snug tracking-tight text-foreground">
                  {currentEvent.title}
                </h2>
                <p className="flex items-center gap-1.5 text-body-sm font-semibold text-primary mt-0.5">
                  <CalendarDays className="size-4 shrink-0" aria-hidden />
                  <time dateTime={currentEvent.starts_at}>
                    {formatEventDateTime(currentEvent.starts_at)}
                  </time>
                </p>
              </div>

              {/* Venue & Location Row */}
              <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3 border border-border/40">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <MapPin className="size-4" aria-hidden />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-sm font-bold text-foreground">
                    {currentEvent.venue}, {currentEvent.city}
                  </span>
                  <span className="text-caption text-muted-foreground">7.9 km away</span>
                </div>
                <ChevronRight className="size-4 text-muted-foreground shrink-0" aria-hidden />
              </div>

              {/* Gates / Timeline Schedule Row */}
              <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3 border border-border/40">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Clock className="size-4" aria-hidden />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-sm font-bold text-foreground">
                    Gates open at 6:30 PM
                  </span>
                  <span className="text-caption text-muted-foreground">View full schedule & timeline</span>
                </div>
                <ChevronRight className="size-4 text-muted-foreground shrink-0" aria-hidden />
              </div>

              {/* Sticky Bottom Booking Action Pill */}
              <div className="mt-auto pt-3">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-muted/40 p-3">
                  <div className="flex flex-col">
                    <span className="text-caption font-semibold text-emerald-600 dark:text-emerald-400">
                      General Sale
                    </span>
                    <span className="text-body-sm font-extrabold text-foreground tabular-nums">
                      {price === 'Free' ? 'Free entry' : `${price} onwards`}
                    </span>
                  </div>

                  <Link
                    href={eventPath(currentEvent)}
                    onClick={closeDeck}
                    className="inline-flex h-11 items-center justify-center rounded-full bg-cta px-6 text-label font-bold text-cta-foreground shadow-md transition-transform active:scale-95"
                  >
                    Book tickets
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Adjacent Peeking Cards (Left & Right Indicators) */}
        {currentIndex > 0 ? (
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous event"
            className="absolute left-1 top-1/2 -translate-y-1/2 opacity-60 transition-opacity hover:opacity-100"
          >
            <div className="h-64 w-6 rounded-r-2xl bg-surface/40 backdrop-blur-sm border-r border-y border-white/20" />
          </button>
        ) : null}

        {currentIndex < events.length - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next event"
            className="absolute right-1 top-1/2 -translate-y-1/2 opacity-60 transition-opacity hover:opacity-100"
          >
            <div className="h-64 w-6 rounded-l-2xl bg-surface/40 backdrop-blur-sm border-l border-y border-white/20" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
