'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Columns3,
  Inbox,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';

/**
 * One data table, used by every list in the console.
 *
 * Sorting, filtering, column visibility, search, bulk selection and bulk
 * actions all live here so a new admin list is a column definition, not a new
 * table.
 *
 * SORTING AND SEARCH ARE CLIENT-SIDE, OVER THE LOADED PAGES — and the table
 * says so when more pages exist. The console's list endpoints are cursor
 * paginated with a fixed server-side ordering (that's what keeps them
 * index-backed and COUNT-free); there is no `sort` or `q` parameter to pass
 * except on users. Sorting a page and implying it sorted the platform is the
 * kind of quiet lie that makes an operator draw the wrong conclusion, so the
 * footer states the scope every time.
 *
 * NOT VIRTUALISED, for the same reason the browse grid isn't: pages are 20–50
 * rows, `content-visibility` already skips off-screen work, and windowing
 * would break find-in-page and the reserved height that keeps CLS at zero.
 */

export type Column<Row> = {
  id: string;
  header: string;
  /** The cell. Keep it presentational — sorting uses `sortValue`. */
  cell: (row: Row) => React.ReactNode;
  /** Sortable when present. Return a primitive. */
  sortValue?: (row: Row) => string | number;
  /** Included in the search haystack. */
  searchValue?: (row: Row) => string;
  /** Hidden by default; still offered in the column menu. */
  defaultHidden?: boolean;
  className?: string;
};

export type BulkAction<Row> = {
  id: string;
  label: string;
  run: (rows: Row[]) => void | Promise<void>;
  destructive?: boolean;
};

