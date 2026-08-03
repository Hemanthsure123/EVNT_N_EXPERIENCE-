'use client';

import * as React from 'react';

/**
 * The state behind every data table on this dashboard.
 *
 * Kept as a hook rather than a component because the three surfaces that use
 * it (events, bookings, refunds) render very different cells but need
 * identical BEHAVIOUR — column visibility, widths, sort, selection, the
 * keyboard cursor. Sharing the markup instead would have meant a `renderCell`
 * prop soup; sharing the state means each table stays readable.
 *
 * ── SORTING IS CLIENT-SIDE, AND SAYS SO ───────────────────────────────────
 *
 * None of the organizer list endpoints accepts a `sort` parameter, and these
 * lists are cursor-paginated on a fixed server ordering. So sorting here can
 * only ever reorder THE ROWS ALREADY LOADED. That is genuinely useful — an
 * organizer scanning the page they are looking at — but it is not the same as
 * sorting the table, and the header says "sorted within loaded rows" rather
 * than letting someone believe they are looking at the top seller of all time.
 * BACKLOG "A `sort` parameter for the organizer lists" covers the real fix.
 *
 * ── PREFERENCES PERSIST, SELECTION DOES NOT ───────────────────────────────
 *
 * Column widths and visibility are a workspace preference and survive a
 * reload. Selection is a transient intent about specific rows — restoring it
 * would mean re-selecting rows that may no longer exist, and then applying a
 * bulk action to them.
 */

export type ColumnKey = string;

export type ColumnDef<Row> = {
  key: ColumnKey;
  header: string;
  /** Default width in px. Resizing overrides it and persists. */
  width: number;
  minWidth?: number;
  /** Right-align numbers; `tabular-nums` is applied by the renderer. */
  numeric?: boolean;
  /** Omit to make the column unsortable (e.g. a poster thumbnail). */
  sortValue?: (row: Row) => string | number;
  /** `false` keeps a column out of the chooser — identity columns you cannot
   *  hide, because a table of anonymous rows is not a table. */
  hideable?: boolean;
  /** Not shown until the organizer turns it on. */
  defaultHidden?: boolean;
  render: (row: Row) => React.ReactNode;
  /** Value used for CSV export. Falls back to `sortValue`, then to "". */
  exportValue?: (row: Row) => string | number;
};

/**
 * Sorting, as an ORDERED list of keys.
 *
 * Multi-sort exists because a single key answers the wrong question on an
 * operations table: "failed payments, newest first" is two sorts, and doing it
 * with one means eyeballing the second. Shift-clicking a header appends rather
 * than replaces, which is the convention every spreadsheet uses.
 *
 * The array order IS the precedence — index 0 breaks ties first.
 */
export type SortRule = { key: ColumnKey; direction: 'asc' | 'desc' };
export type SortState = SortRule[];

/** Row height. `compact` fits roughly a third more rows on a laptop screen. */
export type Density = 'comfortable' | 'compact';

/**
 * A named filter+layout preset.
 *
 * Stored per surface alongside the column preferences. `query` is an opaque
 * search string owned by the SURFACE — the table engine never parses it, it
 * only hands it back, so adding a filter to a page does not touch this file.
 */
export type SavedView = {
  id: string;
  name: string;
  query: string;
  hidden: ColumnKey[];
  sort: SortState;
};

type Prefs = {
  hidden: ColumnKey[];
  widths: Record<ColumnKey, number>;
  /** Keys pinned to the left edge, in pin order. */
  pinned: ColumnKey[];
  density: Density;
  views: SavedView[];
};

const EMPTY_PREFS: Prefs = {
  hidden: [],
  widths: {},
  pinned: [],
  density: 'comfortable',
  views: [],
};

// Bumped from v1: the shape gained pinning, density and saved views. Reading a
// v1 blob would leave those undefined and crash on `.includes` — bumping is
// cheaper and safer than migrating a layout preference nobody will miss.
const PREFS_VERSION = 'v2';

function readPrefs(id: string): Prefs {
  if (typeof window === 'undefined') return EMPTY_PREFS;
  try {
    const raw = window.localStorage.getItem(`ee-table-${PREFS_VERSION}-${id}`);
    if (!raw) return EMPTY_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // Each field is validated independently rather than trusting the blob: a
    // half-corrupt entry should cost the one preference it broke, not the
    // whole table.
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      widths: parsed.widths && typeof parsed.widths === 'object' ? parsed.widths : {},
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      views: Array.isArray(parsed.views) ? parsed.views : [],
    };
  } catch {
    // Corrupt or blocked storage. Defaults are a fine table.
    return EMPTY_PREFS;
  }
}

