'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/discovery/format';
import type { BookingStatus, OrganizerBooking } from '@/lib/api/organizer';
import { useOrganizerBookings,
  useEventRows,
} from '@/lib/organizer/queries';
import { useDataTable, type ColumnDef } from '@/lib/organizer/table';
import { EmptyState, ErrorState } from './primitives';
import {
  ColumnChooser,
  DataGrid,
  ExportButton,
  TableCard,
  TableSkeleton,
  TableToolbar,
  TOOLBAR_CONTROL,
} from './data-table';
import {
  DateRangeFilter,
  FilterCluster,
  FilterChips,
  SearchField,
  SelectFilter,
  presetRange,
  useUrlFilters,
  type DateRange,
} from './filters';
import { BookingInspector } from './booking-inspector';
import { BookingBadge } from './status-badge';

/**
 * Orders across the organizer's events.
 *
 * This is the OTHER side of `GET /bookings/{id}`, which is scoped to the
 * attendee who booked. Neither party can see the other's list, which is why
 * this needed its own endpoint rather than a widened permission on the
 * existing one.
 *
 * ── THE DATE RANGE IS SERVER-SIDE ─────────────────────────────────────────
 *
 * `created_after`/`created_before`, not a client filter. The list is
 * cursor-paginated on `-created_at`, so a client-side window would mean paging
 * through everything to find the rows inside it — and would be wrong wherever
 * a page boundary falls inside the range. It is also served straight off the
 * cursor's own index, so it costs nothing.
 *
 * ── ACTIONS THAT EXIST AND ACTIONS THAT DO NOT ────────────────────────────
 *
 * The brief asked for View, Refund, Resend Ticket, Download Invoice and
 * Cancel. **View** is the inspector. **Refund** is real
 * (`POST /payments/{id}/refund`) but needs our `Payment.id`, and this row
 * carries `payment_ref` — the provider's id, a different value — so refunding
 * from here would be a guess on the money path; it lives on the Refunds
 * surface where the id is the right one. **Resend** has no endpoint
 * (notifications is event-driven with no re-send trigger), **invoices** are
 * generated nowhere, and **cancel-on-behalf-of** is scoped to the booking's
 * own owner. Each is in `frontend/BACKLOG.md` against the endpoint it needs.
 *
 * ── QR LOOKUP IS ON THE CHECK-IN SURFACE, NOT HERE ────────────────────────
 *
 * The brief lists it under Bookings. A QR token resolves to a TICKET, and the
 * only endpoint that reads one (`POST /checkin/verify`) also MARKS IT USED —
 * so "looking one up" from a bookings table would silently admit somebody.
 * The scanner is the honest home for it. BACKLOG "Read-only ticket lookup".
 *
 * ── NO FILLED BUTTON ON THIS SCREEN, AND THAT IS CORRECT ──────────────────
 *
 * Every action here reads: filter, search, choose columns, export, open a
 * booking. There is no create, no approve and no refund (see above), so there
 * is nothing to nominate as THE action — and a filled pill on "Export" would
 * point the eye at the least consequential control on the page.
 */

