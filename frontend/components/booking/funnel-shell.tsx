'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { EventDetail, TicketTier } from '@/lib/api/types';
import { formatEventDate, formatEventTime } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { BookingProvider, useBooking } from './booking-context';

/**
 * The frame both checkout screens render inside.
 *
 * ── IT IS A CHECKOUT, NOT A PAGE ON A WEBSITE ─────────────────────────────
 *
 * This used to be a `Container` inside the public site layout, carrying a
 * stepper, a persistent order-summary card, and — through the layout above it —
 * the site header, a search field, the bottom tab bar and the footer. On a
 * phone that was roughly a full screen of chrome before the first ticket tier,
 * and the same event was drawn twice: once in the summary card and again in the
 * screen's own content.
 *
 * What replaces it is what a checkout needs and nothing else: one back control,
 * the name of the thing being bought, and the content. The route group above
 * (`app/(checkout)`) removed the site chrome; this removed the funnel's own.
 *
 * ── THE HEADER IS PART OF THE FRAME, THE SUBTITLE IS NOT ──────────────────
 *
 * `title`/`subtitle` are per-screen because the two screens answer different
 * questions. Choosing tickets, the header names the EVENT and its date and city
 * — you are still deciding, and that is the context you need. Reviewing, the
 * header names the TASK ("Review your booking") because the event is already
 * settled and is shown in full immediately below.
 *
 * ── WHY THE ORDER SUMMARY CARD IS GONE ────────────────────────────────────
 *
 * It was mounted here so it survived navigation between steps and could animate
 * its height. With two screens that both display the order in full, it was the
 * event and the total rendered twice on the same screen — and on a phone the
 * duplicate came FIRST, pushing the real content below the fold. The hold
 * countdown it carried moved to the review screen, where it belongs: nothing is
 * being held while you are still choosing.
 */
export function FunnelShell({
  event,
  initialTiers,
  children,
}: {
  event: EventDetail;
  initialTiers: TicketTier[];
  children: React.ReactNode;
}) {
  return (
    <BookingProvider event={event} initialTiers={initialTiers}>
      {children}
    </BookingProvider>
  );
}

/**
 * The screen frame: a pinned header, a scrolling body, and room at the bottom
 * for the action bar that is `fixed` over it.
 */
export function FunnelScreen({
  title,
  subtitle,
  children,
  banner,
  className,
}: {
  title: string;
  /** The second line under the title. Omitted where the title stands alone. */
  subtitle?: React.ReactNode;
  /** Full-width strip directly under the header — the hold countdown. */
  banner?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* ── THE HEADER AND THE COUNTDOWN PIN TOGETHER ─────────────────────
          The banner used to sit OUTSIDE this wrapper, under a sticky header
          without being sticky itself — so the hold countdown left the viewport
          within one flick, and everything it is counting down over (the order,
          the total, the donation, the pay button) is below that point. A
          deadline you can scroll past is a fact you were shown once.

          One sticky wrapper rather than two stacked sticky elements with
          hand-computed offsets: the second would need to know the first's
          height, which changes with a wrapped title. */}
      {/* OPAQUE, and that is load-bearing. The header is `bg-background/95` and
          the countdown band is a 10% `--primary` tint — both translucent, and
          with nothing solid behind them the page scrolled visibly THROUGH the
          pinned block: "PAYMENT SUMMARY" read straight across the countdown's
          digits. A solid base here gives both something to composite onto, so
          the tint still reads as a tint and the text stays legible.

          It said `bg-canvas` first, which is NOT A UTILITY THIS CONFIG DEFINES
          — Tailwind drops an unknown class silently, so the header had been
          fully transparent since it was written and nothing said so. It only
          ever looked right because most of what scrolls under it is white. The
          token is `background`; `--canvas` exists in the CSS but is not mapped
          into the colour scale. */}
      <div className="sticky top-0 z-sticky bg-background">
        <FunnelHeader title={title} subtitle={subtitle} />
        {banner}
      </div>
      {/* A SECTION, not a `<main>`: the root layout owns the document's main
          landmark. The id is the skip-link target and what the step
          transitions reference. */}
      <section
        id="funnel-main"
        aria-label="Checkout"
        className={cn(
          'mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-5 sm:px-6',
          // Clearance for the fixed action bar. It publishes its own measured
          // height, so this follows a two-line caption or a one-line one
          // without a magic number; the fallback covers the first paint.
          'pb-[calc(var(--sticky-action-height,5.5rem)+env(safe-area-inset-bottom)+1.5rem)]',
          className,
        )}
      >
        {children}
      </section>
    </div>
  );
}

function FunnelHeader({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  const router = useRouter();
  return (
    // Not sticky itself — the wrapper above pins the header and the countdown
    // as one block, so they can never separate mid-scroll.
    <header className="border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl items-start gap-3 px-4 py-3.5 sm:px-6">
        {/* `router.back()`, not a link to the event. The two screens are one
            flow and the browser's own history is the truthful answer to "where
            was I" — a hard-coded href would send somebody who arrived from a
            shared link to a page they had never seen. */}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-body-lg font-semibold leading-tight text-foreground">
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-body-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** "Sun, 24 Jan, 4:00 AM | Hyderabad" — the ticket screen's subtitle. */
export function EventSubtitle({ event }: { event: EventDetail }) {
  return (
    <>
      {formatEventDate(event.starts_at)}, {formatEventTime(event.starts_at)}
      <span className="px-1.5 text-border-strong" aria-hidden>
        |
      </span>
      {event.city}
    </>
  );
}

/** The event this funnel is for — for screens that need it outside a step. */
export const useFunnelEvent = () => useBooking().event;
