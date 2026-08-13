'use client';

import * as React from 'react';
import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BarList, DonutChart, Meter, TrendLine } from './charts';
import { formatMoney } from '@/lib/discovery/format';
import type { SeriesMetric } from '@/lib/api/organizer';
import {
  useAudience,
  useBreakdown,
  useEventRows,
  useOverview,
  useTimeseries,
} from '@/lib/organizer/queries';
import { EmptyState, ErrorState, Panel, Percent, Skeleton } from './primitives';
import { cn } from '@/lib/utils/cn';

/**
 * Analytics.
 *
 * ── WHAT IS HERE, AND WHAT IS NOT ─────────────────────────────────────────
 *
 * Six KPIs, three trends, three breakdowns and a ranked event list — all of it
 * from `/organizer/*`, all of it real. The brief also asked for Traffic
 * source, Device, Payment methods and a conversion funnel. **The platform
 * records none of those**: there is no analytics/telemetry pipeline, no
 * user-agent capture, and Razorpay's method breakdown is not stored on
 * `Payment` (only the order/payment/refund reference ids and the amount).
 *
 * Rendering those as empty charts would be the specific failure the operator
 * console already learned from — a chart that shows nothing reads as "you had
 * no traffic", not "nobody measured it". So they are absent, and BACKLOG item
 * 29 names what each would need.
 *
 * ── THIS IS AN OPERATIONS SCREEN, NOT A REPORT ────────────────────────────
 *
 * Everything is sized so the six KPIs, the three trends and the first
 * breakdown fit above the fold on a laptop: tiles are one padding rung, panels
 * share one rhythm, and there is exactly ONE filled button on the page — the
 * near-black "Create an event" pill, and only when there is nothing to show.
 * The date range is a filter, so it wears the butter "you are here" pill
 * rather than a second fill competing with it.
 *
 * The charts come from `./charts`, which is this dashboard's own vocabulary —
 * violet for a measure, the semantic status hues for a state, every colour a
 * token with a tuned value in BOTH themes. It used to import the operator
 * console's chart module, which coupled two portals that are redesigned
 * separately and left the organizer with a donut whose slices were told apart
 * by opacity alone.
 */

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

const METRICS: { id: SeriesMetric; label: string; money: boolean }[] = [
  { id: 'revenue', label: 'Revenue', money: true },
  { id: 'bookings', label: 'Bookings', money: false },
  { id: 'tickets', label: 'Tickets', money: false },
];

/** Today in the platform's timezone (IST), as YYYY-MM-DD.
 *
 * The browser's own timezone is deliberately not consulted, for the reason the
 * discovery calendar already documents: the events are in India, and at 20:00
 * UTC a browser-local "today" is already tomorrow — which would offer a range
 * ending on a date the server clamps away.
 */
function istToday(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60_000);
  return ist.toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD dates, inclusive of both ends. */
function inclusiveDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

