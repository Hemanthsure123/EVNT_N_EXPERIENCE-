import * as React from 'react';
import Link from 'next/link';
import { Ticket } from 'lucide-react';
import type { TicketTier } from '@/lib/api/types';
import { formatFromPrice } from '@/lib/discovery/format';
import { availabilityLabel, isUrgent, summariseTiers } from '@/lib/discovery/tiers';
import { cn } from '@/lib/utils/cn';

/**
 * The event page's price and its one action.
 *
 * ── WHAT THIS REPLACED, AND WHY IT IS SMALLER ─────────────────────────────
 *
 * A full `TicketPanel` used to sit here: session picker, tier list, quantity
 * stepper, running total and a Book button, all inside a 22rem sidebar. It
 * worked, and it was the wrong place for it. A tier is not a radio button on
 * this platform — it carries live availability, a per-order maximum and a sale
 * window — and a rail beside a poster is the worst place to read any of that,
 * especially on a phone where the "sidebar" is just more page.
 *
 * So the event page answers the question it is for — what is this, when, where,
 * how much — and choosing happens on `/booking/{id}`, a screen whose only job
 * is choosing.
 *
 * The invariant from `lib/booking/steps.ts` is ASK ONCE. This component must
 * never grow a tier list or a quantity control: the moment it does, the funnel
 * is asking for the same thing twice again, which is the bug the redirect was
 * originally added to fix.
 *
 * ── IT STILL TELLS THE TRUTH ABOUT INVENTORY ──────────────────────────────
 *
 * Sold out, few left and not-on-sale all reach the button, because sending
 * somebody to a picker to discover there is nothing to pick is worse than
 * saying so here. The label changes; the destination does not — a sold-out
 * event still has tiers worth looking at, and its page is where a returning
 * ticket would appear.
 */
export function BookingCta({
  eventId,
  tiers,
  cancelled = false,
  preview = false,
}: {
  eventId: string;
  tiers: TicketTier[];
  cancelled?: boolean;
  preview?: boolean;
}) {
  const summary = summariseTiers(tiers);
  const price = formatFromPrice(summary.fromPrice);
  const label = availabilityLabel(summary.state);
  const soldOut = summary.state.kind === 'sold_out';

  return (
    <section
      aria-label="Tickets"
      id="tickets"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-elevated p-card-lg shadow-sm"
    >
      <div className="flex flex-col gap-1">
        <span className="text-caption uppercase tracking-wide text-muted-foreground">
          {price === 'Free' ? 'Entry' : 'Tickets from'}
        </span>
        <span className="text-h3 font-extrabold tabular-nums text-foreground">
          {price === 'Free' ? 'Free' : (price ?? 'Pricing soon')}
        </span>
        {label ? (
          <span
            className={cn(
              'text-body-sm',
              soldOut
                ? 'text-destructive-subtle-foreground'
                : isUrgent(summary.state)
                  ? 'text-warning-subtle-foreground'
                  : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
        ) : null}
      </div>

      {/* A cancelled event gets no CTA at all. The button's whole job is to
          start a checkout nobody can complete, and the page already says
          where the money went. */}
      {cancelled ? (
        <p className="text-body-sm text-muted-foreground">
          This event was cancelled. Any paid tickets are refunded automatically.
        </p>
      ) : preview ? (
        // A draft has nothing to sell yet and no public URL to sell it at.
        // An inert control that LOOKS live is the worst thing to show an
        // organiser about to publish.
        <span className="inline-flex h-control items-center justify-center rounded-full border border-input px-pill text-label text-muted-foreground">
          Book tickets
        </span>
      ) : (
        <Link
          href={`/booking/${eventId}`}
          className={cn(
            'inline-flex h-control items-center justify-center gap-2 rounded-full px-pill text-label',
            soldOut
              ? 'border border-input text-foreground hover:bg-muted'
              : 'bg-cta text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover active:bg-cta-active',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        >
          <Ticket className="size-4" aria-hidden />
          {soldOut ? 'See ticket types' : 'Book tickets'}
        </Link>
      )}
    </section>
  );
}
