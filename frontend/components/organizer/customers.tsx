'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Loader2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { formatMoney } from '@/lib/discovery/format';
import type { CustomerRow } from '@/lib/api/organizer';
import { useCustomerProfile, useCustomers } from '@/lib/organizer/queries';
import { downloadCsv, toCsv, type ColumnDef } from '@/lib/organizer/table';
import { cn } from '@/lib/utils/cn';
import { TableCard, TOOLBAR_CONTROL, TOOLBAR_ICON } from './data-table';
import { SearchField } from './filters';
import { EmptyState, ErrorState, Skeleton, StatusPill, type Tone } from './primitives';

/**
 * Customers — the CRM view.
 *
 * ── SEGMENTS ARE DERIVED, NOT STORED ──────────────────────────────────────
 *
 * The brief asked for VIP / Repeat / First timers / High spenders / Inactive.
 * There is no segment column and no CRM table, so each of these is computed
 * from two numbers the API already returns per customer: how many bookings
 * they have made with THIS organizer, and what they have spent. That makes
 * them real and self-explanatory — "Repeat" means literally `bookings > 1` —
 * rather than a label someone would have to look up.
 *
 * They are applied CLIENT-SIDE over the loaded pages, and the footer says so,
 * exactly like the browse page's price band. "Inactive" needs a cutoff date;
 * it uses `last_booked_at`, which is real.
 *
 * The chosen segment wears the butter `--nav-active` fill, the same as an
 * applied filter chip and the sidebar's current page — one colour for "this is
 * narrowing what you see", everywhere on the dashboard.
 *
 * ── ONE SEARCH FIELD, NOT A SECOND COPY OF ONE ────────────────────────────
 *
 * This list renders its own markup rather than going through `DataGrid`, but
 * the search box is `filters.SearchField` — the same debounce, the same clear
 * button, the same URL-is-the-source-of-truth effect as every other list. Two
 * hand-rolled search inputs is how two search behaviours appear.
 *
 * ── WHAT IS ABSENT ────────────────────────────────────────────────────────
 *
 * Avatar, phone and notes. `User` has no avatar column; `phone` exists on the
 * model but is not on any serializer the organizer can read; and there is no
 * notes table. Rendering a notes box that discards what was typed would be the
 * worst of the three. BACKLOG item 30.
 */

type SegmentId = 'all' | 'repeat' | 'first' | 'high' | 'inactive';

/** ₹5,000 lifetime with this organizer. A threshold, stated where it is used. */
const HIGH_SPENDER_MINOR = 500_000;
const INACTIVE_DAYS = 180;

const SEGMENTS: { id: SegmentId; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Everyone who has bought from you' },
  { id: 'repeat', label: 'Repeat', hint: 'More than one booking' },
  { id: 'first', label: 'First timers', hint: 'Exactly one booking' },
  { id: 'high', label: 'High spenders', hint: `Over ${formatMoney(HIGH_SPENDER_MINOR)} lifetime` },
  { id: 'inactive', label: 'Inactive', hint: `No booking in ${INACTIVE_DAYS} days` },
];

/**
 * The export shape.
 *
 * Declared separately from the on-screen table because this list renders its
 * own markup rather than going through `DataGrid` — but it reuses `toCsv`, so
 * the formula-injection guard and the CRLF/BOM handling are the same code
 * every other export on the dashboard uses. Money is MAJOR units, so a
 * spreadsheet summing lifetime value is not out by a factor of a hundred.
 */
const EXPORT_COLUMNS: ColumnDef<CustomerRow>[] = [
  { key: 'name', header: 'Name', width: 0, exportValue: (row) => row.full_name, render: () => null },
  { key: 'email', header: 'Email', width: 0, exportValue: (row) => row.email, render: () => null },
  {
    key: 'bookings',
    header: 'Bookings',
    width: 0,
    exportValue: (row) => row.bookings,
    render: () => null,
  },
  {
    key: 'ltv',
    header: 'Lifetime value',
    width: 0,
    exportValue: (row) => row.lifetime_value_minor / 100,
    render: () => null,
  },
  {
    key: 'last',
    header: 'Last booked',
    width: 0,
    exportValue: (row) => row.last_booked_at,
    render: () => null,
  },
];

function inSegment(row: CustomerRow, segment: SegmentId, now: number): boolean {
  switch (segment) {
    case 'repeat':
      return row.bookings > 1;
    case 'first':
      return row.bookings === 1;
    case 'high':
      return row.lifetime_value_minor >= HIGH_SPENDER_MINOR;
    case 'inactive':
      return now - new Date(row.last_booked_at).getTime() > INACTIVE_DAYS * 86_400_000;
    default:
      return true;
  }
}

