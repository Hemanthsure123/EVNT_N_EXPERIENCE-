import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * A horizontal meter: sell-through, check-in progress, setup readiness.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * The identical eleven lines of markup — a `bg-muted` track, a `bg-primary`
 * fill, four ARIA attributes and a `Math.min(100, …)` clamp — were written out
 * by hand in `dashboard-home`, `events-table`, `event-wizard`, `media-step`,
 * `crew` and the performer analytics screen. Six copies of a meter is six
 * chances for one of them to forget `aria-valuenow` (which makes it an
 * unlabelled progressbar), to drop the clamp (which lets a fill overrun its
 * track when a count exceeds its capacity), or to drift a track height.
 *
 * The classes here are copied verbatim from those call sites, so adopting it
 * changes nothing that renders.
 *
 * ── VIOLET IS A DATA MARK HERE, NOT A CONTROL ────────────────────────────
 *
 * `bg-primary` on a meter is the wayfinding accent's other legitimate job: a
 * meter is READ, never pressed. That note was in most of the copies and is
 * kept because it is the question somebody will ask when they see the accent
 * on something that is not a button.
 *
 * ── `segments` IS A DIFFERENT QUESTION FROM `value` ──────────────────────
 *
 * A continuous fill answers "how full" (78% of capacity). Discrete segments
 * answer "how many steps of how many" (3 of 5 done), and drawing that as a
 * continuous 60% bar invites somebody to read a fraction of a step. Where the
 * underlying thing is countable and small, count it.
 */

export interface ProgressBarProps {
  /** 0–1. Clamped, so a count larger than its capacity cannot overrun. */
  value: number;
  /**
   * REQUIRED. A bare meter announces as "progressbar, 78%" with no subject —
   * the number is the least useful half of "384 of 500 checked in".
   */
  'aria-label': string;
  /** Track thickness. `sm` is the row meter, `md` the card-level one. */
  size?: 'sm' | 'md';
  /**
   * Draw N discrete pips instead of one continuous fill, filling
   * `round(value * segments)` of them. For countable steps — see the note
   * above.
   */
  segments?: number;
  /** Overrides the fill colour for a meter that is not measuring progress. */
  fillClassName?: string;
  className?: string;
}

const TRACK: Record<'sm' | 'md', string> = {
  sm: 'h-1.5',
  md: 'h-2',
};

export function ProgressBar({
  value,
  'aria-label': ariaLabel,
  size = 'sm',
  segments,
  fillClassName,
  className,
}: ProgressBarProps) {
  // Clamped at BOTH ends. A negative value comes from a bad subtraction rather
  // than from real data, and it renders as a fill growing leftwards out of its
  // track — visible, unexplainable, and worse than showing zero.
  const ratio = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const percent = Math.round(ratio * 100);

  if (segments && segments > 0) {
    const done = Math.round(ratio * segments);
    return (
      <span
        className={cn('flex items-center gap-1', className)}
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={segments}
        aria-label={ariaLabel}
      >
        {Array.from({ length: segments }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-1.5 min-w-0 flex-1 rounded-full',
              index < done ? (fillClassName ?? 'bg-primary') : 'bg-muted',
            )}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      className={cn('block overflow-hidden rounded-full bg-muted', TRACK[size], className)}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-base ease-out motion-reduce:transition-none',
          fillClassName ?? 'bg-primary',
        )}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}
