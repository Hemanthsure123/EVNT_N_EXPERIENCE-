'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Download, Mail, Phone, QrCode, Ticket, Users } from 'lucide-react';
import type { AttendeeRow, AttendeeSort, AttendeeState } from '@/lib/api/organizer';
import { fetchAttendance } from '@/lib/api/organizer-writes';
import { useEventAttendees } from '@/lib/organizer/queries';
import { downloadCsv, toCsv, type ColumnDef } from '@/lib/organizer/table';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { ErrorState, GLASS_PANEL, Percent, Skeleton, StatusPill } from './primitives';
import { SearchField, SelectFilter, useUrlFilters } from './filters';
import { TOOLBAR_CONTROL } from './data-table';

/**
 * THE GATE LIST — everybody this event will admit.
 *
 * ── WHY THIS EXISTS, WHEN THE SCAN DESK ALREADY DID ──────────────────────
 *
 * `check-in.tsx` resolves ONE QR token at a time, which is the right shape at
 * a door and useless for the three questions a steward actually has between
 * scans: has this person already come in, who is on the list, and can I get
 * the list onto a phone before the venue's signal goes. None of those had a
 * screen, because until now none of them had an endpoint either.
 *
 * ── ONE ROW PER TICKET, NOT PER BOOKING ──────────────────────────────────
 *
 * A booking for six seats is six people through a door. `/dashboard/bookings`
 * is the other question — who paid what — and the two lists have different
 * lengths for the same event, which is exactly why this is not a filtered
 * rendering of that one.
 *
 * ── THE COUNT IN THE HEADER IS THE AUTHORITATIVE ONE ─────────────────────
 *
 * It comes from `GET /events/{id}/attendance`, which `checkin` owns and which
 * reconciles its Redis counter against the used-ticket count in the database.
 * Counting `status === 'used'` across the loaded rows would be a count of
 * whatever page happens to be in the browser, and it would disagree with the
 * scan desk's own figure on the same event.
 *
 * ── FILTERS LIVE IN THE URL ──────────────────────────────────────────────
 *
 * `?q=&state=&sort=`. A steward working a door shares "the unchecked list" with
 * the person on the other gate; a filtered view that cannot be sent is a
 * filtered view one person has.
 */

const DEFAULTS = { q: '', state: '', sort: '' };

const STATES: { value: AttendeeState; label: string }[] = [
  { value: '', label: 'Everyone' },
  { value: 'expected', label: 'Expected' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'void', label: 'Void' },
];

const SORTS: { value: AttendeeSort; label: string }[] = [
  { value: 'recent', label: 'Newest booking' },
  { value: 'oldest', label: 'Oldest booking' },
  // NAMED for what it does to the list, because it also narrows it: `used_at`
  // is null for everybody still outside, and a null in a cursor keyset makes
  // paging skip rows — so the server restricts this ordering to tickets that
  // have one. Saying so on the option is cheaper than explaining a list that
  // silently got shorter.
  { value: 'admitted', label: 'Last admitted (checked in only)' },
];

