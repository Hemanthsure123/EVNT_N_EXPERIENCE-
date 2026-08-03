'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The organizer dashboard's chart vocabulary — plain SVG and HTML, drawn from
 * design tokens.
 *
 * ── NO CHARTING LIBRARY ───────────────────────────────────────────────────
 *
 * Recharts and friends are 40–100KB gzipped and arrive with their own colour
 * system, their own fonts and their own tooltips, all of which then have to be
 * fought back into this design system. A line, a bar, a meter and a ring are a
 * few dozen lines of path maths; they inherit the tokens for free and they cost
 * nothing in the bundle budget the rest of this app is held to.
 *
 * ── THE COLOUR RULE: VIOLET MEANS A MEASURE, A SEMANTIC HUE MEANS A STATE ──
 *
 * A chart with ONE series — revenue over time, revenue by city, sold against
 * capacity — is one measure, so it wears ONE hue: `--primary`, the wayfinding
 * violet, which `styles/tokens.css` names as a sanctioned chart-line colour.
 * Bar length already encodes the value, so colouring bars by their value would
 * spend the identity channel re-encoding what length already shows.
 *
 * A chart whose categories are STATES — booking status, gate-scan result —
 * wears the semantic status tokens instead (`--success` / `--info` /
 * `--warning` / `--destructive`), because "cancelled" is not series 4, it is a
 * state with a fixed meaning the rest of the product already colours that way.
 * Nothing in this file ever mixes the two vocabularies inside one chart.
 *
 * ── EVERY MARK COLOUR IS LEGIBLE IN BOTH THEMES, BY CONSTRUCTION ──────────
 *
 * Every colour here is a SEMANTIC token, which means it has a separately tuned
 * light and dark value with a computed ratio in the contrast ledger — never a
 * raw shade that happens to look right on the theme it was authored in, and
 * never an opacity ramp.
 *
 * The donut this replaces distinguished its slices with
 * `strokeOpacity={1 - index * 0.13}` over a single violet. That is exactly the
 * failure mode a chart palette has: by slot 4 the slice is violet at 0.61
 * alpha, which composites to pale lilac on a white page and to a muddy smudge
 * barely off the canvas on a dark one; by slot 8 it is invisible in both.
 * Opacity is not a palette, it is a way of making one disappear.
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────
 *
 * Every chart is `role="img"` with a summary label that states the totals, and
 * the time series ships a visually-hidden table of the same numbers — a screen
 * reader gets the data, not the word "chart". Colour is never the only channel:
 * every bar and every donut slice is directly labelled with its own name and
 * its own figure. That direct labelling is what makes two things legal here
 * that would otherwise not be: the green/amber/red status hues are NOT
 * colour-blind-separable and are not claimed to be, and `--warning` amber is
 * 2.15:1 against a white page, below the 3:1 a mark normally has to clear.
 * Both are acceptable only because no reader ever has to identify a mark by
 * its colour — the name and the number are printed beside it.
 *
 * The series arrives DENSE from the API (every day present, zeros included —
 * see the backend's `get_timeseries`), so nothing here has to guess about gaps.
 * A chart that silently skips empty days draws a climb that never happened.
 */

export type Point = { date: string; value: number };
export type LabelValue = { label: string; value: number };

type Formatter = (value: number) => string;

/**
 * The tones a mark may take.
 *
 * `measure` is the default and the only one a single-series chart ever uses.
 * The rest are the semantic states, and they are deliberately NOT a categorical
 * ramp — asking for `negative` because you need a fourth colour is how a status
 * hue ends up meaning nothing.
 */
export type SeriesTone = 'measure' | 'positive' | 'progress' | 'notice' | 'negative' | 'neutral';

/** HTML marks (bars, meters, legend swatches). */
const FILL: Record<SeriesTone, string> = {
  measure: 'bg-primary',
  positive: 'bg-success',
  progress: 'bg-info',
  notice: 'bg-warning',
  negative: 'bg-destructive',
  // foreground-subtle, not border-strong: a hairline colour is 1.65:1 on white
  // and disappears as a mark. This clears 5.28:1 light / 7.40:1 dark.
  neutral: 'bg-foreground-subtle',
};

/** SVG marks — set as `text-*` and painted with `currentColor`. */
const INK: Record<SeriesTone, string> = {
  measure: 'text-primary',
  positive: 'text-success',
  progress: 'text-info',
  notice: 'text-warning',
  negative: 'text-destructive',
  neutral: 'text-foreground-subtle',
};

/**
 * The backend's own state strings, mapped to the tone the rest of the product
 * already uses for that state.
 *
 * `reserved` is `progress` (blue) rather than a warning: a live hold is the
 * system working, not a problem. `expired` is `notice` because a lapsed hold is
 * revenue that leaked without anybody deciding to let it. Unknown labels fall
 * to `neutral` rather than being assigned a colour that would imply a judgement
 * this file is not entitled to make.
 */
const STATUS_TONE: Record<string, SeriesTone> = {
  // apps/booking/models.py BookingStatus
  paid: 'positive',
  reserved: 'progress',
  expired: 'notice',
  cancelled: 'negative',
  // apps/checkin ScanResult
  allowed: 'positive',
  denied_invalid: 'negative',
  denied_already_used: 'negative',
  denied_wrong_event: 'negative',
  denied_not_active: 'negative',
  denied_out_of_window: 'notice',
};

export function statusTone(label: string): SeriesTone {
  return STATUS_TONE[label.trim().toLowerCase()] ?? 'neutral';
}

/** `denied_already_used` -> `denied already used`; CSS uppercases the first letter. */
function humanise(label: string): string {
  return label.replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ trend */

// Plot geometry, in user units. The SVG is stretched to its container
// (`preserveAspectRatio="none"`), so NOTHING inside it may be a circle or a
// glyph — both come out distorted. Strokes survive because they opt out of the
// scale with `vectorEffect`, and every label lives in HTML outside the plot.
const PLOT_W = 640;
const PLOT_H = 140;
const PLOT_TOP_PAD = 6;

/**
 * One measure over time: line, soft area, zero baseline.
 *
 * The peak and the total are printed ABOVE the plot and the window's ends
 * BELOW it, because an unlabelled sparkline is decoration — a reader cannot
 * tell ₹500 from ₹50,000 from the shape. Per-day figures are reachable on
 * hover through an invisible hit strip per point, and in full through the
 * screen-reader table.
 */
export function TrendLine({
  points,
  label,
  format,
  tone = 'measure',
  className,
}: {
  points: Point[];
  label: string;
  format: Formatter;
  tone?: SeriesTone;
  className?: string;
}) {
  const gradientId = React.useId();

  if (points.length === 0) {
    return (
      <p className={cn('text-body-sm text-muted-foreground', className)}>Nothing in this window.</p>
    );
  }

  const peak = Math.max(...points.map((point) => point.value), 0);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const max = Math.max(peak, 1);
  const y = (value: number) => PLOT_H - (value / max) * (PLOT_H - PLOT_TOP_PAD);

  // A single point is drawn as a flat line across the window rather than as a
  // dot at x=0, which is what the arithmetic would otherwise produce.
  const xs =
    points.length > 1
      ? points.map((_, index) => (index * PLOT_W) / (points.length - 1))
      : [0, PLOT_W];
  const ys =
    points.length > 1
      ? points.map((point) => y(point.value))
      : [y(points[0].value), y(points[0].value)];

  const line = xs
    .map((x, index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[index].toFixed(1)}`)
    .join(' ');
  const area = `${line} L${PLOT_W},${PLOT_H} L0,${PLOT_H} Z`;
  const strip = points.length > 1 ? PLOT_W / (points.length - 1) : PLOT_W;

  return (
    <div className={cn('flex flex-col gap-stack', className)}>
      <div className="flex items-baseline justify-between gap-3 text-caption text-muted-foreground">
        <span>
          Total <span className="tabular-nums text-foreground">{format(total)}</span>
        </span>
        <span>
          Peak <span className="tabular-nums text-foreground">{format(peak)}</span>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        preserveAspectRatio="none"
        className={cn('h-28 w-full', INK[tone])}
        role="img"
        aria-label={`${label}. Total ${format(total)} across ${points.length} days, peak ${format(peak)}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* The zero rule. Without it a flat week and a week of nothing look
            identical, because the line sits at the bottom of the box either way. */}
        <line
          x1="0"
          y1={PLOT_H}
          x2={PLOT_W}
          y2={PLOT_H}
          className="stroke-border"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
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

        {/* Per-day figures on hover. Native `<title>` rather than a bespoke
            tooltip: it costs no state, cannot desynchronise from the data, and
            the same numbers are already in the table below for anyone not
            using a pointer. */}
        {points.map((point, index) => (
          <rect
            key={point.date}
            x={Math.max(0, xs[Math.min(index, xs.length - 1)] - strip / 2)}
            y={0}
            width={strip}
            height={PLOT_H}
            fill="transparent"
          >
            <title>{`${point.date}: ${format(point.value)}`}</title>
          </rect>
        ))}
      </svg>

      <div className="flex items-baseline justify-between gap-3 text-caption tabular-nums text-muted-foreground">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>

      <SeriesTable
        caption={label}
        rows={points.map((point) => [point.date, format(point.value)])}
      />
    </div>
  );
}

/* --------------------------------------------------------------- bar list */

/**
 * Ranked magnitude: a label, its figure right-aligned in tabular figures, and
 * a bar scaled against the largest row.
 *
 * The figure is the thing being read, so it is the thing that lines up — in a
 * grid of cards the same numbers cannot be compared at all because no two of
 * them share an edge.
 */
export function BarList({
  items,
  format,
  emptyLabel,
  tone = 'measure',
  toneFor,
  humaniseLabels = false,
  className,
}: {
  items: LabelValue[];
  format: Formatter;
  emptyLabel: string;
  /** The single hue every bar takes, unless `toneFor` overrides per row. */
  tone?: SeriesTone;
  /** Per-row tone, for a list whose rows are STATES rather than one measure. */
  toneFor?: (label: string) => SeriesTone;
  /** Turn `denied_already_used` into readable words. Off for names and cities. */
  humaniseLabels?: boolean;
  className?: string;
}) {
  if (!items.length) {
    return <p className={cn('text-body-sm text-muted-foreground', className)}>{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <ul className={cn('flex flex-col gap-stack', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-body-sm text-foreground',
                humaniseLabels && 'first-letter:uppercase',
              )}
            >
              {humaniseLabels ? humanise(item.label) : item.label}
            </span>
            <span className="shrink-0 text-right text-body-sm tabular-nums text-foreground">
              {format(item.value)}
            </span>
          </div>
          <Meter value={item.value / max} tone={toneFor ? toneFor(item.label) : tone} />
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ meter */

/**
 * One proportion, as a bar. `value` is 0–1 and is clamped.
 *
 * Always `aria-hidden`: every caller prints the same proportion as text
 * immediately beside it, and a second announcement of the same fact is noise.
 */
export function Meter({
  value,
  tone = 'measure',
  className,
}: {
  value: number;
  tone?: SeriesTone;
  className?: string;
}) {
  const width = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <span
      className={cn('block h-1.5 overflow-hidden rounded-full bg-muted', className)}
      aria-hidden
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-slow ease-out motion-reduce:transition-none',
          FILL[tone],
        )}
        // A row that has a value at all keeps a visible stub, so "a very small
        // number" never renders identically to "no number".
        style={{ width: `${width > 0 ? Math.max(width, 2) : 0}%` }}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ donut */

const DONUT_BOX = 160;
const DONUT_R = 62;
const DONUT_STROKE = 18;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_R;
/** A surface gap between slices, so adjacent slices never rely on hue alone. */
const SLICE_GAP = 3;

/**
 * Parts of a whole, with the total in the hole.
 *
 * ── ONLY POINT THIS AT A SMALL, CLOSED SET OF DISTINCT STATES ─────────────
 *
 * The slices are coloured by `statusTone`, which is a STATUS palette, not a
 * categorical one — several different labels legitimately share a tone. That
 * is correct for booking status (four states, four tones) and WRONG for gate
 * scans, where five of the six results are denials and would all come out red.
 * Scan results go to `BarList`, where the row's own label carries its identity.
 */
export function DonutChart({
  items,
  format,
  centreLabel,
  className,
}: {
  items: LabelValue[];
  format: Formatter;
  /** The noun under the total in the hole, e.g. "bookings". */
  centreLabel: string;
  className?: string;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) {
    return <p className={cn('text-body-sm text-muted-foreground', className)}>Nothing yet.</p>;
  }

  let offset = 0;
  const arcs = items.map((item) => {
    const dash = (item.value / total) * DONUT_CIRCUMFERENCE;
    const arc = (
      <circle
        key={item.label}
        cx={DONUT_BOX / 2}
        cy={DONUT_BOX / 2}
        r={DONUT_R}
        fill="none"
        strokeWidth={DONUT_STROKE}
        stroke="currentColor"
        className={INK[statusTone(item.label)]}
        // Clamped so a one-booking slice survives the gap instead of vanishing.
        strokeDasharray={`${Math.max(dash - SLICE_GAP, 1)} ${DONUT_CIRCUMFERENCE - Math.max(dash - SLICE_GAP, 1)}`}
        strokeDashoffset={-offset}
      />
    );
    offset += dash;
    return arc;
  });

  return (
    <div className={cn('flex flex-wrap items-center gap-stack-lg', className)}>
      <div className="relative size-32 shrink-0">
        <svg
          viewBox={`0 0 ${DONUT_BOX} ${DONUT_BOX}`}
          className="size-full -rotate-90"
          role="img"
          aria-label={`${format(total)} across ${items.length} states: ${items
            .map((item) => `${humanise(item.label)} ${format(item.value)}`)
            .join(', ')}.`}
        >
          {arcs}
        </svg>
        {/* The hole was empty. On an operations screen that is the cheapest
            place on the page to put the number the slices are shares of. */}
        <span
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          aria-hidden
        >
          <span className="text-h4 tabular-nums text-foreground">{format(total)}</span>
          <span className="text-caption text-muted-foreground">{centreLabel}</span>
        </span>
      </div>

      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-body-sm">
            <span
              className={cn('size-2.5 shrink-0 rounded-full', FILL[statusTone(item.label)])}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate capitalize text-foreground">
              {humanise(item.label)}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">{format(item.value)}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
              {Math.round((item.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ gauge */

const GAUGE_BOX = 132;
const GAUGE_STROKE = 10;
const GAUGE_R = (GAUGE_BOX - GAUGE_STROKE) / 2;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

/**
 * One proportion, as a ring — used where the proportion IS the screen's answer
 * and deserves the room a bar would not take.
 *
 * Deliberately the neutral `measure` violet and never green: on the check-in
 * screen a green ring sitting beside a green "let them in" band would read as a
 * verdict about the person at the gate rather than as a count of the room.
 */
export function Gauge({
  ratio,
  label,
  tone = 'measure',
  className,
}: {
  /** 0–1, clamped. */
  ratio: number;
  /** The accessible summary, e.g. "412 of 900 admitted". */
  label: string;
  tone?: SeriesTone;
  className?: string;
}) {
  const filled = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return (
    <svg
      viewBox={`0 0 ${GAUGE_BOX} ${GAUGE_BOX}`}
      className={cn('size-32', className)}
      role="img"
      aria-label={label}
    >
      <circle
        cx={GAUGE_BOX / 2}
        cy={GAUGE_BOX / 2}
        r={GAUGE_R}
        fill="none"
        strokeWidth={GAUGE_STROKE}
        className="stroke-muted"
      />
      <circle
        cx={GAUGE_BOX / 2}
        cy={GAUGE_BOX / 2}
        r={GAUGE_R}
        fill="none"
        strokeWidth={GAUGE_STROKE}
        strokeLinecap="round"
        strokeDasharray={GAUGE_C}
        strokeDashoffset={GAUGE_C * (1 - filled)}
        transform={`rotate(-90 ${GAUGE_BOX / 2} ${GAUGE_BOX / 2})`}
        stroke="currentColor"
        className={cn(
          INK[tone],
          'transition-[stroke-dashoffset] duration-base ease-out motion-reduce:transition-none',
        )}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ table */

/** The numbers behind a chart, for anyone who cannot see it. */
function SeriesTable({ caption, rows }: { caption: string; rows: [string, string][] }) {
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
