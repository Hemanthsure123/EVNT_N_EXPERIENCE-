'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Ticket as TicketIcon, User } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { TicketQrCode } from './qr-code';

/**
 * Your tickets, one at a time, like the metro.
 *
 * ── WHAT WAS WRONG ────────────────────────────────────────────────────────
 *
 * Tickets were a `sm:grid-cols-2` grid of cards, and under each QR the raw
 * signed token was printed in `break-all font-mono` — a 180-character wall of
 * `v1.eyJ0aWQiOiJm…`. Two problems with that, one cosmetic and one not.
 *
 * The cosmetic one: it is the ugliest thing on the screen somebody reaches
 * immediately after paying, and it makes a finished product look like a debug
 * view.
 *
 * The one that matters: a QR is a CREDENTIAL, and the grid put four of them on
 * one screen. At a gate you hold up your phone; anybody behind you in the queue
 * photographs the other three. One ticket filling the viewport is not just
 * tidier, it is the correct way to show a bearer token in public.
 *
 * ── WHY A SCROLL-SNAP CAROUSEL AND NOT A JS SLIDER ────────────────────────
 *
 * `overflow-x-auto` + `snap-x snap-mandatory` is the browser's own paging: it
 * gets momentum, rubber-banding, trackpad gestures and touch velocity for free,
 * and it keeps working if the JavaScript never loads. The script here only
 * OBSERVES which panel is centred (to update the counter and the dots) and
 * offers buttons for people using a mouse. Nothing about reading a ticket
 * depends on it.
 *
 * ── THE STUB SHAPE IS CSS, NOT AN IMAGE ───────────────────────────────────
 *
 * The notches are two `radial-gradient`s pinned to the left and right edges of
 * a perforation row, and the perforation is a `repeating-linear-gradient`. No
 * asset, no clip-path support question, correct in both themes because both
 * gradients resolve through surface tokens.
 *
 * ── ACCESSIBILITY ─────────────────────────────────────────────────────────
 *
 * A real tab-order: every panel is focusable and Left/Right move between them.
 * `aria-roledescription="carousel"` with a live region announcing "Ticket 2 of
 * 3" on change, so it is navigable without seeing the dots. The QR keeps its
 * descriptive label. The token is NOT rendered — it is in the confirmation
 * email and in the account page's copy action for the gate's manual-entry
 * fallback, which is where a 180-character string belongs.
 */

export type CarouselTicket = {
  id: string;
  ticket_type_name: string;
  qr_token: string;
  attendee_name?: string;
  status?: string;
};

