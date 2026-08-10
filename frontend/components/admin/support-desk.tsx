'use client';

import * as React from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Search, Ticket as TicketIcon, X } from 'lucide-react';
import {
  fetchAdminBooking,
  fetchAdminBookings,
  type AdminBooking,
  type AdminBookingDetail,
} from '@/lib/api/admin';
import { cursorFromNextLink } from '@/lib/api/events';
import { formatMoney } from '@/lib/discovery/format';
import { useDataTable, type ColumnDef } from '@/lib/organizer/table';
import { useDebouncedValue } from '@/lib/utils/use-debounced-value';
import { SpotLookup } from '@/components/illustrations/spots';
import { EmptyState, ErrorState, StatusPill } from '@/components/organizer/primitives';
import {
  ColumnChooser,
  DataGrid,
  DensityToggle,
  ExportButton,
  TableSkeleton,
  TableToolbar,
} from '@/components/organizer/data-table';
import { SearchField, SelectFilter } from '@/components/organizer/filters';
import { useConsoleDateWindow } from '@/components/admin/filters';
import { EventPicker, type PickedEvent } from '@/components/admin/event-picker';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * ── THE SUPPORT DESK ──────────────────────────────────────────────────────
 *
 * "The customer says they paid but has no ticket" is the single most common
 * question a ticketing platform's support gets, and until this screen it could
 * not be answered from the product at all. `GET /bookings/{id}` is scoped to
 * the booking's own OWNER, so an operator could not open one even holding the
 * id — the only route was the Django admin.
 *
 * The Payments surface partly covered it and structurally could not cover it
 * fully: a booking that never reached payment has no `Payment` row to be found
 * by, and that abandoned checkout is precisely what people phone about.
 *
 * ── ONE SEARCH BOX, NOT FOUR ──────────────────────────────────────────────
 *
 * An operator on a call is holding ONE string read aloud to them and does not
 * know what kind of thing it is — an email, a booking reference off a
 * confirmation, a payment reference off a bank statement, or just the name of
 * the gig. The backend matches all four (and a booking id by PREFIX, because
 * people read out the first block of a uuid, not all thirty-six characters).
 * Asking somebody to classify what they are holding before searching is a
 * worse tool.
 *
 * ── THE ANSWER IS ON THE ROW, NOT BEHIND A CLICK ──────────────────────────
 *
 * `Tickets` is a column. The whole question is whether tickets were issued, and
 * making an operator open each result to see it would defeat the search that
 * got them there.
 *
 * ── AND `reserved` IS SPLIT INTO TWO THINGS ───────────────────────────────
 *
 * A live hold and a lapsed one are both `reserved` in the database and mean
 * completely different things to the person on the phone: one is "wait ninety
 * seconds", the other is "the seats went back on sale". The backend computes
 * `is_expired_hold` from the pair rather than storing it — the sweeper may not
 * have run — and this table renders them as two different states.
 *
 * ── NO QR TOKEN, ANYWHERE ─────────────────────────────────────────────────
 *
 * The drawer lists a booking's tickets with their status, and never the code.
 * The token is the credential that admits somebody; an operator needs to know
 * tickets EXIST and whether they have been used, never the code itself.
 * Including it would make every operator session a set of usable tickets. The
 * backend does not send it, so this is enforced rather than agreed.
 *
 * ── THIS SCREEN DOES NOT ACT ──────────────────────────────────────────────
 *
 * No refund button, no cancel, no resend. It answers a question. A refund from
 * a platform-wide search result, one click from a row somebody was scanning,
 * is the wrong shape for an irreversible money movement — the same call
 * `components/admin/payments.tsx` makes and for the same reason. Refunds are
 * decided on the refund-request queue, with the customer's own words in view.
 */

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'paid', label: 'Paid' },
  { value: 'reserved', label: 'Holding' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];

