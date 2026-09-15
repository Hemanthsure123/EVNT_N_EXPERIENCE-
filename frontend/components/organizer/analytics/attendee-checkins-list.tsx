'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Download, Mail, Phone, Search, Ticket, UserCheck, X } from 'lucide-react';
import type { AttendeeRow, AttendeeSort, AttendeeState } from '@/lib/api/organizer';
import { useEventAttendees } from '@/lib/organizer/queries';
import { downloadCsv, toCsv, type ColumnDef } from '@/lib/organizer/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { ErrorState, Skeleton, StatusPill } from '../primitives';
import { useUrlFilters } from '../filters';
import { CARD } from './parts';

/**
 * ATTENDEE CHECK-INS — the gate list, as one card.
 *
 * ── ONE ROW PER TICKET, NOT PER BOOKING ──────────────────────────────────
 *
 * A booking for six seats is six people through a door. The reference counts
 * bookings as attendees; here an attendee is a person, which is the only
 * reading under which "has Priya arrived" has an answer. `/dashboard/bookings`
 * is the other question — who paid what.
 *
 * ── "SHOWING X OF Y" IS A REAL TOTAL ─────────────────────────────────────
 *
 * The list is cursor-paginated, and the endpoint now returns the FILTERED
 * count beside the page. Before that this could only say "50+ loaded", which
 * cannot tell a steward whether that is everybody or the first page of a
 * thousand.
 *
 * ── TWO MOUNTS, ONE COMPONENT ────────────────────────────────────────────
 *
 * On its own page the filters live in the URL, so a steward can send "the
 * unchecked list" to the other gate. Embedded at the foot of the analytics page
 * they live in local state, because that page's URL is about the event, and a
 * search box rewriting it would fight the rest of the page for it.
 */

const STATES: { value: AttendeeState; label: string }[] = [
  { value: '', label: 'All Status' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'expected', label: 'Not checked in' },
  { value: 'void', label: 'Not valid' },
];

const SORTS: { value: AttendeeSort; label: string }[] = [
  { value: 'recent', label: 'Sort by Booking Date' },
  { value: 'oldest', label: 'Oldest booking first' },
  // NAMED for what it does to the list, because it also narrows it: `used_at`
  // is null for everybody still outside, and a null in a cursor keyset makes
  // paging skip rows — so the server restricts this ordering to people in.
  { value: 'admitted', label: 'Last admitted (checked in only)' },
];

const DEFAULTS = { q: '', state: '', sort: '' };
type Filters = typeof DEFAULTS;

type Mode = 'page' | 'embedded';

export function AttendeeCheckinsList({ eventId, mode }: { eventId: string; mode: Mode }) {
  return mode === 'page' ? (
    <UrlFiltered eventId={eventId} />
  ) : (
    <LocallyFiltered eventId={eventId} />
  );
}

