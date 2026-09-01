'use client';

import * as React from 'react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * How long the reserved tickets are actually held.
 *
 * This is the one piece of urgency on the whole funnel, and it is the only kind
 * worth showing: a real deadline the backend will really act on. `hold_expires_at`
 * comes from the booking row, and when it passes a sweeper releases the
 * inventory and marks the booking expired. Nothing here is a persuasion device.
 *
 * It is deliberately calm below five minutes and only warns near the end —
 * a timer that is red from the first second trains people to ignore it.
 *
 * Hydration-safe by the same rule as the event countdown: the server can't know
 * the client's clock, so the first client render matches the server's (a dash)
 * and the digits arrive on the first tick.
 *
 * ── THE ONE PLACE THE FUNNEL SPENDS ITS ACCENT ────────────────────────────
 *
 * The light-first language reserves the wayfinding violet for a handful of
 * jobs, and "a timer banner's tint" is explicitly one of them — so the calm
 * state is a 10% `--primary` wash with a violet clock glyph and INK text
 * (5.0:1 and up on the tint in light, 5.3:1 in dark; the ink is 15:1, and it
 * is the ink that carries the words). It used to be `bg-muted`, which put the
 * only genuinely time-sensitive thing on the screen in the same grey as a
 * disabled control.
 *
 * The escalation is unchanged and still semantic, not decorative: neutral
 * accent → `--warning-subtle` under two minutes → `--destructive-subtle` once
 * it has lapsed. A timer that is red from the first second trains people to
 * ignore it.
 */

const WARN_AT_SECONDS = 120;

export function HoldTimer({
  expiresAt,
  variant = 'card',
  className,
}: {
  expiresAt: string;
  /**
   * `card` — a bordered pill inside a column of content.
   * `bar`  — full width, flush under the checkout header, no rounding.
   *
   * The bar exists because the deadline is the only thing on the review screen
   * that runs out. Inside a card it read as one more fact about the order; as a
   * band across the top it reads as the state of the screen, which is what it
   * is.
   */
  variant?: 'card' | 'bar';
  className?: string;
}) {
  const target = React.useMemo(() => Date.parse(expiresAt), [expiresAt]);
  const [left, setLeft] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => {
      const seconds = Math.max(0, Math.round((target - Date.now()) / 1000));
      setLeft(seconds);
      return seconds;
    };
    if (tick() <= 0) return;
    const timer = window.setInterval(() => {
      if (tick() <= 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  const expired = left !== null && left <= 0;
  const warning = left !== null && left > 0 && left <= WARN_AT_SECONDS;
  const label =
    left === null ? '—' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-3 py-2.5 text-body-sm',
        variant === 'card' ? 'rounded-lg border' : 'justify-center border-b',
        expired
          ? 'border-destructive-subtle bg-destructive-subtle text-destructive-subtle-foreground'
          : warning
            ? 'border-warning-subtle bg-warning-subtle text-warning-subtle-foreground'
            : 'border-border bg-sunken text-foreground',
        className,
      )}
      // Polite and coarse: announcing every second would make the page unusable
      // with a screen reader, so the text below carries the state, not the count.
      role="status"
      aria-live="polite"
    >
      <Timer
        className={cn('size-4 shrink-0', !expired && !warning && 'text-primary')}
        aria-hidden
      />
      {expired ? (
        <span>Your hold has expired — these tickets have been released.</span>
      ) : (
        <span>
          Complete your booking in{' '}
          <span
            className={cn(
              'font-semibold tabular-nums',
              !warning && 'text-success-subtle-foreground',
            )}
          >
            {label}
          </span>{' '}
          mins
        </span>
      )}
    </div>
  );
}