export function useDataTable<Row>({
  id,
  columns,
  rows,
  rowId,
}: {
  /** Namespaces the stored preferences. Stable per surface. */
  id: string;
  columns: ColumnDef<Row>[];
  rows: Row[];
  rowId: (row: Row) => string;
}) {
  const [prefs, setPrefs] = React.useState<Prefs>(() => ({
    ...EMPTY_PREFS,
    hidden: columns.filter((column) => column.defaultHidden).map((column) => column.key),
  }));
  const [hydrated, setHydrated] = React.useState(false);
  const [sort, setSort] = React.useState<SortState>([]);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = React.useState(-1);

  // Read stored preferences AFTER mount. Reading them during render would make
  // the server and client markup disagree and blow up hydration.
  React.useEffect(() => {
    setPrefs(readPrefs(id));
    setHydrated(true);
  }, [id]);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(`ee-table-${PREFS_VERSION}-${id}`, JSON.stringify(prefs));
    } catch {
      // Out of quota or private mode — the in-memory table is still correct.
    }
  }, [id, prefs, hydrated]);

  // Pinned columns lead, in PIN order, then the rest in declaration order.
  // Re-sorting the whole list by "is it pinned" would scramble the unpinned
  // ones every time something is pinned, which is disorienting mid-task.
  const visible = React.useMemo(() => {
    const shown = columns.filter((column) => !prefs.hidden.includes(column.key));
    const pinned = prefs.pinned
      .map((key) => shown.find((column) => column.key === key))
      .filter((column): column is ColumnDef<Row> => Boolean(column));
    const rest = shown.filter((column) => !prefs.pinned.includes(column.key));
    return [...pinned, ...rest];
  }, [columns, prefs.hidden, prefs.pinned]);

  const sorted = React.useMemo(() => {
    if (sort.length === 0) return rows;
    const readers = sort
      .map((rule) => {
        const column = columns.find((candidate) => candidate.key === rule.key);
        return column?.sortValue ? { read: column.sortValue, direction: rule.direction } : null;
      })
      .filter(
        (entry): entry is { read: (row: Row) => string | number; direction: 'asc' | 'desc' } =>
          Boolean(entry),
      );
    if (readers.length === 0) return rows;

    // A COPY: sorting `rows` in place mutates the array TanStack Query handed
    // us, which is the cache's own object — the next render would read
    // reordered data it never asked for.
    return [...rows].sort((left, right) => {
      // Each rule breaks the previous one's ties, in declaration order. The
      // first non-zero comparison wins; the rest are never evaluated.
      for (const { read, direction } of readers) {
        const a = read(left);
        const b = read(right);
        const order =
          typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a).localeCompare(String(b), undefined, { numeric: true });
        if (order !== 0) return direction === 'asc' ? order : -order;
      }
      return 0;
    });
  }, [rows, sort, columns]);

  const ids = React.useMemo(() => sorted.map(rowId), [sorted, rowId]);

  // Selection is pruned against the rows that still exist. Without this, a row
  // that vanishes on refetch stays selected invisibly and a bulk action fires
  // at it — the "archived 4 events, one of which was not on screen" bug.
  React.useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const live = new Set(ids);
      const next = new Set([...current].filter((value) => live.has(value)));
      return next.size === current.size ? current : next;
    });
  }, [ids]);

  const allSelected = ids.length > 0 && ids.every((value) => selected.has(value));
  const someSelected = selected.size > 0 && !allSelected;

  return {
    columns: visible,
    allColumns: columns,
    rows: sorted,
    ids,
    sort,
    sortFor: (key: ColumnKey) => sort.find((rule) => rule.key === key) ?? null,
    sortRank: (key: ColumnKey) => sort.findIndex((rule) => rule.key === key),
    /**
     * Click cycles desc -> asc -> off, exactly as before.
     *
     * SHIFT-click APPENDS instead of replacing, so a second key breaks the
     * first's ties. Without the modifier the list is replaced, because the
     * common case is "actually, sort by this instead" and making that take two
     * actions would be worse for everyone in order to serve the rarer case.
     */
    toggleSort: (key: ColumnKey, append = false) =>
      setSort((current) => {
        const existing = current.find((rule) => rule.key === key);
        const next: SortRule | null = !existing
          ? { key, direction: 'desc' }
          : existing.direction === 'desc'
            ? { key, direction: 'asc' }
            : // Third click clears this key. With nothing left the table falls
              // back to the server's own ordering, which is the honest default
              // for a cursor-paginated list.
              null;
        if (!append) return next ? [next] : [];
        const without = current.filter((rule) => rule.key !== key);
        return next ? [...without, next] : without;
      }),
    clearSort: () => setSort([]),
    hidden: prefs.hidden,
    toggleColumn: (key: ColumnKey) =>
      setPrefs((current) => ({
        ...current,
        hidden: current.hidden.includes(key)
          ? current.hidden.filter((value) => value !== key)
          : [...current.hidden, key],
        // Hiding a pinned column unpins it. A pin on something invisible is
        // state nobody can see or undo.
        pinned: current.hidden.includes(key)
          ? current.pinned
          : current.pinned.filter((value) => value !== key),
      })),
    pinned: prefs.pinned,
    isPinned: (key: ColumnKey) => prefs.pinned.includes(key),
    togglePin: (key: ColumnKey) =>
      setPrefs((current) => ({
        ...current,
        pinned: current.pinned.includes(key)
          ? current.pinned.filter((value) => value !== key)
          : [...current.pinned, key],
      })),
    density: prefs.density,
    setDensity: (density: Density) => setPrefs((current) => ({ ...current, density })),
    views: prefs.views,
    /** Saving under an existing name REPLACES it, which is what "save" means
     *  when the name is the identity. */
    saveView: (name: string, query: string) =>
      setPrefs((current) => ({
        ...current,
        views: [
          ...current.views.filter((view) => view.name !== name),
          { id: `${name}:${current.views.length}`, name, query, hidden: current.hidden, sort },
        ],
      })),
    deleteView: (viewId: string) =>
      setPrefs((current) => ({
        ...current,
        views: current.views.filter((view) => view.id !== viewId),
      })),
    applyView: (view: SavedView) => {
      setPrefs((current) => ({ ...current, hidden: view.hidden }));
      setSort(view.sort);
    },
    /** Resets LAYOUT, not saved views. A reset is about columns; silently
     *  deleting somebody's presets would be a nasty surprise. */
    resetColumns: () => setPrefs((current) => ({ ...EMPTY_PREFS, views: current.views })),
    widthFor: (column: ColumnDef<Row>) => prefs.widths[column.key] ?? column.width,
    setWidth: (key: ColumnKey, width: number) =>
      setPrefs((current) => ({ ...current, widths: { ...current.widths, [key]: width } })),
    selected,
    isSelected: (value: string) => selected.has(value),
    toggleRow: (value: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (!next.delete(value)) next.add(value);
        return next;
      }),
    toggleAll: () => setSelected(allSelected ? new Set() : new Set(ids)),
    clearSelection: () => setSelected(new Set()),
    allSelected,
    someSelected,
    cursor,
    setCursor,
  };
}

