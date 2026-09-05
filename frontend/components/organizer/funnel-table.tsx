'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button, ProgressRing } from '@/components/ui';
import { EmptyState, ErrorState, Skeleton } from '@/components/organizer/primitives';
import { StatusBadge } from '@/components/organizer/status-badge';
import { formatMoney } from '@/lib/discovery/format';
import { useOrganizerFunnel } from '@/lib/organizer/queries';
import type { OrganizerFunnelRow } from '@/lib/api/organizer';

/**
 * Per-event conversion, quota fill and repeat share.
 *
 * ── WHAT THIS TABLE DOES NOT HAVE, AND WHY THAT IS THE DESIGN ────────────
 *
 * The brief for this table asked for Impressions, Detail Views, Add to Cart
 * and a click-through rate. None of them are here, because the platform does
 * not measure any of them — there is no view, impression, session or
 * analytics-event model anywhere in the backend, no beacon and no middleware.
 *
 * The alternatives were to fabricate them, to show four permanently empty
 * columns, or to leave them out. Empty columns are the worst of the three: an
 * organizer reading "Impressions: 0" concludes nobody saw their event, which
 * is a specific and false claim, where "we do not measure that yet" is simply
 * absent from a table that never promised it. Every column below is a count of
 * rows that exist.
 *
 * Getting the missing four means building a tracking pipeline — a collection
 * endpoint, rollups, and a decision about CDN-cached reads that the public
 * event page's 0-query warm path currently depends on. That is a project, not
 * a column.
 *
 * ── BOOKINGS STARTED IS EVERY BOOKING ROW ────────────────────────────────
 *
 * Including the ones that expired. A reserved-then-lapsed hold IS the
 * abandonment the conversion rate measures, so it belongs in the denominator;
 * counting only successful bookings would make conversion 100% for everyone.
 */
export function FunnelTable() {
  const query = useOrganizerFunnel();
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  if (query.isError) {
    return (
      <ErrorState
        message="Could not load the conversion table."
        onRetry={() => void query.refetch()}
        className="rounded-xl border border-border bg-surface shadow-sm"
      />
    );
  }

  return (
    <section className="flex flex-col gap-stack">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body font-semibold text-foreground">Conversion by event</h2>
        <p className="text-caption text-muted-foreground">
          Every figure is a count of real bookings and tickets
        </p>
      </div>

      {/* The table scrolls INSIDE its own container rather than letting the
          page scroll sideways — eight numeric columns do not fit a phone, and
          a dashboard whose body scrolls horizontally loses the sidebar. */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
        <table className="w-full min-w-[52rem] border-collapse text-body-sm">
          <caption className="sr-only">
            Conversion, quota fill and repeat-attendee share for each of your events
          </caption>
          <thead>
            <tr className="border-b border-border text-left">
              <Th className="w-[28%]">Event</Th>
              <Th numeric>Started</Th>
              <Th numeric>Paid</Th>
              <Th numeric>Conversion</Th>
              <Th numeric>Sold</Th>
              <Th numeric>Quota fill</Th>
              <Th numeric>Revenue</Th>
              <Th numeric>Repeat</Th>
            </tr>
          </thead>
          <tbody>
            {query.isPending
              ? Array.from({ length: 4 }, (_, index) => <SkeletonRow key={index} />)
              : rows.map((row) => <Row key={row.id} row={row} />)}
          </tbody>
        </table>

        {!query.isPending && rows.length === 0 ? (
          <EmptyState
            title="No events yet"
            body="Conversion appears here once an event has taken its first booking."
          />
        ) : null}
      </div>

      {query.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more events
        </Button>
      ) : null}
    </section>
  );
}

function Th({
  children,
  numeric,
  className,
}: {
  children: React.ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={[
        'px-card py-stack text-label font-semibold text-muted-foreground',
        numeric ? 'text-right' : 'text-left',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </th>
  );
}

function Row({ row }: { row: OrganizerFunnelRow }) {
  return (
    <tr className="border-b border-border transition-colors last:border-0 hover:bg-muted/40">
      <td className="px-card py-stack">
        <Link
          href={`/dashboard/events/${row.id}/analytics`}
          className="rounded font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.title}
        </Link>
        <div className="mt-1">
          <StatusBadge status={row.status} />
        </div>
      </td>
      <Td>{row.bookings_started.toLocaleString('en-IN')}</Td>
      <Td>{row.bookings_paid.toLocaleString('en-IN')}</Td>
      <Td>
        <Percent value={row.conversion_pct} />
      </Td>
      <Td>
        {row.tickets_sold.toLocaleString('en-IN')}
        <span className="text-muted-foreground"> / {row.capacity.toLocaleString('en-IN')}</span>
      </Td>
      <td className="px-card py-stack">
        <div className="flex justify-end">
          {row.quota_fill_pct === null ? (
            // No capacity means no tiers yet — a ring at 0% would claim the
            // event is selling badly rather than that it is not on sale.
            <NotMeasured hint="No tickets set up" />
          ) : (
            <ProgressRing
              value={row.quota_fill_pct}
              label={`${row.title}: ${Math.round(row.quota_fill_pct)}% of capacity sold`}
              size={44}
              strokeWidth={5}
              tone={row.quota_fill_pct >= 90 ? 'positive' : 'measure'}
            >
              <span className="text-caption font-semibold tabular-nums">
                {Math.round(row.quota_fill_pct)}
              </span>
            </ProgressRing>
          )}
        </div>
      </td>
      <Td>{formatMoney(row.revenue_minor)}</Td>
      <Td>
        <Percent value={row.repeat_attendee_pct} hint="No paid attendees yet" />
      </Td>
    </tr>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-card py-stack text-right tabular-nums text-foreground">{children}</td>;
}

/**
 * A percentage, or an honest blank.
 *
 * Null here means the denominator was zero — no bookings started, or nobody
 * has paid. Rendering "0%" for that would be a measurement nobody took, and
 * this whole table exists to avoid exactly that.
 */
function Percent({ value, hint }: { value: number | null; hint?: string }) {
  if (value === null) return <NotMeasured hint={hint ?? 'Nothing to measure yet'} />;
  return <span>{value.toFixed(1)}%</span>;
}

function NotMeasured({ hint }: { hint: string }) {
  return (
    <span className="text-muted-foreground" title={hint}>
      <span aria-hidden>—</span>
      <span className="sr-only">{hint}</span>
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-card py-stack">
        <Skeleton className="h-4 w-40" />
      </td>
      {Array.from({ length: 7 }, (_, index) => (
        <td key={index} className="px-card py-stack">
          <Skeleton className="ml-auto h-4 w-12" />
        </td>
      ))}
    </tr>
  );
}
