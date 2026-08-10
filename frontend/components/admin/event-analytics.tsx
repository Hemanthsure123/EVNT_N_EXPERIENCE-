'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, ExternalLink } from 'lucide-react';
import { fetchAdminEventAnalytics } from '@/lib/api/admin';
import { formatMoney } from '@/lib/discovery/format';
import { Button } from '@/components/ui/button';
import {
  BarList,
  DonutChart,
  Meter,
  TrendLine,
  statusTone,
} from '@/components/organizer/charts';
import { eventBadge } from '@/lib/organizer/event-status';
import { EmptyState, ErrorState, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * One event, measured.
 *
 * ── WHY IT IS A PAGE AND NOT THE DRAWER IT LIVED IN ───────────────────────
 *
 * The same figures were already on `GET /admin/events/{id}/analytics`, and the
 * console rendered a summary of them inside the event drawer. A drawer is a
 * glance; it has room for four numbers and no room at all for a sales curve,
 * a tier table and a scan breakdown. So the numbers that answer "how did this
 * event do" were computed, sent over the wire, and then thrown away.
 *
 * This is the page they were always for. Nothing new is fetched — it is the
 * same endpoint the drawer calls, which is also why the two can never disagree.
 *
 * ── IT REUSES THE ORGANIZER'S CHARTS, DELIBERATELY ────────────────────────
 *
 * `components/organizer/charts.tsx` already owns the line, the bars, the donut
 * and the meter, with one tone scale and one empty state. A second chart set
 * for the console would be a second set of axes to keep honest — and the two
 * would drift on the day somebody fixed a label in one of them.
 *
 * ── AND IT SHOWS NOTHING IT WAS NOT GIVEN ─────────────────────────────────
 *
 * `conversion_pct`, `abandonment_pct` and `attendance_pct` are null until
 * there is something to divide. A null renders as "—" with a sentence saying
 * why, never as 0% — which is a claim, and a wrong one: an event that has sold
 * nothing has no conversion rate, it does not have a conversion rate of zero.
 */

export function AdminEventAnalytics({ eventId }: { eventId: string }) {
  const [days, setDays] = React.useState(30);

  const query = useQuery({
    queryKey: ['admin', 'event-analytics', eventId, days],
    queryFn: () => fetchAdminEventAnalytics(eventId, days),
    staleTime: 60_000,
  });

  const stats = query.data;
  const header = stats?.event;
  // Capacity and sold come from the analytics payload, which is what makes
  // "Sold out" and "Selling fast" real here rather than inferred.
  const badge = eventBadge({
    status: (header?.status ?? 'draft') as Parameters<typeof eventBadge>[0]['status'],
    capacity: stats?.capacity ?? 0,
    sold: stats?.sold ?? 0,
  });

  return (
    <div className="flex flex-col gap-block">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href="/admin/events"
            className="inline-flex w-fit items-center gap-1.5 rounded-full text-caption text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All events
          </Link>
          <h1 className="truncate text-h3">{header?.title ?? 'Event analytics'}</h1>
          {header ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-muted-foreground">
              {/* `eventBadge`, not `statusTone`: the latter is the CHART tone
                  scale (it has a `progress` hue a pill has no colour for), and
                  the badge is the one place event statuses get their label and
                  their tone — so the pill here reads exactly as it does on
                  every list. */}
              <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
              <span>
                {header.venue}, {header.city}
              </span>
              <span className="tabular-nums">
                {new Date(header.starts_at).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {/* The window applies to the SALES CURVE only. Every total below is
              the event's lifetime — a revenue figure that silently meant "the
              last 30 days" on a page headed with the event's name is the kind
              of number somebody reports upward. The chart says so on itself. */}
          <div role="radiogroup" aria-label="Sales window" className="flex gap-1">
            {[7, 30, 90].map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={days === option}
                onClick={() => setDays(option)}
                className={cn(
                  'inline-flex h-control-sm items-center rounded-full border px-3 text-caption font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  days === option
                    ? 'border-nav-active bg-nav-active text-nav-active-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {option}d
              </button>
            ))}
          </div>
          {header ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/events/${eventId}`}>Open event</Link>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" asChild>
            <a href={`/events/${eventId}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" aria-hidden />
              Public page
            </a>
          </Button>
        </div>
      </div>

      {query.isError ? (
        <ErrorState
          message="Could not load analytics for this event."
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : !stats ? (
        <EmptyState
          icon={BarChart3}
          title="Nothing to show"
          body="This event has no analytics — it may have been removed."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Revenue" value={formatMoney(stats.revenue_minor)} note="Captured, lifetime" />
            <Stat
              label="Refunded"
              value={formatMoney(stats.refunded_minor)}
              // NOT subtracted from revenue: the backend already excludes
              // refunded payments from it, and subtracting twice is how a
              // finance number goes quietly wrong.
              note={`${stats.refunded_count} ${stats.refunded_count === 1 ? 'refund' : 'refunds'}`}
            />
            <Stat
              label="Tickets sold"
              value={`${stats.sold.toLocaleString('en-IN')} / ${stats.capacity.toLocaleString('en-IN')}`}
              note="Against total capacity"
              meter={stats.sell_through_pct === null ? undefined : stats.sell_through_pct / 100}
            />
            <Stat
              label="Checked in"
              value={stats.checkins.toLocaleString('en-IN')}
              note={
                stats.attendance_pct === null
                  ? 'No tickets issued yet'
                  : `${stats.attendance_pct}% of tickets issued`
              }
              meter={stats.attendance_pct === null ? undefined : stats.attendance_pct / 100}
            />
          </div>

          <Panel
            title="Sales"
            blurb={`Captured revenue per day over the last ${days} days. Every total above is lifetime.`}
          >
            <TrendLine
              points={stats.sales_timeline}
              label="Revenue"
              format={(value) => formatMoney(value)}
            />
          </Panel>

          <div className="grid gap-block lg:grid-cols-2">
            <Panel
              title="Bookings"
              blurb="Every booking ever made on this event, by where it ended up."
            >
              <DonutChart
                items={stats.bookings_by_status}
                format={(value) => value.toLocaleString('en-IN')}
                centreLabel="bookings"
              />
            </Panel>

            <Panel
              title="At the gate"
              blurb="Every scan that reached a real ticket."
            >
              <BarList
                items={stats.scans_by_result}
                format={(value) => value.toLocaleString('en-IN')}
                emptyLabel="Nobody has scanned a ticket yet."
                toneFor={statusTone}
                humaniseLabels
              />
            </Panel>
          </div>

          <Panel title="By ticket type" blurb="Where the money and the seats actually went.">
            {stats.tiers.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                No ticket types on this event.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-body-sm">
                  <thead>
                    <tr className="border-b border-border text-caption text-muted-foreground">
                      <th className="py-2 text-left font-medium">Tier</th>
                      <th className="py-2 text-right font-medium">Price</th>
                      <th className="py-2 text-right font-medium">Sold</th>
                      <th className="py-2 text-right font-medium">Capacity</th>
                      <th className="py-2 text-right font-medium">Revenue</th>
                      <th className="w-32 py-2 text-left font-medium">Sell-through</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.tiers.map((tier) => (
                      <tr key={tier.id} className="border-b border-border last:border-0">
                        <td className="max-w-48 truncate py-2.5 font-medium text-foreground">
                          {tier.name}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {formatMoney(tier.price_minor)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {tier.sold.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                          {tier.quantity.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {formatMoney(tier.revenue_minor)}
                        </td>
                        <td className="py-2.5">
                          <Meter value={tier.quantity ? tier.sold / tier.quantity : 0} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Funnel"
            blurb="Of everybody who started a booking, how many finished."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Ratio
                label="Completed"
                value={stats.conversion_pct}
                note="Bookings that reached paid."
              />
              <Ratio
                label="Abandoned"
                value={stats.abandonment_pct}
                note="Holds that expired or were cancelled."
              />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Panel({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-stack-lg rounded-xl border border-border bg-surface p-card shadow-sm lg:p-card-lg">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-body font-semibold text-foreground">{title}</h2>
        <p className="max-w-prose text-caption text-muted-foreground">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  note,
  meter,
}: {
  label: string;
  value: string;
  note: string;
  meter?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-card shadow-sm">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="text-h4 tabular-nums text-foreground">{value}</p>
      {meter !== undefined ? <Meter value={meter} /> : null}
      <p className="text-caption text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * A percentage, or an honest dash.
 *
 * Null means there was nothing to divide by. It renders as "—" with the reason
 * rather than as 0% — an event that has sold nothing does not have a
 * conversion rate of zero, it does not have one.
 */
function Ratio({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="text-h3 tabular-nums text-foreground">{value === null ? '—' : `${value}%`}</p>
      {value !== null ? <Meter value={value / 100} /> : null}
      <p className="text-caption text-muted-foreground">
        {value === null ? 'No bookings on this event yet.' : note}
      </p>
    </div>
  );
}