export function DataTable<Row extends { id: string }>({
  rows,
  columns,
  getRowId = (row: Row) => row.id,
  loading = false,
  hasMore = false,
  onLoadMore,
  searchPlaceholder = 'Search these rows…',
  search,
  onSearchChange,
  toolbarExtra,
  bulkActions = [],
  emptyTitle,
  emptyBody,
  emptyAction,
  highlightId,
  className,
}: {
  rows: Row[];
  columns: Column<Row>[];
  getRowId?: (row: Row) => string;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  searchPlaceholder?: string;
  /**
   * Hand the search box to the SERVER.
   *
   * Supplied together, these make the input a controlled field whose value the
   * caller sends as a query param, and the client-side filter step is skipped
   * because the rows arriving are already the answer. Omitted, the table keeps
   * its own box and filters the rows it holds.
   *
   * The distinction matters because these lists are cursor-paginated: a
   * client-side search over page one looks exactly like a search over the
   * whole platform and silently is not, which is how an operator concludes an
   * organisation does not exist.
   */
  search?: string;
  onSearchChange?: (value: string) => void;
  /** Extra toolbar controls — a date window, a status select. */
  toolbarExtra?: React.ReactNode;
  bulkActions?: BulkAction<Row>[];
  emptyTitle: string;
  emptyBody: string;
  emptyAction?: React.ReactNode;
  /** Row to flash, e.g. arriving from the command palette. */
  highlightId?: string | null;
  className?: string;
}) {
  const serverSide = onSearchChange !== undefined;
  const [localQuery, setLocalQuery] = React.useState('');
  const query = serverSide ? (search ?? '') : localQuery;
  const setQuery = serverSide ? onSearchChange : setLocalQuery;
  const [sort, setSort] = React.useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);
  const [hidden, setHidden] = React.useState<Set<string>>(
    () => new Set(columns.filter((column) => column.defaultHidden).map((column) => column.id)),
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [running, setRunning] = React.useState(false);

  const visible = columns.filter((column) => !hidden.has(column.id));

  const filtered = React.useMemo(() => {
    // Server-filtered rows ARE the result; filtering them again would drop
    // matches the server found on columns this table does not render.
    if (serverSide) return rows;
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      columns.some((column) => column.searchValue?.(row).toLowerCase().includes(needle)),
    );
  }, [rows, columns, query, serverSide]);

  const sorted = React.useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((entry) => entry.id === sort.id);
    if (!column?.sortValue) return filtered;
    const direction = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (left === right) return 0;
      return (left < right ? -1 : 1) * direction;
    });
  }, [filtered, sort, columns]);

  const allSelected = sorted.length > 0 && sorted.every((row) => selected.has(getRowId(row)));

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(sorted.map((row) => getRowId(row))));

  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (action: BulkAction<Row>) => {
    const chosen = sorted.filter((row) => selected.has(getRowId(row)));
    setRunning(true);
    try {
      await action.run(chosen);
      setSelected(new Set());
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          {/* `border-input`, not `border-border`, and `h-control`, not `h-10`.
              A field's edge is its ONLY affordance, so it has to clear the 3:1
              non-text requirement (WCAG 1.4.11) that a 1.27:1 hairline does
              not — the rule this console's own `SELECT_CLASS` states, and the
              one every other search field in the product follows. 44px is the
              touch-target floor and it lines this up with the select beside
              it. */}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-control w-full rounded-md border border-input bg-surface pl-9 pr-11 text-body-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        {toolbarExtra}

        <Popover>
          <PopoverTrigger
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-3 text-body-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Choose visible columns"
          >
            <Columns3 className="size-4" aria-hidden />
            Columns
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2">
            {columns.map((column) => (
              <label
                key={column.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-body-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={!hidden.has(column.id)}
                  onChange={() =>
                    setHidden((current) => {
                      const next = new Set(current);
                      if (next.has(column.id)) next.delete(column.id);
                      else next.add(column.id);
                      return next;
                    })
                  }
                  className="size-4 accent-primary"
                />
                {column.header}
              </label>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {selected.size && bulkActions.length ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-primary bg-secondary px-4 py-2.5"
        >
          <span className="text-body-sm text-secondary-foreground">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {bulkActions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant={action.destructive ? 'outline' : 'primary'}
                loading={running}
                onClick={() => void runBulk(action)}
              >
                {action.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── CARDS ON A PHONE, THE TABLE FROM `sm` ─────────────────────────
          `min-w-[40rem]` inside `overflow-x-auto` means this table was 640px
          wide in a 390px window on every console list — payments, users,
          moderation, refunds — so an operator read one row by dragging it
          sideways past the identity column that told them whose row it was.

          The same rows, as cards, below `sm`. `column.cell` is reused
          verbatim, so the two layouts cannot drift and a column added to the
          table is not silently absent on mobile. The first visible column is
          the identity one on every list here, so it heads the card. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {loading
          ? Array.from({ length: 4 }, (_, index) => (
              <li
                key={index}
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
              >
                <div className="skeleton h-4 w-32 rounded" />
                <div className="skeleton h-3 w-full rounded" />
              </li>
            ))
          : sorted.map((row) => {
              const id = getRowId(row);
              const [identity, ...rest] = visible;
              return (
                <li
                  key={id}
                  className={cn(
                    'flex flex-col gap-2 rounded-xl border p-3 transition-colors',
                    selected.has(id) || highlightId === id
                      ? 'border-transparent bg-secondary/40'
                      : 'border-border bg-surface',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    {bulkActions.length ? (
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        onChange={() => toggleRow(id)}
                        aria-label={`Select row ${id}`}
                        className="mt-0.5 size-5 shrink-0 accent-primary"
                      />
                    ) : null}
                    {identity ? (
                      <div className="min-w-0 flex-1 text-body-sm font-semibold text-foreground">
                        {identity.cell(row)}
                      </div>
                    ) : null}
                  </div>
                  {rest.length ? (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {rest.map((column) => (
                        <div key={column.id} className="flex min-w-0 flex-col gap-0.5">
                          <dt className="truncate text-[0.6875rem] uppercase tracking-wide text-foreground-subtle">
                            {column.header}
                          </dt>
                          <dd className="min-w-0 text-caption text-foreground">
                            {column.cell(row)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </li>
              );
            })}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <thead className="border-b border-border bg-surface">
            <tr>
              {bulkActions.length ? (
                <th scope="col" className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows on this page"
                    className="size-4 accent-primary"
                  />
                </th>
              ) : null}
              {visible.map((column) => {
                const active = sort?.id === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn('px-4 py-3 text-label text-muted-foreground', column.className)}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSort((current) =>
                            current?.id === column.id
                              ? { id: column.id, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                              : { id: column.id, dir: 'asc' },
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {column.header}
                        {active ? (
                          sort.dir === 'asc' ? (
                            <ArrowUp className="size-3.5" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3.5" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {loading
              ? Array.from({ length: 6 }, (_, index) => (
                  <tr key={index} className="border-b border-border last:border-0">
                    {bulkActions.length ? <td className="px-4 py-4" /> : null}
                    {visible.map((column) => (
                      <td key={column.id} className="px-4 py-4">
                        <div className="skeleton h-4 w-24 rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              : sorted.map((row) => {
                  const id = getRowId(row);
                  return (
                    <tr
                      key={id}
                      className={cn(
                        'border-b border-border transition-colors last:border-0 hover:bg-muted/50',
                        selected.has(id) && 'bg-secondary/40',
                        highlightId === id && 'bg-secondary',
                      )}
                    >
                      {bulkActions.length ? (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(id)}
                            onChange={() => toggleRow(id)}
                            aria-label={`Select row ${id}`}
                            className="size-4 accent-primary"
                          />
                        </td>
                      ) : null}
                      {visible.map((column) => (
                        <td
                          key={column.id}
                          className={cn('px-4 py-3 text-body-sm', column.className)}
                        >
                          {column.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>

      </div>

      {/* OUTSIDE the desktop wrapper. Left inside it, an empty list rendered
          NOTHING on a phone — no "nothing matches", no way to clear the search
          — which reads as a broken screen rather than an empty one. */}
      {!loading && !sorted.length ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border px-6 py-14 text-center sm:rounded-t-none sm:border-t-0">
          <span
            className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
            aria-hidden
          >
            <Inbox className="size-6" />
          </span>
          <div className="flex max-w-sm flex-col gap-1">
            <p className="text-body font-medium text-foreground">
              {query ? `Nothing matches “${query}”` : emptyTitle}
            </p>
            <p className="text-body-sm text-muted-foreground">
              {query ? 'Try a shorter search, or clear it.' : emptyBody}
            </p>
          </div>
          {query ? (
            <Button variant="outline" size="sm" onClick={() => setQuery('')}>
              Clear search
            </Button>
          ) : (
            emptyAction
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-muted-foreground">
          {sorted.length} row{sorted.length === 1 ? '' : 's'}
          {hasMore ? ' loaded' : ''}
          {/* Said every time, because it changes what the numbers mean. */}
          {hasMore ? ' · sorting and search apply to the rows loaded so far' : ''}
        </p>
        {hasMore && onLoadMore ? (
          <Button variant="outline" size="sm" onClick={onLoadMore} loading={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Load more
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Status pill, shared by every console list. */
export function StatusPill({
  status,
  tone,
}: {
  status: string;
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-caption capitalize',
        tone === 'ok' && 'bg-success-subtle text-success-subtle-foreground',
        tone === 'warn' && 'bg-warning-subtle text-warning-subtle-foreground',
        tone === 'bad' && 'bg-destructive-subtle text-destructive-subtle-foreground',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
