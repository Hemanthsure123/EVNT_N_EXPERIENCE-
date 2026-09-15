'use client';

import * as React from 'react';
import { CalendarDays, Clock, Info, Zap } from 'lucide-react';
import type { BookingWindowDay, EventAnalytics } from '@/lib/api/organizer';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils/cn';
import {
  CARD,
  CARD_PAD,
  DataPill,
  Section,
  StatCard,
  formatCount,
  formatDate,
  formatDay,
  plural,
} from './parts';

/**
 * WHEN people booked: the insights, and the booking-window chart.
 *
 * ── THE SERIES IS DENSE, AND THE RANGE IS CLIENT-SIDE ────────────────────
 *
 * The API sends every day from the event's creation to today (or to the show),
 * zeros included — a chart fed only the days that had a booking draws a climb
 * that never happened. The range control SLICES that series rather than asking
 * the server again: it is at most a year of small integers, and a range that
 * refetches is a chart that flickers on every press.
 *
 * ── SPOTS AND ORDERS ─────────────────────────────────────────────────────
 *
 * A spot is a seat — one person — and an order is a purchase that may carry
 * several. The toggle switches which one the LINE draws; the readout under the
 * chart always prints both, because "15 orders" means nothing without the 26
 * people in them.
 *
 * ── DRAWN AT THE CONTAINER'S REAL WIDTH ──────────────────────────────────
 *
 * Unlike the dashboard's sparklines, this chart carries point markers and value
 * labels, and a stretched SVG (`preserveAspectRatio="none"`) turns a circle into
 * an ellipse and a label into a smear. So it measures its container and draws
 * at one user unit per pixel.
 */

type Metric = 'seats' | 'orders';

const RANGES = [
  { value: 'all', label: 'Since event creation', days: null },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '14', label: 'Last 14 days', days: 14 },
  { value: '7', label: 'Last 7 days', days: 7 },
] as const;

type RangeValue = (typeof RANGES)[number]['value'];

export function BookingTrendsChart({ data }: { data: EventAnalytics }) {
  return (
    <>
      <BookingInsights data={data} />
      <BookingWindow series={data.booking_window} />
    </>
  );
}

/* ------------------------------------------------------------ the insights */

/**
 * A plain-words name for the late share. Fixed thresholds over the real
 * number, never a judgement about the organizer — and absent until the doors
 * open, because the final window has not finished happening before then.
 */
export function trendLabel(latePct: number | null): string | null {
  if (latePct === null) return null;
  if (latePct >= 60) return 'Last minute surge';
  if (latePct <= 25) return 'Booked well in advance';
  return 'Steady build-up';
}

function BookingInsights({ data }: { data: EventAnalytics }) {
  const insights = data.booking_insights;
  const period = insights.period_days;

  return (
    <Section icon={Clock} title="Booking Insights">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          icon={CalendarDays}
          label="First Booking Date"
          value={insights.first_booking_at ? formatDate(insights.first_booking_at) : '—'}
          caption={insights.first_booking_at ? 'Campaign kickoff' : 'Nothing booked yet'}
        />
        <StatCard
          icon={Clock}
          label="Booking Period"
          value={period === null ? '—' : period === 0 ? 'Same day' : plural(period, 'day')}
          caption="Active sales window"
        />
      </div>

      <StatCard
        icon={Zap}
        label="Booking Trend"
        value={
          insights.late_pct === null
            ? 'Not yet'
            : `${insights.late_pct}% bookings in last ${insights.late_window_hours} hrs`
        }
        caption={
          insights.late_pct === null
            ? 'Measured once the doors open'
            : trendLabel(insights.late_pct)
        }
      />
    </Section>
  );
}

/* ----------------------------------------------------------- the chart card */

