'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  BarChart3,
  CalendarPlus,
  ExternalLink,
  LayoutGrid,
  Receipt,
  Rows3,
  Send,
  Ticket,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/discovery/format';
import type { EventRow } from '@/lib/api/organizer';
import { STATUS_FILTERS } from '@/lib/organizer/event-status';
import { canSubmit, submitBlockers } from '@/lib/organizer/submit-gate';
import { useEventRows, useInvalidateOrganizer } from '@/lib/organizer/queries';
import { archiveEvent, publishEvent } from '@/lib/api/organizer-writes';
import { ApiError } from '@/lib/api/errors';
import { useDataTable, type ColumnDef } from '@/lib/organizer/table';
import { cn } from '@/lib/utils/cn';
import { EmptyState, ErrorState, Poster } from './primitives';
import {
  BulkBar,
  ColumnChooser,
  DataGrid,
  ExportButton,
  TableCard,
  TableSkeleton,
  TableToolbar,
  TOOLBAR_CONTROL,
  TOOLBAR_ICON,
} from './data-table';
import {
  DateRangeFilter,
  FilterChips,
  FilterCluster,
  SearchField,
  SelectFilter,
  presetRange,
  useUrlFilters,
  type DateRange,
} from './filters';
import { EventPanel } from './event-panel';
import { StatusBadge } from './status-badge';

/**
 * The events surface.
 *
 * ── TWO VIEWS OF THE SAME QUERY ───────────────────────────────────────────
 *
 * A table for comparing (which sold more, which is closest, which has no
 * tickets set up) and cards for recognising (the poster IS how an organizer
 * with twenty events finds one). Both read the identical filtered query and
 * the identical selection, so switching never re-fetches and never loses what
 * is ticked — it is a rendering choice, not a mode.
 *
 * ── ONE FILLED BUTTON ON THE SCREEN ───────────────────────────────────────
 *
 * "New event" is it. Everything else in the toolbar — Columns, Export, the
 * view toggle, the filters — is outlined or a butter state pill, because a
 * toolbar with five filled buttons has no primary action at all. The empty
 * state's "Create your first event" is outlined for the same reason: the
 * filled pill for that job is already on screen, four inches above it.
 *
 * ── FILTERS LIVE IN THE URL ───────────────────────────────────────────────
 *
 * `?q=&status=&city=&from=&to=&preset=&view=&event=`. Shareable, reloadable,
 * and back-button-able. The selected row is a param too, which is what lets
 * the ⌘K palette deep-link straight into a row's side panel.
 *
 * ── WHAT THE BULK BAR OFFERS, AND WHY NOT MORE ────────────────────────────
 *
 * Submit-for-review and Archive are real endpoints and are here. **Delete is
 * not**, and will not be: an event is referenced by bookings, tickets and a
 * settlement, all `PROTECT`ed at the database, so a delete would either fail
 * outright or orphan real money. **Duplicate is not**, because there is no
 * duplicate endpoint — doing it client-side means a create plus N tier creates
 * with no transaction around them, so a failure halfway leaves a half-built
 * event that looks real. Both are BACKLOG items rather than buttons that lie.
 *
 * ── NOT VIRTUALIZED, DELIBERATELY ─────────────────────────────────────────
 *
 * This fetches 20 rows a page and appends on demand, so the DOM never holds
 * more than the organizer explicitly asked for. A virtualizer on top of
 * pagination costs a dependency, breaks Ctrl+F, and fixes every row's height.
 * If one organizer ever needs 10k rows on screen, the fix is server-side sort
 * AND a virtualizer, not one.
 */

const DEFAULTS = {
  q: '',
  status: '',
  city: '',
  preset: '',
  from: '',
  to: '',
  view: '',
};