export function EventAttendees({ eventId }: { eventId: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const search = React.useMemo(() => new URLSearchParams(params?.toString() ?? ''), [params]);
  const { values, set } = useUrlFilters(DEFAULTS, search, (query) =>
    router.replace(
      query
        ? `/dashboard/events/${eventId}/attendees?${query}`
        : `/dashboard/events/${eventId}/attendees`,
      { scroll: false },
    ),
  );

  const sort = (values.sort || 'recent') as AttendeeSort;
  const query = useEventAttendees(eventId, {
    q: values.q || undefined,
    state: (values.state || '') as AttendeeState,
    sort,
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  return (
    <div className="flex flex-col gap-stack-lg">
      <Link
        href="/dashboard/events"
        className="inline-flex w-fit items-center gap-2 rounded-full text-label text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>

      <LiveCount eventId={eventId} rows={rows} hasMore={Boolean(query.hasNextPage)} />

      <Controls
        values={values}
        set={set}
        sort={sort}
        rows={rows}
        hasMore={Boolean(query.hasNextPage)}
      />

      {query.isError ? (
        <ErrorState
          message="Could not load this event's attendees."
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <div className="flex flex-col gap-stack">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
          <span className="sr-only">Loading attendees…</span>
        </div>
      ) : rows.length === 0 ? (
        <Empty filtered={Boolean(values.q || values.state)} />
      ) : (
        <ul className="flex flex-col gap-stack">
          {rows.map((row) => (
            <li key={row.ticket_id}>
              <AttendeeCard row={row} />
            </li>
          ))}
        </ul>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
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
    </div>
  );
}

/* ------------------------------------------------------------- the header */

/**
 * ADMITTED vs CAPACITY, FROM THE ENDPOINT THAT OWNS IT.
 *
 * `checkin` reconciles its fast Redis counter against the authoritative
 * used-ticket count in the database, so this is the same figure the scan desk
 * shows. Counting `status === 'used'` over the loaded rows instead would be a
 * count of one page, and it would disagree with the desk on the same event —
 * two numbers for one question, on the screen a steward trusts most.
 *
 * The loaded-row count sits beside it as a FLOOR, because the list is
 * cursor-paginated and there is no total.
 */
function LiveCount({
  eventId,
  rows,
  hasMore,
}: {
  eventId: string;
  rows: AttendeeRow[];
  hasMore: boolean;
}) {
  const attendance = useQuery({
    queryKey: ['organizer', 'attendance', eventId],
    queryFn: () => fetchAttendance(eventId),
    enabled: Boolean(eventId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const admitted = attendance.data?.admitted ?? null;
  const capacity = attendance.data?.capacity ?? null;
  const rate =
    admitted !== null && capacity ? Math.round((admitted / capacity) * 1000) / 10 : null;

  return (
    <header className={cn(GLASS_PANEL, 'flex flex-col gap-stack rounded-xl p-card shadow-sm')}>
      <div className="flex flex-wrap items-end justify-between gap-stack">
        <div className="min-w-0">
          <h1 className="inline-flex items-center gap-2 text-h4">
            <Users className="size-5 shrink-0 text-primary" aria-hidden />
            Attendees
          </h1>
          <p className="mt-1 text-caption text-muted-foreground">
            {hasMore ? `${rows.length}+` : rows.length} ticket
            {rows.length === 1 ? '' : 's'} loaded
          </p>
        </div>

        <div className="text-right">
          <p className="text-h3 tabular-nums leading-none text-foreground" aria-live="polite">
            {admitted === null ? '—' : admitted}
            {capacity ? (
              <span className="text-body-sm text-muted-foreground"> / {capacity}</span>
            ) : null}
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            inside now{rate === null ? '' : ' · '}
            {rate === null ? '' : <Percent value={rate} />}
          </p>
        </div>
      </div>

      <Button asChild variant="outline" size="sm" className="w-fit">
        <Link href={`/dashboard/check-in?event=${eventId}`}>
          <QrCode className="size-3.5" aria-hidden />
          Open the scan desk
        </Link>
      </Button>
    </header>
  );
}

/* ------------------------------------------------------------ the filters */

function Controls({
  values,
  set,
  sort,
  rows,
  hasMore,
}: {
  values: Record<string, string>;
  set: (next: Record<string, string>) => void;
  sort: AttendeeSort;
  rows: AttendeeRow[];
  hasMore: boolean;
}) {
  return (
    <div className="flex flex-col gap-stack">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={values.q}
          onChange={(q) => set({ q })}
          placeholder="Name, email, or ticket ID"
          label="Search attendees"
        />

        <SelectFilter
          value={values.sort || 'recent'}
          onChange={(next) => set({ sort: next === 'recent' ? '' : next })}
          options={SORTS}
          label="Sort"
        />

        {/* Export covers what is LOADED and says so — the same sentence the
            bookings table carries, because the same thing is true of both. */}
        <Button
          type="button"
          variant="outline"
          onClick={() => exportAttendees(rows)}
          disabled={rows.length === 0}
          className={cn(TOOLBAR_CONTROL, 'ml-auto')}
        >
          <Download className="size-3.5" aria-hidden />
          Export CSV
        </Button>
      </div>

      {/* The state filter as pills rather than a second select: it is the one
          an organizer touches constantly at a door, and four of them fit. */}
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {STATES.map((option) => (
          <Chip
            key={option.value || 'all'}
            selected={(values.state || '') === option.value}
            onClick={() => set({ state: option.value })}
            className="shrink-0"
          >
            {option.label}
          </Chip>
        ))}
      </div>

      {rows.length ? (
        <p className="text-caption text-muted-foreground">
          Export covers the {rows.length} row{rows.length === 1 ? '' : 's'} loaded
          {hasMore ? ' so far — load more to include the rest' : ''}.
          {sort === 'admitted' ? ' This sort shows only people who have been let in.' : ''}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- one card */

function AttendeeCard({ row }: { row: AttendeeRow }) {
  const admitted = row.status === 'used';

  return (
    <article
      className={cn(
        GLASS_PANEL,
        'flex items-start gap-stack rounded-2xl p-card shadow-sm',
        // A voided ticket is still drawn, because the person holding it still
        // turns up. It is dimmed so a steward scanning the list does not read
        // it as somebody to expect.
        row.status === 'void' && 'opacity-60',
      )}
    >
      <Avatar name={row.holder_name} email={row.holder_email} admitted={admitted} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-body-sm font-semibold text-foreground">
            {row.holder_name || row.holder_email || 'Ticket holder'}
          </span>
          <State row={row} />
        </div>

        <p className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <Mail className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{row.holder_email}</span>
        </p>

        {/* ── THE PHONE, WHEN IT IS THIS PERSON'S ────────────────────────
            Blank on a re-addressed ticket: nothing stores an assigned
            attendee's number, and printing the buyer's under somebody else's
            name is how a steward rings the wrong person. When the ticket WAS
            re-addressed the buyer is named instead, which is the fact that is
            actually useful — somebody has to be asked about it. */}
        {row.phone ? (
          <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <Phone className="size-3.5 shrink-0" aria-hidden />
            <a href={`tel:${row.phone}`} className="underline-offset-2 hover:underline">
              {row.phone}
            </a>
          </p>
        ) : null}

        {row.is_reassigned ? (
          <p className="text-caption text-muted-foreground">
            Booked by {row.buyer_name || row.buyer_email}
          </p>
        ) : null}

        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Ticket className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{row.ticket_type}</span>
          </span>
          {admitted && row.used_at ? (
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5 shrink-0" aria-hidden />
              <time dateTime={row.used_at}>
                {new Date(row.used_at).toLocaleTimeString('en-IN', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
              {row.gate ? ` · ${row.gate}` : ''}
            </span>
          ) : null}
        </p>
      </div>
    </article>
  );
}

/**
 * INITIALS, NOT A PHOTOGRAPH.
 *
 * Nothing on this platform stores an attendee avatar, and a generated one
 * (gravatar, an identicon) would either leak an email hash to a third party or
 * draw a pattern that means nothing. Initials at least help somebody find a
 * row again after looking up at a queue.
 *
 * The tick is on the AVATAR as well as in the badge, because at a door the
 * list is read down the left edge.
 */
function Avatar({
  name,
  email,
  admitted,
}: {
  name: string;
  email: string;
  admitted: boolean;
}) {
  const source = (name || email || '?').trim();
  const initials =
    source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';

  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex size-11 shrink-0 items-center justify-center rounded-full',
        'text-label font-semibold',
        admitted ? 'bg-success-subtle text-success-subtle-foreground' : 'bg-muted text-foreground',
      )}
    >
      {initials}
      {admitted ? (
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex size-4 items-center justify-center rounded-full bg-success text-success-foreground ring-2 ring-background">
          <Check className="size-2.5" />
        </span>
      ) : null}
    </span>
  );
}

/**
 * The three states a ticket can be in at a door, named for what they mean to
 * the person holding the list rather than for the stored enum.
 */
function State({ row }: { row: AttendeeRow }) {
  if (row.status === 'used') return <StatusPill tone="success">Checked in</StatusPill>;
  if (row.status === 'void') {
    // NOT "cancelled" — the reason could be a refund or a cancelled event, and
    // what the steward needs to know is only that it will be refused.
    return <StatusPill tone="danger">Not valid</StatusPill>;
  }
  return <StatusPill tone="neutral">Expected</StatusPill>;
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <p className={cn(GLASS_PANEL, 'rounded-xl p-card text-body-sm text-muted-foreground shadow-sm')}>
      {filtered
        ? 'Nobody matches those filters. Clear the search or pick a different state.'
        : 'No tickets have been issued for this event yet. Attendees appear here the moment somebody pays.'}
    </p>
  );
}

/* ---------------------------------------------------------------- the CSV */

/**
 * The door list, as a file.
 *
 * The reason it exists: venue signal. A steward who cannot load this page can
 * still work from a spreadsheet, so the export carries everything the card
 * shows and the ticket id that identifies a row on the phone next to them.
 *
 * `checked_in` is spelled as a word rather than exported as the raw enum — a
 * CSV is read by a human, and "used" against a person's name reads like an
 * accusation.
 */
const EXPORT_COLUMNS: ColumnDef<AttendeeRow>[] = [
  { key: 'holder_name', header: 'Name', width: 200, render: (row) => row.holder_name },
  { key: 'holder_email', header: 'Email', width: 220, render: (row) => row.holder_email },
  { key: 'phone', header: 'Phone', width: 140, render: (row) => row.phone },
  { key: 'ticket_type', header: 'Ticket type', width: 140, render: (row) => row.ticket_type },
  {
    key: 'status',
    header: 'Status',
    width: 120,
    render: (row) => row.status,
    exportValue: (row) =>
      row.status === 'used' ? 'Checked in' : row.status === 'void' ? 'Not valid' : 'Expected',
  },
  {
    key: 'used_at',
    header: 'Checked in at',
    width: 180,
    render: (row) => row.used_at ?? '',
    exportValue: (row) => row.used_at ?? '',
  },
  { key: 'gate', header: 'Gate', width: 120, render: (row) => row.gate },
  {
    key: 'booked_by',
    header: 'Booked by',
    width: 220,
    render: (row) => row.buyer_email,
    exportValue: (row) => (row.is_reassigned ? row.buyer_email : ''),
  },
  { key: 'ticket_id', header: 'Ticket ID', width: 300, render: (row) => row.ticket_id },
];

function exportAttendees(rows: AttendeeRow[]) {
  downloadCsv('attendees.csv', toCsv(EXPORT_COLUMNS, rows));
}
