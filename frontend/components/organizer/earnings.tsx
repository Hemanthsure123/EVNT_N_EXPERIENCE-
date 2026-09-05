'use client';

import * as React from 'react';
import { CalendarDays, Lightbulb, TrendingUp, Users, Wallet } from 'lucide-react';
import { StatCard, StatCardSkeleton } from '@/components/ui';
import { formatMoney } from '@/lib/discovery/format';
import { useOrganizerEarnings, useOrganizerInsights } from '@/lib/organizer/queries';
import type { OrganizerInsight } from '@/lib/api/organizer';
import { ErrorState } from '@/components/organizer/primitives';

/**
 * The three money questions an organizer arrives with.
 *
 * ── WHY THESE THREE, AND WHY THEY DO NOT BRING BACK THE TILE GRID ─────────
 *
 * This dashboard used to open with six KPI tiles and they were cut on purpose:
 * six numbers shouting at one volume is the same as none of them shouting, and
 * every one of them was a variation on "today". The lead panel that replaced
 * them still owns TODAY — revenue, bookings and tickets over a fourteen-day
 * chart — and it answers "is the on-sale working".
 *
 * It cannot answer "how is the business doing", because that question is not
 * about today at all. These three are the smallest set that does: what the
 * business has earned in total, what it is earning this month, and what a
 * customer is worth. Three distinct questions, not six restatements of one —
 * which is the distinction the original cut was actually about.
 *
 * ── THE MONTH COMPARISON SAYS WHAT IT COMPARED ───────────────────────────
 *
 * `month_change_pct` is this month so far against the SAME ELAPSED SPAN of
 * last month, and the hint says so with the real number of days. A tile
 * reading "+240% on last month" on the 2nd, because two days were measured
 * against thirty-one, is worse than no tile: it is a number somebody might
 * act on.
 */
export function EarningsStrip() {
  const query = useOrganizerEarnings();

  if (query.isError) {
    return (
      <ErrorState
        message="Could not load earnings."
        onRetry={() => void query.refetch()}
        className="rounded-xl border border-border bg-surface shadow-sm"
      />
    );
  }

  if (query.isPending) {
    return (
      <div className="grid gap-stack sm:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    );
  }

  const data = query.data;
  const days = data.comparison_days;

  return (
    <div className="grid gap-stack sm:grid-cols-3">
      <StatCard
        label="Total earnings"
        value={formatMoney(data.lifetime_revenue_minor)}
        hint={`${data.lifetime_tickets.toLocaleString('en-IN')} tickets to ${data.lifetime_attendees.toLocaleString('en-IN')} attendees`}
        icon={<Wallet className="size-4" aria-hidden />}
        // NO trend. There is nothing to compare a lifetime total against, and
        // a tile that shows a percentage beside every number teaches the eye
        // to stop reading them.
      />

      <StatCard
        label="This month"
        value={formatMoney(data.month_revenue_minor)}
        trend={
          data.month_change_pct === null
            ? null
            : { value: data.month_change_pct, label: `vs same ${days} days last month` }
        }
        hint={
          data.month_change_pct === null
            ? 'No comparable period last month'
            : `Against the first ${days} day${days === 1 ? '' : 's'} of last month`
        }
        icon={<CalendarDays className="size-4" aria-hidden />}
      />

      <StatCard
        label="Revenue per attendee"
        // Null renders as an em dash via `formatMoney`, and the hint explains
        // it. Rendering ₹0 would be a claim that people bought and paid
        // nothing, which is a different and untrue fact.
        value={formatMoney(data.avg_revenue_per_attendee_minor)}
        hint={
          data.avg_revenue_per_attendee_minor === null
            ? 'No paid attendees yet'
            : `Across ${data.lifetime_attendees.toLocaleString('en-IN')} paying attendees`
        }
        icon={<Users className="size-4" aria-hidden />}
      />
    </div>
  );
}

const INSIGHT_ICON: Record<string, React.ReactNode> = {
  weekday: <CalendarDays className="size-4" aria-hidden />,
  hour: <CalendarDays className="size-4" aria-hidden />,
  category: <TrendingUp className="size-4" aria-hidden />,
  city: <TrendingUp className="size-4" aria-hidden />,
};

/**
 * Insights and recommendations.
 *
 * ── ABSENT, NOT EMPTY ────────────────────────────────────────────────────
 *
 * The server returns nothing rather than a guess when the data cannot support
 * advice, so an empty array is a real answer and this renders NOTHING for it —
 * no card, no "no insights yet" placeholder. A section that exists only to say
 * it has nothing to say is a section an organizer learns to skip, and the
 * moment it does have something they will skip that too.
 *
 * ── EVERY LINE CARRIES ITS SAMPLE SIZE ───────────────────────────────────
 *
 * "Saturdays earn the most" from nine bookings and from nine hundred are
 * different claims, and the reader is the only one who can tell which one they
 * should act on. The server already refuses below its minimum; showing the
 * count is what stops the survivors reading as certainties.
 */
export function InsightsCard() {
  const query = useOrganizerInsights();
  const insights = query.data ?? [];

  // Nothing to say, or not loaded yet — either way, no chrome. This sits
  // beside real content and must not reserve space it might never fill.
  if (query.isPending || query.isError || insights.length === 0) return null;

  return (
    <section className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
      <h2 className="inline-flex items-center gap-2 text-body-sm font-semibold text-foreground">
        <Lightbulb className="size-4 text-primary" aria-hidden />
        Insights
      </h2>
      <ul className="flex flex-col gap-stack">
        {insights.map((insight) => (
          <InsightRow key={`${insight.kind}:${insight.key}`} insight={insight} />
        ))}
      </ul>
    </section>
  );
}

function InsightRow({ insight }: { insight: OrganizerInsight }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground">
        {INSIGHT_ICON[insight.kind] ?? <TrendingUp className="size-4" aria-hidden />}
      </span>
      <div className="min-w-0">
        <p className="text-body-sm text-foreground">{insight.label}</p>
        <p className="text-caption text-muted-foreground">
          {/* The evidence, in the same breath as the claim. */}
          From {insight.sample_size.toLocaleString('en-IN')} booking
          {insight.sample_size === 1 ? '' : 's'}
        </p>
      </div>
    </li>
  );
}