export function Analytics() {
  const [days, setDays] = React.useState<number>(30);
  // A chosen range and a named window are separate state, exactly as the
  // browse page keeps `when` apart from `dateFrom`/`dateTo`: a preset is a
  // rolling window that means something different tomorrow, and that is the
  // point of it. `range` non-null is what makes the custom one active.
  const [range, setRange] = React.useState<{ from: string; to: string } | null>(null);
  const effectiveDays = range ? Math.max(1, inclusiveDays(range.from, range.to)) : days;
  const effectiveEnd = range?.to;
  const overview = useOverview();
  const audience = useAudience();

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex flex-wrap items-center gap-stack">
        <h1 className="text-h4">Analytics</h1>
        <div
          role="radiogroup"
          aria-label="Date range"
          className="ml-auto flex rounded-full border border-border bg-surface p-0.5"
        >
          {RANGES.map((preset) => (
            <Button
              key={preset.days}
              type="button"
              variant="ghost"
              size="sm"
              role="radio"
              aria-checked={!range && days === preset.days}
              onClick={() => {
                setDays(preset.days);
                setRange(null);
              }}
              className={cn(
                'px-3',
                // The applied filter wears the warm "you are here" pill, never
                // a second filled action.
                !range && days === preset.days
                  ? 'bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        {/* A chosen range, beside the named ones rather than hidden behind a
            toggle: an organizer reconciling a payout or a month's takings
            wants specific dates, and making them open a menu first is a step
            for no reason. Two native date inputs — the platform's own picker
            is keyboard-accessible, localised and understood, and a bespoke
            calendar here would be a second, worse one to maintain. */}
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="analytics-from">
            From
          </label>
          <input
            id="analytics-from"
            type="date"
            max={range?.to ?? istToday()}
            value={range?.from ?? ''}
            onChange={(event) => {
              const from = event.target.value;
              if (!from) return setRange(null);
              setRange({ from, to: range?.to && range.to >= from ? range.to : istToday() });
            }}
            className="h-control rounded-full border border-border bg-surface px-3 text-body-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span aria-hidden className="text-caption text-muted-foreground">
            to
          </span>
          <label className="sr-only" htmlFor="analytics-to">
            To
          </label>
          <input
            id="analytics-to"
            type="date"
            min={range?.from}
            max={istToday()}
            value={range?.to ?? ''}
            onChange={(event) => {
              const to = event.target.value;
              if (!to || !range?.from) return;
              setRange({ from: range.from, to });
            }}
            disabled={!range?.from}
            className="h-control rounded-full border border-border bg-surface px-3 text-body-sm text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {range ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRange(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {/* Six KPIs. Every rate renders a dash rather than 0% when its
          denominator is zero — see `Percent`. */}
      {overview.isError ? (
        <ErrorState
          message="Could not load your headline numbers."
          onRetry={() => void overview.refetch()}
          className="rounded-xl border border-border bg-surface"
        />
      ) : (
        <ul className="grid grid-cols-2 gap-stack md:grid-cols-3 xl:grid-cols-6">
          <Kpi
            label="Revenue today"
            value={overview.data ? formatMoney(overview.data.revenue_today_minor) : null}
            loading={overview.isPending}
          />
          <Kpi
            label="Tickets today"
            value={overview.data ? String(overview.data.tickets_sold_today) : null}
            loading={overview.isPending}
          />
          <Kpi
            label="Conversion"
            value={overview.data ? <Percent value={overview.data.conversion_pct} /> : null}
            loading={overview.isPending}
          />
          <Kpi
            label="Check-ins today"
            value={overview.data ? String(overview.data.checkins_today) : null}
            loading={overview.isPending}
          />
          <Kpi
            label="Refunds today"
            value={overview.data ? String(overview.data.refunds_today) : null}
            loading={overview.isPending}
          />
          <Kpi
            label="Repeat customers"
            value={audience.data ? <Percent value={audience.data.repeat_pct} /> : null}
            loading={audience.isPending}
          />
        </ul>
      )}

      <div className="grid gap-stack-lg xl:grid-cols-3">
        {METRICS.map((metric) => (
          <Trend key={metric.id} metric={metric} days={effectiveDays} end={effectiveEnd} />
        ))}
      </div>

      <div className="grid gap-stack-lg lg:grid-cols-2 xl:grid-cols-3">
        <Breakdown
          by="revenue_by_event"
          title="Revenue by event"
          subtitle="Captured payments, all time"
          money
        />
        <Breakdown
          by="revenue_by_city"
          title="Revenue by city"
          subtitle="Where your buyers are"
          money
        />
        <BookingStatuses />
      </div>

      <TopEvents />

      {/* A paragraph here listed the charts this page does NOT draw and why,
          citing a backlog item. The reasoning is right — a traffic chart drawn
          from nothing reads as "you had no visitors" rather than "nobody
          measured it", which is why those charts are absent. But an organiser
          opening their analytics wants the numbers that exist, and a footnote
          about a missing telemetry pipeline tells them the tool is
          incomplete. What is on this page is real; that is the whole claim. */}
    </div>
  );
}

/**
 * A stat tile: the label small, quiet and set in caps; the figure large, in
 * the foreground ink and in TABULAR figures so a column of them lines up and
 * a changing number does not jitter its own tile.
 */
function Kpi({
  label,
  value,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  loading: boolean;
}) {
  return (
    <li className="rounded-xl border border-border bg-surface p-card">
      <p className="truncate text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-16" />
      ) : (
        <p className="mt-1 truncate text-h4 tabular-nums text-foreground">{value ?? '—'}</p>
      )}
    </li>
  );
}

