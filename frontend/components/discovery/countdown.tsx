'use client';

import * as React from 'react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Live countdown to an event that starts soon.
 *
 * Server-rendered as a static "starts in Xh", then upgraded to a ticking value
 * on the client — so the markup is correct before hydration and there is no
 * mismatch (the server and the first client render agree because both derive
 * from the same `starts_at`, rounded to the minute).
 *
 * It ticks once a MINUTE, not once a second: a per-second timer on a discovery
 * page is a wake-up every second for a number nobody is watching that closely.
 * It stops entirely once the event has started.
 */
function partsUntil(target: number, now: number) {
  const ms = Math.max(0, target - now);
  const totalMinutes = Math.floor(ms / 60_000);
  return {
    days: Math.floor(totalMinutes / (60 * 24)),
    hours: Math.floor(totalMinutes / 60) % 24,
    minutes: totalMinutes % 60,
    done: ms === 0,
  };
}

function label(target: number, now: number): string {
  const { days, hours, minutes, done } = partsUntil(target, now);
  if (done) return 'Starting now';
  if (days > 0) return `Starts in ${days}d ${hours}h`;
  if (hours > 0) return `Starts in ${hours}h ${minutes}m`;
  return `Starts in ${minutes}m`;
}

export function Countdown({ startsAt, className }: { startsAt: string; className?: string }) {
  const target = React.useMemo(() => Date.parse(startsAt), [startsAt]);
  // Minute-quantised so the server render and the first client render match.
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 60_000) * 60_000);

  React.useEffect(() => {
    if (Date.now() >= target) return;
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 60_000) * 60_000), 60_000);
    return () => window.clearInterval(id);
  }, [target]);

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 tabular-nums', className)}
      suppressHydrationWarning
    >
      <Timer className="size-3.5 shrink-0" aria-hidden />
      {label(target, now)}
    </span>
  );
}
