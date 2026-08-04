'use client';

import * as React from 'react';
import type { CurrentPhase } from '@/lib/api/types';
import { formatEventDateTime, formatFromPrice } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';

/**
 * How a live sale phase is presented — ONE implementation, two surfaces.
 *
 * The event page's ticket panel and the funnel's tier picker both have to say
 * the same three things about a phase, and it deliberately does not live in
 * either directory: two copies of a countdown is two hydration bugs, and this is
 * a component whose entire job is to not tell a lie about money.
 *
 * ── EVERY CLAIM COMES FROM A FIELD, OR IS NOT MADE ────────────────────────
 *
 * - `Only N left at this price` renders ONLY when `remaining` is non-null. A
 *   seat-unbounded phase has no count and the backend refuses to invent one
 *   (`PhaseState.remaining`), so neither does this — the deadline is what bounds
 *   it and the deadline is what gets shown.
 * - The rise line renders ONLY from a real `ends_at`. No `ends_at` means the
 *   phase is bounded by seats alone; a countdown there would be manufactured
 *   urgency, which is the one thing this codebase refuses to put next to a price.
 * - When `next_price` is absent the sentence says the price ENDS rather than
 *   naming a number nobody sent.
 *
 * ── HYDRATION-SAFE THE SAME WAY THE EVENT COUNTDOWN IS ────────────────────
 *
 * The server cannot know the reader's clock, so the first client render produces
 * exactly the markup the server did — the absolute deadline, formatted in the
 * platform's fixed timezone (IST, see `lib/discovery/format.ts`) so both sides
 * agree to the character. The relative part ("in 1d 22h") is state that starts
 * `null` and is filled on the first tick after mount, exactly as
 * `components/event/countdown.tsx` does it. Deriving it during render is how a
 * countdown ends up flashing a wrong value that React silently patches over.
 *
 * It ticks once a MINUTE: a phase deadline is hours or days away, and a
 * per-second wake-up for a number at that resolution is battery, not
 * information. The interval clears itself once the deadline passes.
 */

/** The phase's name, as a quiet pill. A discount is genuinely good news, so it
 *  reaches for the success tint rather than the wayfinding violet — which this
 *  page reserves for the countdown and for selection. */
export function PhaseBadge({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-success-subtle px-2 py-0.5 text-caption text-success-subtle-foreground',
        className,
      )}
    >
      {name}
    </span>
  );
}

/**
 * What is true about the phase, in sentences.
 *
 * Renders `<span>`s rather than `<p>`s on purpose: in the event page's panel
 * this sits inside the tier `<button>`, whose content model is phrasing content
 * only — a paragraph in there is invalid markup that browsers silently reflow.
 */
export function PhaseNotes({
  phase,
  nextPrice,
  className,
}: {
  phase: CurrentPhase;
  /** Minor units. Null when the backend named no next price — then the sentence
   *  says the price ends, and does not guess what it becomes. */
  nextPrice: number | null;
  className?: string;
}) {
  const remainder = useDeadlineRemainder(phase.ends_at);
  const nextLabel = nextPrice === null ? null : formatFromPrice(nextPrice);

  if (phase.remaining === null && !phase.ends_at) return null;

  return (
    <span className={cn('flex flex-col gap-0.5', className)}>
      {phase.remaining !== null ? (
        <span className="text-caption text-warning-subtle-foreground">
          {phase.remaining === 1
            ? 'Last ticket at this price'
            : `Only ${phase.remaining} left at this price`}
        </span>
      ) : null}
      {phase.ends_at ? (
        <span className="text-caption text-muted-foreground">
          {remainder === 'ended'
            ? 'This price has just ended.'
            : `${
                nextLabel ? `Prices rise to ${nextLabel}` : 'This price ends'
              } on ${formatEventDateTime(phase.ends_at)}${remainder ? ` — ${remainder}` : ''}`}
        </span>
      ) : null}
    </span>
  );
}

/**
 * "in 1d 22h" for a deadline, or `'ended'` once it passes — and `null` until the
 * first tick after mount, which is what keeps the server and client renders
 * identical.
 */
function useDeadlineRemainder(endsAt: string | null): string | null | 'ended' {
  const target = React.useMemo(() => (endsAt ? Date.parse(endsAt) : Number.NaN), [endsAt]);
  const [remainder, setRemainder] = React.useState<string | null | 'ended'>(null);

  React.useEffect(() => {
    if (Number.isNaN(target)) return;
    const tick = () => {
      const ms = target - Date.now();
      // The tier read is `no-store` and refetches on a timer, so an expiry that
      // lands while the page is open corrects itself within the minute. Saying
      // so is better than counting down past zero.
      if (ms <= 0) {
        setRemainder('ended');
        return true;
      }
      setRemainder(relative(ms));
      return false;
    };
    if (tick()) return;
    const timer = window.setInterval(() => {
      if (tick()) window.clearInterval(timer);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [target]);

  return remainder;
}

function relative(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor(minutes / 60) % 24;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  // Under a minute is "any moment now" rather than "in 0m", which reads as a
  // rendering fault at exactly the moment somebody is deciding.
  return minutes > 0 ? `in ${minutes}m` : 'any moment now';
}
