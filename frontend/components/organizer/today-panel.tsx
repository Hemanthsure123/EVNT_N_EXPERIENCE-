'use client';

import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { formatMoney } from '@/lib/discovery/format';
import { useOverview, useTimeseries } from '@/lib/organizer/queries';
import type { SeriesMetric } from '@/lib/api/organizer';
import { TrendLine } from './charts';
import { ErrorState, Skeleton } from './primitives';
import { cn } from '@/lib/utils/cn';

/**
 * The lead answer on the dashboard: one metric, big, with its own fourteen-day
 * shape beside it.
 *
 * ── WHY THIS REPLACED SIX EQUAL TILES ─────────────────────────────────────
 *
 * The page opened with six KPI tiles of identical size and weight — revenue,
 * bookings, tickets, upcoming, refunds, conversion — each carrying a 64px
 * sparkline too small to read a value off. Six things at the same volume is no
 * emphasis at all, and the sparklines were decoration: a 24px-tall polyline
 * with no axis and no labels cannot distinguish a good week from a bad one.
 *
 * An organizer opens this asking ONE question — how are sales going — so one
 * number gets the room, at a size that reads across a desk, with the delta
 * against yesterday next to it and a properly labelled chart (totals, peak,
 * both window ends, per-day values on hover) rather than a squiggle.
 *
 * The other two headline measures did not disappear, they became a CHOICE. The
 * segmented control re-points both the number and the chart, so comparing
 * revenue to ticket volume is one click on the same axis instead of two tiles
 * that share no scale and cannot be compared at all.
 *
 * ── THE SECONDARY ROW IS DELIBERATELY NOT CARDS ───────────────────────────
 *
 * Upcoming, check-ins, refunds and conversion are reference figures, not the
 * question. They sit on one rule under the lead as plain figures — four more
 * bordered boxes would put them back at the same weight as the thing they are
 * meant to support, which is the exact problem being fixed.
 *
 * `checkins_today` is on the overview payload and was never displayed. On an
 * event day it is the number an organizer refreshes for.
 *
 * ── EVERY NUMBER IS STILL REAL ────────────────────────────────────────────
 *
 * Same `GET /organizer/overview` and `GET /organizer/timeseries` as before. No
 * forecast, no goal ring, no "engagement" score. A trend against a zero
 * yesterday stays a dash rather than becoming "+100%".
 */

const METRICS: { key: SeriesMetric; label: string; money: boolean }[] = [
  { key: 'revenue', label: 'Revenue', money: true },
  { key: 'bookings', label: 'Bookings', money: false },
  { key: 'tickets', label: 'Tickets', money: false },
];

const TREND_DAYS = 14;

export function TodayPanel() {
  const [metric, setMetric] = React.useState<SeriesMetric>('revenue');
  const overview = useOverview();
  const series = useTimeseries(metric, TREND_DAYS);

  const active = METRICS.find((entry) => entry.key === metric) ?? METRICS[0];
  const data = overview.data;

  const headline = !data
    ? null
    : metric === 'revenue'
      ? formatMoney(data.revenue_today_minor)
      : metric === 'bookings'
        ? String(data.bookings_today)
        : String(data.tickets_sold_today);

  const change = !data
    ? null
    : metric === 'revenue'
      ? data.revenue_change_pct
      : metric === 'bookings'
        ? data.bookings_change_pct
        : data.tickets_change_pct;

  const format = React.useCallback(
    (value: number) => (active.money ? formatMoney(value) : String(value)),
    [active.money],
  );

  if (overview.isError) {
    return (
      <ErrorState
        message="Could not load today's numbers."
        onRetry={() => void overview.refetch()}
        className="rounded-xl border border-border bg-surface shadow-sm"
      />
    );
  }

  return (
    <section
      aria-labelledby="today-heading"
      className="flex flex-col gap-block rounded-xl border border-border bg-surface p-card shadow-sm lg:p-card-lg"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="today-heading" className="text-body font-semibold text-foreground">
          Today
        </h2>
        <MetricSwitch value={metric} onChange={setMetric} />
      </header>

      <div className="grid gap-block lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-block-lg">
        <div className="flex flex-col justify-center gap-2">
          {overview.isPending ? (
            <Skeleton className="h-12 w-40" />
          ) : (
            <p className="text-h2 tabular-nums leading-none text-foreground">{headline ?? '—'}</p>
          )}
          {overview.isPending ? null : <Delta change={change} />}
          {/* No caption here. It read "Revenue booked today, against the same
              hours yesterday" — directly under a heading that says "Today", a
              control that says "Revenue" and a delta that says "vs yesterday".
              Three restatements of the same sentence, wrapping to two lines. */}
        </div>

        <div className="min-w-0">
          {series.isError ? (
            <ErrorState
              message="Could not load the trend."
              onRetry={() => void series.refetch()}
            />
          ) : series.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <TrendLine
              points={series.data.points}
              label={`${active.label}, last ${TREND_DAYS} days`}
              format={format}
            />
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-block sm:grid-cols-4">
        <Stat
          label="Upcoming events"
          value={data ? String(data.events_upcoming) : null}
          loading={overview.isPending}
        />
        <Stat
          label="Checked in today"
          value={data ? String(data.checkins_today) : null}
          loading={overview.isPending}
        />
        <Stat
          label="Refunds today"
          value={data ? String(data.refunds_today) : null}
          hint={data && data.refunds_today_minor > 0 ? formatMoney(data.refunds_today_minor) : null}
          loading={overview.isPending}
        />
        <Stat
          label="Conversion"
          // `null` is not zero: it means no booking started today, so there is
          // no rate to report. A 0% would be a claim nobody made.
          value={data ? (data.conversion_pct === null ? '—' : `${data.conversion_pct}%`) : null}
          hint={data?.conversion_pct === null ? 'No bookings started' : null}
          loading={overview.isPending}
        />
      </dl>
    </section>
  );
}

/**
 * Three states, one control.
 *
 * A radiogroup rather than tabs: nothing is being shown and hidden, one measure
 * is being chosen out of three, and a screen reader should hear "Revenue,
 * selected, 1 of 3" rather than a tab that implies a panel per option.
 */
function MetricSwitch({
  value,
  onChange,
}: {
  value: SeriesMetric;
  onChange: (metric: SeriesMetric) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Measure" className="flex rounded-full bg-muted p-0.5">
      {METRICS.map((entry) => {
        const selected = entry.key === value;
        return (
          <button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(entry.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-label transition-colors duration-fast motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

function Delta({ change }: { change: number | null }) {
  if (change === null) {
    return (
      <p className="inline-flex items-center gap-1 text-body-sm text-muted-foreground">
        <Minus className="size-3.5" aria-hidden />
        No comparison — nothing yesterday
      </p>
    );
  }
  const up = change > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p
      className={cn(
        'inline-flex items-center gap-1 text-body-sm tabular-nums',
        change === 0 ? 'text-muted-foreground' : up ? 'text-success' : 'text-destructive',
      )}
    >
      {change === 0 ? (
        <Minus className="size-3.5" aria-hidden />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {Math.abs(change)}%
      <span className="text-muted-foreground">vs yesterday</span>
    </p>
  );
}

function Stat({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string | null;
  hint?: string | null;
  loading: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-h4 tabular-nums text-foreground">
        {loading ? <Skeleton className="h-6 w-14" /> : (value ?? '—')}
      </dd>
      {hint ? <p className="truncate text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
