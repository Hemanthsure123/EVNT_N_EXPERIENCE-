'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CreditCard, Undo2 } from 'lucide-react';
import {
  fetchAdminPayments,
  fetchAdminRefunds,
  type AdminPayment,
  type AdminRefund,
} from '@/lib/api/admin';
import { cursorFromNextLink } from '@/lib/api/events';
import { formatMoney } from '@/lib/discovery/format';
import { useDataTable, type ColumnDef } from '@/lib/organizer/table';
import { useDebouncedValue } from '@/lib/utils/use-debounced-value';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, StatusPill } from '@/components/organizer/primitives';
import {
  ColumnChooser,
  DataGrid,
  DensityToggle,
  ExportButton,
  SavedViews,
  TableSkeleton,
  TableToolbar,
} from '@/components/organizer/data-table';
import { SearchField, SelectFilter } from '@/components/organizer/filters';
import { useConsoleDateWindow } from '@/components/admin/filters';
import { cn } from '@/lib/utils/cn';

/**
 * Payment operations.
 *
 * ── TWO TABS, BECAUSE THEY ARE TWO DIFFERENT LEDGERS ──────────────────────
 *
 * Transactions are attempts — created, paid, failed, refunded. Refunds are
 * completed reversals. Merging them into one list would mean a `type` column
 * doing the work a tab does better, and would make "how much came in today"
 * require reading a filter.
 *
 * ── EVERY ROW IS A REFERENCE AN OPERATOR CAN QUOTE ────────────────────────
 *
 * The provider's own payment id is the thing support and the vendor both
 * speak. It is searchable, exportable and copyable, because the alternative is
 * an operator transcribing it from a screenshot into a ticket.
 *
 * ── WHAT THIS SURFACE DOES NOT DO, AND WHY ────────────────────────────────
 *
 * **It does not refund.** `POST /payments/{id}/refund` exists and is organizer
 * or admin gated, so the capability is there — but a refund from a
 * platform-wide list, one click from a row an operator was merely scanning, is
 * the wrong shape for an irreversible money movement. It belongs on the
 * booking it reverses, with the amount and the customer in view.
 *
 * **There are no chargebacks.** Nothing records one: a dispute arrives by
 * webhook from the provider, and this platform handles exactly one webhook
 * event (payment captured). A "Chargebacks" tab would be permanently empty and
 * would imply the platform is watching for something it is not. BACKLOG item
 * 52 specifies the webhook, the model and the notification.
 *
 * **There is no manual review queue.** No payment is ever held for a human —
 * the webhook either confirms and issues tickets or refunds automatically.
 * A queue with nothing that can enter it is furniture. BACKLOG item 53.
 *
 * ── NOTHING ON THIS SCREEN IS A FILLED BUTTON ─────────────────────────────
 *
 * Because nothing on it acts. Every control here narrows, sorts or exports a
 * view of money that has already moved, and a solid pill in a toolbar of read
 * controls would claim to be the thing to press. The one thing that would earn
 * it — issuing a refund — deliberately lives on the booking instead, for the
 * reason above.
 */

type Tab = 'transactions' | 'refunds';

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'paid', label: 'Paid' },
  { value: 'created', label: 'Started, not paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
];

/**
 * The ledger tab pill.
 *
 * Butter (`--nav-active`), the console's one "you are here" fill — the same
 * token as the active nav item and every applied filter. 44px on a phone,
 * 36px from `sm` up.
 */