function UrlFiltered({ eventId }: { eventId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const search = React.useMemo(() => new URLSearchParams(params?.toString() ?? ''), [params]);
  const { values, set } = useUrlFilters(DEFAULTS, search, (query) =>
    router.replace(
      query ? `/dashboard/events/${eventId}/attendees?${query}` : `/dashboard/events/${eventId}/attendees`,
      { scroll: false },
    ),
  );
  return <Checkins eventId={eventId} values={values} set={set} />;
}

function LocallyFiltered({ eventId }: { eventId: string }) {
  const [values, setValues] = React.useState<Filters>(DEFAULTS);
  const set = React.useCallback(
    (next: Partial<Filters>) => setValues((current) => ({ ...current, ...next })),
    [],
  );
  return <Checkins eventId={eventId} values={values} set={set} />;
}

function Checkins({
  eventId,
  values,
  set,
}: {
  eventId: string;
  values: Filters;
  set: (next: Partial<Filters>) => void;
}) {
  const headingId = React.useId();
  const sort = (values.sort || 'recent') as AttendeeSort;
  const query = useEventAttendees(eventId, {
    q: values.q || undefined,
    state: (values.state || '') as AttendeeState,
    sort,
  });

  const rows = React.useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  const total = query.data?.pages[0]?.meta.count ?? null;
  const hasMore = Boolean(query.hasNextPage);
  const filtered = Boolean(values.q || values.state);

  return (
    <section aria-labelledby={headingId} className={cn(CARD, 'flex flex-col overflow-hidden')}>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={headingId} className="flex min-w-0 items-center gap-2.5 text-h4 font-semibold text-foreground">
            <UserCheck className="size-6 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0">Attendee Check-ins</span>
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => exportAttendees(rows)}
            disabled={rows.length === 0}
            className="shrink-0"
          >
            <Download className="size-4 text-primary" aria-hidden />
            Export CSV
          </Button>
        </div>

        <SearchBox value={values.q} onChange={(q) => set({ q })} />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Filter by status"
            value={values.state}
            onChange={(state) => set({ state })}
            options={STATES}
          />
          <Select
            label="Sort"
            value={values.sort || 'recent'}
            onChange={(next) => set({ sort: next === 'recent' ? '' : next })}
            options={SORTS}
          />
        </div>

        <p className="text-body text-muted-foreground" aria-live="polite">
          {query.isPending
            ? 'Loading attendees…'
            : total === null
              ? `Showing ${rows.length}${hasMore ? '+' : ''} attendee${rows.length === 1 && !hasMore ? '' : 's'}`
              : `Showing ${rows.length} of ${total} attendee${total === 1 ? '' : 's'}`}
        </p>
        {hasMore && rows.length ? (
          <p className="-mt-2 text-caption text-muted-foreground">
            Export covers the {rows.length} rows loaded so far — load more to include the rest.
            {sort === 'admitted' ? ' This sort shows only people who have been let in.' : ''}
          </p>
        ) : null}
      </div>

      <div className="border-t border-border bg-sunken px-4 py-4 sm:px-5">
        <span className="text-label font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Attendee
        </span>
      </div>

      {query.isError ? (
        <ErrorState
          message="Could not load this event's attendees."
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <div className="flex flex-col gap-3 p-4">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="p-4 text-body-sm text-muted-foreground sm:p-5">
          {filtered
            ? 'Nobody matches those filters. Clear the search or pick a different status.'
            : 'No tickets have been issued for this event yet. Attendees appear here the moment somebody pays.'}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((row) => (
            <li key={row.ticket_id}>
              <AttendeeRowView row={row} />
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="flex justify-center border-t border-border p-4">
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Debounced like every search on the dashboard — local state per keystroke, the query after a pause. */
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = React.useState(value);
  const id = React.useId();
  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => onChange(draft), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Search attendees
      </label>
      <Search
        className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        id={id}
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search by name, email, or ticket ID..."
        className="h-12 w-full rounded-xl border border-input bg-surface pl-12 pr-11 text-body text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
      />
      {draft ? (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = React.useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full min-w-0 truncate rounded-xl border border-input bg-surface px-3 text-body-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((option) => (
          <option key={option.value || 'all'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function AttendeeRowView({ row }: { row: AttendeeRow }) {
  const admitted = row.status === 'used';
  const name = row.holder_name || row.holder_email || 'Ticket holder';
  return (
    <article className={cn('flex items-start gap-4 px-4 py-5 sm:px-5', row.status === 'void' && 'opacity-60')}>
      <Initial name={row.holder_name || row.holder_email} admitted={admitted} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-body font-semibold text-foreground">{name}</span>
          <State row={row} />
        </div>

        {row.holder_email ? (
          <p className="flex min-w-0 items-center gap-2 text-body-sm text-muted-foreground">
            <Mail className="size-4 shrink-0" aria-hidden />
            <a
              href={`mailto:${row.holder_email}`}
              className="truncate underline decoration-border underline-offset-4 hover:text-foreground"
            >
              {row.holder_email}
            </a>
          </p>
        ) : null}

        {/* The BUYER's number, and blank on a re-addressed ticket: nothing stores
            an assigned attendee's phone, and the buyer's under somebody else's
            name is how a steward rings the wrong person. */}
        {row.phone ? (
          <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <Phone className="size-4 shrink-0" aria-hidden />
            <a
              href={`tel:${row.phone}`}
              className="underline decoration-border underline-offset-4 hover:text-foreground"
            >
              {row.phone}
            </a>
          </p>
        ) : null}

        {row.is_reassigned ? (
          <p className="text-caption text-muted-foreground">Booked by {row.buyer_name || row.buyer_email}</p>
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
                  timeZone: 'Asia/Kolkata',
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
 * ONE LETTER, NOT A PHOTOGRAPH.
 *
 * Nothing stores an attendee photo, and a generated avatar would either leak an
 * email hash to a third party or draw a pattern that means nothing. An initial
 * helps somebody find a row again after looking up at a queue — and the tick is
 * on it too, because at a door the list is read down its left edge.
 */
function Initial({ name, admitted }: { name: string; admitted: boolean }) {
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex size-14 shrink-0 items-center justify-center rounded-full border-2 text-h4 font-semibold',
        admitted
          ? 'border-success bg-success-subtle text-success-subtle-foreground'
          : 'border-primary/50 text-foreground',
      )}
    >
      {letter}
      {admitted ? (
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex size-5 items-center justify-center rounded-full bg-success text-success-foreground ring-2 ring-background">
          <Check className="size-3" />
        </span>
      ) : null}
    </span>
  );
}

function State({ row }: { row: AttendeeRow }) {
  if (row.status === 'used') return <StatusPill tone="success">Checked in</StatusPill>;
  // NOT "cancelled": the reason could be a refund or a called-off event, and
  // all the steward needs to know is that it will be refused.
  if (row.status === 'void') return <StatusPill tone="danger">Not valid</StatusPill>;
  return <StatusPill tone="neutral">Expected</StatusPill>;
}

/**
 * The door list, as a file — for when the venue's signal goes. `checked_in` is
 * spelled as words: a CSV is read by a person, and "used" against somebody's
 * name reads like an accusation.
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
