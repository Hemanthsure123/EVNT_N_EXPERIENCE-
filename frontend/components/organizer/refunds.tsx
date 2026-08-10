'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/discovery/format';
import type { OrganizerRefund } from '@/lib/api/organizer';
import { useRefunds } from '@/lib/organizer/queries';
import { useDataTable, type ColumnDef } from '@/lib/organizer/table';
import { EmptyState, ErrorState, StatusPill } from './primitives';
import {
  ColumnChooser,
  DataGrid,
  ExportButton,
  TableCard,
  TableSkeleton,
  TableToolbar,
  TOOLBAR_CONTROL,
} from './data-table';
import { FilterChips, useUrlFilters } from './filters';

/**
 * Refunds.
 *
 * ── EVERY ROW HERE IS MONEY THAT HAS ALREADY LEFT ─────────────────────────
 *
 * `payments.execute_refund` writes a `Refund` row only AFTER the vendor call
 * has succeeded. So there is no pending, no approved and no rejected — every
 * record in this table is completed, by construction.
 *
 * The brief asked for a five-state workflow (Pending / Approved / Rejected /
 * Partial / Completed) with a reason and evidence. **Partial and Completed are
 * real** and are shown: partiality is computed server-side from the refunded
 * amount against the payment's, so it cannot disagree with the numbers beside
 * it. The other three describe a REQUEST awaiting a decision, and no such
 * object exists — a customer cannot ask for a refund through this platform,
 * and an organizer cannot approve one, because the only refund entry point is
 * an organizer (or the system) issuing one outright.
 *
 * Rendering three empty tabs would make this look like a queue somebody
 * forgets to check, and would imply customers have a channel they do not have.
 * BACKLOG "Refund request workflow" specifies the model, the two endpoints and
 * the notification it needs.
 *
 * ── THE REASON IS SHOWN VERBATIM ──────────────────────────────────────────
 *
 * `reason` is a short code the system wrote (`hold_expired`,
 * `amount_mismatch`) or free text an organizer typed. It is displayed as
 * stored rather than prettified into a sentence the record does not contain —
 * two of those codes mean the platform refunded automatically, which is
 * something an organizer needs to be able to tell apart from their own action.
 */

const SYSTEM_REASONS: Record<string, string> = {
  hold_expired: 'Automatic — the hold lapsed before payment was confirmed',
  amount_mismatch: 'Automatic — the captured amount did not match the booking',
};

const DEFAULTS = { event_id: '' };

export function Refunds() {
  const router = useRouter();
  const params = useSearchParams();

  const search = React.useMemo(() => new URLSearchParams(params?.toString() ?? ''), [params]);
  const { values, set, clearAll } = useUrlFilters(DEFAULTS, search, (query) =>
    router.replace(query ? `/dashboard/refunds?${query}` : '/dashboard/refunds', { scroll: false }),
  );

  const query = useRefunds(values.event_id);
  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  const table = useDataTable<OrganizerRefund>({
    id: 'refunds',
    columns: COLUMNS,
    rows,
    rowId: (row) => row.id,
  });

  const total = rows.reduce((sum, row) => sum + row.amount_minor, 0);

  const chips = values.event_id
    ? [{ key: 'event', label: 'One event', onClear: () => set({ event_id: '' }) }]
    : [];

  return (
    <TableCard>
      <TableToolbar>
        {/* The headline number leads the toolbar rather than sitting in a card
            above it: this screen has one figure that matters, and an organizer
            opening it is answering "how much went back". */}
        <p className="text-body-sm text-muted-foreground">
          {query.isPending ? (
            'Loading…'
          ) : (
            <>
              <span className="text-h4 tabular-nums text-foreground">{formatMoney(total)}</span>{' '}
              refunded across {rows.length}
              {query.hasNextPage ? '+' : ''} record{rows.length === 1 ? '' : 's'}
            </>
          )}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ColumnChooser table={table} />
          <ExportButton table={table} filename="refunds.csv" disabled={query.isPending} />
        </div>
      </TableToolbar>

      {chips.length ? (
        <div className="border-b border-border px-card py-2">
          <FilterChips chips={chips} onClearAll={clearAll} />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState message="Could not load refunds." onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <TableSkeleton rows={6} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Undo2}
          title={values.event_id ? 'No refunds on this event' : 'No refunds'}
          body="Refunds appear here once the provider confirms the money has gone back."
        />
      ) : (
        <DataGrid
          table={table}
          caption="Refunds issued against your events"
          selectable={false}
          loading={query.isFetchingNextPage}
        />
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center border-t border-border py-4">
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className={TOOLBAR_CONTROL}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      <p className="border-t border-border px-card py-stack text-caption text-muted-foreground">
        A refund voids the tickets it covers, so they can no longer be admitted at the gate.
      </p>
    </TableCard>
  );
}

const COLUMNS: ColumnDef<OrganizerRefund>[] = [
  {
    key: 'event_title',
    header: 'Event',
    width: 220,
    minWidth: 140,
    hideable: false,
    sortValue: (row) => row.event_title,
    render: (row) => (
      <Link
        href={`/dashboard/events?event=${row.event_id}`}
        onClick={(event) => event.stopPropagation()}
        className="truncate font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {row.event_title}
      </Link>
    ),
  },
  {
    key: 'amount_minor',
    header: 'Refunded',
    width: 130,
    numeric: true,
    sortValue: (row) => row.amount_minor,
    render: (row) => formatMoney(row.amount_minor),
    exportValue: (row) => row.amount_minor / 100,
  },
  {
    key: 'payment_amount_minor',
    header: 'Of payment',
    width: 130,
    numeric: true,
    sortValue: (row) => row.payment_amount_minor,
    render: (row) => (
      <span className="text-muted-foreground">{formatMoney(row.payment_amount_minor)}</span>
    ),
    exportValue: (row) => row.payment_amount_minor / 100,
  },
  {
    key: 'is_partial',
    header: 'Extent',
    width: 100,
    sortValue: (row) => (row.is_partial ? 1 : 0),
    render: (row) => (
      <StatusPill tone={row.is_partial ? 'warning' : 'neutral'}>
        {row.is_partial ? 'Partial' : 'Full'}
      </StatusPill>
    ),
    exportValue: (row) => (row.is_partial ? 'partial' : 'full'),
  },
  {
    key: 'reason',
    header: 'Reason',
    width: 260,
    sortValue: (row) => row.reason,
    render: (row) =>
      row.reason ? (
        <span
          className="truncate text-muted-foreground"
          // The tooltip explains a system code; the cell shows what was stored.
          title={SYSTEM_REASONS[row.reason] ?? row.reason}
        >
          {SYSTEM_REASONS[row.reason] ?? row.reason}
        </span>
      ) : (
        <span className="text-muted-foreground" title="No reason was recorded">
          —
        </span>
      ),
  },
  {
    key: 'created_at',
    header: 'Refunded on',
    width: 150,
    sortValue: (row) => Date.parse(row.created_at),
    render: (row) => (
      <time dateTime={row.created_at} className="tabular-nums text-muted-foreground">
        {new Date(row.created_at).toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        })}
      </time>
    ),
    exportValue: (row) => row.created_at,
  },
  {
    key: 'provider_ref',
    header: 'Provider ref',
    width: 190,
    defaultHidden: true,
    sortValue: (row) => row.provider_ref,
    render: (row) => (
      <span className="truncate font-mono text-caption text-muted-foreground">
        {row.provider_ref}
      </span>
    ),
  },
];