export function EventsTable() {
  const router = useRouter();
  const params = useSearchParams();
  const invalidate = useInvalidateOrganizer();

  const search = React.useMemo(() => new URLSearchParams(params?.toString() ?? ''), [params]);
  const { values, set, clearAll } = useUrlFilters(DEFAULTS, search, (query) =>
    router.replace(query ? `/dashboard/events?${query}` : '/dashboard/events', { scroll: false }),
  );

  const selectedId = params?.get('event') ?? null;

  // The preset is expanded into a real instant here rather than sent as
  // "7 days" — the API takes bounds, and expanding it at the edge keeps one
  // definition of "last 7 days" instead of two.
  const range: DateRange = React.useMemo(() => {
    if (values.preset) return presetRange(Number(values.preset));
    return { from: values.from, to: values.to };
  }, [values.preset, values.from, values.to]);

  const query = useEventRows({
    q: values.q || undefined,
    status: values.status || undefined,
    city: values.city || undefined,
    starts_after: range.from || undefined,
    starts_before: range.to || undefined,
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  const table = useDataTable<EventRow>({
    id: 'events',
    columns: COLUMNS,
    rows,
    rowId: (row) => row.id,
  });

  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const selectedRows = rows.filter((row) => table.isSelected(row.id));

  /**
   * A bulk action, one row at a time.
   *
   * Sequential rather than `Promise.all`: these are writes against a
   * money-adjacent resource, and a burst of parallel state transitions makes
   * the failure modes much harder to reason about for no meaningful latency
   * win at these counts. Failures are COUNTED and reported — "archived 3 of 5"
   * is the truth; a silent success on a partial failure is not.
   */
  const runBulk = async (
    label: string,
    eligible: (row: EventRow) => boolean,
    action: (row: EventRow) => Promise<unknown>,
  ) => {
    setBusy(true);
    setFailure(null);
    const targets = selectedRows.filter(eligible);
    const skipped = selectedRows.length - targets.length;
    let done = 0;
    let firstError: string | null = null;

    for (const row of targets) {
      try {
        await action(row);
        done += 1;
      } catch (thrown) {
        if (!firstError) {
          firstError = thrown instanceof ApiError ? thrown.message : 'That request failed.';
        }
      }
    }

    void invalidate();
    table.clearSelection();
    setBusy(false);
    if (done < targets.length || skipped) {
      setFailure(
        [
          `${label} ${done} of ${targets.length + skipped}.`,
          skipped ? `${skipped} were not eligible and were left alone.` : '',
          firstError ?? '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
  };

  const chips = [
    values.q && { key: 'q', label: `“${values.q}”`, onClear: () => set({ q: '' }) },
    values.status && {
      key: 'status',
      label: STATUS_FILTERS.find((option) => option.value === values.status)?.label ?? values.status,
      onClear: () => set({ status: '' }),
    },
    values.city && { key: 'city', label: values.city, onClear: () => set({ city: '' }) },
    (values.preset || values.from || values.to) && {
      key: 'date',
      label: values.preset ? `Last ${values.preset} days` : 'Custom dates',
      onClear: () => set({ preset: '', from: '', to: '' }),
    },
  ].filter(Boolean) as { key: string; label: string; onClear: () => void }[];

  const cards = values.view === 'cards';
  // Distinct cities among the loaded rows, for the filter's suggestions.
  const cityOptions = React.useMemo(
    () => Array.from(new Set(rows.map((row) => row.city).filter(Boolean))).sort(),
    [rows],
  );

  return (
    <TableCard>
      <TableToolbar>
        <SearchField
          value={values.q}
          onChange={(q) => set({ q })}
          placeholder="Search title or venue"
          label="Search your events"
        />

        {/* Status, city and dates are the SECONDARY filters — search is how
            people actually narrow a list of their own events, so it stays
            visible and these collapse behind one button on a phone. */}
        <FilterCluster count={chips.filter((chip) => chip.key !== 'q').length}>
          <SelectFilter
            value={values.status}
            onChange={(status) => set({ status })}
            options={STATUS_FILTERS.map((option) => ({ value: option.value, label: option.label }))}
            label="Filter by status"
          />

          {/* The city filter had a chip and a query param but no control, so it
              could be cleared and never set. Suggestions come from the rows on
              screen — a real subset, never a claim to be the complete list,
              which is why it is a datalist over a free-text field rather than a
              `<select>` that would silently omit a city whose events are all on
              the next page. */}
          <SearchField
            value={values.city}
            onChange={(city) => set({ city })}
            placeholder="City"
            label="Filter by city"
            suggestions={cityOptions}
          />

          <DateRangeFilter
            preset={values.preset}
            onPreset={(preset) => set({ preset })}
            custom={{ from: values.from, to: values.to }}
            onCustom={(next) => set({ from: next.from, to: next.to })}
            label="Event date"
          />
        </FilterCluster>

        {/* No divider between the two groups. One was tried here and the
            screenshot killed it: the toolbar WRAPS, so a separator that was
            meant to sit between filtering and acting landed at the far right
            end of the filter row, reading as a stray tick rather than a seam.
            A rule can only divide things that are reliably on the same line,
            and nothing in a wrapping toolbar is. The row break itself is now
            the separation. */}

        {/* `flex-wrap` here as well as on the toolbar: at 390px this group is
            wider than the card, and an inner nowrap row is exactly how a
            toolbar pushes a page into horizontal scroll. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ViewToggle view={values.view} onChange={(view) => set({ view })} />
          {cards ? null : <ColumnChooser table={table} />}
          <ExportButton table={table} filename="events.csv" disabled={query.isPending} />
          {/* THE filled action on this screen. */}
          <Button asChild className={TOOLBAR_CONTROL}>
            <Link href="/dashboard/events/new">
              <CalendarPlus className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">New event</span>
              <span className="sr-only sm:hidden">New event</span>
            </Link>
          </Button>
        </div>
      </TableToolbar>

      {chips.length ? (
        <div className="border-b border-border px-card py-2">
          <FilterChips chips={chips} onClearAll={clearAll} />
        </div>
      ) : null}

      {failure ? (
        <p role="alert" className="border-b border-border px-card py-2 text-caption text-destructive">
          {failure}
        </p>
      ) : null}

      {query.isError ? (
        <ErrorState message="Could not load your events." onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <TableSkeleton rows={8} columns={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title={chips.length ? 'No events match those filters' : 'No events yet'}
          body={
            chips.length
              ? 'Try clearing one — the chips above show which filters are active.'
              : 'An event is a title, a venue, a date and at least one ticket type. The studio walks through it and saves as you type.'
          }
          action={
            chips.length ? (
              <Button variant="outline" onClick={clearAll}>
                Clear filters
              </Button>
            ) : (
              // Outlined, not filled: "New event" in the toolbar above is
              // already the one filled pill on this screen, and two would make
              // neither of them read as THE action.
              <Button variant="outline" asChild>
                <Link href="/dashboard/events/new">
                  <CalendarPlus className="size-3.5" aria-hidden />
                  Create your first event
                </Link>
              </Button>
            )
          }
        />
      ) : cards ? (
        <EventCards
          rows={table.rows}
          isSelected={table.isSelected}
          onToggle={table.toggleRow}
          onOpen={(row) => openRow(router, search, row.id)}
        />
      ) : (
        <DataGrid
          table={table}
          caption="Your events, with capacity, sales and revenue"
          onOpen={(row) => openRow(router, search, row.id)}
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
            // The one thing this table must not let someone believe.
            <p className="text-caption text-muted-foreground">
              Sorted within the {rows.length} rows loaded so far, not across every event.
            </p>
          ) : null}
        </div>
      ) : null}

      <BulkBar count={table.selected.size} onClear={table.clearSelection}>
        {/* `title` carries WHY, because a disabled button with no explanation
            is the thing that reads as "the platform is broken". When exactly
            one row is selected we can name its specific blockers; for a mixed
            selection we say how many are not ready. */}
        <BulkButton
          icon={Send}
          label="Submit for review"
          disabled={busy || !selectedRows.some(canSubmit)}
          title={
            selectedRows.length === 1 && !canSubmit(selectedRows[0])
              ? submitBlockers(selectedRows[0]).join(' ')
              : selectedRows.some(canSubmit)
                ? undefined
                : `${selectedRows.length} selected, none ready to submit.`
          }
          onClick={() => void runBulk('Submitted', canSubmit, (row) => publishEvent(row.id))}
        />
        <BulkButton
          icon={Archive}
          label="Archive"
          disabled={busy || !selectedRows.some(canArchive)}
          onClick={() => void runBulk('Archived', canArchive, (row) => archiveEvent(row.id))}
        />
      </BulkBar>

      {/* The panel takes the loaded ROW rather than an id, so opening it costs
          no request — the table already has every field it renders. A row that
          is not in the loaded pages (a stale deep link) resolves to `null` and
          the drawer simply stays shut. */}
      <EventPanel
        row={rows.find((row) => row.id === selectedId) ?? null}
        onClose={() => closeRow(router, search)}
      />
    </TableCard>
  );
}

const canArchive = (row: EventRow) =>
  row.status === 'draft' || row.status === 'rejected' || row.status === 'finished';

function openRow(router: ReturnType<typeof useRouter>, search: URLSearchParams, id: string): void {
  const next = new URLSearchParams(search.toString());
  next.set('event', id);
  router.replace(`/dashboard/events?${next.toString()}`, { scroll: false });
}

function closeRow(router: ReturnType<typeof useRouter>, search: URLSearchParams): void {
  const next = new URLSearchParams(search.toString());
  next.delete('event');
  const query = next.toString();
  router.replace(query ? `/dashboard/events?${query}` : '/dashboard/events', { scroll: false });
}

/**
 * A bulk action.
 *
 * Outlined, never filled — see the note on `BulkBar`. Archive and Submit sit
 * next to each other and neither is the safe default.
 */
function BulkButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: typeof Archive;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is disabled. A greyed control with no reason is indistinguishable
   *  from a broken one, and a disabled button is not focusable — so this also
   *  goes on a wrapper that IS hoverable. */
  title?: string;
}) {
  const button = (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </Button>
  );
  if (!title) return button;
  return (
    <span title={title} className="inline-flex">
      {button}
    </span>
  );
}

/**
 * Table / cards.
 *
 * A segmented pill where the chosen half wears the same butter fill as an
 * applied filter and the sidebar's current page — this is a "you are here",
 * not an action.
 */
function ViewToggle({ view, onChange }: { view: string; onChange: (view: string) => void }) {
  return (
    <div
      role="group"
      aria-label="View"
      className="flex h-control overflow-hidden rounded-full border border-border sm:h-control-sm"
    >
      {[
        { value: '', icon: Rows3, label: 'Table' },
        { value: 'cards', icon: LayoutGrid, label: 'Cards' },
      ].map((option, index) => {
        const active = view === option.value;
        return (
          <button
            key={option.value || 'table'}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            aria-label={option.label}
            title={option.label}
            className={cn(
              'inline-flex w-control items-center justify-center transition-colors sm:w-control-sm',
              index === 1 && 'border-l border-border',
              active
                ? 'bg-nav-active text-nav-active-foreground'
                : 'bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            )}
          >
            <option.icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- the cards */

/**
 * The card view.
 *
 * The one place on this dashboard where an image earns its space — a poster is
 * how an organizer with twenty events picks one out. It is still not the
 * consumer product: the cards are compact, three to a row, and every figure on
 * one is a column the backend maintains — capacity and sold from the
 * authoritative tier counters, revenue from captured payments, check-ins from
 * used tickets. **Views and conversion are not here.** The brief marked both
 * "future-ready", and the honest form of future-ready is an absent row — not a
 * greyed-out one showing "—", which implies the number exists and merely
 * happens to be zero. Nothing counts a page view on this platform; BACKLOG
 * "Event view counting" says what it would take.
 */
function EventCards({
  rows,
  isSelected,
  onToggle,
  onOpen,
}: {
  rows: EventRow[];
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
  onOpen: (row: EventRow) => void;
}) {
  return (
    <ul className="grid gap-stack p-card sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => {
        const chosen = isSelected(row.id);
        const remaining = Math.max(0, row.capacity - row.sold);
        const sellThrough = row.capacity > 0 ? row.sold / row.capacity : null;

        return (
          <li key={row.id}>
            <div
              className={cn(
                'group flex h-full flex-col overflow-hidden rounded-xl border transition-colors duration-fast',
                'motion-reduce:transition-none',
                chosen ? 'border-nav-active bg-nav-active' : 'border-border bg-surface',
              )}
            >
              <div className="relative aspect-card w-full bg-muted">
                <Poster
                  url={row.poster_url}
                  className="size-full object-cover"
                  fallback={
                    <span className="flex size-full items-center justify-center text-caption text-muted-foreground">
                      No cover image
                    </span>
                  }
                />

                <label className="absolute left-2 top-2 inline-flex cursor-pointer items-center rounded-md bg-surface/90 p-1.5 backdrop-blur">
                  <input
                    type="checkbox"
                    checked={chosen}
                    onChange={() => onToggle(row.id)}
                    aria-label={`Select ${row.title}`}
                    className="size-5 cursor-pointer accent-primary"
                  />
                </label>

                <span className="absolute right-2 top-2">
                  <StatusBadge status={row.status} capacity={row.capacity} sold={row.sold} />
                </span>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2 p-card">
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="rounded-sm text-left text-body-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="line-clamp-2">{row.title}</span>
                </button>

                <p className="truncate text-caption text-muted-foreground">
                  {new Date(row.starts_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  · {row.city}
                </p>

                {sellThrough === null ? (
                  <p className="text-caption text-muted-foreground">No ticket types yet</p>
                ) : (
                  <>
                    <span
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={Math.round(sellThrough * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${row.sold} of ${row.capacity} sold`}
                    >
                      {/* Violet as a DATA mark, not a control: a meter is read,
                          never pressed. */}
                      <span
                        className="block h-full rounded-full bg-primary transition-[width] duration-base ease-out motion-reduce:transition-none"
                        style={{ width: `${Math.min(100, Math.round(sellThrough * 100))}%` }}
                      />
                    </span>
                    <dl className="grid grid-cols-3 gap-2 text-caption">
                      <Stat label="Sold" value={String(row.sold)} />
                      <Stat label="Left" value={String(remaining)} />
                      <Stat label="Revenue" value={formatMoney(row.revenue_minor)} />
                    </dl>
                  </>
                )}

                <div className="mt-auto flex items-center gap-1 pt-1">
                  <CardAction
                    icon={BarChart3}
                    label="Analytics"
                    href={`/dashboard/events/${row.id}/analytics`}
                  />
                  <CardAction
                    icon={Receipt}
                    label="Bookings"
                    href={`/dashboard/bookings?event=${row.id}`}
                  />
                  {row.status === 'live' ? (
                    <CardAction
                      icon={ExternalLink}
                      label="View public page"
                      href={`/events/${row.id}`}
                      external
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="truncate tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function CardAction({
  icon: Icon,
  label,
  href,
  external,
}: {
  icon: typeof BarChart3;
  label: string;
  href: string;
  external?: boolean;
}) {
  return (
    <Button variant="ghost" size="icon" asChild className={TOOLBAR_ICON}>
      <Link
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        aria-label={label}
        title={label}
      >
        <Icon className="size-4" aria-hidden />
      </Link>
    </Button>
  );
}

/* ------------------------------------------------------------- the columns */

const COLUMNS: ColumnDef<EventRow>[] = [
  {
    key: 'title',
    header: 'Event',
    width: 280,
    minWidth: 160,
    hideable: false,
    sortValue: (row) => row.title,
    render: (row) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="relative hidden size-8 shrink-0 overflow-hidden rounded-md bg-muted sm:block">
          <Poster url={row.poster_url} className="size-full object-cover" />
        </span>
        <span className="truncate font-medium">{row.title}</span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: 160,
    sortValue: (row) => row.status,
    render: (row) => <StatusBadge status={row.status} capacity={row.capacity} sold={row.sold} />,
    exportValue: (row) => row.status,
  },
  {
    key: 'starts_at',
    header: 'Date',
    width: 130,
    sortValue: (row) => Date.parse(row.starts_at),
    render: (row) => (
      <time dateTime={row.starts_at} className="tabular-nums text-muted-foreground">
        {new Date(row.starts_at).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: '2-digit',
        })}
      </time>
    ),
    exportValue: (row) => row.starts_at,
  },
  {
    key: 'venue',
    header: 'Venue',
    width: 180,
    sortValue: (row) => row.venue,
    render: (row) => <span className="truncate text-muted-foreground">{row.venue}</span>,
  },
  {
    key: 'city',
    header: 'City',
    width: 120,
    defaultHidden: true,
    sortValue: (row) => row.city,
    render: (row) => <span className="truncate text-muted-foreground">{row.city}</span>,
  },
  {
    key: 'capacity',
    header: 'Capacity',
    width: 100,
    numeric: true,
    sortValue: (row) => row.capacity,
    render: (row) => (row.capacity ? row.capacity : <Dash reason="No ticket types yet" />),
  },
  {
    key: 'sold',
    header: 'Sold',
    width: 90,
    numeric: true,
    sortValue: (row) => row.sold,
    render: (row) => row.sold,
  },
  {
    key: 'remaining',
    header: 'Left',
    width: 90,
    numeric: true,
    defaultHidden: true,
    sortValue: (row) => Math.max(0, row.capacity - row.sold),
    render: (row) =>
      row.capacity ? Math.max(0, row.capacity - row.sold) : <Dash reason="No ticket types yet" />,
  },
  {
    key: 'revenue_minor',
    header: 'Revenue',
    width: 130,
    numeric: true,
    sortValue: (row) => row.revenue_minor,
    render: (row) => formatMoney(row.revenue_minor),
    // Major units in the export: a finance spreadsheet summing paise as rupees
    // is off by a factor of a hundred, and nobody notices until it matters.
    exportValue: (row) => row.revenue_minor / 100,
  },
  {
    key: 'checkins',
    header: 'Checked in',
    width: 110,
    numeric: true,
    defaultHidden: true,
    sortValue: (row) => row.checkins,
    render: (row) => row.checkins,
  },
  {
    key: 'actions',
    header: '',
    // 64, not 44. The cell is `truncate` (so `overflow: hidden`) with 12px of
    // padding a side, which left a 44px column exactly 20px of content box —
    // and the icon button was 28px, so the only action in the table was being
    // CLIPPED. 64 gives a 40px box, which fits a 36px control with room.
    width: 64,
    minWidth: 64,
    // Not sortable and not exportable — it is a door, not a value. Omitting
    // `sortValue` is what makes the header unsortable; `exportValue` returning
    // empty keeps a column of identical link text out of every CSV.
    hideable: false,
    exportValue: () => '',
    render: (row) => (
      <Link
        href={`/dashboard/events/${row.id}/analytics`}
        // The row itself opens the side panel, so this must not also trigger
        // it — otherwise pressing the link opens a panel behind the page you
        // just navigated to.
        onClick={(event) => event.stopPropagation()}
        aria-label={`Analytics for ${row.title}`}
        title="Analytics"
        className="inline-flex size-control-sm items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BarChart3 className="size-4" aria-hidden />
      </Link>
    ),
  },
];

/** An em dash with a REASON. A bare dash makes people ask; this answers. */
function Dash({ reason }: { reason: string }) {
  return (
    <span className="text-muted-foreground" title={reason}>
      —
    </span>
  );
}