export type DataTable<Row> = ReturnType<typeof useDataTable<Row>>;

/* ------------------------------------------------------------------ export */

/**
 * CSV, built from the columns actually on screen.
 *
 * Exporting the visible columns rather than every field is the behaviour that
 * matches what someone just looked at — they hid four columns for a reason,
 * and a file with them back is a file they have to edit.
 */
export function toCsv<Row>(columns: ColumnDef<Row>[], rows: Row[]): string {
  const header = columns.map((column) => escapeCsv(column.header));
  const body = rows.map((row) =>
    columns.map((column) => {
      const read = column.exportValue ?? column.sortValue;
      return escapeCsv(read ? String(read(row)) : '');
    }),
  );
  // CRLF: Excel on Windows treats a bare LF as one long line.
  return [header, ...body].map((line) => line.join(',')).join('\r\n');
}

/**
 * A CSV cell.
 *
 * The leading-character guard is the important part and is NOT cosmetic: a
 * value starting `=`, `+`, `-` or `@` is executed as a FORMULA when the file
 * is opened in Excel or Sheets. Customer names and refund reasons are
 * user-supplied, so this is a real injection path out of our data into
 * someone's spreadsheet. Prefixing a single quote neutralises it.
 */
function escapeCsv(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function downloadCsv(filename: string, csv: string): void {
  // A BOM, so Excel reads it as UTF-8 rather than the local codepage —
  // without it, every non-ASCII name in the file is mojibake.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoked on the next tick: revoking synchronously can cancel the download
  // in Safari before it has read the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
