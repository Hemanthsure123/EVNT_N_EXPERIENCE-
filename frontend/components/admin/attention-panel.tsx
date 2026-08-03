'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import {
  useAdminAttention,
  type AdminAttentionItem,
  type AttentionSeverity,
} from '@/lib/admin/attention';
import { cn } from '@/lib/utils/cn';
import { Skeleton } from '@/components/organizer/primitives';

/**
 * "What requires attention?" — the first thing on the console.
 *
 * ── IT SITS ABOVE THE NUMBERS ─────────────────────────────────────────────
 *
 * Revenue tells an operator what happened; this tells them what to do. Only
 * one of those has a cost that grows while it goes unread: a degraded database
 * is compounding by the minute, an event stuck in review is an organizer
 * losing sales, and today's revenue will still be today's revenue after lunch.
 *
 * ── AN EMPTY LIST IS THE GOOD OUTCOME ─────────────────────────────────────
 *
 * It gets a calm all-clear that NAMES what was checked, rather than an
 * apology or a manufactured task. An operator who learns this panel only
 * speaks when something is genuinely wrong will read it every morning; one
 * that always has three items gets ignored within a week.
 *
 * ── IT IS DRAWN AS A WORK QUEUE, NOT AS A BANNER ──────────────────────────
 *
 * Rows are `px-card py-stack` — full card padding across, a tight 12px down —
 * because this sits ABOVE the numbers and every row it spends pushes the day's
 * counts further off the screen. The severity tints (`--destructive-subtle`,
 * `--warning-subtle`) carry the urgency; nothing here is a filled button,
 * because the whole row is the target and a pill inside it would compete with
 * the row it sits in.
 */

const TONE: Record<
  AttentionSeverity,
  { icon: typeof AlertTriangle; wrap: string; chip: string }
> = {
  critical: {
    icon: AlertTriangle,
    wrap: 'border-destructive-subtle bg-destructive-subtle',
    chip: 'text-destructive-subtle-foreground',
  },
  warning: {
    icon: TriangleAlert,
    wrap: 'border-warning-subtle bg-warning-subtle',
    chip: 'text-warning-subtle-foreground',
  },
  // Neutral, and it is the only rung that needs the light theme's card recipe
  // (hairline + soft shadow): the other two separate from the page with their
  // own tint, this one is the same white as the canvas behind it.
  info: {
    icon: Info,
    wrap: 'border-border bg-surface shadow-sm',
    chip: 'text-muted-foreground',
  },
};

export function AdminAttentionPanel({ limit }: { limit?: number }) {
  const { items, isPending, isError, counts } = useAdminAttention();
  const shown = limit ? items.slice(0, limit) : items;

  if (isPending) {
    return (
      <section className="flex flex-col gap-2" aria-busy>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </section>
    );
  }

  // A failed READ is not an all-clear. Rendering the calm empty state here
  // would tell an operator the platform is healthy because the console cannot
  // see it, which is the most dangerous thing this panel could do.
  if (isError) {
    return (
      <section
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-destructive-subtle bg-destructive-subtle px-card py-stack"
      >
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-destructive-subtle-foreground"
          aria-hidden
        />
        <p className="text-body-sm text-destructive-subtle-foreground">
          The console cannot reach the platform right now. This is a failed request, not an
          all-clear — nothing below has been checked.
        </p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-xl border border-border bg-surface px-card py-stack shadow-sm">
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-success-subtle"
          aria-hidden
        >
          <CheckCircle2 className="size-4 text-success" />
        </span>
        <div className="min-w-0">
          <p className="text-body-sm font-medium">Nothing needs an operator</p>
          {/* Names what was checked. "All clear" that does not say what it
              looked at is indistinguishable from a panel that looked at
              nothing. */}
          <p className="text-caption text-muted-foreground">
            Dependencies probed and healthy, no failed payouts, no events or verifications waiting.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-1.5">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-body-sm font-semibold">Needs an operator</h2>
        <p aria-live="polite" className="text-caption text-muted-foreground">
          {counts.critical > 0
            ? `${counts.critical} urgent${counts.warning ? `, ${counts.warning} ageing` : ''}`
            : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </p>
      </header>

      <ul className="flex flex-col gap-1.5">
        {shown.map((item) => (
          <li key={item.id}>
            <AttentionCard item={item} />
          </li>
        ))}
      </ul>

      {limit && items.length > limit ? (
        <p className="text-caption text-muted-foreground">
          {items.length - limit} more, shown in full on each section.
        </p>
      ) : null}
    </section>
  );
}

function AttentionCard({ item }: { item: AdminAttentionItem }) {
  const tone = TONE[item.severity];
  const Icon = tone.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        'group flex items-start gap-3 rounded-xl border px-card py-stack transition-colors duration-fast',
        'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        tone.wrap,
        item.severity === 'info' && 'hover:bg-muted',
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone.chip)} aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-foreground">{item.title}</p>
        <p className={cn('text-caption', tone.chip)}>{item.detail}</p>
      </div>

      <span
        className={cn(
          'mt-0.5 inline-flex shrink-0 items-center gap-1 text-label',
          tone.chip,
          // The one animation here, and it says "this goes somewhere" rather
          // than decorating.
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

/** The sidebar badge — critical items only, so the number means one thing. */
export function useAdminAttentionBadge(): number {
  const { counts } = useAdminAttention();
  return counts.critical;
}
