'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CalendarDays, MapPin } from 'lucide-react';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDateTime, formatFromPrice } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { AnimatedNumber, EASE_OUT } from './motion';
import { PosterFrame } from './poster-frame';
import { CHECKOUT_TRUST, TrustList } from './trust';
import { useBooking } from './booking-context';
import { HoldTimer } from './hold-timer';

/**
 * The order summary — ONE instance, mounted by the funnel layout and alive for
 * the whole journey.
 *
 * That single fact is what makes the four screens feel like one. Because the
 * component never unmounts, its height animates between steps instead of
 * snapping, the poster is fetched once, and the total counts from the old value
 * to the new rather than blinking. Re-rendering a fresh summary per page would
 * give all of that up and cost an extra image request each time.
 *
 * WHAT IT DOES NOT SHOW:
 *
 * - **No taxes line.** The backend returns `total_amount` and `platform_fee` and
 *   nothing else; there is no tax field, so an itemised tax row would be a
 *   number nobody computed.
 * - **No promo code field.** There is no coupon endpoint. An input that always
 *   answers "invalid code" is worse than no input — it implies discounts exist
 *   and that you failed to find one.
 * - **The platform fee is shown, never added.** It is the platform's cut taken
 *   OUT of the total at settlement, not a surcharge, so it appears as a note
 *   under the total rather than as a line above it. Adding it would overstate
 *   the price by exactly the fee.
 *
 * ── HOW IT LIFTS OFF A WHITE PAGE ─────────────────────────────────────────
 *
 * White fill, hairline, soft shadow — the light theme's only way to elevate,
 * since the canvas is already pure white and there is nowhere lighter to go.
 * The TOTAL is the biggest thing in the card (`text-h3`, tabular) because it is
 * the one number somebody scrolls back up to check; everything above it is
 * `text-body-sm` or smaller so the ladder is unambiguous at a glance.
 *
 * The thumbnail is a `PosterFrame`, so an event with no poster shows its
 * category's pastel tile rather than the grey gradient that used to sit there
 * looking like a broken image.
 */
