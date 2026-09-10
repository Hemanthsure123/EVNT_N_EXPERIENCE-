'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { TicketQrCode } from '@/components/booking/qr-code';
import type { IssuedTicket } from '@/lib/booking/tickets';
import { cn } from '@/lib/utils/cn';

/**
 * The QR codes of one booking, one per person, as a SWIPEABLE strip.
 *
 * ── A NATIVE SCROLLER, NOT AN INDEX THAT SWAPS A PICTURE ──────────────────
 *
 * This was `useState(index)` with arrows and dots: every code was the same
 * element re-rendered with a new token, so there was nothing to swipe — a
 * party of four at a door had to find two small circles to get to the next
 * person's code. It is a CSS scroll-snap strip now. The finger swipes it
 * natively, with the browser's own momentum; `snap-always` stops at the NEXT
 * code rather than flinging past two; and the arrows and dots drive the same
 * strip, so all three ways of moving agree about where you are.
 *
 * The index is read back from `scrollLeft` — every slide is exactly the
 * strip's width, so the division is exact and needs no observer.
 *
 * ── `scrollTo` ON THE STRIP, NEVER `scrollIntoView` ───────────────────────
 *
 * `scrollIntoView` scrolls every scrollable ANCESTOR as well, which on a long
 * page yanks the whole screen to the carousel the moment an arrow is pressed —
 * the scroll-jack the event page's tab bar once had.
 *
 * ── ONE CODE IS READ, THE OTHERS ARE HIDDEN FROM IT ───────────────────────
 *
 * Only the slide in view is exposed to assistive technology. A screen reader
 * walking into four unlabelled QR images at once is four identical sentences;
 * the arrows and "Ticket 2 of 4" are how that reader moves through them.
 */
export function QrCarousel({
  tickets,
  eventTitle,
}: {
  tickets: IssuedTicket[];
  eventTitle: string;
}) {
  const railRef = React.useRef<HTMLDivElement>(null);
  const [index, setIndex] = React.useState(0);
  const reduceMotion = useReducedMotion();
  const count = tickets.length;
  const many = count > 1;
  const safe = Math.min(index, Math.max(count - 1, 0));

  const onScroll = React.useCallback(() => {
    const node = railRef.current;
    if (!node || node.clientWidth === 0) return;
    const next = Math.min(Math.max(Math.round(node.scrollLeft / node.clientWidth), 0), count - 1);
    setIndex((previous) => (previous === next ? previous : next));
  }, [count]);

  const goTo = React.useCallback(
    (target: number) => {
      const node = railRef.current;
      if (!node || count === 0) return;
      // Wraps, as the arrows always have: the last person's "next" is the first.
      const next = (target + count) % count;
      node.scrollTo({ left: next * node.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' });
      setIndex(next);
    },
    [count, reduceMotion],
  );

  if (count === 0) return null;

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="relative w-full">
        <div
          ref={railRef}
          onScroll={onScroll}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              goTo(safe + 1);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              goTo(safe - 1);
            }
          }}
          tabIndex={many ? 0 : -1}
          role="region"
          aria-roledescription="carousel"
          aria-label="Your tickets"
          className={cn(
            'flex w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain',
            'touch-pan-x rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {tickets.map((ticket, position) => (
            <div
              key={ticket.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`Ticket ${position + 1} of ${count}`}
              aria-hidden={position === safe ? undefined : true}
              // `px-10` keeps the code clear of the arrows laid over the
              // strip's edges; the code itself caps at 224px.
              className={cn(
                'flex w-full shrink-0 snap-center snap-always justify-center',
                many ? 'px-10' : 'px-0',
              )}
            >
              <TicketQrCode
                token={ticket.qr_token}
                label={`QR code for ticket ${position + 1} of ${count}, ${ticket.ticket_type_name} — ${eventTitle}`}
                className="w-56 max-w-full rounded-2xl p-3"
              />
            </div>
          ))}
        </div>

        {many ? (
          <>
            <ArrowButton side="left" onClick={() => goTo(safe - 1)} />
            <ArrowButton side="right" onClick={() => goTo(safe + 1)} />
          </>
        ) : null}
      </div>

      {many ? (
        <ul className="flex items-center justify-center gap-2" aria-label="Choose a ticket">
          {tickets.map((ticket, position) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => goTo(position)}
                aria-label={`Show ticket ${position + 1}`}
                aria-current={position === safe}
                className={cn(
                  'h-2.5 rounded-full transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                  position === safe ? 'w-5 bg-ink-25' : 'w-2.5 bg-ink-700 hover:bg-ink-500',
                )}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-caption uppercase tracking-wide text-ink-400" aria-live="polite">
        {many
          ? `Ticket ${safe + 1} of ${count} · each admits one person, once`
          : 'Admits one person, once'}
      </p>
    </div>
  );
}

function ArrowButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous ticket' : 'Next ticket'}
      className={cn(
        'absolute top-1/2 z-10 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full',
        'bg-ink-800 text-ink-200 shadow-md transition-colors duration-fast hover:bg-ink-700 hover:text-ink-25',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        side === 'left' ? 'left-0' : 'right-0',
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
