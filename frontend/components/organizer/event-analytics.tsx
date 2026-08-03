'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Receipt, ScanLine, Ticket, TrendingUp, Users } from 'lucide-react';
import type {
  EventAnalytics as EventAnalyticsData,
  EventStatus,
  TierAnalytics,
} from '@/lib/api/organizer';
import { useEventAnalytics } from '@/lib/organizer/queries';
import { downloadCsv, toCsv, type ColumnDef } from '@/lib/organizer/table';
import { formatMoney } from '@/lib/discovery/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { BarList, Meter, TrendLine, statusTone } from './charts';
import { ErrorState, Panel, Percent, Skeleton } from './primitives';
import { StatusBadge } from './status-badge';

/**
 * One event, everything known about it.
 *
 * ── WHY THIS IS A ROUTE AND NOT THE SIDE PANEL ────────────────────────────
 *
 * `event-panel.tsx` shows a summary beside the table, which is the right shape
 * for glancing while triaging a list. It is the wrong shape for the question
 * "how is this event actually doing" — that is a session, not a glance, and it
 * wants a URL somebody can bookmark, share with a co-organizer, and come back
 * to. The panel stays; this is where "View analytics" now leads.
 *
 * Before this, that action linked to `/dashboard/analytics?event=<id>` and the
 * account-wide analytics page never read `?event=` at all. So it silently
 * dropped the one thing the organizer had asked for and showed them totals
 * across every event they run.
 *
 * ── ORDERED BY WHAT COSTS MOST TO GET WRONG ───────────────────────────────
 *
 *   money        revenue, refunds — the number the business runs on
 *   inventory    sold vs capacity, and which tier is actually moving
 *   funnel       started -> paid, and where it leaks
 *   door         admissions and denials, once the event has run
 *
 * ── EVERY RATE CAN BE `null`, AND IS DRAWN THAT WAY ───────────────────────
 *
 * The backend returns `null` rather than `0` for a rate whose denominator is
 * zero, and `Percent` renders that as an em dash. A 0% conversion on an event
 * nobody has opened yet is a false statement, not a neutral one — and it is
 * the kind of false statement an organizer makes a pricing decision on.
 *
 * ── NOTHING HERE IS DERIVED FROM A NUMBER THE BACKEND DID NOT SEND ────────
 *
 * No projections, no "expected sell-out", no comparison against events this
 * organizer does not have. Every figure on the page is one the API returned.
 *
 * ── THERE IS NO FILLED BUTTON ON THIS SCREEN, ON PURPOSE ──────────────────
 *
 * It is a read surface. Everything on it — the two deep links, the CSV export,
 * the range switch — is navigation or a filter, and giving any of them the
 * near-black primary pill would claim an action that does not exist here. The
 * range switch wears the warm "you are here" pill because it is an applied
 * filter, which is the one thing that IS being asserted about state.
 */

const RANGES = [
  { days: 7, short: '7d', label: '7 days' },
  { days: 30, short: '30d', label: '30 days' },
  { days: 90, short: '90d', label: '90 days' },
] as const;

export function EventAnalytics({ eventId }: { eventId: string }) {
  const [days, setDays] = React.useState<number>(30);
  const analytics = useEventAnalytics(eventId, days);

  return (
    <div className="flex flex-col gap-stack-lg">
      <Link
        href="/dashboard/events"
        className="inline-flex w-fit items-center gap-2 rounded-full text-label text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>

      {analytics.isError ? (
        <ErrorState
          message="Could not load this event's analytics."
          onRetry={() => void analytics.refetch()}
        />
      ) : analytics.isPending ? (
        <LoadingShape />
      ) : (
        <Loaded data={analytics.data} days={days} onDays={setDays} eventId={eventId} />
      )}
    </div>
  );
}

