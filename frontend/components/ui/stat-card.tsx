import * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Skeleton } from './skeleton';

/**
 * StatCard — one headline number, optionally with the direction it moved.
 *
 * ── UP IS NOT AUTOMATICALLY GOOD ─────────────────────────────────────────
 *
 * The obvious implementation colours a positive change green. On an organizer
 * dashboard that paints "Refunds +20%" and "Failed payouts +3" in the same
 * reassuring green as "Revenue +20%", which is the one reading an operator must
 * never take from a glance. `invertTrend` says which way is the GOOD way for
 * this particular measure, and the colour follows that rather than the sign.
 *
 * ── A MISSING TREND RENDERS NOTHING ──────────────────────────────────────
 *
 * "We have no earlier period to compare against" and "it did not move" are
 * different facts, and the second one is a real measurement. So `trend`
 * undefined draws no trend at all — never `0%`, never an em dash, because both
 * of those are a claim about the business. `trend.value === 0` IS flat, and
 * gets the neutral treatment its own state deserves.
 *
 * ── THE HEIGHT IS FIXED BY CONSTRUCTION ──────────────────────────────────
 *
 * Three rows, always: label (16px), value (32px), footer (16px). The footer is
 * reserved even when there is neither a trend nor a hint, which is what lets
 * `StatCardSkeleton` promise the same height and what keeps a row of cards
 * flush when only some of them carry a trend. Label and value `truncate` for
 * the same reason — a value that wrapped to a second line would break the
 * promise the moment a number got long, which is exactly when a dashboard is
 * being watched.
 */

export interface StatCardTrend {
  /**
   * The signed change against the comparison period. Its SIGN chooses the
   * direction and the colour; its magnitude is what gets printed. A number,
   * not a formatted string, because the direction has to be derivable — a
   * caller handing us "+12%" would leave us parsing text to pick a colour.
   */
  value: number;
  /** What the change is measured against — "vs last week". */
  label?: string;
  /** Printed after the magnitude. Percent unless a measure says otherwise. */
  unit?: string;
}

export interface StatCardProps {
  /** What the number is. Kept short — it truncates. */
  label: string;
  /**
   * The number itself, ALREADY FORMATTED by the caller. Currency, locale and
   * unit decisions belong with whoever knows what the figure means; this card
   * only has to render it without jitter.
   */
  value: React.ReactNode;
  /** A second fact about the figure — "across 4 events". Optional. */
  hint?: string;
  /** Omit entirely when there is no comparison period. See the note above. */
  trend?: StatCardTrend | null;
  /** Set for measures where DOWN is the good direction: refunds, no-shows. */
  invertTrend?: boolean;
  /**
   * A rendered element, never a component reference — this card is used from
   * server components, and a function cannot cross that boundary (it fails as
   * "Functions cannot be passed directly to Client Components", taking the
   * whole page down rather than losing an icon).
   */
  icon?: React.ReactNode;
  /** Makes the whole card the link target, with a visible affordance. */
  href?: string;
  className?: string;
}

/**
 * `bg-surface` alone is invisible on the light theme's white canvas — a card
 * separates with a hairline plus a soft shadow, and carries the ladder's value
 * step in dark. Written once here so the skeleton cannot drift from the card.
 */
const CARD_SURFACE =
  'flex h-full flex-col gap-1.5 rounded-xl border border-border bg-surface p-card shadow-sm';

/** The three fixed row heights the skeleton has to match. */
const LABEL_ROW = 'flex h-4 items-center gap-1.5 text-caption text-muted-foreground';
const VALUE_ROW = 'h-8 truncate text-h3 tabular-nums text-foreground';
const FOOTER_ROW = 'flex h-4 items-center gap-2 text-caption';

export function StatCard({
  label,
  value,
  hint,
  trend,
  invertTrend = false,
  icon,
  href,
  className,
}: StatCardProps) {
  const body = (
    <>
      <span className={LABEL_ROW}>
        {icon ? (
          <span className="flex shrink-0 items-center" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate uppercase tracking-wide">{label}</span>
        {/* Visible, not hover-only: which cards open a screen is something you
            should be able to see without dragging a mouse across all of them. */}
        {href ? (
          <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-foreground-subtle" aria-hidden />
        ) : null}
      </span>

      {/* `tabular-nums`: a row of these updates on a poll, and proportional
          digits change width as the value changes, so the whole row twitches. */}
      <span className={VALUE_ROW}>{value}</span>

      <span className={FOOTER_ROW}>
        {trend ? <Trend trend={trend} invert={invertTrend} /> : null}
        {hint ? <span className="min-w-0 truncate text-muted-foreground">{hint}</span> : null}
      </span>
    </>
  );

  if (!href) {
    return <div className={cn(CARD_SURFACE, className)}>{body}</div>;
  }

  return (
    <Link
      href={href}
      className={cn(
        'group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      {/* Colour on hover, never a lift: a card that moves displaces the number
          somebody is in the middle of reading. */}
      <div
        className={cn(
          CARD_SURFACE,
          'transition-colors duration-fast ease-out group-hover:border-border-strong group-hover:bg-sunken motion-reduce:transition-none',
        )}
      >
        {body}
      </div>
    </Link>
  );
}

function Trend({ trend, invert }: { trend: StatCardTrend; invert: boolean }) {
  const { value, label, unit = '%' } = trend;

  if (value === 0) {
    return (
      <span className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground">
        <Minus className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">No change,</span>
        {`0${unit}`}
        {label ? <span className="truncate">{label}</span> : null}
      </span>
    );
  }

  const up = value > 0;
  // The whole point of the component: the SIGN says which way, `invert` says
  // which way is good, and only the second one may pick the colour.
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 tabular-nums',
        good ? 'text-success' : 'text-destructive',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {/* The arrow is decorative, so the direction has to reach a screen
          reader as words — otherwise "12%" is read with no direction at all. */}
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      {`${Math.abs(value)}${unit}`}
      {label ? <span className="truncate text-muted-foreground">{label}</span> : null}
    </span>
  );
}

/**
 * The loading shape. Same surface, same three row heights — so the grid does
 * not jump by a row's worth of pixels the moment the data lands, which is the
 * one thing a skeleton exists to prevent and the one thing an eyeballed
 * skeleton always gets wrong.
 */
export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(CARD_SURFACE, className)} aria-hidden>
      <span className={LABEL_ROW}>
        <Skeleton className="h-3 w-24" />
      </span>
      <span className={cn(VALUE_ROW, 'flex items-center')}>
        <Skeleton className="h-6 w-20" />
      </span>
      <span className={FOOTER_ROW}>
        <Skeleton className="h-3 w-28" />
      </span>
    </div>
  );
}
