import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * ProgressRing — a percentage drawn as a circular arc (quota fill, profile
 * completeness, capacity sold).
 *
 * Plain SVG and design tokens, like the dashboard charts: a ring is a few
 * lines of arithmetic, and a charting library would arrive with its own colour
 * system to be fought back into this one. Colour comes from `currentColor` plus
 * a token text class, so both themes are handled by the tokens rather than by
 * a value that happened to look right on the theme it was authored in.
 *
 * ── THE ARITHMETIC IS A PURE FUNCTION, ON PURPOSE ────────────────────────
 *
 * `progressRingGeometry` is exported and unit-tested separately from the
 * component. Its failure cases — a value over 100, a negative one, a `NaN`
 * arriving from a division by a zero denominator — are the ones that are
 * invisible by looking at a ring that renders: an unclamped 140% draws an arc
 * that has wrapped past its own start and reads as 40%, which is a confident
 * lie rather than a broken-looking picture.
 */

/** The tone vocabulary the dashboard charts already use. */
export type ProgressRingTone = 'measure' | 'positive' | 'notice' | 'negative' | 'neutral';

/**
 * `measure` (the wayfinding violet) is the default and the only tone a plain
 * "how full is this" ring ever needs. The rest are the semantic STATES — reach
 * for `negative` because something is wrong, never because you want a fourth
 * colour.
 */
const TONE_STROKE: Record<ProgressRingTone, string> = {
  measure: 'text-primary',
  positive: 'text-success',
  notice: 'text-warning',
  negative: 'text-destructive',
  neutral: 'text-foreground-subtle',
};

export interface ProgressRingGeometry {
  /** The clamped, finite percentage actually drawn. */
  value: number;
  /** Radius of the stroked circle's centre line. */
  radius: number;
  circumference: number;
  /** `stroke-dashoffset` for the value arc — full circumference at 0%. */
  dashOffset: number;
}

/**
 * Turn a percentage into the numbers an SVG circle needs.
 *
 * Every input is CLAMPED rather than trusted. `value` is a percentage computed
 * upstream — `used / quota * 100` is `NaN` when the quota is zero and can
 * exceed 100 the moment an allowance is overrun — and both of those reach the
 * arc as a nonsense `stroke-dashoffset` that still renders.
 *
 * The stroke is clamped to the box for the same reason: a stroke wider than
 * the ring gives a negative radius, and a negative radius makes the browser
 * drop the circle entirely, so the ring silently disappears instead of looking
 * wrong.
 */
export function progressRingGeometry(
  value: number,
  size: number,
  strokeWidth: number,
): ProgressRingGeometry {
  const percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  const box = Number.isFinite(size) && size > 0 ? size : 0;
  const stroke = Number.isFinite(strokeWidth) && strokeWidth > 0 ? Math.min(strokeWidth, box) : 0;
  const radius = Math.max((box - stroke) / 2, 0);
  const circumference = 2 * Math.PI * radius;

  return {
    value: percent,
    radius,
    circumference,
    dashOffset: circumference * (1 - percent / 100),
  };
}

export interface ProgressRingProps {
  /** A percentage, 0–100. Anything outside that (or `NaN`) is clamped. */
  value: number;
  /**
   * What the ring MEASURES — "Profile completeness", "Tickets sold". Required,
   * and the percentage is appended to it: the number drawn in the middle is a
   * picture, and a picture is not an accessible name.
   */
  label: string;
  /** Drawn inside the ring. Optional — a small ring has no room for text. */
  children?: React.ReactNode;
  /** Outer diameter in pixels. A number, because an SVG box needs one. */
  size?: number;
  strokeWidth?: number;
  tone?: ProgressRingTone;
  className?: string;
}

export function ProgressRing({
  value,
  label,
  children,
  size = 64,
  strokeWidth = 6,
  tone = 'measure',
  className,
}: ProgressRingProps) {
  const {
    value: percent,
    radius,
    circumference,
    dashOffset,
  } = progressRingGeometry(value, size, strokeWidth);
  const centre = size / 2;

  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label}: ${Math.round(percent)}%`}
        // Rotated so the arc starts at twelve o'clock, which is where a reader
        // expects a dial to begin.
        className="-rotate-90"
      >
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={cn(
            // The arc sweeps to its value; under `prefers-reduced-motion` it is
            // simply drawn there. A dial filling itself is decoration, and the
            // number it settles on is the whole content.
            'transition-[stroke-dashoffset] duration-slow ease-out motion-reduce:transition-none',
            TONE_STROKE[tone],
          )}
        />
      </svg>
      {children ? (
        // `aria-hidden`: the svg's own label already carries the figure, and
        // without this a screen reader reads the percentage twice.
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-label tabular-nums text-foreground"
        >
          {children}
        </span>
      ) : null}
    </div>
  );
}
