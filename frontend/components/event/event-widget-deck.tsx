'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Globe,
  Share2,
  Ticket,
  Users,
  Ban,
  Building2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { FavouriteButton } from '@/components/discovery/favourite-button';
import { EventSubSheets, type SubSheetType } from './event-sub-sheets';
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
 * - Draggable top handle pill for gesture-based expansion (up to 100% full screen, down to collapse).
 * - Exact reference section hierarchy & sub-sheet modal triggers (Venue, Schedule, About, Things to Know, Organiser).
 * - Sticky bottom EMI banner + Book tickets action bar.
 */
export function EventWidgetDeck() {
  const { isOpen, events, currentIndex, closeDeck, setCurrentIndex } = useEventDeck();
  const [expanded, setExpanded] = React.useState(false);
  const [direction, setDirection] = React.useState(0);
  const [activeSubSheet, setActiveSubSheet] = React.useState<SubSheetType>(null);

  React.useEffect(() => {
    if (!isOpen) {
      setExpanded(false);
      setActiveSubSheet(null);
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
    <div className="fixed inset-0 z-modal flex flex-col justify-start pt-2 sm:hidden">
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
              'relative flex w-[92vw] max-w-sm flex-col overflow-hidden bg-neutral-900 text-white shadow-2xl transition-all duration-300 ease-out',
              expanded
                ? 'fixed inset-0 max-w-none w-full h-[100dvh] rounded-none z-50'
                : 'h-[84vh] max-h-[86vh] rounded-3xl border border-white/10 mt-1',
            )}
          >
            {/* Top Drag Handle Pill Bar */}
            <div className="flex w-full justify-center pt-2.5 pb-1 bg-neutral-900 shrink-0">
              <div className="h-1.5 w-12 rounded-full bg-neutral-600/60" />
            </div>

            {/* Top Poster Image Area */}
            <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-neutral-800">
              {currentEvent.poster_url ? (
                <Image
                  src={currentEvent.poster_url}
                  alt={currentEvent.title}
                  fill
                  priority
                  sizes="92vw"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-neutral-800 text-neutral-400">
                  <Ticket className="size-12" />
                </div>
              )}

              {/* Overlaid Top Header Actions */}
              <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 bg-gradient-to-b from-black/70 via-black/30 to-transparent z-20">
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
                    <Share2 className="size-4.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Scrollable Reference Content Hierarchy Details */}
            <div className="flex flex-1 flex-col overflow-y-auto p-4 gap-5 bg-neutral-900 text-neutral-100 pb-28">
              {/* Category Pills */}
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-neutral-800 px-3 py-1 text-caption font-semibold text-neutral-300 border border-white/10">
                  {category ? category.label : 'DJ Nights'}
                </span>
                <span className="rounded-full bg-neutral-800 px-3 py-1 text-caption font-semibold text-neutral-300 border border-white/10">
                  Nightlife
                </span>
              </div>

              {/* Event Title & Accent Date */}
              <div className="flex flex-col gap-1">
                <h2 className="text-h3 font-extrabold leading-snug tracking-tight text-white">
                  {currentEvent.title}
                </h2>
                <p className="text-body-sm font-bold text-amber-400 mt-0.5">
                  {formatEventDateTime(currentEvent.starts_at)}
                </p>
              </div>

              {/* Venue Row */}
              <button
                type="button"
                onClick={() => setActiveSubSheet('venue')}
                className="flex items-center gap-3.5 rounded-2xl bg-neutral-800/80 p-3.5 border border-white/10 text-left transition-colors hover:bg-neutral-800"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-700/80 text-neutral-300">
                  <Building2 className="size-5" aria-hidden />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-body-sm font-bold text-white">
                    {currentEvent.venue}, {currentEvent.city}
                  </span>
                  <span className="text-caption font-semibold text-neutral-400">
                    <span className="text-lime-400">Rated 3.9</span> | 7.1 km away
                  </span>
                </div>
                <ChevronRight className="size-5 text-neutral-400 shrink-0" aria-hidden />
              </button>

              {/* Schedule / Timeline Row */}
              <button
                type="button"
                onClick={() => setActiveSubSheet('schedule')}
                className="flex items-center gap-3.5 rounded-2xl bg-neutral-800/80 p-3.5 border border-white/10 text-left transition-colors hover:bg-neutral-800"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-700/80 text-neutral-300">
                  <Clock className="size-5" aria-hidden />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-body-sm font-bold text-white">Starts at 8 PM</span>
                  <span className="text-caption text-neutral-400">View full schedule & timeline</span>
                </div>
                <ChevronRight className="size-5 text-neutral-400 shrink-0" aria-hidden />
              </button>

              {/* About the Event Section */}
              <div className="flex flex-col gap-2 pt-1">
                <h3 className="text-body font-extrabold text-white">About the event</h3>
                <p className="text-body-sm text-neutral-300 font-medium">Feel the beat. Own the floor.</p>
                <p className="text-body-sm text-neutral-400 line-clamp-2">
                  {currentEvent.title} is taking over Quake Arena with unstoppable energy, electrifying
                  music, and a night made for high vibrations...
                </p>
                <button
                  type="button"
                  onClick={() => setActiveSubSheet('about')}
                  className="flex items-center gap-1 text-body-sm font-bold text-white hover:underline self-start pt-0.5"
                >
                  Read more <ChevronRight className="size-4 text-neutral-400" />
                </button>
              </div>

              {/* Things to Know Section */}
              <div className="flex flex-col gap-3 pt-2">
                <h3 className="text-body font-extrabold text-white">Things to Know</h3>
                <div className="flex flex-col gap-3 text-body-sm text-neutral-300">
                  <div className="flex items-center gap-3">
                    <Globe className="size-4.5 text-neutral-400 shrink-0" />
                    <span>Event will be in English</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Users className="size-4.5 text-neutral-400 shrink-0" />
                    <span>Ticket needed for ages 21 and above</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Ticket className="size-4.5 text-neutral-400 shrink-0" />
                    <span>Entry allowed for ages 21 and above</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Ban className="size-4.5 text-neutral-400 shrink-0" />
                    <span>Kids not allowed</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubSheet('things_to_know')}
                  className="flex items-center gap-1 text-body-sm font-bold text-white hover:underline self-start pt-1"
                >
                  See all <ChevronRight className="size-4 text-neutral-400" />
                </button>
              </div>

              {/* Organised By Section */}
              <div className="flex flex-col gap-3 pt-2">
                <h3 className="text-body font-extrabold text-white">Organised By</h3>
                <button
                  type="button"
                  onClick={() => setActiveSubSheet('organiser')}
                  className="flex items-center gap-3.5 rounded-2xl bg-neutral-800/80 p-3.5 border border-white/10 text-left transition-colors hover:bg-neutral-800"
                >
                  <div className="size-12 rounded-full bg-purple-600/30 text-purple-300 flex items-center justify-center font-bold text-body">
                    H
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-sm font-bold text-white">
                      {currentEvent.organization_name || 'HIGHSTREET HOSPITALITY LLP'}
                    </span>
                    <span className="text-caption text-neutral-400">69% Liked • 20+ Events</span>
                  </div>
                  <ChevronRight className="size-5 text-neutral-400 shrink-0" aria-hidden />
                </button>
              </div>
            </div>

            {/* Sticky Bottom Booking Action Surface */}
            <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-b-3xl bg-neutral-900 p-3.5 border-t border-white/10 shadow-2xl">
              {/* EMI Offer Top Pill */}
              <div className="mb-2.5 flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-900/90 to-purple-900/90 px-3 py-1.5 border border-purple-500/30">
                <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-indigo-950 font-black text-xs">
                  %
                </div>
                <span className="text-caption font-bold text-white">
                  EMI available on orders over ₹4,000
                </span>
              </div>

              {/* Price & Primary CTA */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-h4 font-extrabold text-white tabular-nums">
                    {price === 'Free' ? 'Free entry' : `${price}`}
                  </span>
                  <span className="text-caption font-semibold text-neutral-400">onwards</span>
                </div>

                <Link
                  href={eventPath(currentEvent)}
                  onClick={closeDeck}
                  className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-body-sm font-extrabold text-neutral-950 shadow-lg transition-transform active:scale-95 hover:bg-neutral-100"
                >
                  Book tickets
                </Link>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Adjacent Peeking Cards Navigation Indicators */}
        {currentIndex > 0 ? (
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous event"
            className="absolute left-1 top-1/2 -translate-y-1/2 opacity-60 transition-opacity hover:opacity-100"
          >
            <div className="h-64 w-5 rounded-r-2xl bg-neutral-800/60 backdrop-blur-sm border-r border-y border-white/20" />
          </button>
        ) : null}

        {currentIndex < events.length - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next event"
            className="absolute right-1 top-1/2 -translate-y-1/2 opacity-60 transition-opacity hover:opacity-100"
          >
            <div className="h-64 w-5 rounded-l-2xl bg-neutral-800/60 backdrop-blur-sm border-l border-y border-white/20" />
          </button>
        ) : null}

        {/* Unified Sub-Sheets Modal Overlay */}
        <EventSubSheets
          sheetType={activeSubSheet}
          onClose={() => setActiveSubSheet(null)}
          event={currentEvent}
        />
      </div>
    </div>
  );
}
