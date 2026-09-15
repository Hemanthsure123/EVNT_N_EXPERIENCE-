'use client';

import * as React from 'react';
import Link from 'next/link';
import { IndianRupee, ScanLine, TrendingUp, UserCheck, UserX, Users } from 'lucide-react';
import type { EventAnalytics, OrderSlice, OrganizerSettlement } from '@/lib/api/organizer';
import { ApiError } from '@/lib/api/errors';
import { formatMoney } from '@/lib/discovery/format';
import { useEventSettlement } from '@/lib/organizer/queries';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { Skeleton } from '../primitives';
import {
  CARD,
  CARD_PAD,
  Section,
  StatCard,
  formatCount,
  formatDate,
  formatPct,
  plural,
} from './parts';

/**
 * Money in, and who turned up.
 *
 * ── "TICKETS" HERE MEANS SEATS, AND "ORDERS" MEANS PURCHASES ─────────────
 *
 * On this platform a ticket is one person through a door, and one purchase can
 * carry six of them. The reference layout counts purchases as tickets; this
 * page keeps its card and uses the platform's own words, so "Tickets Sold" is
 * the same number the attendee list counts rows of, and the purchases it came
 * in are named as orders.
 *
 * ── THE PAYOUT STAYS ─────────────────────────────────────────────────────
 *
 * The reference has no payout, because it is not a marketplace that pays
 * organizers. This one is, and "what will I actually be paid" was the most
 * important sentence on the previous version of this page. It keeps its card
 * under the revenue, labelled as the display copy it is.
 */

export function RevenueAndAttendance({ data, eventId }: { data: EventAnalytics; eventId: string }) {
  return (
    <>
      <Section icon={IndianRupee} title="Revenue Performance">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <StatCard
            icon={IndianRupee}
            label="Total Revenue"
            value={formatMoney(data.revenue_minor)}
            caption={
              data.refunded_minor > 0
                ? `After ${formatMoney(data.refunded_minor)} refunded`
                : undefined
            }
          />
          <StatCard
            icon={Users}
            label="Avg per Attendee"
            value={formatMoney(data.avg_per_attendee_minor)}
            caption={data.avg_per_attendee_minor === null ? 'Nobody has paid yet' : undefined}
          />
        </div>

        <div className={cn(CARD, CARD_PAD, 'flex flex-col gap-3')}>
          <div className="flex flex-col gap-0.5">
            <p className="text-body-sm text-muted-foreground">Revenue by Ticket Type</p>
            <p className="text-caption text-muted-foreground">
              Orders of more than one ticket, and of exactly one — at the prices they were billed.
            </p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-border">
            <Split label="Multiple" slice={data.order_split.multiple} className="pr-4" />
            <Split label="Single" slice={data.order_split.single} className="pl-4" />
          </div>
        </div>

        <Payout eventId={eventId} />

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href={`/dashboard/bookings?event=${eventId}`}>View bookings</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href={`/dashboard/refunds?event=${eventId}`}>View refunds</Link>
          </Button>
        </div>
      </Section>

      <Attendance data={data} />
    </>
  );
}

function Split({ label, slice, className }: { label: string; slice: OrderSlice; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-body-sm font-semibold text-primary">{label}:</span>
        <span className="text-body font-semibold tabular-nums text-foreground">
          {formatMoney(slice.revenue_minor)}
        </span>
      </div>
      <span className="text-caption text-muted-foreground">{plural(slice.orders, 'order')}</span>
    </div>
  );
}

/**
 * SOLD IS NOT THE SAME QUESTION AS SHOWED UP.
 *
 * Check-ins come from the TICKET rows — the used-ticket count is the source of
 * truth `checkin` reconciles against — so this page and the scan desk cannot
 * disagree. No-shows are only counted once the event is over: before that,
 * somebody not yet scanned is on their way, and calling them a no-show would
 * be a claim about a person that has not happened yet.
 */
