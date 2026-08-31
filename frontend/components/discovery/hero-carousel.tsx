'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { EventPosterArt } from '@/components/illustrations/poster';
import { Container } from '@/components/shell/container';
import type { EventCard as EventCardModel } from '@/lib/api/types';
import { categoryBySlug, inferCategory } from '@/lib/discovery/categories';
import { formatEventDate, formatEventTime, formatFromPrice } from '@/lib/discovery/format';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';
import { EventPreviewSheet } from '@/components/event/event-preview-sheet';
import { categoryTint } from './category-tint';

/**
 * ── THE FIRST SCREEN: ONE EVENT, FULL WIDTH ───────────────────────────────
 *
 * A banner per event — date, title, venue, from-price, one black CTA — beside
 * its poster, over a blurred blow-up of that same poster. The blur is what
 * gives each slide the colour of the event it shows without anybody choosing a
 * colour per event, and it is the reason the band reads as *this gig* rather
 * than as a template with a picture dropped into it.
 *
 * ── IT SHOWS ONE, NOT TWELVE ──────────────────────────────────────────────
 *
 * The rail this replaces put five posters on screen at once, which is a shelf:
 * five things competing at a fifth of the attention each. A hero is a
 * recommendation, so it commits to one — and the grid below it still shows
 * everything, so nothing is hidden by the choice.
 *
 * ── NO AUTOPLAY ───────────────────────────────────────────────────────────
 *
 * Deliberate, not an omission. A banner that advances on a timer moves the CTA
 * out from under a pointer already travelling towards it and restarts the
 * decision every few seconds. The controls are all explicit: chevrons, dots,
 * arrow keys, and on touch a horizontal swipe, which is the gesture the
 * peeking layout already implies.
 *
 * ── ONE COMPONENT, TWO SHAPES ─────────────────────────────────────────────
 *
 * Below `md` the banner would be a split of nothing across 360px, so the same
 * slides render as a "Featured events" rail: a snapped horizontal scroller
 * with the neighbours peeking, so the scroll affords itself. Same data, same
 * order, same links — two components would be two sets of keyboard bugs.
 */
export interface HeroCarouselProps {
  events: EventCardModel[];
  /** What this rail IS — the mobile heading and the assistive name. */
  label: string;
}