function Loaded({
  data,
  days,
  onDays,
  eventId,
}: {
  data: EventAnalyticsData;
  days: number;
  onDays: (days: number) => void;
  eventId: string;
}) {
  const event = data.event;
  const remaining = Math.max(0, data.capacity - data.sold);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-stack">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h4">{event?.title ?? 'This event'}</h1>
            {event ? <StatusBadge status={event.status as EventStatus} /> : null}
          </div>
          {event ? (
            <p className="mt-1 text-body-sm text-muted-foreground">
              <time dateTime={event.starts_at}>
                {new Date(event.starts_at).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
              {event.venue ? ` · ${event.venue}` : ''}
              {event.city ? `, ${event.city}` : ''}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Deep links, not duplicated tables. The bookings and refunds
              surfaces already filter by event; rebuilding either here would
              be a second implementation of the same list to keep in sync. */}
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/bookings?event=${eventId}`}>
              <Receipt className="size-3.5" aria-hidden />
              Bookings
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/refunds?event=${eventId}`}>
              <Ticket className="size-3.5" aria-hidden />
              Refunds
            </Link>
          </Button>
        </div>
      </header>

      <section aria-label="Headline figures" className="grid grid-cols-2 gap-stack lg:grid-cols-4">
        <Kpi
          icon={TrendingUp}
          label="Revenue"
          value={formatMoney(data.revenue_minor)}
          hint={
            data.refunded_count
              ? `${formatMoney(data.refunded_minor)} refunded across ${data.refunded_count}`
              : 'No refunds issued'
          }
        />
        <Kpi
          icon={Ticket}
          label="Sold"
          value={data.capacity ? `${data.sold} / ${data.capacity}` : String(data.sold)}
          hint={data.capacity ? `${remaining} still available` : 'No ticket types yet'}
          rate={data.sell_through_pct}
        />
        <Kpi
          icon={Users}
          label="Conversion"
          value={<Percent value={data.conversion_pct} />}
          hint="Bookings that reached payment"
        />
        <Kpi
          icon={ScanLine}
          label="Attendance"
          value={<Percent value={data.attendance_pct} />}
          hint={`${data.checkins} admitted at the gate`}
        />
      </section>

      <Panel
        title="Sales"
        subtitle="Paid revenue per day"
        actions={
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Date range">
            {RANGES.map((range) => (
              <Button
                key={range.days}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDays(range.days)}
                aria-pressed={days === range.days}
                // The visible label is abbreviated so three of them fit beside
                // a panel title on a phone; the accessible name is not.
                aria-label={range.label}
                className={cn(
                  'px-2.5',
                  // An applied filter, so the warm "you are here" pill — the
                  // page's only asserted state and its only filled shape.
                  days === range.days
                    ? 'bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                    : 'text-muted-foreground',
                )}
              >
                {range.short}
              </Button>
            ))}
          </div>
        }
      >
        <div className="p-card">
          {/* The same line the account-wide trends use. Two time-series forms
              on two adjacent analytics screens is two chart languages to keep
              in step, and the reader has to re-learn the second one. */}
          <TrendLine points={data.sales_timeline} label="Daily revenue" format={formatMoney} />
        </div>
      </Panel>

      <div className="grid gap-stack-lg xl:grid-cols-2">
        <Panel
          title="Ticket tiers"
          // NOT "where the revenue came from", which is what this said and
          // what it is not. The per-tier figure is `sold x list price` — a
          // GROSS — while the headline revenue counts only payments still
          // held, so a refunded ticket is in one and not the other. Those two
          // numbers sitting side by side unexplained is how an organizer
          // decides the dashboard is lying to them; naming the difference is
          // the whole fix.
          subtitle="Sold at list price, before refunds"
          actions={
            data.tiers.length ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => exportTiers(data.tiers, event?.title ?? 'event')}
                className="shrink-0 text-muted-foreground"
              >
                <Download className="size-3.5" aria-hidden />
                CSV
              </Button>
            ) : null
          }
        >
          <Tiers tiers={data.tiers} refundedMinor={data.refunded_minor} />
        </Panel>

        <div className="flex flex-col gap-stack-lg">
          <Panel title="Bookings" subtitle="Every booking ever started for this event">
            <Distribution items={data.bookings_by_status} empty="No bookings yet." />
          </Panel>
          <Panel title="Gate scans" subtitle="The audit trail, including refusals">
            <Distribution
              items={data.scans_by_result}
              empty="Nothing has been scanned at the gate yet."
            />
          </Panel>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ parts */

/**
 * A stat tile: an icon and a quiet capped label, then the figure in tabular
 * figures, then at most two lines of context. When the tile carries a rate it
 * also carries the bar for it — sell-through is the one number on this page an
 * organizer reads as a position rather than as a quantity.
 */
function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  rate,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint: string;
  rate?: number | null;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-card">
      <span className="inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5 text-primary" aria-hidden />
        {label}
      </span>
      <span className="text-h4 tabular-nums text-foreground">{value}</span>
      {rate !== undefined ? (
        <>
          {typeof rate === 'number' ? <Meter value={rate / 100} className="mt-0.5" /> : null}
          <span className="text-caption tabular-nums text-muted-foreground">
            <Percent value={rate} /> sold
          </span>
        </>
      ) : null}
      <span className="text-caption text-muted-foreground">{hint}</span>
    </div>
  );
}

