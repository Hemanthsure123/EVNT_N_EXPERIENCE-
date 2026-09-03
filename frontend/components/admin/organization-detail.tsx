'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, UserRound } from 'lucide-react';
import { fetchAdminOrganizationAnalytics, fetchAdminOrganizationCrew } from '@/lib/api/admin';
import { TrendChart } from '@/components/admin/charts';
import { RemoteImage } from '@/components/ui/remote-image';
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

      <CrewPanel organizationId={organizationId} />
    </div>
  );
}

/**
 * Who this organization puts on stage.
 *
 * Here rather than as its own admin section: there is no platform-wide crew
 * endpoint, and a nav item leading to a page that needs an organization id it
 * does not have is worse than no nav item. An operator arrives at this
 * question FROM an organization, which is where the answer lives.
 *
 * `appearance_count` is the column the organizer's own roster does not show,
 * and it is the reason an operator opens this list — a name attached to
 * fourteen events is a different thing from one attached to none.
 */
function CrewPanel({ organizationId }: { organizationId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'organization-crew', organizationId],
    queryFn: () => fetchAdminOrganizationCrew(organizationId),
    staleTime: 60_000,
  });

  return (
    <Panel title="Crew" subtitle="People this organiser puts on stage">
      {query.isPending ? (
        <div className="p-card">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (query.data ?? []).length === 0 ? (
        // Absent-not-empty does not apply inside an operator console: an
        // operator asking "who do they book" needs "nobody" to be an answer,
        // not a missing panel they cannot tell from a broken one.
        <p className="p-card text-body-sm text-muted-foreground">
          This organisation has not added anyone to its crew list.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {(query.data ?? []).map((member) => (
            <li key={member.id} className="flex items-center gap-3 px-card py-3">
              <span
                aria-hidden
                className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
              >
                <RemoteImage
                  src={member.photo_url}
                  className="size-full object-cover"
                  fallback={<UserRound className="size-4" />}
                />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-sm font-medium text-foreground">
                  {member.name}
                </span>
                {member.role ? (
                  <span className="truncate text-caption text-muted-foreground">
                    {member.role}
                  </span>
                ) : null}
              </div>
              {!member.is_active ? (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                  Retired
                </span>
              ) : null}
              <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                {member.appearance_count === 1
                  ? '1 event'
                  : `${member.appearance_count} events`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
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