function BookingWindow({ series }: { series: BookingWindowDay[] }) {
  const [metric, setMetric] = React.useState<Metric>('seats');
  const [range, setRange] = React.useState<RangeValue>('all');
  const rangeId = React.useId();

  const visible = React.useMemo(() => {
    const days = RANGES.find((option) => option.value === range)?.days ?? null;
    return days ? series.slice(-days) : series;
  }, [series, range]);

  const totalSeats = visible.reduce((sum, day) => sum + day.seats, 0);
  const peak = visible.reduce<BookingWindowDay | null>(
    (best, day) => (day.seats > 0 && (!best || day.seats > best.seats) ? day : best),
    null,
  );
  const average = visible.length ? totalSeats / visible.length : null;
  const first = visible[0];
  const last = visible[visible.length - 1];

  return (
    <section
      aria-label="Booking Window Trend"
      className={cn(CARD, CARD_PAD, 'flex flex-col gap-4')}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h4 font-semibold text-foreground">Booking Window Trend</h2>
        <DataPill>{plural(totalSeats, 'spot')}</DataPill>
      </div>

      <SegmentedControl
        aria-label="What the line shows"
        value={metric}
        onValueChange={(value) => setMetric(value as Metric)}
        options={[
          { value: 'seats', label: 'Spots per day' },
          { value: 'orders', label: 'Orders per day' },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label htmlFor={rangeId} className="text-body-sm text-foreground">
            Range
          </label>
          <select
            id={rangeId}
            value={range}
            onChange={(event) => setRange(event.target.value as RangeValue)}
            className="h-control rounded-xl border border-input bg-surface px-3 text-body-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {first && last ? (
          <DataPill>
            {first.date === last.date
              ? formatDay(first.date, { year: false })
              : `${formatDay(first.date, { year: false })} - ${formatDay(last.date, { year: false })}`}
          </DataPill>
        ) : null}
      </div>

      <WindowChart series={visible} metric={metric} peak={peak} />

      <div className="flex flex-col gap-2">
        <p className={cn('rounded-xl border border-border bg-sunken px-4 py-3 text-body-sm text-foreground')}>
          Peak Booking Date:{' '}
          {peak ? (
            <>
              <span className="font-semibold">{formatDay(peak.date)}</span>{' '}
              <span className="text-muted-foreground">({plural(peak.seats, 'spot')})</span>
            </>
          ) : (
            <span className="text-muted-foreground">nothing booked in this range</span>
          )}
        </p>
        <p className="rounded-xl border border-border bg-sunken px-4 py-3 text-body-sm text-foreground">
          Average Spots/Day:{' '}
          {average === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>
              <span className="font-semibold">{average.toFixed(1)} spots/day</span>{' '}
              <span className="text-muted-foreground">across {plural(visible.length, 'day')}</span>
            </>
          )}
        </p>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- the plot */

const HEIGHT = 220;
const PAD_LEFT = 36;
const PAD_RIGHT = 16;
const PAD_TOP = 28;
const PAD_BOTTOM = 34;
/** Below this many days every point carries its value; above it, only the chosen one. */
const LABEL_EVERY_POINT_UNDER = 15;
/** A date label needs about this much room. */
const X_LABEL_SPACING = 56;

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Five gridlines, evenly spaced up to the tallest day: 0, ¼, ½, ¾, max. */
export function yTicks(max: number): number[] {
  const top = Math.max(1, max);
  return [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(top * fraction));
}

function WindowChart({
  series,
  metric,
  peak,
}: {
  series: BookingWindowDay[];
  metric: Metric;
  peak: BookingWindowDay | null;
}) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = measured || 320;
  const gradientId = React.useId();

  const [selected, setSelected] = React.useState<number | null>(null);
  // Every new series (a range change, a new day) starts on the peak, or the
  // last day when nothing sold — the point a reader came to look at.
  const defaultIndex = React.useMemo(() => {
    if (!series.length) return null;
    const peakIndex = peak ? series.findIndex((day) => day.date === peak.date) : -1;
    return peakIndex >= 0 ? peakIndex : series.length - 1;
  }, [series, peak]);
  React.useEffect(() => setSelected(null), [series]);
  const active = selected ?? defaultIndex;

  if (!series.length) {
    return (
      <p className="rounded-xl border border-border p-4 text-body-sm text-muted-foreground">
        Nothing to chart yet.
      </p>
    );
  }

  const values = series.map((day) => (metric === 'seats' ? day.seats : day.orders));
  const ticks = yTicks(Math.max(...values, 0));
  const top = ticks[ticks.length - 1] ?? 1;
  const plotWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (index: number) =>
    PAD_LEFT + (series.length === 1 ? plotWidth / 2 : (index * plotWidth) / (series.length - 1));
  const y = (value: number) => PAD_TOP + plotHeight - (value / Math.max(top, 1)) * plotHeight;

  const line = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ');
  const baseline = PAD_TOP + plotHeight;
  const area = `${line} L${x(values.length - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;
  const labelStep = Math.max(1, Math.ceil(series.length / Math.max(1, Math.floor(plotWidth / X_LABEL_SPACING))));
  const unit = metric === 'seats' ? 'spots' : 'orders';
  const chosen = active !== null ? series[active] : undefined;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (active === null) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(Math.min(series.length - 1, active + 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected(Math.max(0, active - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSelected(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setSelected(series.length - 1);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:p-4">
      <span
        className="inline-flex w-fit items-center text-primary"
        title="Seats (spots) and purchases (orders) in paid bookings, by the Indian day each booking was made."
      >
        <Info className="size-5" aria-hidden />
        <span className="sr-only">
          Seats and purchases in paid bookings, by the Indian day each booking was made.
        </span>
      </span>

      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={`Booking window, ${unit} per day`}
        aria-valuemin={0}
        aria-valuemax={series.length - 1}
        aria-valuenow={active ?? 0}
        aria-valuetext={
          chosen
            ? `${formatDay(chosen.date)}: ${plural(chosen.orders, 'order')}, ${plural(chosen.seats, 'spot')}`
            : undefined
        }
        onKeyDown={onKeyDown}
        className="w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg width={width} height={HEIGHT} className="block text-primary" aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                x2={width - PAD_RIGHT}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-border"
                strokeDasharray="4 5"
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 10}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-caption tabular-nums"
              >
                {tick}
              </text>
            </g>
          ))}

          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {series.map((day, index) => {
            const value = values[index] ?? 0;
            const isActive = index === active;
            const showValue = series.length < LABEL_EVERY_POINT_UNDER || isActive;
            // The two ends always carry a date. A middle one only does when it
            // clears both by a label's width — the ends are anchored inward, so
            // a neighbour placed by `labelStep` alone collides with them.
            const isEnd = index === 0 || index === series.length - 1;
            const showDate =
              isEnd ||
              (index % labelStep === 0 &&
                x(index) - x(0) >= X_LABEL_SPACING &&
                x(series.length - 1) - x(index) >= X_LABEL_SPACING);
            return (
              <g key={day.date}>
                {showValue ? (
                  <text
                    x={x(index)}
                    y={y(value) - 12}
                    textAnchor="middle"
                    className="fill-foreground text-caption font-semibold tabular-nums"
                  >
                    {value}
                  </text>
                ) : null}
                <circle
                  cx={x(index)}
                  cy={y(value)}
                  r={isActive ? 6 : 4}
                  className={cn(isActive ? 'fill-primary' : 'fill-surface')}
                  stroke="currentColor"
                  strokeWidth={2}
                />
                {/* A generous invisible hit target: a 4px dot is not a thumb target. */}
                <circle
                  cx={x(index)}
                  cy={y(value)}
                  r={16}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={() => setSelected(index)}
                />
                {showDate ? (
                  <text
                    x={x(index)}
                    y={HEIGHT - 10}
                    // The ends are anchored INWARD: a centred label on the last
                    // point hangs half outside the plot and is clipped.
                    textAnchor={
                      series.length === 1
                        ? 'middle'
                        : index === 0
                          ? 'start'
                          : index === series.length - 1
                            ? 'end'
                            : 'middle'
                    }
                    className="fill-muted-foreground text-caption"
                  >
                    {formatDay(day.date, { year: false })}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {chosen ? (
        <p
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-border bg-sunken px-4 py-3 text-body-sm text-muted-foreground"
          aria-live="polite"
        >
          <span>
            Date: <span className="font-semibold text-foreground">{formatDay(chosen.date)}</span>
          </span>
          <span className="flex gap-4">
            <span>
              Orders: <span className="font-semibold tabular-nums text-foreground">{formatCount(chosen.orders)}</span>
            </span>
            <span>
              Spots: <span className="font-semibold tabular-nums text-foreground">{formatCount(chosen.seats)}</span>
            </span>
          </span>
        </p>
      ) : null}

      <table className="sr-only">
        <caption>Booking window, per day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Orders</th>
            <th scope="col">Spots</th>
          </tr>
        </thead>
        <tbody>
          {series.map((day) => (
            <tr key={day.date}>
              <th scope="row">{formatDay(day.date)}</th>
              <td>{day.orders}</td>
              <td>{day.seats}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