function Attendance({ data }: { data: EventAnalytics }) {
  const refused = data.scans_by_result
    .filter((row) => row.label !== 'allowed')
    .reduce((sum, row) => sum + row.value, 0);

  return (
    <Section icon={UserCheck} title="Attendance & Show-up Quality">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          icon={Users}
          label="Tickets Sold"
          value={formatCount(data.sold)}
          caption={plural(data.orders, 'order')}
        />
        <StatCard
          icon={UserCheck}
          label="Actual Check-ins"
          value={formatCount(data.checkins)}
          caption={`${formatPct(data.attendance_pct)} arrival`}
        />
        <StatCard
          icon={TrendingUp}
          label="Show-up Rate"
          value={formatPct(data.attendance_pct)}
          caption="Checked in, of tickets sold"
        />
        <StatCard
          icon={UserX}
          label="No-shows"
          value={formatCount(data.no_shows)}
          caption={
            data.no_shows === null
              ? 'Counted once the event is over'
              : `${formatCount(data.checkins)} attended`
          }
        />
      </div>

      {/* The gate's own audit trail, and only when it has something to say. */}
      {refused > 0 ? (
        <p className={cn(CARD, CARD_PAD, 'flex items-start gap-2 text-body-sm text-muted-foreground')}>
          <ScanLine className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>
            {plural(refused, 'scan')} refused at the gate —{' '}
            {data.scans_by_result
              .filter((row) => row.label !== 'allowed' && row.value > 0)
              .map((row) => `${row.value} ${row.label.replace(/^denied_/, '').replace(/_/g, ' ')}`)
              .join(', ')}
            .
          </span>
        </p>
      ) : null}
    </Section>
  );
}

/**
 * WHAT YOU WILL ACTUALLY BE PAID — and the sentence that has to go with it.
 *
 * `net` is the running DISPLAY total. At release it is recomputed from the
 * payment records under the settlement row's lock, so presenting this as "you
 * will receive X" would be a promise made by the wrong copy of the number.
 *
 * A `404` is the ordinary answer before the first confirmed payment — the row
 * is created then — so it renders as a sentence, not as an error.
 */
function Payout({ eventId }: { eventId: string }) {
  const settlement = useEventSettlement(eventId);

  if (settlement.isPending) return <Skeleton className="h-24 w-full rounded-2xl" />;

  if (settlement.isError) {
    const missing = settlement.error instanceof ApiError && settlement.error.status === 404;
    return (
      <p className={cn(CARD, CARD_PAD, 'text-body-sm text-muted-foreground')}>
        {missing
          ? 'No payout yet. A settlement opens on this event’s first confirmed payment, and releases after the event and its refund window.'
          : 'Could not load this event’s payout.'}
      </p>
    );
  }

  const row: OrganizerSettlement = settlement.data;
  return (
    <div className={cn(CARD, CARD_PAD, 'flex flex-col gap-3')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body-sm font-semibold text-foreground">Payout</h3>
        <span className="text-caption text-muted-foreground">{settlementState(row)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Money label="Gross" value={row.gross} />
        <Money label="Platform fee" value={-row.platform_fee} />
        <Money label="Refunds" value={-row.refunds} />
        <Money label="Net" value={row.net} strong />
      </dl>
      <p className="text-caption text-muted-foreground">
        A running total for display. The amount actually transferred is recomputed from the payment
        records when the payout is released.
      </p>
    </div>
  );
}

function settlementState(row: OrganizerSettlement): string {
  if (row.status === 'paid') return row.payout_at ? `Paid out on ${formatDate(row.payout_at)}` : 'Paid out';
  // NOT "lost": a failed transfer leaves the money owed.
  if (row.status === 'failed') return 'Transfer failed — still owed';
  if (row.status === 'zero') return 'Nothing to pay';
  return row.releasable_at
    ? `Releases ${formatDate(row.releasable_at)}`
    : 'Releases after the event and its refund window';
}

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'truncate tabular-nums',
          strong ? 'text-body font-semibold text-foreground' : 'text-body-sm text-foreground',
        )}
      >
        {formatMoney(value)}
      </dd>
    </div>
  );
}
