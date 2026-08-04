'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { fetchAdminOrganizationAnalytics } from '@/lib/api/admin';
import { TrendChart } from '@/components/admin/charts';
import { ErrorState, Panel, Skeleton } from '@/components/organizer/primitives';
import { formatMoney } from '@/lib/discovery/format';
import type { SeriesMetric } from '@/lib/api/organizer';

/**
 * One organization's dashboard, as an operator.
 *
 * Same principle as the event screen: this renders the ORGANIZER's own
 * overview and series, fetched from an endpoint that delegates to the
 * organizer module's selectors. An operator investigating "our revenue is
 * missing" must be reading the figures that organizer is reading, or the
 * conversation becomes about which screen is right.
 *
 * There is deliberately no write here. Suspending a user, deciding a
 * verification and releasing a settlement each already live on the surface
 * that owns them, and a second set of buttons in a third place is how two
 * operators take the same action twice.
 */

const METRICS: { id: SeriesMetric; label: string }[] = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'tickets', label: 'Tickets' },
];

export function AdminOrganizationDetail({ organizationId }: { organizationId: string }) {
  const [metric, setMetric] = React.useState<SeriesMetric>('revenue');

  const query = useQuery({
    queryKey: ['admin', 'organization-analytics', organizationId, metric],
    queryFn: () => fetchAdminOrganizationAnalytics(organizationId, { metric, days: 30 }),
  });

  return (
    <div className="flex flex-col gap-block">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/organizations"
          className="inline-flex w-fit items-center gap-1.5 rounded-sm text-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Organizations
        </Link>
        <h1 className="text-h3">Organizer dashboard</h1>
        <p className="text-caption text-muted-foreground">
          The same figures this organizer sees on their own dashboard.
        </p>
      </div>

      <Panel title="Today" subtitle="Against yesterday, for the trend">
        {query.isPending ? (
          <div className="grid gap-3 p-card sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : query.isError || !query.data ? (
          <ErrorState
            message="Could not load this organizer's figures."
            onRetry={() => void query.refetch()}
          />
        ) : (
          <dl className="grid gap-3 p-card sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Revenue today"
              value={formatMoney(query.data.overview.revenue_today_minor)}
            />
            <Stat label="Bookings today" value={String(query.data.overview.bookings_today)} />
            <Stat label="Tickets sold" value={String(query.data.overview.tickets_sold_today)} />
            <Stat label="Upcoming events" value={String(query.data.overview.events_upcoming)} />
          </dl>
        )}
      </Panel>

      <Panel title="Last 30 days">
        <div className="flex flex-col gap-block p-card">
          <div className="flex flex-wrap gap-2">
            {METRICS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setMetric(option.id)}
                aria-pressed={metric === option.id}
                className="inline-flex h-9 items-center rounded-full border border-border px-4 text-label transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[pressed=true]:border-transparent aria-[pressed=true]:bg-nav-active aria-[pressed=true]:text-nav-active-foreground"
              >
                {option.label}
              </button>
            ))}
          </div>

          {query.data ? (
            <TrendChart
              points={query.data.timeseries.points}
              label={METRICS.find((m) => m.id === metric)?.label ?? 'Revenue'}
              format={(value) => (metric === 'revenue' ? formatMoney(value) : String(value))}
            />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-sunken p-card">
      <dt className="text-caption uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-h4 tabular-nums">{value}</dd>
    </div>
  );
}
