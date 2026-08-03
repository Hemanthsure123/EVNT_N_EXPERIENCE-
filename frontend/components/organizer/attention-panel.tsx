'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { useAttention, type AttentionItem, type AttentionSeverity } from '@/lib/organizer/attention';
import { cn } from '@/lib/utils/cn';
import { Skeleton } from './primitives';

/**
 * "What requires attention?" — the first thing on the dashboard.
 *
 * ── AN EMPTY LIST IS THE GOOD OUTCOME, AND IS DRAWN THAT WAY ──────────────
 *
 * Most dashboards treat "nothing to show" as a failure of the component and
 * fill it with suggestions. Here it is the answer to the question, and it gets
 * a calm, deliberate all-clear rather than an apology or a made-up task. An
 * organizer who learns this panel only speaks when something is actually wrong
 * will read it every morning; one that always has three items will stop.
 *
 * ── IT SITS ABOVE THE NUMBERS ─────────────────────────────────────────────
 *
 * Revenue tells you what happened. This tells you what to do, which is the
 * more expensive thing to miss — a rejected event is losing sales for every
 * hour it goes unnoticed, whereas yesterday's revenue will still be there
 * after lunch.
 *
 * ── SEVERITY IS CARRIED BY MORE THAN COLOUR ───────────────────────────────
 *
 * Each row has a tinted fill, a distinct icon, an edge in its own hue AND a
 * screen-reader-only severity word before the title. Colour alone would make
 * "a payout failed" and "a draft has no tickets" identical to anyone reading
 * this with a screen reader or a red/green deficiency, on the one panel where
 * the whole point is which item to open first.
 */

const TONE: Record<
  AttentionSeverity,
  { icon: typeof AlertTriangle; wrap: string; chip: string; label: string }
> = {
  critical: {
    icon: AlertTriangle,
    // The border is an ALPHA of the solid hue, not the tint again. Setting
    // both to `-subtle` drew a border the same colour as the fill, i.e. no
    // border at all — the card had no edge in either theme.
    wrap: 'border-destructive/25 bg-destructive-subtle',
    chip: 'text-destructive-subtle-foreground',
    label: 'Needs action',
  },
  warning: {
    icon: TriangleAlert,
    wrap: 'border-warning/30 bg-warning-subtle',
    chip: 'text-warning-subtle-foreground',
    label: 'Worth a look',
  },
  info: {
    // A plain card on a white page separates by hairline + shadow, which is
    // the light-first recipe; the two tinted rows above separate by fill and
    // deliberately carry no shadow, so the eye reaches them first.
    icon: Info,
    wrap: 'border-border bg-surface shadow-sm',
    chip: 'text-muted-foreground',
    label: 'For information',
  },
};

export function AttentionPanel({ limit }: { limit?: number }) {
  const { items, isPending, isError, counts } = useAttention();
  const shown = limit ? items.slice(0, limit) : items;

  if (isPending) {
    return (
      <section className="flex flex-col gap-2" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </section>
    );
  }

  // A failed READ is not an all-clear. Rendering the calm empty state here
  // would tell an organizer everything is fine because the network broke,
  // which is the most dangerous thing this panel could do.
  if (isError) {
    return (
      <section
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-border bg-surface p-card shadow-sm"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-body-sm text-muted-foreground">
          Could not check for anything needing attention. This is a failed request, not an
          all-clear — reload to try again.
        </p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-xl border border-border bg-surface p-card shadow-sm">
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-success-subtle"
          aria-hidden
        >
          <CheckCircle2 className="size-4 text-success-subtle-foreground" />
        </span>
        <div className="min-w-0">
          <p className="text-body-sm font-medium">Nothing needs you right now</p>
          <p className="text-caption text-muted-foreground">
            No rejected events, no failed payouts, no unsold events starting this week.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2">
        <h2 className="text-body-sm font-semibold">Needs your attention</h2>
        <p aria-live="polite" className="text-caption tabular-nums text-muted-foreground">
          {counts.critical > 0
            ? `${counts.critical} blocking${counts.warning ? `, ${counts.warning} to watch` : ''}`
            : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <li key={item.id}>
            <AttentionCard item={item} />
          </li>
        ))}
      </ul>

      {limit && items.length > limit ? (
        <p className="text-caption text-muted-foreground">
          {items.length - limit} more — shown in full on each section.
        </p>
      ) : null}
    </section>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const tone = TONE[item.severity];
  const Icon = tone.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        'group flex items-start gap-3 rounded-xl border p-card transition-colors duration-fast',
        'motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tone.wrap,
        item.severity === 'info' && 'hover:bg-muted',
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone.chip)} aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-foreground">
          {/* The severity in words, for anybody who is not reading the hue. */}
          <span className="sr-only">{tone.label}: </span>
          {item.title}
        </p>
        <p className={cn('text-caption', tone.chip)}>{item.detail}</p>
      </div>

      <span
        className={cn(
          'mt-0.5 inline-flex shrink-0 items-center gap-1 text-label',
          tone.chip,
          // The arrow leads by 2px on hover. It is the one animation here, and
          // it exists to say "this is a link that goes somewhere", not to
          // decorate.
          'transition-transform duration-fast group-hover:translate-x-0.5',
          'motion-reduce:transition-none motion-reduce:group-hover:translate-x-0',
        )}
      >
        <span className="hidden sm:inline">{item.action}</span>
        <ArrowRight className="size-3.5" aria-hidden />
      </span>
    </Link>
  );
}

/** The sidebar badge — critical items only, so it means one thing. */
export function useAttentionBadge(): number {
  const { counts } = useAttention();
  return counts.critical;
}