function Tiers({ tiers, refundedMinor }: { tiers: TierAnalytics[]; refundedMinor: number }) {
  if (!tiers.length) {
    return (
      <p className="p-card text-body-sm text-muted-foreground">
        This event has no ticket types, so there is nothing to sell yet.
      </p>
    );
  }

  const top = Math.max(...tiers.map((tier) => tier.sold), 1);
  const gross = tiers.reduce((sum, tier) => sum + tier.revenue_minor, 0);

  return (
    <>
      {/* Shown only when the two figures actually disagree — an explanation
          permanently pinned under a panel is read as boilerplate and stops
          being read at all. */}
      {refundedMinor > 0 ? (
        <p className="border-b border-border px-card py-2 text-caption text-muted-foreground">
          {formatMoney(gross)} sold at list price. {formatMoney(refundedMinor)} of it was refunded,
          which is why the headline revenue above is lower.
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {tiers.map((tier) => (
          <li key={tier.id} className="flex flex-col gap-1.5 px-card py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-body-sm font-medium text-foreground">
                {tier.name}
              </span>
              <span className="shrink-0 text-right text-body-sm tabular-nums text-foreground">
                {formatMoney(tier.revenue_minor)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Meter value={tier.sold / top} className="flex-1" />
              <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                {tier.sold}/{tier.quantity} at {formatMoney(tier.price_minor)}
              </span>
            </div>
            {tier.reserved > 0 ? (
              <span className="text-caption text-muted-foreground">
                {tier.reserved} held in carts right now
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * A labelled count list, coloured by STATE rather than by rank.
 *
 * Bars are relative to the largest row, not to a total — these are counts by
 * category, not parts of a whole. The tone comes from the backend's own state
 * string (`statusTone`), so an "allowed" scan and a "denied" one do not read
 * alike, and the row's own label is what carries its identity: several denial
 * reasons legitimately share the destructive tone.
 */
function Distribution({
  items,
  empty,
}: {
  items: { label: string; value: number }[];
  empty: string;
}) {
  return (
    <div className="p-card">
      <BarList
        items={items}
        format={(value) => String(value)}
        emptyLabel={empty}
        toneFor={statusTone}
        humaniseLabels
      />
    </div>
  );
}

function LoadingShape() {
  return (
    <div className="flex flex-col gap-stack-lg">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-stack lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-56" />
    </div>
  );
}

/**
 * Tier performance as a spreadsheet.
 *
 * MAJOR UNITS in the export, unlike everywhere else in this codebase, and it
 * is the one place that conversion belongs: a CSV is opened by a human and
 * summed by a formula. Exporting paise would make every total somebody builds
 * on top of it wrong by a factor of 100, silently.
 */
const TIER_EXPORT_COLUMNS: ColumnDef<TierAnalytics>[] = [
  {
    key: 'name',
    header: 'Tier',
    width: 200,
    render: (tier) => tier.name,
    sortValue: (t) => t.name,
  },
  {
    key: 'price',
    header: 'Price',
    width: 120,
    numeric: true,
    render: (tier) => tier.price_minor,
    exportValue: (tier) => (tier.price_minor / 100).toFixed(2),
  },
  {
    key: 'quantity',
    header: 'Quantity',
    width: 100,
    numeric: true,
    render: (tier) => tier.quantity,
    exportValue: (tier) => tier.quantity,
  },
  {
    key: 'sold',
    header: 'Sold',
    width: 100,
    numeric: true,
    render: (tier) => tier.sold,
    exportValue: (tier) => tier.sold,
  },
  {
    key: 'reserved',
    header: 'Held',
    width: 100,
    numeric: true,
    render: (tier) => tier.reserved,
    exportValue: (tier) => tier.reserved,
  },
  {
    key: 'revenue',
    header: 'Revenue',
    width: 140,
    numeric: true,
    render: (tier) => tier.revenue_minor,
    exportValue: (tier) => (tier.revenue_minor / 100).toFixed(2),
  },
];

function exportTiers(tiers: TierAnalytics[], eventTitle: string) {
  const slug = eventTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'event';
  downloadCsv(`${slug}-tiers.csv`, toCsv(TIER_EXPORT_COLUMNS, tiers));
}