export function HeroCarousel({ events, label }: HeroCarouselProps) {
  const [index, setIndex] = React.useState(0);
  const [isPaused, setIsPaused] = React.useState(false);
  const count = events.length;

  const go = React.useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  React.useEffect(() => {
    if (count <= 1 || isPaused) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % count);
    }, 4000);
    return () => clearInterval(timer);
  }, [count, isPaused]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(index - 1);
    }
  };

  if (!count) return null;

  const active = events[Math.min(index, count - 1)]!;

  return (
    <section aria-roledescription="carousel" aria-label={label}>
      {/* ── PHONE: the peeking rail ────────────────────────────────────── */}
      <div className="md:hidden">
        <Container className="pb-3 pt-5">
          <h2 className="text-body font-bold tracking-tight text-foreground">{label}</h2>
        </Container>
        <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {events.map((event, i) => (
            <li key={event.id} className="w-[76%] shrink-0 snap-center">
              <HeroPosterTile event={event} priority={i === 0} />
            </li>
          ))}
        </ul>
      </div>

      {/* ── DESKTOP: the banner ────────────────────────────────────────── */}
      <div
        className="relative isolate hidden overflow-hidden border-b border-border md:block"
        onKeyDown={onKeyDown}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocus={() => setIsPaused(true)}
        onBlur={() => setIsPaused(false)}
      >
        <Backdrop event={active} />

        <Container className="relative flex min-h-[26rem] items-center gap-10 py-14 lg:min-h-[30rem] lg:py-16">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <p className="text-body-sm font-semibold text-foreground/80">
              {formatEventDate(active.starts_at)}, {formatEventTime(active.starts_at)}
            </p>
            <h2 className="max-w-2xl text-h1 font-extrabold leading-[1.08] tracking-tight text-foreground lg:text-display">
              {active.title}
            </h2>
            <p className="max-w-xl text-h4 font-medium text-foreground/80">
              {active.venue}
              {active.city ? ` | ${active.city}` : ''}
            </p>
            <PriceLine event={active} />
            <Link
              href={eventPath(active)}
              className="mt-2 inline-flex h-control-lg w-fit items-center rounded-full bg-cta px-pill-lg text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-cta-active"
            >
              Book tickets
            </Link>
          </div>

          {/* The poster at the size the design gives it. `aria-hidden`: the
              text beside it already names this event, and announcing it twice
              is noise on the busiest screen of the site. */}
          <div
            className="relative hidden aspect-portrait w-64 shrink-0 overflow-hidden rounded-2xl shadow-lg lg:block lg:w-72"
            aria-hidden
          >
            <Poster event={active} priority sizes="288px" />
          </div>
        </Container>

        <Chevron side="left" onClick={() => go(index - 1)} />
        <Chevron side="right" onClick={() => go(index + 1)} />

        <div className="absolute inset-x-0 bottom-5 flex justify-center gap-2">
          {events.map((event, i) => (
            <button
              key={event.id}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show ${event.title}`}
              aria-current={i === index}
              className={cn(
                'h-1.5 rounded-full transition-all duration-base',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                // The active dot ELONGATES rather than only changing colour: a
                // size difference survives both themes and every kind of colour
                // blindness, where a tint does not.
                i === index ? 'w-8 bg-foreground' : 'w-1.5 bg-foreground/25 hover:bg-foreground/40',
              )}
            />
          ))}
        </div>

        {/* The slide change is announced, not a silent swap. */}
        <p className="sr-only" aria-live="polite">
          {`${active.title}. Slide ${index + 1} of ${count}.`}
        </p>
      </div>
    </section>
  );
}

/** The blurred blow-up behind a slide — colour taken from the artwork, free. */
function Backdrop({ event }: { event: EventCardModel }) {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      {event.poster_url ? (
        <Image
          src={event.poster_url}
          alt=""
          fill
          priority
          sizes="100vw"
          className="scale-110 object-cover blur-3xl saturate-150"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-muted to-border" />
      )}
      {/* The scrim is what keeps the headline legible over ANY poster. Without
          it the contrast of the h1 depends on whichever image an organizer
          happened to upload, which is not something a design can guarantee. */}
      <div className="absolute inset-0 bg-background/70 backdrop-blur-2xl" />
    </div>
  );
}

function Poster({
  event,
  priority,
  sizes,
}: {
  event: EventCardModel;
  priority?: boolean;
  sizes: string;
}) {
  const category = categoryBySlug(event.category) ?? inferCategory(event);
  if (!event.poster_url) {
    return (
      <EventPosterArt
        slug={category?.slug ?? ''}
        seed={event.id}
        className={categoryTint(category?.slug).surface}
      />
    );
  }
  return (
    <Image
      src={event.poster_url}
      alt=""
      fill
      sizes={sizes}
      priority={priority}
      className="object-cover"
    />
  );
}

/** Null is not zero — an uncosted event shows no price line at all. */
function PriceLine({ event }: { event: EventCardModel }) {
  const price = formatFromPrice(event.from_price);
  if (!price) return null;
  return (
    <p className="text-body-lg font-semibold text-foreground">
      {price === 'Free' ? 'Free entry' : `${price} onwards`}
    </p>
  );
}

function HeroPosterTile({ event, priority }: { event: EventCardModel; priority?: boolean }) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const price = formatFromPrice(event.from_price);
  return (
    <>
      <EventPreviewSheet event={event} open={sheetOpen} onOpenChange={setSheetOpen} />
      <div
        onClick={() => setSheetOpen(true)}
        className="group/tile flex h-full flex-col gap-2.5 rounded-2xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative aspect-portrait w-full overflow-hidden rounded-2xl bg-muted">
          <Poster event={event} priority={priority} sizes="76vw" />
        </div>
        <div className="flex flex-col gap-0.5 px-0.5 pb-1">
          <p className="line-clamp-2 text-body-sm font-bold leading-snug text-foreground">
            {event.title}
          </p>
          {price ? (
            <p className="text-caption text-muted-foreground">
              {price === 'Free' ? 'Free' : `${price} onwards`}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Chevron({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous event' : 'Next event'}
      className={cn(
        'absolute top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full',
        'text-foreground/70 transition-colors duration-fast hover:bg-surface hover:text-foreground hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        side === 'left' ? 'left-1 lg:left-3' : 'right-1 lg:right-3',
      )}
    >
      <Icon className="size-6" aria-hidden />
    </button>
  );
}
