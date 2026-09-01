'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Container } from '@/components/shell/container';
import type { EventDetail, TicketTier } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { eventPath } from '@/lib/events/ref';
import { BookingProvider, useBooking } from './booking-context';
import { Stepper } from './stepper';
import { SummaryCard } from './summary-card';

/**
 * The frame every step renders inside.
 *
 * It is mounted by the route GROUP's layout, so it survives navigation between
 * the four steps. That's the whole architecture of this flow in one sentence:
 * the stepper and the summary card are not re-created per page, they persist and
 * update, which is what makes four routes read as one journey.
 *
 * LAYOUT: two columns from `lg` (content, then a sticky summary), stacked below
 * it with the summary FIRST on tablet — someone on a narrow screen wants to see
 * what they're buying before the form, and pushing it to the bottom of a long
 * page hides the total behind a scroll.
 *
 * RHYTHM COMES FROM THE TOKENS, not from picked numbers. Every gap here is a
 * rung of the spacing scale (`block` between components, `section` between the
 * header group and the body), so retuning the funnel's density is one edit in
 * styles/tokens.css rather than eight edits across five step files.
 *
 * The sticky offset is `lg:top-sticky-top-lg` — `--header-height-lg` plus 1rem,
 * expressed once — replacing a hand-picked `lg:top-20` (80px) that was already
 * 8px out of step with the 72px header it was clearing.
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
      <FunnelLayout>{children}</FunnelLayout>
    </BookingProvider>
  );
}

function FunnelLayout({ children }: { children: React.ReactNode }) {
  const { event, step } = useBooking();

  return (
    <div className="flex flex-col">
      {/* Clearance for the sticky action bar, which is `fixed` and therefore
          takes no space in the flow. Without it the last section of every step
          — the trust marks on review, the delivery block — sat underneath the
          bar and could not be read at any scroll position. The number is the
          bar's own stack: the bottom nav, its padding, its content and the
          safe-area inset. */}
      <Container
        className={cn(
          'flex flex-col gap-block-lg py-block lg:gap-section lg:py-block-lg',
          'pb-[calc(var(--bottom-nav-height)_+_7rem_+_env(safe-area-inset-bottom))] lg:pb-block-lg',
        )}
      >
        <div className="flex flex-col gap-block">
          {/* A ghost pill, not a text link: at `text-label` the hit area was
              16px tall on a phone. `-ml-3` pulls the pill's own padding back so
              the label still sits on the page's left edge optically. */}
          <Link
            href={eventPath(event)}
            className={cn(
              '-ml-3 inline-flex h-control w-fit items-center gap-2 rounded-full px-3',
              'text-label text-muted-foreground',
              'transition-colors duration-fast hover:bg-muted hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to event
          </Link>
          <Stepper />
        </div>

        <div className="grid items-start gap-block-lg lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          {/* The summary comes FIRST in source order so it lands above the form
              when the columns collapse, and is placed into column two at `lg`. */}
          <SummaryCard className="lg:sticky lg:top-sticky-top-lg lg:col-start-2 lg:row-start-1" />

          {/* A SECTION, not a second `<main>`. The site shell already renders
              `<main id="main">` around every page, so this nested one made two
              main landmarks on the busiest authenticated route — invalid HTML,
              and a screen reader offering two "main content" targets on the
              screen where money is about to move. The id is kept because the
              step transitions and the skip target reference it. */}
          <section
            id="funnel-main"
            aria-label="Booking step"
            // Keyed on the step so a fresh subtree mounts per screen; the
            // summary beside it is deliberately NOT keyed and stays alive.
            key={step}
            className="flex min-w-0 flex-col gap-block-lg lg:col-start-1 lg:row-start-1"
          >
            {children}
          </section>
        </div>
      </Container>
    </div>
  );
}