const STATUS_FILTERS: { value: '' | BookingStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'paid', label: 'Paid' },
  { value: 'reserved', label: 'Holding' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

const DEFAULTS = { q: '', status: '', event_id: '', preset: '', from: '', to: '' };

export function BookingsTable() {
  const router = useRouter();
  const params = useSearchParams();

  const search = React.useMemo(() => new URLSearchParams(params?.toString() ?? ''), [params]);
  const { values, set, clearAll } = useUrlFilters(DEFAULTS, search, (query) =>
    router.replace(query ? `/dashboard/bookings?${query}` : '/dashboard/bookings', {
      scroll: false,
    }),
  );

  const selectedId = params?.get('booking') ?? null;

  const range: DateRange = React.useMemo(() => {
    if (values.preset) return presetRange(Number(values.preset));
    return { from: values.from, to: values.to };
  }, [values.preset, values.from, values.to]);

  const query = useOrganizerBookings({
    q: values.q || undefined,
    status: values.status || undefined,
    event_id: values.event_id || undefined,
    created_after: range.from || undefined,
    created_before: range.to || undefined,
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  const table = useDataTable<OrganizerBooking>({
    id: 'bookings',
    columns: COLUMNS,
    rows,
    rowId: (row) => row.id,
  });

  // ── THE EVENT FILTER'S OPTIONS ─────────────────────────────────────────
  //
  // `event_id` was already in the filter state, already sent to the API and
  // already had a clear-chip — but nothing could SET it. It was reachable only
  // by editing the URL or by arriving from an event's own page, so an
  // organizer looking at every booking had no way to narrow to one event, and
  // the chip was an affordance for a filter that appeared from nowhere.
  //
  // The list is the organizer's own events, newest first, unfiltered by
  // status: bookings exist for finished and archived events too, and omitting
  // them would make their rows unreachable through the very control meant to
  // find them.
  const eventOptions = useEventRows({});
  const events = React.useMemo(
    () => eventOptions.data?.pages.flatMap((page) => page.data) ?? [],
    [eventOptions.data],
  );

  const chips = [
    values.q && { key: 'q', label: `“${values.q}”`, onClear: () => set({ q: '' }) },
    values.status && {
      key: 'status',
      label: STATUS_FILTERS.find((option) => option.value === values.status)?.label ?? values.status,
      onClear: () => set({ status: '' }),
    },
    values.event_id && {
      key: 'event',
      // Now that the picker loads the organizer's events, the title IS
      // available and the chip can name the event instead of saying "One
      // event" — an active filter should say which one. It falls back to the
      // old wording while the list is still loading, or when the filter
      // arrived by URL for an event outside the first page, so the chip is
      // never a bare uuid.
      label: events.find((event) => event.id === values.event_id)?.title ?? 'One event',
      onClear: () => set({ event_id: '' }),
    },
    (values.preset || values.from || values.to) && {
      key: 'date',
      label: values.preset ? `Last ${values.preset} days` : 'Custom dates',
      onClear: () => set({ preset: '', from: '', to: '' }),
    },
  ].filter(Boolean) as { key: string; label: string; onClear: () => void }[];

  const openRow = (id: string) => {
    const next = new URLSearchParams(search.toString());
    next.set('booking', id);
    router.replace(`/dashboard/bookings?${next.toString()}`, { scroll: false });
  };

  const closeRow = () => {
    const next = new URLSearchParams(search.toString());
    next.delete('booking');
    const encoded = next.toString();
    router.replace(encoded ? `/dashboard/bookings?${encoded}` : '/dashboard/bookings', {
      scroll: false,
    });
  };

  return (
    <TableCard>
      <TableToolbar>
        <SearchField
          value={values.q}
          onChange={(q) => set({ q })}
          placeholder="Name, email or payment reference"
          label="Search bookings"
        />

        {/* Same grouping as the events table: search stays visible because it
            is how people actually find a booking, and the three narrowing
            controls collapse behind one button on a phone. */}
        <FilterCluster count={chips.filter((chip) => chip.key !== 'q').length}>
          <SelectFilter
            value={values.status}
            onChange={(status) => set({ status })}
            options={STATUS_FILTERS.map((option) => ({ value: option.value, label: option.label }))}
            label="Filter by status"
          />

          <SelectFilter
            value={values.event_id}
            onChange={(event_id) => set({ event_id })}
            options={[
              { value: '', label: 'All events' },
              ...events.map((event) => ({ value: event.id, label: event.title })),
            ]}
            label="Filter by event"
          />

          <DateRangeFilter
            preset={values.preset}
            onPreset={(preset) => set({ preset })}
            custom={{ from: values.from, to: values.to }}
            onCustom={(next) => set({ from: next.from, to: next.to })}
            label="Booked"
          />
        </FilterCluster>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ColumnChooser table={table} />
          <ExportButton table={table} filename="bookings.csv" disabled={query.isPending} />
        </div>
      </TableToolbar>

      {chips.length ? (
        <div className="border-b border-border px-card py-2">
          <FilterChips chips={chips} onClearAll={clearAll} />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState message="Could not load bookings." onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <TableSkeleton rows={8} columns={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={chips.length ? 'No bookings match those filters' : 'No bookings yet'}
          body={
            chips.length
              ? 'Try clearing one — the chips above show which filters are active.'
              : 'Every order across your events appears here the moment it is placed, including holds that have not been paid for yet.'
          }
          action={
            chips.length ? (
              <Button variant="outline" onClick={clearAll}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataGrid
          table={table}
          caption="Bookings across your events"
          onOpen={(row) => openRow(row.id)}
          loading={query.isFetchingNextPage}
        />
      )}

      {query.hasNextPage ? (
        <div className="flex flex-col items-center gap-1.5 border-t border-border py-4">
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className={TOOLBAR_CONTROL}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
          {table.sort ? (
            <p className="text-caption text-muted-foreground">
              Sorted within the {rows.length} rows loaded so far, not across every booking.
            </p>
          ) : null}
          <p className="text-caption text-muted-foreground">
            Export covers the rows loaded so far{table.selected.size ? ', or your selection' : ''}.
          </p>
        </div>
      ) : null}

      <BookingInspector
        booking={rows.find((row) => row.id === selectedId) ?? null}
        onClose={closeRow}
      />
    </TableCard>
  );
}

/* ------------------------------------------------------------- the columns */

const COLUMNS: ColumnDef<OrganizerBooking>[] = [
  {
    key: 'customer',
    header: 'Customer',
    width: 220,
    minWidth: 140,
    hideable: false,
    sortValue: (row) => row.customer_name || row.customer_email,
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
    render: (row) => <span className="truncate text-muted-foreground">{row.event_title}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 110,
    sortValue: (row) => row.status,
    render: (row) => <BookingBadge status={row.status} />,
    exportValue: (row) => row.status,
  },
  {
    key: 'quantity',
    header: 'Tickets',
    width: 90,
    numeric: true,
    sortValue: (row) => row.quantity,
    render: (row) => row.quantity,
  },
  {
    key: 'total_amount_minor',
    header: 'Total',
    width: 120,
    numeric: true,
    sortValue: (row) => row.total_amount_minor,
    render: (row) => formatMoney(row.total_amount_minor),
    // Major units, so a finance spreadsheet summing this column is not out by
    // a factor of a hundred.
    exportValue: (row) => row.total_amount_minor / 100,
  },
  {
    key: 'platform_fee_minor',
    header: 'Fee',
    width: 100,
    numeric: true,
    defaultHidden: true,
    sortValue: (row) => row.platform_fee_minor,
    render: (row) => formatMoney(row.platform_fee_minor),
    exportValue: (row) => row.platform_fee_minor / 100,
  },
  {
    key: 'created_at',
    header: 'Booked',
    width: 140,
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
    key: 'payment_ref',
    header: 'Payment ref',
    width: 180,
    defaultHidden: true,
    sortValue: (row) => row.payment_ref,
    render: (row) =>
      row.payment_ref ? (
        <span className="truncate font-mono text-caption text-muted-foreground">
          {row.payment_ref}
        </span>
      ) : (
        <span className="text-muted-foreground" title="No payment captured yet">
          —
        </span>
      ),
  },
];
