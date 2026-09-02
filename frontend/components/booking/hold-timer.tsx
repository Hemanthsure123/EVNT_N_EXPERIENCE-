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
 * Hydration-safe by the same rule as the event countdown: the server can't know
 * the client's clock, so the first client render matches the server's (a dash)
 * and the digits arrive on the first tick.
 *
 * ── THE BAR WAS PRESENT AND UNREADABLE, WHICH IS THE SAME AS ABSENT ───────
 *
 * Two faults, and each alone was nearly enough to make people report that the
 * review screen had no countdown at all:
 *
 * 1. **It scrolled away.** It sat under a sticky header without being sticky
 *    itself, so it left the viewport within one flick — and everything below it
 *    (the order, the total, the donation, the pay button) is exactly where
 *    somebody spends the ten minutes it is counting. A deadline you can scroll
 *    away from is not a deadline; it is a fact you were shown once. It now
 *    travels with the header.
 *
 * 2. **It was white on white.** `bg-sunken` over the page background is a real
 *    step in dark theme and a NO-OP in light, where the background, the surface
 *    and the sunken well are all effectively white — the same trap
 *    `tier-picker`'s rank ladder hit. The calm state is a `--primary` wash now,
 *    which is a value the light theme genuinely has.
 *
 * ── AND IT SHOWS TIME THE WAY TIME IS READ ────────────────────────────────
 *
 * A depleting rule under the text, so the state is answerable at a glance
 * without parsing digits — the thing a progress bar is actually good at. It is
 * driven off the same `left` the label is, so the two can never disagree, and
 * it is `aria-hidden` because the sentence above it already says the number.
 *
 * `tabular-nums` on the digits is not cosmetic: without it "9:59" and "9:11"
 * are different widths and the whole line jitters once a second, directly under
 * the reader's eye.
 *
 * ── THE ESCALATION IS SEMANTIC, NOT DECORATIVE ────────────────────────────
 *
 * Calm accent → `--warning-subtle` under two minutes → `--destructive-subtle`
 * once it has lapsed. A timer that is red from the first second trains people
 * to ignore it, which costs exactly the moment it was built for.
 *
 * `aria-live` stays POLITE and the text stays coarse. Announcing every second
 * would make the screen unusable with a screen reader; the sentence carries the
 * state, the digits are detail.
 */

const WARN_AT_SECONDS = 120;
/** The window a full hold covers, for the depleting rule. Mirrors BOOKING_HOLD_MINUTES. */
const HOLD_SECONDS = 600;

export function HoldTimer({
  expiresAt,
  variant = 'card',
  onExpire,
  className,
}: {
  expiresAt: string;
  /**
   * Fired ONCE, on the tick that crosses zero.
   *
   * Without it this component knew the hold had lapsed and nobody else did:
   * the review screen kept a live Pay button beside a band reading "these
   * tickets have been released". Pressing it would have created a payment
   * order against inventory that no longer existed — the webhook finds
   * `hold_expired`, refuses to issue, and auto-refunds, so money leaves an
   * account and comes back days later with no ticket. That is the exact
   * outcome the payments module exists to prevent, reached through the front
   * door of the UI.
   *
   * Guarded by a ref rather than fired from render, because the interval keeps
   * ticking for one more beat and a parent that navigates on this must not be
   * told twice.
   */
  onExpire?: () => void;
  /**
   * `card` — a bordered pill inside a column of content.
   * `bar`  — full width, pinned under the checkout header.
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

  // `onExpire` in a ref so a caller that re-creates the callback each render
  // does not restart the interval — which would reset the countdown to a full
  // minute on every keystroke elsewhere on the screen.
  const onExpireRef = React.useRef(onExpire);
  onExpireRef.current = onExpire;
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    firedRef.current = false;
    const announce = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      onExpireRef.current?.();
    };
    const tick = () => {
      const seconds = Math.max(0, Math.round((target - Date.now()) / 1000));
      setLeft(seconds);
      return seconds;
    };
    // An ALREADY-lapsed hold still has to announce itself. This is the case a
    // reload lands in — the row says expired the moment the page opens, and
    // returning early here left that screen payable.
    if (tick() <= 0) {
      announce();
      return;
    }
    const timer = window.setInterval(() => {
      if (tick() <= 0) {
        window.clearInterval(timer);
        announce();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  const expired = left !== null && left <= 0;
  const warning = left !== null && left > 0 && left <= WARN_AT_SECONDS;
  const label =
    left === null ? '—:——' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  // Clamped both ways: a hold longer than the nominal window (a config change,
  // a clock skew) must not draw a rule wider than its track.
  const remaining = left === null ? 1 : Math.min(Math.max(left / HOLD_SECONDS, 0), 1);

  const tone = expired
    ? 'border-destructive-subtle bg-destructive-subtle text-destructive-subtle-foreground'
    : warning
      ? 'border-warning-subtle bg-warning-subtle text-warning-subtle-foreground'
      : // A `--primary` wash, not `bg-sunken`: see the note above. The INK is
        // what carries the words (15:1); the tint only says which state this is.
        'border-primary/25 bg-primary/10 text-foreground';

  const body = (
    <>
      <Timer
        className={cn(
          'size-4 shrink-0',
          !expired && !warning && 'text-primary',
          // The only motion here, and only when it is nearly out — a pulsing
          // icon for ten minutes is decoration; for the last two it is the
          // point. Off entirely under reduced motion.
          warning && 'motion-safe:animate-pulse',
        )}
        aria-hidden
      />
      {expired ? (
        <span>Your hold has expired — these tickets have been released.</span>
      ) : (
        <span>
          Complete your booking in{' '}
          <span className="font-semibold tabular-nums">{label}</span> mins
        </span>
      )}
    </>
  );

  if (variant === 'card') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-body-sm', tone, className)}
      >
        {body}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('relative border-b text-body-sm', tone, className)}
    >
      <div className="mx-auto flex w-full max-w-2xl items-center justify-center gap-2.5 px-4 py-2.5 sm:px-6">
        {body}
      </div>
      {/* The rule sits ON the band's bottom edge rather than under it, so the
          band's height never changes as the fill shrinks — a bar that resized
          itself would nudge the whole page up once a second. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
        <div
          className={cn(
            'h-full origin-left transition-[width] duration-1000 ease-linear',
            expired ? 'bg-destructive' : warning ? 'bg-warning' : 'bg-primary',
          )}
          style={{ width: `${remaining * 100}%` }}
        />
      </div>
    </div>
  );
}
