'use client';

import * as React from 'react';
import type { BreakdownItem, SeriesPoint } from '@/lib/api/admin';
import { cn } from '@/lib/utils/cn';

/**
 * Charts, drawn as plain SVG from design tokens.
 *
 * NO CHARTING LIBRARY, on purpose. Recharts and friends are 40–100KB gzipped
 * and arrive with their own colour system, their own fonts and their own
 * tooltips — all of which then have to be fought back into this design system.
 * A line, an area, bars and a donut are a few dozen lines of path maths, they
 * inherit the tokens for free, they theme correctly in light and dark because
 * they use `currentColor` and CSS variables, and they cost nothing in the
 * bundle budget the rest of this app is held to.
 *
 * ACCESSIBILITY: every chart is `role="img"` with a summary label, and ships a
 * visually-hidden table of the same numbers. A screen reader gets the data,
 * not "chart".
 *
 * The series arrives DENSE from the API (every day present, zeros included —
 * see the backend's `get_timeseries`), so nothing here has to guess about gaps.
 * A chart that silently skips empty days draws a climb that never happened.
 *
 * ── ONE INK, AND IT IS THE WAYFINDING ACCENT ──────────────────────────────
 *
 * Marks are drawn in `--primary` (violet) — the accent's sanctioned job, the
 * same one it does on a chart line elsewhere in the product. The bar list used
 * to fill with `bg-gradient-brand`: a two-stop gradient across a bar makes the
 * long end read as a different value from the short end, which is the one
 * thing a bar chart exists not to do. Slices in the donut separate by an
 * OPACITY RAMP of that single ink rather than by a second palette, so a legend
 * swatch can never disagree with the arc it names.
 *
 * The NUMBER is the datum, so it is `tabular-nums`, right-aligned against the
 * label and set in `--foreground`; the label beside it is the quieter half.
 */

type Formatter = (value: number) => string;

const CHART_HEIGHT = 160;
const CHART_WIDTH = 640;

function pathFor(points: SeriesPoint[], max: number): { line: string; area: string } {
  if (points.length === 0) return { line: '', area: '' };
  const stepX = points.length > 1 ? CHART_WIDTH / (points.length - 1) : 0;
  const y = (value: number) => CHART_HEIGHT - (max === 0 ? 0 : (value / max) * (CHART_HEIGHT - 8));
  const coords = points.map((point, index) => [index * stepX, y(point.value)] as const);
  const line = coords
    .map(([x, yy], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${yy.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${CHART_WIDTH},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z`;
  return { line, area };
}

/** Line + area. Used for revenue and bookings over time. */
export function TrendChart({
  points,
  label,
  format,
  className,
}: {
  points: SeriesPoint[];
  label: string;
  format: Formatter;
  className?: string;
}) {
  const max = Math.max(...points.map((point) => point.value), 1);
  const { line, area } = pathFor(points, max);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const gradientId = React.useId();

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-40 w-full text-primary"
        role="img"
        aria-label={`${label}. Total ${format(total)} over ${points.length} days.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <DataTableForScreenReaders
        caption={label}
        rows={points.map((point) => [point.date, format(point.value)])}
      />
    </div>
  );
}

/** Horizontal bars. Used for cities, where labels are words, not dates. */
export function BarList({
  items,
  format,
  emptyLabel,
  className,
}: {
  items: BreakdownItem[];
  format: Formatter;
  emptyLabel: string;
  className?: string;
}) {
  if (!items.length) {
    return <p className={cn('text-body-sm text-muted-foreground', className)}>{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <ul className={cn('flex flex-col gap-stack', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate text-body-sm text-muted-foreground">{item.label}</span>
            <span className="shrink-0 text-body-sm font-medium tabular-nums text-foreground">
              {format(item.value)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-slow ease-spring motion-reduce:transition-none"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Donut. Proportions of a whole — used for the split across cities. */
export function DonutChart({
  items,
  format,
  className,
}: {
  items: BreakdownItem[];
  format: Formatter;
  className?: string;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) {
    return <p className={cn('text-body-sm text-muted-foreground', className)}>Nothing yet.</p>;
  }

  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-6', className)}>
      <svg
        viewBox="0 0 160 160"
        className="size-36 shrink-0 -rotate-90"
        role="img"
        aria-label={`Split across ${items.length} groups, ${format(total)} in total.`}
      >
        {items.map((item, index) => {
          const fraction = item.value / total;
          const dash = fraction * circumference;
          const circle = (
            <circle
              key={item.label}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              strokeWidth="20"
              stroke="currentColor"
              // Opacity ramp rather than a second palette: the brief forbids
              // new colours, and a donut needs its slices distinguishable.
              className="text-primary"
              strokeOpacity={1 - index * 0.13}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return circle;
        })}
      </svg>

      <ul className="flex min-w-0 flex-col gap-2">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2 text-body-sm">
            <span
              className="size-2.5 shrink-0 rounded-full bg-primary"
              style={{ opacity: 1 - index * 0.13 }}
              aria-hidden
            />
            <span className="truncate text-muted-foreground">{item.label}</span>
            <span className="ml-auto shrink-0 font-medium tabular-nums text-foreground">
              {format(item.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The numbers behind a chart, for anyone who can't see it. */
function DataTableForScreenReaders({
  caption,
  rows,
}: {
  caption: string;
  rows: [string, string][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([key, value]) => (
          <tr key={key}>
            <th scope="row">{key}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
