'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { GLASS_PANEL } from '../primitives';

/**
 * The event analytics page's shared vocabulary: the card, the section heading,
 * the stat tile, the table shell, and the formatters every section agrees on.
 *
 * ── ONE CARD RECIPE ───────────────────────────────────────────────────────
 *
 * Every tile on the page is the same frosted card at the same radius and the
 * same inner padding. The reference layout is a vertical stack of cards, and
 * the thing that makes a stack like that read as one page rather than six
 * widgets is that no two of them disagree about what a card is.
 *
 * ── EVERY DATE IS THE INDIAN DAY ──────────────────────────────────────────
 *
 * The API buckets days in IST, and this page prints instants in IST too. A
 * browser in another zone would otherwise label a 23:30 IST booking as the
 * previous day, and the chart and the table beside it would disagree.
 */

export const CARD = cn(GLASS_PANEL, 'rounded-2xl shadow-sm');

/**
 * Inner padding for a card, one step roomier from `sm`. Twelve pixels on a
 * phone, as the reference has it — at sixteen, a two-column label like "Total
 * Event Views" wraps onto a second line in a 390px frame.
 */
export const CARD_PAD = 'p-3 sm:p-5';

export const PLATFORM_TIME_ZONE = 'Asia/Kolkata';

function valid(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? null : date;
}

/** An instant as the Indian calendar date — "5 Sept 2026". */
export function formatDate(iso: string | null | undefined): string {
  const date = valid(iso);
  if (!date) return '—';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: PLATFORM_TIME_ZONE,
  });
}

/** An instant as Indian wall-clock time — "05:00 pm". */
export function formatTime(iso: string | null | undefined): string {
  const date = valid(iso);
  if (!date) return '—';
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: PLATFORM_TIME_ZONE,
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  return valid(iso) ? `${formatDate(iso)} at ${formatTime(iso)}` : '—';
}

/** The IST calendar day of an instant, as the API's `YYYY-MM-DD`. */
export function istDay(iso: string | null | undefined): string | null {
  const date = valid(iso);
  // `en-CA` is the locale whose short date IS ISO order.
  return date ? date.toLocaleDateString('en-CA', { timeZone: PLATFORM_TIME_ZONE }) : null;
}

/**
 * A DAY from the API ("2026-09-05") — already an IST day, so it is printed as
 * that date and never re-zoned: parsing it as local midnight would move it a
 * day for anybody west of India.
 */
export function formatDay(day: string | null | undefined, { year = true } = {}): string {
  if (!day) return '—';
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return day;
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('en-IN');
}

/** `null` is an em dash, never "0%" — a rate with no denominator is not zero. */
export function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value}%`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** A named region of the page: an icon, a heading, and anything it carries. */
export function Section({
  icon: Icon,
  title,
  trailing,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="flex min-w-0 items-center gap-2.5 text-h4 font-semibold text-foreground">
          <Icon className="size-6 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">{title}</span>
        </h2>
        {trailing}
      </div>
      {children}
    </section>
  );
}

/**
 * One figure: an icon and a label, the value large, and a line of context.
 *
 * `children` sits between the value and the caption, which is where a meter
 * goes when the figure is a proportion somebody reads as a position.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  caption,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(CARD, CARD_PAD, 'flex min-w-0 flex-col gap-2', className)}>
      <span className="flex items-start gap-2 text-body-sm leading-snug text-muted-foreground">
        <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0">{label}</span>
      </span>
      <span className="text-h3 font-bold leading-tight tabular-nums text-foreground">{value}</span>
      {children}
      {caption ? (
        <span className="text-body-sm leading-snug text-muted-foreground">{caption}</span>
      ) : null}
    </div>
  );
}

/** A quiet outlined chip for a data label — "52 spots", "31 Aug – 5 Sept". */
export function DataPill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-sunken px-3 py-1 text-label font-medium tabular-nums text-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A table in a card, scrolling SIDEWAYS on a phone.
 *
 * The reference tables are wider than a phone and scroll, with the first
 * columns in view; wrapping every cell into a stack instead would lose the one
 * thing a table is for, which is comparing a column top to bottom.
 */
export function TableCard({
  children,
  label,
  className,
}: {
  children: React.ReactNode;
  /** Names the scroll region for a screen reader. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn(CARD, 'overflow-hidden', className)}>
      <div
        // `relative`: an absolutely positioned descendant (an `sr-only` label)
        // otherwise escapes the scroller's clipping and widens the page.
        className="relative overflow-x-auto overscroll-x-contain"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}

export const TH = 'whitespace-nowrap px-4 py-3.5 text-left text-body-sm font-medium text-muted-foreground';
export const TD = 'px-4 py-3.5 align-middle text-body-sm text-foreground';

/** A sentence where a section has nothing to draw. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn(CARD, CARD_PAD, 'text-body-sm text-muted-foreground')}>{children}</p>
  );
}