export function SummaryCard({ className }: { className?: string }) {
  const { event, totals, booking, tiersLoading } = useBooking();
  const reduced = useReducedMotion();
  const category = inferCategory(event);

  // Once a booking exists it is authoritative: it is what was actually
  // reserved, and what Razorpay will be asked to charge. Before that, the
  // selection is the best available answer.
  const total = booking?.total_amount ?? totals.total;
  const fee = booking?.platform_fee ?? totals.platformFee;
  // `phase_name` is the label the server RECORDED at reserve time, so a line
  // stays truthfully "Early bird" even after the phase itself has lapsed. Before
  // a booking exists the selection's live phase is the best answer there is.
  const lines = booking?.items?.length
    ? booking.items.map((item) => ({
        id: item.ticket_type_id,
        name: item.ticket_type_name,
        phaseName: item.phase_name ?? null,
        quantity: item.quantity,
        subtotal: item.unit_price * item.quantity,
      }))
    : totals.lines.map((line) => ({
        id: line.tier.id,
        name: line.tier.name,
        phaseName: line.phaseName,
        quantity: line.quantity,
        subtotal: line.subtotal,
      }));

  return (
    <motion.aside
      layout={reduced ? false : 'position'}
      transition={EASE_OUT}
      aria-label="Order summary"
      className={cn(
        'flex flex-col gap-card rounded-2xl border border-border bg-surface p-card-lg shadow-md',
        className,
      )}
    >
      <div className="flex gap-stack-lg">
        <PosterFrame event={event} sizes="64px" className="size-16" iconClassName="size-9" />
        <div className="flex min-w-0 flex-col gap-1">
          {category ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground">
              <category.icon className="size-3" aria-hidden />
              {category.label}
            </span>
          ) : null}
          <p className="line-clamp-2 text-body-sm font-semibold text-foreground">{event.title}</p>
        </div>
      </div>

      <dl className="flex flex-col gap-2 border-t border-border pt-stack-lg text-caption">
        <div className="flex items-start gap-2">
          <dt className="sr-only">When</dt>
          <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <dd className="text-muted-foreground">{formatEventDateTime(event.starts_at)}</dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">Where</dt>
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <dd className="text-muted-foreground">
            {event.venue}, {event.city}
          </dd>
        </div>
      </dl>

      {/* ── THE MONEY HALF IS DESKTOP-ONLY ─────────────────────────────────
          From `lg` this card sits BESIDE the step, so the lines and the total
          are a running summary of what the step is asking about. Below `lg` it
          stacks ABOVE the step, and every step body already lists exactly the
          same lines and the same total — so a phone showed the order twice,
          the second copy pushing the actual controls a screen further down.

          What stays on a phone is the half the step body does NOT repeat: the
          poster, the title, the date, the venue and the hold countdown. What
          this order costs is answered by the sticky bar at the bottom of the
          screen, which is on top of the thumb rather than above the fold. */}
      {/* The one part that changes between steps. `AnimatePresence` with a
          `layout` parent is what turns "content swapped" into "card grew". */}
      <motion.div
        layout={reduced ? false : true}
        transition={EASE_OUT}
        className="hidden flex-col lg:flex"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {lines.length ? (
            <motion.ul
              key="lines"
              layout={reduced ? false : true}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={EASE_OUT}
              className="flex flex-col gap-2 border-t border-border pt-stack-lg"
            >
              {lines.map((line) => (
                <li key={line.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-body-sm text-muted-foreground">
                    {/* The phase, as part of the line's name — "Gold — Early
                        bird". It is what makes a subtotal below the tier's list
                        price self-explanatory, and it is a recorded fact about
                        this order, not a badge. */}
                    {line.phaseName ? `${line.name} — ${line.phaseName}` : line.name}
                    <span className="ml-1.5 text-caption">× {line.quantity}</span>
                  </span>
                  <span className="shrink-0 text-body-sm tabular-nums text-foreground">
                    {formatFromPrice(line.subtotal)}
                  </span>
                </li>
              ))}
            </motion.ul>
          ) : (
            <motion.p
              key="empty"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={EASE_OUT}
              className="border-t border-border pt-stack-lg text-body-sm text-muted-foreground"
            >
              {tiersLoading ? 'Loading tickets…' : 'No tickets chosen yet.'}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="hidden flex-col gap-1 border-t border-border pt-stack-lg lg:flex">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-body font-semibold text-foreground">Total</span>
          <AnimatedNumber
            value={total}
            format={(value) => formatFromPrice(value) ?? '—'}
            className="text-h3 text-foreground"
          />
        </div>
        {total > 0 ? (
          <p className="text-caption text-muted-foreground">
            Includes a {formatFromPrice(fee)} platform fee. No other charges.
          </p>
        ) : null}
      </div>

      {/* The hold countdown lives HERE and only here. The card is on screen at
          every step and every width, so a second copy in the step body was the
          same deadline stated twice — which reads as pressure rather than as
          information.

          IT IS GATED ON `status === 'reserved'`, and that is the whole fix for a
          real bug. `hold_expires_at` is a column, not a flag: confirming a
          booking sets `status = 'paid'` and LEAVES the timestamp exactly where
          it was, because it is a historical fact about the hold. Rendering on
          the timestamp alone meant the confirmation screen — the one showing
          issued tickets — kept counting down, and then announced "Your hold has
          expired — these tickets have been released" over tickets that were
          paid for and are perfectly valid. The most alarming possible sentence,
          on the least appropriate screen. */}
      {booking?.status === 'reserved' && booking.hold_expires_at ? (
        <HoldTimer expiresAt={booking.hold_expires_at} />
      ) : null}

      {/* Also desktop-only: every step body ends with its own `TrustStrip`,
          so on a phone this was the same four marks twice on one screen. */}
      <TrustList marks={CHECKOUT_TRUST} className="hidden border-t border-border pt-stack-lg lg:flex" />
    </motion.aside>
  );
}
