'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Time until doors, ticking once a second.
 *
 * HYDRATION-SAFE by construction: the server cannot know the client's clock, so
 * the first client render deliberately produces the SAME markup the server did
 * — a reserved, empty frame — and the digits appear on the first tick after
 * mount. The alternative (render `Date.now()` during render) mismatches on
 * every load and React silently patches it, which is how countdowns end up
 * flashing a wrong value.
 *
 * NO FLASHING, two ways. The boxes are sized and present before the numbers
 * arrive, so nothing moves when they do; and each value is `tabular-nums`, so
 * 9→10 doesn't shift the digits beside it. The transition is on colour only —
 * animating a number that changes every second is noise, not motion.
 *
 * The interval is cleared when the event starts, so a page left open overnight
 * isn't still running a timer against a date in the past.
 *
 * THIS IS THE PAGE'S ONE VIOLET. The light-first language keeps the accent for
 * wayfinding, and a timer's tint is named as one of the sanctioned uses — so
 * the clock wears a faint `--primary` wash and a violet label, and nothing else
 * below the photograph is coloured at all. The digits themselves stay
 * `--foreground` on that wash (a violet number would be the least legible thing
 * on the page and it is the thing people are here to read).
 */

type Remaining = { days: number; hours: number; minutes: number; seconds: number } | null;

function remainingFrom(target: number, now: number): Remaining {
  const ms = target - now;
  if (ms <= 0) return null;
  const seconds = Math.floor(ms / 1000);
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

export function Countdown({ startsAt, className }: { startsAt: string; className?: string }) {
  const target = React.useMemo(() => Date.parse(startsAt), [startsAt]);
  const [remaining, setRemaining] = React.useState<Remaining>(null);
  const [started, setStarted] = React.useState(false);

  React.useEffect(() => {
    const tick = () => {
      const next = remainingFrom(target, Date.now());
      setRemaining(next);
      setStarted(next === null);
      return next;
    };
    if (tick() === null) return;
    const timer = window.setInterval(() => {
      if (tick() === null) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  if (started) {
    return (
      <p className={cn('text-body-sm text-muted-foreground', className)}>
        This event has already started.
      </p>
    );
  }

  const units: { label: string; value: number | null }[] = [
    { label: 'days', value: remaining?.days ?? null },
    { label: 'hrs', value: remaining?.hours ?? null },
    { label: 'min', value: remaining?.minutes ?? null },
    { label: 'sec', value: remaining?.seconds ?? null },
  ];

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="text-caption uppercase tracking-wide text-primary">Starts in</p>
      {/* One polite live region for the whole clock, updated coarsely — a
          per-second announcement would make a screen reader unusable, so the
          digits themselves are hidden from it and this sentence carries the
          meaning. */}
      <p className="sr-only" role="status">
        {remaining
          ? `Starts in ${remaining.days} days, ${remaining.hours} hours and ${remaining.minutes} minutes`
          : 'Loading countdown'}
      </p>
      <div className="flex items-stretch gap-2" aria-hidden>
        {units.map((unit) => (
          <div
            key={unit.label}
            className="flex min-w-14 flex-col items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2"
          >
            <span className="text-h3 tabular-nums leading-none text-foreground">
              {unit.value === null ? '—' : String(unit.value).padStart(2, '0')}
            </span>
            <span className="text-caption uppercase tracking-wide text-muted-foreground">
              {unit.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