export function TicketCarousel({
  tickets,
  eventTitle,
  className,
}: {
  tickets: CarouselTicket[];
  eventTitle: string;
  className?: string;
}) {
  const trackRef = React.useRef<HTMLUListElement>(null);
  const [active, setActive] = React.useState(0);
  const count = tickets.length;

  // Which panel is centred. An IntersectionObserver against the track rather
  // than a scroll handler: it fires once per panel crossing instead of on every
  // frame of a flick, so the counter never becomes the reason the scroll janks.
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const panels = Array.from(track.children) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = panels.indexOf(entry.target as HTMLElement);
          if (index >= 0) setActive(index);
        }
      },
      { root: track, threshold: 0.6 },
    );
    panels.forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
  }, [count]);

  const goTo = React.useCallback((index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const panel = track.children[index] as HTMLElement | undefined;
    panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    panel?.focus({ preventScroll: true });
  }, []);

  if (!count) return null;

  return (
    <div
      className={cn('flex flex-col gap-stack', className)}
      role="group"
      aria-roledescription="carousel"
      aria-label={`${count} ticket${count === 1 ? '' : 's'} for ${eventTitle}`}
    >
      <ul
        ref={trackRef}
        // `-mx-*` + matching padding lets a panel sit centred while the track
        // still bleeds to the edge of a phone, which is what makes the next
        // ticket peek in and invites the swipe.
        className={cn(
          'flex snap-x snap-mandatory gap-stack-lg overflow-x-auto scroll-smooth',
          'motion-reduce:scroll-auto',
          // Hide the scrollbar: the dots and the counter already say where you
          // are, and a visible bar under a ticket reads as a rendering artifact.
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          count > 1 ? 'px-[10%] sm:px-0' : '',
        )}
      >
        {tickets.map((ticket, index) => (
          <li
            key={ticket.id}
            tabIndex={0}
            aria-roledescription="slide"
            aria-label={`Ticket ${index + 1} of ${count}`}
            onKeyDown={(moment) => {
              if (moment.key === 'ArrowRight' && index < count - 1) {
                moment.preventDefault();
                goTo(index + 1);
              }
              if (moment.key === 'ArrowLeft' && index > 0) {
                moment.preventDefault();
                goTo(index - 1);
              }
            }}
            className={cn(
              'flex w-full shrink-0 snap-center flex-col overflow-hidden rounded-2xl',
              'border border-border bg-surface shadow-md',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              // One ticket fills a phone; on a wide screen it stops growing so a
              // QR does not become a 600px square nobody needs.
              'max-w-sm sm:w-80',
            )}
          >
            <header className="flex items-center justify-between gap-3 px-card py-stack">
              <span className="inline-flex min-w-0 items-center gap-2">
                <TicketIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate text-body-sm font-semibold text-foreground">
                  {ticket.ticket_type_name}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-caption font-medium text-secondary-foreground">
                Ticket {index + 1}
              </span>
            </header>

            {/* THE PERFORATION. Two notches bitten out of the side by radial
                gradients in the PAGE's colour, and a dashed rule between them.
                It is what makes the panel read as a torn stub rather than a
                card, and it costs one element. */}
            <div
              className="relative h-4 bg-[radial-gradient(circle_at_left,rgb(var(--background))_0.5rem,transparent_0.5rem),radial-gradient(circle_at_right,rgb(var(--background))_0.5rem,transparent_0.5rem)]"
              aria-hidden
            >
              <span className="absolute inset-x-4 top-1/2 border-t border-dashed border-border" />
            </div>

            <div className="flex flex-col items-center gap-stack px-card pb-card">
              <TicketQrCode
                token={ticket.qr_token}
                label={`QR code for ${ticket.ticket_type_name} ticket ${index + 1} of ${count} — ${eventTitle}`}
                className="p-3"
              />
              {/* WHO IT ADMITS, when the buyer has named somebody. Blank means
                  the buyer is going, which is the default and needs no label —
                  printing "Unassigned" on your own ticket would be noise. */}
              {ticket.attendee_name ? (
                <p className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                  <User className="size-3" aria-hidden />
                  Admits {ticket.attendee_name}
                </p>
              ) : null}
              <p className="text-caption text-muted-foreground">One scan admits one person</p>
            </div>
          </li>
        ))}
      </ul>

      {count > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => goTo(Math.max(0, active - 1))}
            disabled={active === 0}
            aria-label="Previous ticket"
            className="inline-flex size-9 items-center justify-center rounded-full border border-border text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>

          <div className="flex items-center gap-1.5" aria-hidden>
            {tickets.map((ticket, index) => (
              <button
                key={ticket.id}
                type="button"
                tabIndex={-1}
                onClick={() => goTo(index)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-base',
                  index === active ? 'w-5 bg-foreground' : 'w-1.5 bg-border-strong',
                )}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => goTo(Math.min(count - 1, active + 1))}
            disabled={active === count - 1}
            aria-label="Next ticket"
            className="inline-flex size-9 items-center justify-center rounded-full border border-border text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* The only announcement of position for a screen reader. `polite` so it
          does not interrupt, and it is the reason the dots can be aria-hidden. */}
      <p className="sr-only" aria-live="polite">
        Ticket {active + 1} of {count}
      </p>
    </div>
  );
}