/** The row's state, as an operator would say it out loud. */
function bookingTone(row: AdminBooking): {
  label: string;
  tone: 'success' | 'warning' | 'neutral' | 'danger';
} {
  if (row.status === 'paid') return { label: 'Paid', tone: 'success' };
  if (row.status === 'reserved') {
    // The distinction that decides what an operator tells the caller.
    return row.is_expired_hold
      ? { label: 'Hold lapsed', tone: 'danger' }
      : { label: 'Holding', tone: 'warning' };
  }
  if (row.status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
  return { label: 'Expired', tone: 'neutral' };
}

const COLUMNS: ColumnDef<AdminBooking>[] = [
  {
    key: 'customer',
    header: 'Customer',
    width: 210,
    minWidth: 150,
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
    width: 190,
    sortValue: (row) => row.event_title,
    render: (row) => <span className="truncate text-muted-foreground">{row.event_title}</span>,
    exportValue: (row) => row.event_title,
  },
  {
    key: 'status',
    header: 'Status',
    width: 130,
    sortValue: (row) => row.status,
    render: (row) => {
      const state = bookingTone(row);
      return <StatusPill tone={state.tone}>{state.label}</StatusPill>;
    },
    exportValue: (row) => bookingTone(row).label,
  },
  {
    key: 'tickets',
    header: 'Tickets',
    width: 110,
    sortValue: (row) => row.tickets_issued,
    // THE column. "Were any issued?" is the whole question this screen exists
    // for, so it is answered in the list rather than in the drawer.
    render: (row) => (
      <span
        className={cn(
          'tabular-nums',
          row.status === 'paid' && row.tickets_issued === 0
            ? // Paid with nothing issued is the alarming combination, and the
              // only one worth colouring.
              'font-semibold text-destructive'
            : 'text-muted-foreground',
        )}
      >
        {row.tickets_issued} of {row.quantity}
      </span>
    ),
    exportValue: (row) => `${row.tickets_issued}/${row.quantity}`,
  },
  {
    key: 'total',
    header: 'Total',
    width: 120,
    numeric: true,
    sortValue: (row) => row.total_amount_minor,
    render: (row) => <span className="tabular-nums">{formatMoney(row.total_amount_minor)}</span>,
    exportValue: (row) => String(row.total_amount_minor / 100),
  },
  {
    key: 'payment_ref',
    header: 'Payment ref',
    width: 170,
    sortValue: (row) => row.payment_ref,
    render: (row) => (
      <span className="truncate font-mono text-caption text-muted-foreground">
        {row.payment_ref || row.payment_order_id || '—'}
      </span>
    ),
    exportValue: (row) => row.payment_ref || row.payment_order_id,
  },
  {
    key: 'created_at',
    header: 'Booked',
    width: 150,
    sortValue: (row) => row.created_at,
    render: (row) => (
      <span className="text-muted-foreground">
        {new Date(row.created_at).toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    ),
    exportValue: (row) => row.created_at,
  },
];

export function SupportDesk() {
  const [term, setTerm] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const search = useDebouncedValue(term.trim(), 250);
  const dates = useConsoleDateWindow();
  const [event, setEvent] = React.useState<PickedEvent | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['admin', 'bookings', { search, status, dates: dates.key, event: event?.id }],
    queryFn: ({ pageParam }) =>
      fetchAdminBookings({
        q: search || undefined,
        status: status || undefined,
        // The id, never the title — two events share a name often enough that
        // a text match would silently sum both.
        event_id: event?.id,
        ...dates.window,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    // Never served stale: an operator is on a call and the booking may have
    // changed between the customer paying and them looking.
    staleTime: 0,
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const table = useDataTable<AdminBooking>({
    id: 'admin-bookings',
    columns: COLUMNS,
    rows,
    rowId: (row) => row.id,
  });

  return (
    <div className="flex flex-col gap-stack-lg">
      <TableToolbar>
        <SearchField
          value={term}
          onChange={setTerm}
          placeholder="Email, booking id, payment reference or event"
          label="Search bookings"
        />
        <SelectFilter
          value={status}
          onChange={setStatus}
          options={STATUS_FILTERS}
          label="Filter by status"
        />
        <EventPicker value={event} onChange={setEvent} />
        {dates.control}
        <div className="ml-auto flex items-center gap-2">
          <DensityToggle table={table} />
          <ColumnChooser table={table} />
          <ExportButton table={table} filename="bookings.csv" disabled={query.isPending} />
        </div>
      </TableToolbar>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {query.isError ? (
          <ErrorState message="Could not load bookings." onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <TableSkeleton rows={8} columns={COLUMNS.length} />
        ) : rows.length === 0 ? (
          // Two genuinely different empty states. Before a search this is not
          // "no results" — it is the resting state of a tool that waits to be
          // asked, and saying "no bookings found" there would be a false
          // negative about the whole platform.
          search || status ? (
            <EmptyState
              icon={Search}
              title="Nothing matched that"
              body="Search by email, booking reference or payment reference."
            />
          ) : (
            <div className="flex flex-col items-center gap-4 px-card py-14 text-center">
              <SpotLookup className="size-24" />
              <div className="flex max-w-md flex-col gap-1.5">
                <h2 className="text-body font-semibold text-foreground">Look up a booking</h2>
                <p className="text-body-sm text-muted-foreground">
                  Search by email, booking reference, payment reference or event name.
                  Partial references work.
                </p>
              </div>
            </div>
          )
        ) : (
          <DataGrid
            table={table}
            caption="Every booking on the platform"
            selectable={false}
            loading={query.isFetchingNextPage}
            onOpen={(row) => setOpenId(row.id)}
          />
        )}
        {query.hasNextPage ? (
          <div className="flex flex-col items-center gap-1.5 border-t border-border py-4">
            <Button
              variant="outline"
              onClick={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
            >
              Load more
            </Button>
            {table.sort.length > 0 ? (
              // The one thing this table must not let an operator believe.
              <p className="text-caption text-muted-foreground">
                Sorted within the {rows.length} bookings loaded so far, not across the platform.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <BookingDrawer bookingId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/**
 * The booking an operator opens mid-call.
 *
 * A drawer rather than a route, because they are reading it out to somebody and
 * will go straight back to the list for the next one. A route would lose the
 * search they typed.
 */
function BookingDrawer({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['admin', 'booking', bookingId],
    queryFn: () => fetchAdminBooking(bookingId as string),
    enabled: Boolean(bookingId),
    staleTime: 0,
  });

  return (
    <Drawer open={Boolean(bookingId)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <DrawerTitle>Booking</DrawerTitle>
        {query.isPending ? (
          <p className="text-body-sm text-muted-foreground">Loading…</p>
        ) : query.isError || !query.data ? (
          <ErrorState message="Could not load that booking." onRetry={() => void query.refetch()} />
        ) : (
          <BookingSummary booking={query.data} />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function BookingSummary({ booking }: { booking: AdminBookingDetail }) {
  const state = bookingTone(booking);
  const paidWithNoTickets = booking.status === 'paid' && booking.tickets_issued === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* The verdict FIRST. An operator is on a call and needs the answer in
          the first line, not after reading a table. */}
      <div
        className={cn(
          'flex items-start gap-3 rounded-xl border p-card',
          paidWithNoTickets
            ? 'border-destructive-subtle bg-destructive-subtle'
            : 'border-border bg-sunken',
        )}
      >
        {paidWithNoTickets ? (
          <AlertTriangle
            className="mt-0.5 size-5 shrink-0 text-destructive-subtle-foreground"
            aria-hidden
          />
        ) : (
          <Check className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="flex flex-col gap-1">
          <p
            className={cn(
              'text-body font-semibold',
              paidWithNoTickets ? 'text-destructive-subtle-foreground' : 'text-foreground',
            )}
          >
            {paidWithNoTickets
              ? 'Paid, but no tickets were issued'
              : booking.status === 'paid'
                ? `${booking.tickets_issued} ticket${booking.tickets_issued === 1 ? '' : 's'} issued`
                : booking.is_expired_hold
                  ? 'The hold lapsed — these seats went back on sale'
                  : `This booking is ${state.label.toLowerCase()}`}
          </p>
          <p
            className={cn(
              'text-body-sm',
              paidWithNoTickets ? 'text-destructive-subtle-foreground' : 'text-muted-foreground',
            )}
          >
            {paidWithNoTickets
              ? 'The platform refunds this automatically once reconciliation runs. Check the payment before intervening manually.'
              : booking.status === 'paid'
                ? 'The customer can see these in their account under My tickets.'
                : 'Nothing was charged for this booking.'}
          </p>
        </div>
      </div>

      <Facts
        rows={[
          ['Customer', booking.customer_name || booking.customer_email],
          ['Email', booking.customer_email],
          ['Event', booking.event_title],
          ['Booking reference', booking.id],
          ['Payment reference', booking.payment_ref || booking.payment_order_id || '—'],
          ['Total', formatMoney(booking.total_amount_minor)],
          ['Platform fee', formatMoney(booking.platform_fee_minor)],
          ['Booked', new Date(booking.created_at).toLocaleString('en-IN')],
        ]}
      />

      <section className="flex flex-col gap-2">
        <h3 className="text-label uppercase tracking-wide text-foreground-subtle">
          What they bought
        </h3>
        <ul className="flex flex-col gap-1.5">
          {booking.items.map((item) => (
            <li
              key={item.ticket_type_id}
              className="flex items-baseline justify-between gap-4 text-body-sm"
            >
              <span className="text-foreground">
                {item.quantity} × {item.ticket_type_name}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatMoney(item.unit_price_minor)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-label uppercase tracking-wide text-foreground-subtle">Tickets</h3>
        {booking.tickets.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            None issued. Tickets are created when a payment is confirmed.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {booking.tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <TicketIcon className="size-4 shrink-0 text-foreground-subtle" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-sm text-foreground">
                      {ticket.ticket_type_name}
                    </span>
                    {ticket.attendee_name ? (
                      <span className="truncate text-caption text-muted-foreground">
                        {ticket.attendee_name}
                      </span>
                    ) : null}
                  </span>
                </span>
                {ticket.status === 'used' ? (
                  <StatusPill tone="neutral">
                    Used{ticket.gate ? ` · ${ticket.gate}` : ''}
                  </StatusPill>
                ) : ticket.status === 'void' ? (
                  <StatusPill tone="danger">Void</StatusPill>
                ) : (
                  <StatusPill tone="success">Valid</StatusPill>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* Said out loud rather than left to be noticed. An operator who
            expects to find a QR here and does not should know it is a decision
            rather than a gap. */}
        <p className="flex items-start gap-1.5 text-caption text-foreground-subtle">
          <X className="mt-0.5 size-3 shrink-0" aria-hidden />
          Entry codes are never shown here. Use the check-in scanner to verify a code a
          holder presents.
        </p>
      </section>
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="flex flex-col divide-y divide-border rounded-xl border border-border">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 px-3 py-2.5">
          <dt className="shrink-0 text-body-sm text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate text-right text-body-sm text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