const tabClass = (active: boolean) =>
  cn(
    'inline-flex h-control items-center rounded-full border px-pill text-label sm:h-control-sm',
    'transition-colors duration-fast motion-reduce:transition-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  );

export function PaymentsConsole() {
  const [tab, setTab] = React.useState<Tab>('transactions');

  return (
    <div className="flex flex-col gap-stack-lg">
      <div role="tablist" aria-label="Payment ledgers" className="flex gap-1.5">
        {(
          [
            { value: 'transactions', label: 'Transactions' },
            { value: 'refunds', label: 'Refunds' },
          ] as const
        ).map((entry) => (
          <button
            key={entry.value}
            role="tab"
            type="button"
            aria-selected={tab === entry.value}
            onClick={() => setTab(entry.value)}
            className={tabClass(tab === entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {tab === 'transactions' ? <Transactions /> : <Refunds />}
      </div>
    </div>
  );
}

function Transactions() {
  const [term, setTerm] = React.useState('');
  const [status, setStatus] = React.useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const dates = useConsoleDateWindow();

  const query = useInfiniteQuery({
    // The window is part of the key: it changes WHICH rows a cursor walks, and
    // one cache entry across two windows would append the second window's
    // pages onto the first window's list.
    queryKey: ['admin', 'payments', { search, status, dates: dates.key }],
    queryFn: ({ pageParam }) =>
      fetchAdminPayments({
        q: search || undefined,
        status: status || undefined,
        ...dates.window,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const table = useDataTable<AdminPayment>({
    id: 'admin-payments',
    columns: PAYMENT_COLUMNS,
    rows,
    rowId: (row) => row.id,
  });

  // Captured money only. Summing every row would count abandoned checkouts and
  // refunded charges as income, which is the wrong number on a finance screen.
  const captured = rows
    .filter((row) => row.status === 'paid')
    .reduce((sum, row) => sum + row.amount_minor, 0);

  return (
    <div className="flex flex-col">
      <TableToolbar>
        <SearchField
          value={term}
          onChange={setTerm}
          placeholder="Reference or customer email"
          label="Search payments"
        />
        <SelectFilter
          value={status}
          onChange={setStatus}
          options={STATUS_FILTERS}
          label="Filter by status"
        />
        {dates.control}
        <p className="text-caption text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{formatMoney(captured)}</span>{' '}
          captured in the rows loaded
        </p>
        <div className="ml-auto flex items-center gap-2">
          <SavedViews
            table={table}
            currentQuery={new URLSearchParams({ q: term, status }).toString()}
            onApply={(query) => {
              const params = new URLSearchParams(query);
              setTerm(params.get('q') ?? '');
              setStatus(params.get('status') ?? '');
            }}
          />
          <DensityToggle table={table} />
          <ColumnChooser table={table} />
          <ExportButton table={table} filename="payments.csv" disabled={query.isPending} />
        </div>
      </TableToolbar>

      {query.isError ? (
        <ErrorState message="Could not load payments." onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <TableSkeleton rows={8} columns={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={term || status ? 'No payments match' : 'No payments yet'}
          body="Every charge attempt across the platform appears here the moment the provider reports it."
        />
      ) : (
        <DataGrid
          table={table}
          caption="Every payment on the platform"
          selectable={false}
          loading={query.isFetchingNextPage}
        />
      )}

      <LoadMore query={query} sorted={table.sort.length > 0} count={rows.length} noun="payment" />
    </div>
  );
}

function Refunds() {
  const [term, setTerm] = React.useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const dates = useConsoleDateWindow();

  const query = useInfiniteQuery({
    queryKey: ['admin', 'refunds', { search, dates: dates.key }],
    queryFn: ({ pageParam }) =>
      fetchAdminRefunds({
        q: search || undefined,
        ...dates.window,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const table = useDataTable<AdminRefund>({
    id: 'admin-refunds',
    columns: REFUND_COLUMNS,
    rows,
    rowId: (row) => row.id,
  });

  const total = rows.reduce((sum, row) => sum + row.amount_minor, 0);

  return (
    <div className="flex flex-col">
      <TableToolbar>
        <SearchField
          value={term}
          onChange={setTerm}
          placeholder="Reference or customer email"
          label="Search refunds"
        />
        {dates.control}
        <p className="text-caption text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{formatMoney(total)}</span>{' '}
          returned in the rows loaded
        </p>
        <div className="ml-auto flex items-center gap-2">
          <DensityToggle table={table} />
          <ColumnChooser table={table} />
          <ExportButton table={table} filename="refunds.csv" disabled={query.isPending} />
        </div>
      </TableToolbar>

      {query.isError ? (
        <ErrorState message="Could not load refunds." onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <TableSkeleton rows={6} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Undo2}
          title={term ? 'No refunds match' : 'No refunds'}
          body="Recorded once the provider confirms the money has gone back."
        />
      ) : (
        <DataGrid
          table={table}
          caption="Refunds across the platform"
          selectable={false}
          loading={query.isFetchingNextPage}
        />
      )}

      <LoadMore query={query} sorted={table.sort.length > 0} count={rows.length} noun="refund" />
    </div>
  );
}

function LoadMore({
  query,
  sorted,
  count,
  noun,
}: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
  sorted: boolean;
  count: number;
  noun: string;
}) {
  if (!query.hasNextPage) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 border-t border-border py-4">
      <Button
        variant="outline"
        onClick={() => void query.fetchNextPage()}
        loading={query.isFetchingNextPage}
      >
        Load more
      </Button>
      {sorted ? (
        // The one thing this table must not let an operator believe.
        <p className="text-caption text-muted-foreground">
          Sorted within the {count} {noun}s loaded so far, not across the whole ledger.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ columns */

const PAYMENT_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> =
  {
    paid: { label: 'Paid', tone: 'success' },
    created: { label: 'Not completed', tone: 'warning' },
    failed: { label: 'Failed', tone: 'danger' },
    refunded: { label: 'Refunded', tone: 'neutral' },
  };

const PAYMENT_COLUMNS: ColumnDef<AdminPayment>[] = [
  {
    key: 'customer',
    header: 'Customer',
    width: 220,
    minWidth: 140,
    hideable: false,
    sortValue: (row) => row.customer_email,
    render: (row) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{row.customer_name || row.customer_email}</span>
        {row.customer_name ? (
          <span className="truncate text-caption text-muted-foreground">{row.customer_email}</span>
        ) : null}
      </span>
    ),
    exportValue: (row) => row.customer_email,
  },
  {
    key: 'event_title',
    header: 'Event',
    width: 200,
    sortValue: (row) => row.event_title,
    render: (row) => (
      <Link
        href={`/admin/moderation?event=${row.event_id}`}
        onClick={(event) => event.stopPropagation()}
        className="truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {row.event_title}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: 140,
    sortValue: (row) => row.status,
    render: (row) => {
      const badge = PAYMENT_STATUS[row.status] ?? { label: row.status, tone: 'neutral' as const };
      return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
    },
    exportValue: (row) => row.status,
  },
  {
    key: 'amount_minor',
    header: 'Amount',
    width: 120,
    numeric: true,
    sortValue: (row) => row.amount_minor,
    render: (row) => formatMoney(row.amount_minor),
    // Major units, so a finance spreadsheet summing the column is not out by a
    // factor of a hundred.
    exportValue: (row) => row.amount_minor / 100,
  },
  {
    key: 'platform_fee_minor',
    header: 'Platform fee',
    width: 120,
    numeric: true,
    defaultHidden: true,
    sortValue: (row) => row.platform_fee_minor,
    render: (row) => formatMoney(row.platform_fee_minor),
    exportValue: (row) => row.platform_fee_minor / 100,
  },
  {
    key: 'created_at',
    header: 'When',
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
    key: 'provider_payment_id',
    header: 'Payment reference',
    width: 200,
    // ── A REFERENCE IS SEARCHED BY, NOT SCANNED ──────────────────────────
    //
    // Provider ids are how an operator finds ONE row when a customer quotes
    // one — and the search box above already searches them. Nobody reads a
    // column of `order_TPxZ6pXVXUXwyM` down the page, but every row paid ~180px
    // for it, which is what pushed these tables into horizontal scroll and cut
    // off the columns that ARE scanned. One click in Columns brings it back.
    defaultHidden: true,
    sortValue: (row) => row.provider_payment_id,
    render: (row) =>
      row.provider_payment_id ? (
        <span className="truncate font-mono text-caption text-muted-foreground">
          {row.provider_payment_id}
        </span>
      ) : (
        <span className="text-muted-foreground" title="No charge was captured">
          —
        </span>
      ),
  },
  {
    key: 'provider_order_id',
    header: 'Order reference',
    width: 200,
    defaultHidden: true,
    sortValue: (row) => row.provider_order_id,
    render: (row) => (
      <span className="truncate font-mono text-caption text-muted-foreground">
        {row.provider_order_id}
      </span>
    ),
  },
];

const REFUND_COLUMNS: ColumnDef<AdminRefund>[] = [
  {
    key: 'customer_email',
    header: 'Customer',
    width: 220,
    minWidth: 140,
    hideable: false,
    sortValue: (row) => row.customer_email,
    render: (row) => <span className="truncate font-medium">{row.customer_email}</span>,
  },
  {
    key: 'event_title',
    header: 'Event',
    width: 200,
    sortValue: (row) => row.event_title,
    render: (row) => <span className="truncate text-muted-foreground">{row.event_title}</span>,
  },
  {
    key: 'amount_minor',
    header: 'Refunded',
    width: 120,
    numeric: true,
    sortValue: (row) => row.amount_minor,
    render: (row) => formatMoney(row.amount_minor),
    exportValue: (row) => row.amount_minor / 100,
  },
  {
    key: 'payment_amount_minor',
    header: 'Of payment',
    width: 120,
    numeric: true,
    // The original payment's amount, kept only as context for `is_partial` —
    // which is COMPUTED from this against the refund and already states the
    // answer. Two columns to say one thing, on the widest table here.
    defaultHidden: true,
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
    width: 240,
    sortValue: (row) => row.reason,
    render: (row) =>
      row.reason ? (
        // Shown as stored. Two of these codes mean the PLATFORM refunded
        // automatically, which an operator needs to tell apart from a person
        // deciding to — prettifying them into one sentence would lose that.
        <span className="truncate text-muted-foreground" title={row.reason}>
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
    header: 'When',
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
    header: 'Refund reference',
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

const SYSTEM_REASONS: Record<string, string> = {
  hold_expired: 'Automatic — the hold lapsed before payment was confirmed',
  amount_mismatch: 'Automatic — the captured amount did not match the booking',
};
