'use client';

import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { formatMoney } from '@/lib/discovery/format';
import { useOverview, useTimeseries } from '@/lib/organizer/queries';
import type { SeriesPoint } from '@/lib/api/organizer';
import { ErrorState, Skeleton } from './primitives';
import { cn } from '@/lib/utils/cn';

/**
 * The six tiles that answer "how is my business doing today", above the fold.
 *
 * DENSITY: six tiles across at 1600px, three at tablet, two on a phone — each
 * about 96px tall. The brief explicitly ruled out giant cards, and a KPI you
 * have to scroll to see is a KPI you check once a week instead of once an hour.
 *
 * EVERY NUMBER IS REAL. Revenue, bookings, tickets, upcoming, refunds and
 * conversion all come from `GET /organizer/overview`, which aggregates rows
 * this organizer owns. The trend is today versus the same length of yesterday.
 * When yesterday was zero the API returns `null` and the tile shows a dash
 * rather than "+100%" — a trend against nothing is noise, and on a revenue
 * tile it is the kind of noise people make decisions on.
 *
 * SPARKLINES are the last 14 days of the matching series, drawn as a plain
 * polyline from design tokens. A charting library for six 24px sparklines
 * would cost more than the rest of this page put together.
 */
export function KpiStrip() {
  const overview = useOverview();
  const revenue = useTimeseries('revenue', 14);
  const bookings = useTimeseries('bookings', 14);
  const tickets = useTimeseries('tickets', 14);

  if (overview.isError) {
    return (
      <ErrorState
        message="Could not load today's numbers."
        onRetry={() => void overview.refetch()}
        className="rounded-xl border border-border bg-surface"
      />
    );
  }

  const data = overview.data;

  const tiles = [
    {
      label: "Today's revenue",
      value: data ? formatMoney(data.revenue_today_minor) : null,
      change: data?.revenue_change_pct ?? null,
      series: revenue.data?.points,
    },
    {
      label: "Today's bookings",
      value: data ? String(data.bookings_today) : null,
      change: data?.bookings_change_pct ?? null,
      series: bookings.data?.points,
    },
    {
      label: 'Tickets sold',
      value: data ? String(data.tickets_sold_today) : null,
      change: data?.tickets_change_pct ?? null,
      series: tickets.data?.points,
    },
    {
      label: 'Upcoming events',
      value: data ? String(data.events_upcoming) : null,
      // A count of future events has no "yesterday" to compare against.
      change: null,
      series: undefined,
    },
    {
      label: 'Refunds today',
      value: data ? String(data.refunds_today) : null,
      change: null,
      series: undefined,
      // Refunds going UP is bad, so the arrow's colour has to invert.
      inverted: true,
      caption: data && data.refunds_today_minor > 0 ? formatMoney(data.refunds_today_minor) : null,
    },
    {
      label: 'Conversion',
      value: data?.conversion_pct === null || data === undefined ? null : `${data.conversion_pct}%`,
      change: data?.conversion_change_pct ?? null,
      series: undefined,
      // A percentage-point delta, not a percentage OF a percentage.
      unit: 'pp',
      // Distinguishes "still loading" from "no bookings started today, so
      // there is no rate" — the tile shows a dash and says why.
      absent: Boolean(data) && data?.conversion_pct === null,
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <li key={tile.label}>
          <Tile {...tile} loading={overview.isPending} />
        </li>
      ))}
    </ul>
  );
}

function Tile({
  label,
  value,
  change,
  series,
  loading,
  inverted,
  unit,
  caption,
  absent,
}: {
  label: string;
  value: string | null;
  change: number | null;
  series?: SeriesPoint[];
  loading: boolean;
  inverted?: boolean;
  unit?: string;
  caption?: string | null;
  absent?: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-1.5 rounded-xl border border-border bg-surface p-3">
      <p className="truncate text-caption text-muted-foreground">{label}</p>

      <div className="flex items-end justify-between gap-2">
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <p className="truncate text-h4 tabular-nums text-foreground">
            {absent ? (
              <span className="text-muted-foreground" title="No bookings started today">
                —
              </span>
            ) : (
              (value ?? '—')
            )}
          </p>
        )}
        {series && series.length > 1 ? <Sparkline points={series} /> : null}
      </div>

      <div className="flex min-h-4 items-center gap-1.5">
        {loading ? null : <Trend change={change} inverted={inverted} unit={unit} />}
        {caption ? (
          <span className="truncate text-caption text-muted-foreground">{caption}</span>
        ) : null}
      </div>
    </div>
  );
}

function Trend({
  change,
  inverted,
  unit,
}: {
  change: number | null;
  inverted?: boolean;
  unit?: string;
}) {
  if (change === null) {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
        <Minus className="size-3" aria-hidden />
        <span className="sr-only">No comparison available</span>
        vs yesterday
      </span>
    );
  }
  const up = change > 0;
  const good = inverted ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-caption tabular-nums',
        change === 0 ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive',
      )}
    >
      {change === 0 ? (
        <Minus className="size-3" aria-hidden />
      ) : (
        <Icon className="size-3" aria-hidden />
      )}
      {Math.abs(change)}
      {unit ?? '%'}
      <span className="ml-0.5 text-muted-foreground">vs yesterday</span>
    </span>
  );
}

/**
 * A 14-point polyline in a 64×24 box.
 *
 * `preserveAspectRatio="none"` lets it stretch to whatever width the tile
 * gives it without the stroke distorting (`vector-effect` keeps that honest).
 * A flat series draws a flat line rather than dividing by a zero range.
 */
function Sparkline({ points }: { points: SeriesPoint[] }) {
  const values = points.map((point) => point.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = 64 / Math.max(values.length - 1, 1);
  const path = values
    .map((value, index) => `${index * step},${24 - ((value - min) / range) * 20 - 2}`)
    .join(' ');

  return (
    <svg
      viewBox="0 0 64 24"
      preserveAspectRatio="none"
      className="h-6 w-16 shrink-0 text-primary"
      role="img"
      aria-label={`Last ${values.length} days`}
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
