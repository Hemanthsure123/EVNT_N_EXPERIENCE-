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
import { useEventDeck } from '@/lib/discovery/event-deck-context';
import { DateBadge } from './date-badge';
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
    // The banner this advances is `hidden md:block`. Unguarded, the timer
    // re-rendered the WHOLE carousel — every mobile slide included — once every
    // four seconds on a phone, to move something with `display: none`.
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches) return;
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
      {/* ── PHONE: 3-Card Peeking Raised Carousel ──────────────────────── */}
      <MobileFeaturedCarousel events={events} label={label} />

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

function MobileFeaturedCarousel({
  events,
  label,
}: {
  events: EventCardModel[];
  label: string;
}) {
  const containerRef = React.useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const handleScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const children = Array.from(el.children) as HTMLElement[];
    if (children.length === 0) return;

    const containerCenter = el.scrollLeft + el.clientWidth / 2;
    let closestIndex = 0;
    let minDistance = Infinity;

    children.forEach((child, idx) => {
      const childCenter = child.offsetLeft + child.clientWidth / 2;
      const distance = Math.abs(containerCenter - childCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = idx;
      }
    });

    setActiveIndex(closestIndex);
  }, []);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div className="overflow-x-hidden md:hidden">
      <Container className="pb-3 pt-5">
        <h2 className="text-body font-bold tracking-tight text-foreground">{label}</h2>
      </Container>
      <ul
        ref={containerRef}
        aria-label={label}
        className={cn(
          // `relative`, because `handleScroll` compares `child.offsetLeft`
          // against this element's `scrollLeft`. `offsetLeft` is measured from
          // the nearest POSITIONED ancestor, so without this the two are in
          // different coordinate spaces and the active card is only correct by
          // the accident of this rail sitting at page-x 0.
          'relative flex snap-x snap-mandatory items-center gap-3.5 overflow-x-auto scroll-smooth',
          // 16vw each side + a 68vw card = exactly 100vw, so the FIRST and LAST
          // cards can reach the centre like every other one. It was `px-[14vw]`
          // against a card capped at `max-w-64`: a vw padding and a px cap stop
          // agreeing as the phone widens, so card one sat ~12px left of centre
          // at 390px and ~27px off on a Pro Max. The cap is gone and both
          // numbers are now the same unit.
          'px-[16vw]',
          // py-6, not py-4: the active card is scaled 5% and lifted 6px, which
          // is ~9px of ink above its box, and `overflow-x-auto` also clips
          // vertically — so `shadow-xl` and the ring were being cut off and the
          // elevation read flatter than it was drawn.
          'py-6',
          'scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {events.map((event, i) => {
          const isActive = i === activeIndex;
          return (
            <li
              key={event.id}
              className={cn(
                'w-[68vw] shrink-0 snap-center transition-all duration-300 ease-out',
                // Every other animated surface in this repo pairs its
                // transition with this guard; the largest moving element on the
                // mobile home page was the one place that did not.
                'motion-reduce:transition-none motion-reduce:transform-none',
                isActive
                  ? 'scale-105 -translate-y-1.5 opacity-100 z-10'
                  : 'scale-95 translate-y-1 opacity-75 z-0',
              )}
            >
              {/* ── NO RING ON THE ACTIVE CARD ───────────────────────────
                  It carried `ring-2 ring-primary/40`, which drew a violet
                  outline around the whole card — so the centre event read as a
                  UI component in a selected state rather than as a poster. A
                  discovery card is a thing you look AT; an outline is the
                  language of a control you have focused.

                  Position, scale and elevation already say which one is
                  active, and they say it the way a deck of cards does. The
                  focus ring is still there for the keyboard, on the button
                  itself, where a focus ring belongs. */}
              <div
                className={cn(
                  'rounded-2xl transition-shadow duration-300 motion-reduce:transition-none',
                  isActive ? 'shadow-xl' : 'shadow-sm',
                )}
              >
                <HeroPosterTile event={event} priority={i === 0} allEvents={events} index={i} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HeroPosterTile({
  event,
  priority,
  allEvents,
  index = 0,
}: {
  event: EventCardModel;
  priority?: boolean;
  allEvents?: EventCardModel[];
  index?: number;
}) {
  const { openDeck } = useEventDeck();
  const price = formatFromPrice(event.from_price);
  return (
    // A BUTTON, not a div with onClick. A div is not focusable, so the
    // `focus-visible:ring` classes below could never fire, the card was
    // unreachable by keyboard, and a screen reader announced no control at all
    // on the biggest thing on the mobile home page.
    <button
      type="button"
      onClick={() => openDeck(allEvents && allEvents.length > 0 ? allEvents : [event], index)}
      // A CARD, not a bare poster with two lines under it. The artwork sits
      // on a surface with its own padding, which is what gives the title and
      // the price somewhere to live instead of floating on the page — and what
      // makes the rail read as a row of cards rather than a row of pictures.
      className="group/tile flex h-full w-full flex-col overflow-hidden rounded-2xl bg-surface p-2 text-left transition-transform duration-fast active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      {/* `aspect-poster` (4/5), not `aspect-portrait` (3/4). The token was added
          for exactly this carousel and was orphaned — nothing referenced it —
          while the card used the taller ratio, which pushed the price line down
          under the bottom navigation bar on a 664px-tall phone. 4/5 is ~24px
          shorter at this width, which is the difference between reading the
          price and not. */}
      {/* `rounded-xl` inside a `rounded-2xl` card: the artwork's corners sit
          just inside the card's, which is what stops the padding reading as a
          mistake. */}
      <div className="relative aspect-poster w-full overflow-hidden rounded-xl bg-muted">
        {/* `68vw` because that is exactly what the card is (see the track's
            padding). It said `76vw`, which asked the browser for a source a
            size larger than anything ever painted. */}
        <Poster event={event} priority={priority} sizes="68vw" />
        <DateBadge startsAt={event.starts_at} className="left-2 top-2" />
      </div>
      {/* Compact: the title clamped to one line and the price under it. Two
          lines of title on a 4:5 poster is most of the card's height spent
          below the artwork, which is the "excessively tall" complaint. */}
      <div className="flex flex-col gap-0.5 px-1 pb-1 pt-2">
        <p className="line-clamp-1 text-body-sm font-bold leading-snug text-foreground">
          {event.title}
        </p>
        {price ? (
          <p className="text-caption text-muted-foreground">
            {price === 'Free' ? 'Free' : `${price} onwards`}
          </p>
        ) : null}
      </div>
    </button>
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