function Trend({
  metric,
  days,
  end,
}: {
  metric: { id: SeriesMetric; label: string; money: boolean };
  days: number;
  end?: string;
}) {
  const series = useTimeseries(metric.id, days, end);
  return (
    <Panel
      title={metric.label}
      // Says WHICH window, not just how long. "Last 30 days" under a chart of
      // a chosen range would be a caption contradicting the control above it.
      subtitle={end ? `${days} days to ${end}` : `Last ${days} days`}
    >
      <div className="p-card">
        {series.isError ? (
          <ErrorState onRetry={() => void series.refetch()} className="px-0 py-0" />
        ) : series.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <TrendLine
            points={series.data.points}
            label={metric.label}
            format={metric.money ? formatMoney : (value) => String(value)}
          />
        )}
      </div>
    </Panel>
  );
}

function Breakdown({
  by,
  title,
  subtitle,
  money,
}: {
  by: 'revenue_by_event' | 'revenue_by_city';
  title: string;
  subtitle: string;
  money?: boolean;
}) {
  const breakdown = useBreakdown(by, 8);
  return (
    <Panel title={title} subtitle={subtitle}>
      <div className="p-card">
        {breakdown.isError ? (
          <ErrorState onRetry={() => void breakdown.refetch()} className="px-0 py-0" />
        ) : breakdown.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <BarList
            items={breakdown.data.items}
            format={money ? formatMoney : (value) => String(value)}
            emptyLabel="Nothing captured yet."
          />
        )}
      </div>
    </Panel>
  );
}

/**
 * The one chart on this page whose categories are STATES rather than a
 * measure, so it is the one that wears the semantic status hues: paid is
 * success, a live hold is informational, a lapsed hold is a warning and a
 * cancellation is destructive. Four closed values, four distinct tones — the
 * only shape the donut is safe for (see `charts.tsx`).
 */
function BookingStatuses() {
  const breakdown = useBreakdown('bookings_by_status', 8);
  return (
    <Panel title="Bookings by status" subtitle="Paid, reserved, expired and cancelled">
      <div className="p-card">
        {breakdown.isError ? (
          <ErrorState onRetry={() => void breakdown.refetch()} className="px-0 py-0" />
        ) : breakdown.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : breakdown.data.items.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No bookings yet.</p>
        ) : (
          <DonutChart
            items={breakdown.data.items}
            format={(value) => String(value)}
            centreLabel="bookings"
          />
        )}
      </div>
    </Panel>
  );
}

/**
 * Ranked by revenue, over the events already loaded.
 *
 * A LIST, not a grid of cards. The question is "which of these earned most",
 * which is a comparison between figures — and in a three-column grid no two
 * figures share an edge, so they cannot be compared at a glance at all. In one
 * column, right-aligned and in tabular figures, the ranking reads itself.
 *
 * The first page only — `/organizer/event-rows` is cursor-paginated on
 * `-created_at`, so a true "top by revenue" needs a server-side sort. The
 * footer says which set is being ranked rather than implying it is all of
 * them. BACKLOG item 26.
 */
function TopEvents() {
  const query = useEventRows({});
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  const ranked = [...rows].sort((a, b) => b.revenue_minor - a.revenue_minor).slice(0, 6);

  return (
    <Panel title="Top performing events" subtitle="By captured revenue">
      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="flex flex-col gap-stack p-card">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-12" />
          ))}
        </div>
      ) : ranked.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No events yet"
          body="Create and publish an event, and its performance shows up here."
          action={
            <Button asChild size="sm">
              <Link href="/dashboard/events/new">Create an event</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ol className="divide-y divide-border">
            {ranked.map((row, index) => {
              const sellThrough =
                row.capacity > 0 ? Math.round((row.sold / row.capacity) * 100) : null;
              return (
                <li key={row.id}>
                  <Link
                    href={`/dashboard/events?event=${row.id}`}
                    className="flex items-start gap-3 px-card py-2.5 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                  >
                    <span className="w-5 shrink-0 pt-0.5 text-caption tabular-nums text-muted-foreground">
                      #{index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-foreground">
                        {row.title}
                      </span>
                      <span className="block text-caption tabular-nums text-muted-foreground">
                        {row.sold} sold
                        {sellThrough !== null ? ` · ${sellThrough}% of capacity` : ''}
                      </span>
                      {sellThrough !== null ? (
                        <Meter value={sellThrough / 100} className="mt-1.5" />
                      ) : null}
                    </span>
                    <span className="shrink-0 text-right text-body-sm tabular-nums text-foreground">
                      {formatMoney(row.revenue_minor)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {query.hasNextPage ? (
            <p className="border-t border-border px-card py-2.5 text-caption text-muted-foreground">
              Ranked over the {rows.length} events loaded so far — the list is paginated by creation
              date, so a true all-time ranking needs a server-side sort.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
