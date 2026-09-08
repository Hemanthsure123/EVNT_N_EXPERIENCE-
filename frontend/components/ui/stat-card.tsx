import * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { ProgressBar } from './progress-bar';
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
 *
 * ── `emphasis` IS OPT-IN, AND THAT IS DELIBERATE ─────────────────────────
 *
 * The organizer's mobile dashboard wants a denser treatment: the icon in a
 * tinted badge at the far right instead of inline before the label, the trend
 * as a filled pill instead of coloured text, and a meter under the number.
 * That reads well in a two-up grid on a phone, where each card is about 160px
 * wide and the label needs the full width.
 *
 * It is a PROP rather than the new default because this component is also the
 * admin console's stat card, and quietly restyling every tile on a screen
 * nobody asked to change is how a layout refactor turns into a regression
 * hunt. `emphasis="badge"` is the organizer surface asking for it; every
 * existing caller keeps the layout it was written against, byte for byte.
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
  /**
   * `inline` (default) keeps the icon before the label and the trend as
   * coloured text — what every existing caller renders today.
   *
   * `badge` moves the icon into a tinted square at the far right and draws the
   * trend as a filled pill. See the note above for why this is not the
   * default.
   */
  emphasis?: 'inline' | 'badge';
  /**
   * A meter under the value, for a figure that is a fraction of a known whole
   * — tickets sold against capacity, guests admitted against issued.
   *
   * `value` is 0–1. `caption` and `trailing` sit at the two ends of the row
   * beneath it ("78% capacity" … "380 left"), because those are two different
   * facts and centring or concatenating them makes the reader parse a
   * sentence to find a number.
   *
   * OMITTED, not zeroed, when there is no denominator: a full-width empty
   * track under a real number reads as "none of them", which is a claim, and
   * `null` capacity means nobody has set up tickets yet.
   */
  progress?: { value: number; caption?: string; trailing?: string; label: string } | null;
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
  emphasis = 'inline',
  progress,
  className,
}: StatCardProps) {
  const badge = emphasis === 'badge';

  const body = (
    <>
      {/* The label row carries the icon at whichever end `emphasis` chose. In
          `badge` the icon leaves the text flow entirely, which is the point:
          in a two-up grid on a phone the label needs every pixel of width
          before it truncates. */}
      <span className={cn(LABEL_ROW, badge && 'items-start gap-2')}>
        {icon && !badge ? (
          <span className="flex shrink-0 items-center" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate uppercase tracking-wide">{label}</span>
        {/* Visible, not hover-only: which cards open a screen is something you
            should be able to see without dragging a mouse across all of them. */}
        {href && !badge ? (
          <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-foreground-subtle" aria-hidden />
        ) : null}
        {icon && badge ? (
          // `bg-muted`, not a tinted accent: a row of these would otherwise
          // put four coloured squares above four numbers and the squares
          // would win the glance.
          <span
            className="-mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </span>

      {/* `tabular-nums`: a row of these updates on a poll, and proportional
          digits change width as the value changes, so the whole row twitches. */}
      <span className={VALUE_ROW}>{value}</span>

      {progress ? (
        <ProgressBar value={progress.value} aria-label={progress.label} className="mt-0.5" />
      ) : null}

      {/* The two ends of the footer are two different facts, so in `badge`
          they are pushed apart rather than run together. `justify-between`
          only when there is something to put at each end — a lone pill shoved
          against the left edge of an empty row is what `gap-2` already does. */}
      <span className={cn(FOOTER_ROW, badge && (progress?.trailing || hint) && 'justify-between')}>
        {trend ? <Trend trend={trend} invert={invertTrend} asPill={badge} /> : null}
        {progress?.caption ? (
          <span className="min-w-0 truncate font-medium text-primary">{progress.caption}</span>
        ) : null}
        {hint ? <span className="min-w-0 truncate text-muted-foreground">{hint}</span> : null}
        {progress?.trailing ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">{progress.trailing}</span>
        ) : null}
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

/**
 * `asPill` wraps the same content in a tinted chip instead of tinting the text.
 *
 * THE COLOUR LOGIC IS UNTOUCHED by the switch — `invert` still decides which
 * direction is the good one, and the pill's tint is the subtle pairing of
 * exactly the same semantic token. A pill that picked its own hue would be a
 * second place for "up is not automatically good" to be got wrong.
 */
function Trend({
  trend,
  invert,
  asPill = false,
}: {
  trend: StatCardTrend;
  invert: boolean;
  asPill?: boolean;
}) {
  const { value, label, unit = '%' } = trend;

  const shell = asPill
    ? 'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 tabular-nums'
    : 'flex shrink-0 items-center gap-1 tabular-nums';

  if (value === 0) {
    return (
      <span
        className={cn(shell, asPill ? 'bg-muted text-muted-foreground' : 'text-muted-foreground')}
      >
        <Minus className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">No change,</span>
        {`0${unit}`}
        {label && !asPill ? <span className="truncate">{label}</span> : null}
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
        shell,
        asPill
          ? good
            ? 'bg-success-subtle text-success-subtle-foreground'
            : 'bg-destructive-subtle text-destructive-subtle-foreground'
          : good
            ? 'text-success'
            : 'text-destructive',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {/* The arrow is decorative, so the direction has to reach a screen
          reader as words — otherwise "12%" is read with no direction at all. */}
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      {`${Math.abs(value)}${unit}`}
      {/* Inside a pill the comparison label is dropped: "vs last mo" belongs
          beside the chip, not inside it, or the pill grows into a sentence and
          stops reading as a badge. The caller puts it in `hint`. */}
      {label && !asPill ? <span className="truncate text-muted-foreground">{label}</span> : null}
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