export function Customers() {
  const router = useRouter();
  const params = useSearchParams();

  const urlQuery = params?.get('q') ?? '';
  const segment = (params?.get('segment') as SegmentId) ?? 'all';
  const selectedId = params?.get('customer') ?? null;

  const setParam = React.useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(window.location.search);
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
      const query = next.toString();
      router.replace(query ? `/dashboard/customers?${query}` : '/dashboard/customers', {
        scroll: false,
      });
    },
    [router],
  );

  // Trimmed on the way to the API, not on the way to the URL: trimming the URL
  // would make the field's own text disagree with the address bar and rewrite
  // what somebody just typed.
  const query = useCustomers(urlQuery.trim());
  const all = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const now = Date.now();
  const rows = React.useMemo(
    () => all.filter((row) => inSegment(row, segment, now)),
    // `now` is read once per render on purpose — recomputing per row would
    // make the segment flicker across a second boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, segment],
  );

  return (
    <div className="flex flex-col gap-stack">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={urlQuery}
          onChange={(value) => setParam('q', value)}
          placeholder="Search name or email"
          label="Search customers"
        />
        <p className="ml-auto text-caption tabular-nums text-muted-foreground" role="status">
          {query.isFetching
            ? 'Loading…'
            : `${rows.length}${query.hasNextPage ? '+' : ''} customer${rows.length === 1 ? '' : 's'}`}
        </p>

        {/* Exports the SEGMENT currently on screen, not the whole list — the
            organizer filtered to "high spenders" for a reason, and a file with
            everyone in it is a file they have to edit. Outlined: this screen is
            read-only, so nothing on it is THE action. */}
        <Button
          variant="outline"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(`customers-${segment}.csv`, toCsv(EXPORT_COLUMNS, rows))}
          className={TOOLBAR_CONTROL}
        >
          <Download className="size-3.5" aria-hidden />
          Export
        </Button>
      </div>

      <div role="tablist" aria-label="Segments" className="flex flex-wrap gap-1.5">
        {SEGMENTS.map((entry) => {
          const active = segment === entry.id;
          return (
            <button
              key={entry.id}
              role="tab"
              type="button"
              aria-selected={active}
              title={entry.hint}
              onClick={() => setParam('segment', entry.id)}
              className={cn(
                'inline-flex h-control-sm items-center rounded-full border px-pill text-label transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-nav-active bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <TableCard className="overflow-hidden">
        {query.isError ? (
          <ErrorState message="Could not load customers." onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <div className="flex flex-col gap-2 p-card">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={all.length ? 'Nobody in this segment' : 'No customers yet'}
            body={
              all.length
                ? 'Try another segment, or clear the search.'
                : 'Customers appear here after your first paid booking — you cannot add them by hand, they arrive by buying a ticket.'
            }
            action={
              all.length ? undefined : (
                <Button variant="outline" asChild>
                  <Link href="/dashboard/events">See your events</Link>
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                {/*
                  NOT sticky, and it never was — this row carried
                  `sticky top-14 z-10`, which had nothing to stick to: the box
                  around it is `overflow-x-auto`, so CSS makes it a scroll
                  container on BOTH axes and IT, not the page, becomes the
                  sticky scrollport. It never scrolls vertically, so the only
                  thing the offset could do was DISPLACE the header 3.5rem down
                  — straight over the first customer — while `z-10` guaranteed
                  it won the overlap. Exactly the bug documented at length on
                  `data-table.tsx`'s `headCellClass`, in a second table that
                  had copied the pattern before it was diagnosed.
                */}
                <tr>
                  {['Customer', 'Bookings', 'Lifetime value', 'Last booking', 'Segment'].map(
                    (label, index) => (
                      <th
                        key={label}
                        scope="col"
                        className={cn(
                          'border-b border-border bg-sunken px-3 py-2 text-caption font-medium uppercase tracking-wide text-muted-foreground',
                          index === 1 || index === 2 ? 'text-right' : 'text-left',
                          index === 3 && 'hidden md:table-cell',
                          index === 4 && 'hidden lg:table-cell',
                        )}
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row
                    key={row.customer_id}
                    row={row}
                    now={now}
                    selected={row.customer_id === selectedId}
                    onSelect={() =>
                      setParam('customer', row.customer_id === selectedId ? '' : row.customer_id)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {query.hasNextPage ? (
          <div className="flex flex-col items-center gap-2 border-t border-border p-stack text-center">
            <Button
              variant="outline"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className={TOOLBAR_CONTROL}
            >
              {query.isFetchingNextPage ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              Load more
            </Button>
            <p className="text-caption text-muted-foreground">
              Segments apply to the {all.length} customers loaded so far.
            </p>
          </div>
        ) : null}
      </TableCard>

      <CustomerInspector customerId={selectedId} onClose={() => setParam('customer', '')} />
    </div>
  );
}

function segmentFor(row: CustomerRow, now: number): { label: string; tone: Tone } {
  if (row.lifetime_value_minor >= HIGH_SPENDER_MINOR)
    return { label: 'High spender', tone: 'success' };
  if (now - new Date(row.last_booked_at).getTime() > INACTIVE_DAYS * 86_400_000) {
    return { label: 'Inactive', tone: 'neutral' };
  }
  if (row.bookings > 1) return { label: 'Repeat', tone: 'info' };
  return { label: 'First timer', tone: 'neutral' };
}

function Row({
  row,
  now,
  selected,
  onSelect,
}: {
  row: CustomerRow;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const segment = segmentFor(row, now);
  const initials = (row.full_name || row.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <tr
      onClick={onSelect}
      tabIndex={0}
      role="button"
      aria-expanded={selected}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'cursor-pointer border-b border-border transition-colors last:border-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        // The same butter as a selected DataGrid row, so "the one I opened"
        // reads identically on both kinds of list.
        selected ? 'bg-nav-active hover:bg-nav-active-hover' : 'hover:bg-muted',
      )}
    >
      <td className="max-w-0 px-3 py-2">
        <span className="flex items-center gap-2.5">
          {/* Initials, not an avatar — `User` has no image column, and a
              generated cartoon face is a fabricated identity. */}
          <span
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-caption font-semibold text-secondary-foreground"
            aria-hidden
          >
            {initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.full_name || row.email}</span>
            <span className="block truncate text-caption text-muted-foreground">{row.email}</span>
          </span>
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.bookings}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.lifetime_value_minor)}</td>
      <td className="hidden whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground md:table-cell">
        {new Date(row.last_booked_at).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </td>
      <td className="hidden px-3 py-2 lg:table-cell">
        <StatusPill tone={segment.tone}>{segment.label}</StatusPill>
      </td>
    </tr>
  );
}

function CustomerInspector({
  customerId,
  onClose,
}: {
  customerId: string | null;
  onClose: () => void;
}) {
  const profile = useCustomerProfile(customerId);

  return (
    <Drawer open={Boolean(customerId)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side="responsive" hideClose className="flex flex-col gap-0 p-0 sm:max-w-lg">
        <header className="flex items-start gap-3 border-b border-border p-card">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-h4">{profile.data?.email || 'Customer'}</h2>
            <p className="text-caption text-muted-foreground">
              Everything below is with you only — never their spend elsewhere on the platform.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
            className={cn(TOOLBAR_ICON, 'shrink-0')}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-card">
          {profile.isError ? (
            <ErrorState
              message="Could not load this customer."
              onRetry={() => void profile.refetch()}
            />
          ) : profile.isPending ? (
            <div className="flex flex-col gap-stack">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-block">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Bookings" value={String(profile.data.bookings)} />
                <Metric label="Lifetime" value={formatMoney(profile.data.lifetime_value_minor)} />
                <Metric
                  label="Tickets"
                  value={`${profile.data.tickets_attended}/${profile.data.tickets_issued}`}
                  note="attended / issued"
                />
                <Metric
                  label="Refunds"
                  value={
                    profile.data.refunds === 0
                      ? '0'
                      : `${profile.data.refunds} · ${formatMoney(profile.data.refunded_minor)}`
                  }
                />
              </dl>

              {profile.data.top_cities.length ? (
                <section className="flex flex-col gap-stack">
                  <h3 className="text-body-sm font-semibold">Where they go</h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {profile.data.top_cities.map((city) => (
                      <li
                        key={city.label}
                        className="rounded-full bg-muted px-3 py-1 text-caption text-muted-foreground"
                      >
                        {city.label} · <span className="tabular-nums">{city.value}</span>
                      </li>
                    ))}
                  </ul>
                  {/* City is a real column on Event. "Preferred category" is
                      not — there is no category column at all (BACKLOG 2). */}
                  <p className="text-caption text-muted-foreground">
                    Derived from the cities of the events they bought.
                  </p>
                </section>
              ) : null}

              <section className="flex flex-col gap-stack">
                <h3 className="text-body-sm font-semibold">Recent bookings</h3>
                {profile.data.recent_bookings.length === 0 ? (
                  <p className="text-body-sm text-muted-foreground">No bookings.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                    {profile.data.recent_bookings.map((booking) => (
                      <li key={booking.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-sm">{booking.event_title}</span>
                          <span className="block text-caption tabular-nums text-muted-foreground">
                            {new Date(booking.created_at).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-body-sm tabular-nums">
                            {formatMoney(booking.total_amount_minor)}
                          </span>
                          <span className="block text-caption capitalize text-muted-foreground">
                            {booking.status}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <Button variant="outline" asChild className="w-fit">
                <Link href={`/dashboard/bookings?q=${encodeURIComponent(profile.data.email)}`}>
                  All their bookings
                </Link>
              </Button>
      {/* A footnote here explained that `User.phone` was not on the payload
          and that there was no notes table, citing a backlog item. It is now
          also wrong — a phone number is on the account. Engineering copy on a
          customer list ages badly and helps nobody who reads it. */}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * A metric tile.
 *
 * `p-stack` rather than `p-card`: four of these share the width of a drawer,
 * so card padding would leave a money figure ~70px to render in and truncate
 * it. It is still a token, not a number somebody picked.
 */
function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border p-stack">
      <dt className="truncate text-caption text-muted-foreground">{label}</dt>
      <dd className="truncate text-body-lg tabular-nums">{value}</dd>
      {note ? <p className="truncate text-caption text-muted-foreground">{note}</p> : null}
    </div>
  );
}
