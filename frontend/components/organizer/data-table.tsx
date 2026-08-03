'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  Columns3,
  Download,
  Loader2,
  Pin,
  Rows2,
  Rows3,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadCsv, toCsv, type ColumnDef, type DataTable } from '@/lib/organizer/table';
import { cn } from '@/lib/utils/cn';
import { Skeleton } from './primitives';

/**
 * The shell every organizer table renders inside.
 *
 * ── IT IS A REAL `<table>` ────────────────────────────────────────────────
 *
 * Not a grid of divs with `role="row"` sprinkled on. A native table gives
 * screen readers row/column position, header association and "column 3 of 7"
 * announcements for free, and every div-based reimplementation of that is
 * worse. `table-fixed` plus explicit `<col>` widths is what makes resizing
 * work without giving that up.
 *
 * ── DENSITY IS THE PRODUCT ────────────────────────────────────────────────
 *
 * This is an operations console, not the attendee site. The shared design
 * language arrives here as the PALETTE, both themes, the pill controls and the
 * near-black primary action — and stops short of the whitespace: rows stay
 * tight, the header stays a compact uppercase caption rung, and every number
 * is `tabular-nums` and right-aligned so a column of money reads as a column
 * rather than as ragged text.
 *
 * ── HORIZONTAL OVERFLOW IS SCOPED; THE HEADER IS NOT PINNED ───────────────
 *
 * A wide table must not make the whole page scroll sideways, so the table
 * scrolls horizontally inside its own box. That box is therefore a scroll
 * container on BOTH axes — CSS gives no way to scope one axis alone — which
 * is precisely why the header cannot also be `position: sticky` against the
 * page. See the long note on `headCellClass`; it used to claim it was, and
 * was not.
 *
 * An inner `overflow-y: auto` box WOULD make a pinned header possible, and is
 * deliberately not used: it traps the wheel, breaks browser find-in-page, and
 * puts a second scrollbar beside the page's.
 *
 * ── KEYBOARD NAVIGATION IS ROVING-TABINDEX ────────────────────────────────
 *
 * One tab stop for the whole table; ↑/↓ move a cursor, Space selects, Enter
 * opens. Making every row a tab stop means twenty tab presses to get past the
 * table, which is how keyboard users end up avoiding the page.
 */

/**
 * Control sizing for every list toolbar, in one place.
 *
 * 44px (`h-control`, the touch floor, and `<Button>`'s own `md` default) on a
 * phone, 36px (`h-control-sm`) from `sm` up. An organizer works these with a
 * thumb at a venue and with a mouse at a desk, and the two want opposite
 * things — so the breakpoint decides rather than a single compromise height
 * that is wrong twice.
 */
export const TOOLBAR_CONTROL = 'sm:h-control-sm';
/** The same rule for a square icon control. */
export const TOOLBAR_ICON = 'sm:size-control-sm';

/**
 * The row of controls above a list.
 *
 * Sits on the card's `--surface` with a hairline under it, which is the
 * light-theme recipe (a white card cannot separate by value, so it separates
 * by an edge) and reads as a distinct rung of the value ladder in dark.
 */
export function TableToolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // NOT sticky — the same correction as `headCellClass`, and the same
        // cause. This was `sticky top-14 z-sticky`, which in a container that
        // never scrolls vertically does not pin anything: it displaces the
        // toolbar 3.5rem DOWNWARD, on top of the column headings underneath
        // it. `z-sticky` then guaranteed it won, so the header row was drawn
        // and then covered — which is why the console's tables looked like
        // they had lost their headings entirely.
        //
        // Sticky filters are worth having and need the scroll-container
        // redesign described on `headCellClass`, not an offset.
        'flex flex-wrap items-center gap-2 border-b border-border bg-surface px-card py-stack',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The card every list sits in.
 *
 * `bg-surface` ALONE is invisible in light — background, surface and elevated
 * are all pure white there — so the recipe is surface + hairline + a very soft
 * shadow, and in dark the value ladder does the same job. Without it these
 * screens were a toolbar hairline floating on a white page with no object
 * around the data; `customers` and `payouts` already drew this container, and
 * the three DataGrid surfaces did not.
 *
 * Deliberately NOT `overflow-hidden`: the toolbar's Columns / Views / date
 * popovers are absolutely positioned inside it, and clipping is how a filter
 * menu becomes a 2px sliver. `DataGrid` rounds its own bottom instead.
 */
export function TableCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border bg-surface shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A menu row inside one of the toolbar popovers. Not a `<Button>`: these are
 *  full-width list rows, and a pill per row would turn a compact menu into a
 *  scrolling column of lozenges. 36px tall so a thumb can still hit one. */
const menuItemClass =
  'flex min-h-control-sm w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

/** The floating surface of a toolbar popover. `bg-elevated` so it reads as
 *  above the card in dark, where value — not shadow — carries elevation. */
const popoverClass =
  'absolute top-full z-popover mt-1 rounded-xl border border-border bg-elevated p-1 shadow-lg animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none';

export function ColumnChooser<Row>({ table }: { table: DataTable<Row> }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hideable = table.allColumns.filter((column) => column.hideable !== false);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className={TOOLBAR_CONTROL}
      >
        <Columns3 className="size-3.5" aria-hidden />
        Columns
        {table.hidden.length ? (
          <span className="tabular-nums text-caption">({table.columns.length})</span>
        ) : null}
      </Button>

      {open ? (
        <div className={cn(popoverClass, 'right-0 w-56')}>
          <ul className="max-h-72 overflow-y-auto">
            {hideable.map((column) => {
              const shown = !table.hidden.includes(column.key);
              return (
                <li key={column.key}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={shown}
                    onClick={() => table.toggleColumn(column.key)}
                    className={menuItemClass}
                  >
                    <span
                      className={cn(
                        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm border',
                        // Violet as a SELECTED MARKER, which is the one job it
                        // kept — never as a button fill.
                        shown
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input',
                      )}
                      aria-hidden
                    >
                      {shown ? <Check className="size-3" /> : null}
                    </span>
                    {column.header}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              table.resetColumns();
              setOpen(false);
            }}
            className={cn(
              menuItemClass,
              'mt-1 border-t border-border text-caption text-muted-foreground hover:text-foreground',
            )}
          >
            Reset columns and widths
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Row height.
 *
 * `compact` fits roughly a third more rows on a laptop, which on a triage
 * queue is the difference between seeing the whole backlog and scrolling it.
 * It is a stored preference rather than a per-session toggle because an
 * operator who wants dense tables wants them every morning.
 */
export function DensityToggle<Row>({ table }: { table: DataTable<Row> }) {
  const compact = table.density === 'compact';
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => table.setDensity(compact ? 'comfortable' : 'compact')}
      aria-pressed={compact}
      title={compact ? 'Comfortable rows' : 'Compact rows'}
      aria-label={compact ? 'Switch to comfortable rows' : 'Switch to compact rows'}
      className={TOOLBAR_ICON}
    >
      {compact ? <Rows3 className="size-4" aria-hidden /> : <Rows2 className="size-4" aria-hidden />}
    </Button>
  );
}

/**
 * Saved views: a named filter + layout preset.
 *
 * The `query` is opaque to the table engine — the SURFACE hands in its current
 * query string and gets it back on apply. That is what keeps this component
 * from having to know that Payments has a `status` filter and Users has a
 * `role` one, and means adding a filter to a page never touches this file.
 *
 * Stored per surface in `localStorage`, which is the honest scope: these are
 * one operator's shortcuts on one machine. Sharing a view with a colleague
 * needs a server-side model — BACKLOG "Shared saved views".
 */
export function SavedViews<Row>({
  table,
  currentQuery,
  onApply,
}: {
  table: DataTable<Row>;
  currentQuery: string;
  onApply: (query: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className={TOOLBAR_CONTROL}
      >
        <Bookmark className="size-3.5" aria-hidden />
        Views
        {table.views.length ? (
          <span className="tabular-nums text-caption">({table.views.length})</span>
        ) : null}
      </Button>

      {open ? (
        <div className={cn(popoverClass, 'right-0 w-64')}>
          {table.views.length ? (
            <ul className="max-h-64 overflow-y-auto">
              {table.views.map((view) => (
                <li key={view.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      table.applyView(view);
                      onApply(view.query);
                      setOpen(false);
                    }}
                    className={cn(menuItemClass, 'min-w-0 flex-1 truncate')}
                  >
                    {view.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => table.deleteView(view.id)}
                    aria-label={`Delete the view “${view.name}”`}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive-subtle hover:text-destructive-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 text-caption text-muted-foreground">
              No saved views yet. Filter and sort the table, then save it here.
            </p>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              table.saveView(name.trim(), currentQuery);
              setName('');
              setOpen(false);
            }}
            className="mt-1 flex items-center gap-1 border-t border-border pt-1"
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this view"
              aria-label="Name this view"
              className="h-control-sm min-w-0 flex-1 rounded-full border border-input bg-surface px-3 text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {/* The one filled action in this popover — its own context, so it
                does not compete with the surface's primary action. */}
            <Button type="submit" size="sm" disabled={!name.trim()} className="shrink-0">
              Save
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function ExportButton<Row>({
  table,
  filename,
  disabled,
}: {
  table: DataTable<Row>;
  filename: string;
  disabled?: boolean;
}) {
  // Exports the SELECTION when there is one, otherwise everything loaded. The
  // label says which, because "Export" that silently means one or the other is
  // how somebody mails the wrong file to a finance team.
  const rows = table.selected.size
    ? table.rows.filter((row, index) => table.selected.has(table.ids[index]))
    : table.rows;

  return (
    <Button
      variant="outline"
      disabled={disabled || rows.length === 0}
      onClick={() => downloadCsv(filename, toCsv(table.columns, rows))}
      className={TOOLBAR_CONTROL}
    >
      <Download className="size-3.5" aria-hidden />
      {table.selected.size ? `Export ${table.selected.size}` : 'Export'}
    </Button>
  );
}

/**
 * The bulk bar.
 *
 * Appears only with a selection, and slides up from the bottom rather than
 * pushing the table down — a toolbar that reflows the rows you are selecting
 * makes you lose your place mid-selection.
 *
 * The actions inside are OUTLINE buttons on purpose. Bulk archive and bulk
 * submit are consequential and near each other; one filled pill among them
 * would nominate a default, and there is no correct default for "what do you
 * want to do to these five events".
 */
export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label={`${count} selected`}
      className={cn(
        'fixed inset-x-0 bottom-4 z-sticky mx-auto flex w-[calc(100%-2rem)] max-w-2xl items-center gap-3',
        'rounded-xl border border-border bg-elevated px-card py-2 shadow-lg',
        'animate-in slide-in-from-bottom-2 fade-in-0 motion-reduce:animate-none',
      )}
    >
      <span aria-live="polite" className="text-body-sm font-medium tabular-nums">
        {count} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClear}
        aria-label="Clear selection"
        className={cn(TOOLBAR_ICON, 'shrink-0')}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

export function DataGrid<Row>({
  table,
  caption,
  onOpen,
  selectable = true,
  loading,
  className,
}: {
  table: DataTable<Row>;
  /** Announced to screen readers; never rendered visually. */
  caption: string;
  onOpen?: (row: Row, index: number) => void;
  selectable?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);

  const move = (delta: number) => {
    const next = Math.max(0, Math.min(table.rows.length - 1, table.cursor + delta));
    table.setCursor(next);
    const row = bodyRef.current?.querySelectorAll('tr')[next];
    (row as HTMLElement | undefined)?.focus({ preventScroll: false });
  };

  const cellClass = table.density === 'compact' ? 'py-1.5' : 'py-2.5';

  return (
    // Only the TABLE scrolls sideways. The page never does — a body that
    // scrolls horizontally on mobile is the most-reported layout bug there is.
    //
    // `rounded-b-xl` because this box already clips (an `overflow-x` other than
    // `visible` forces the same on `overflow-y`), so it is what keeps a hovered
    // or selected LAST row from painting square into the card's rounded bottom
    // corners. Invisible when a footer follows it.
    <div className={cn('w-full overflow-x-auto rounded-b-xl', className)}>
      {/* `border-separate border-spacing-0`, NOT `border-collapse`.

          The third and last reason the sticky header never worked: Chrome
          ignores `position: sticky` on a `<th>` inside a table with collapsed
          borders. Nothing warns; the cell simply scrolls away while reporting
          `position: sticky` in devtools, which is why this looked like an
          offset bug twice over.

          The catch, and it cost the rows their dividers: in the SEPARATED
          model a `<tr>` cannot have a border at all — CSS says user agents
          must ignore border properties on rows — so the `border-t` this table
          carried on every `<tr>` drew nothing, and the body ran as one
          undifferentiated block. The rule now lives on the CELLS, which is the
          only place the separated model honours it, and at spacing 0 the
          per-cell edges join into the continuous line a dense table needs. */}
      <table className="w-full table-fixed border-separate border-spacing-0 text-body-sm">
        <caption className="sr-only">
          {caption}
          {table.sort
            ? '. Sorted within the rows loaded so far, not across the whole list.'
            : ''}
        </caption>
        <colgroup>
          {selectable ? <col style={{ width: '2.75rem' }} /> : null}
          {table.columns.map((column) => (
            <col key={column.key} style={{ width: `${table.widthFor(column)}px` }} />
          ))}
        </colgroup>

        <thead>
          <tr>
            {selectable ? (
              <th scope="col" className={headCellClass}>
                <input
                  type="checkbox"
                  checked={table.allSelected}
                  ref={(node) => {
                    // The indeterminate state is a DOM property, not an
                    // attribute — React cannot set it declaratively.
                    if (node) node.indeterminate = table.someSelected;
                  }}
                  onChange={table.toggleAll}
                  aria-label={table.allSelected ? 'Clear selection' : 'Select all loaded rows'}
                  className="size-5 cursor-pointer accent-primary"
                />
              </th>
            ) : null}

            {table.columns.map((column) => (
              <HeadCell key={column.key} column={column} table={table} />
            ))}
          </tr>
        </thead>

        <tbody
          ref={bodyRef}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              move(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              move(-1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              table.setCursor(0);
              move(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              table.setCursor(table.rows.length - 1);
              move(0);
            }
          }}
        >
          {table.rows.map((row, index) => {
            const id = table.ids[index];
            const chosen = table.isSelected(id);
            return (
              <tr
                key={id}
                // Roving tabindex: one stop for the table, arrows inside it.
                tabIndex={index === Math.max(table.cursor, 0) ? 0 : -1}
                aria-selected={selectable ? chosen : undefined}
                onFocus={() => table.setCursor(index)}
                onKeyDown={(event) => {
                  if (event.key === ' ' && selectable) {
                    event.preventDefault();
                    table.toggleRow(id);
                  } else if (event.key === 'Enter' && onOpen) {
                    event.preventDefault();
                    onOpen(row, index);
                  }
                }}
                onClick={() => onOpen?.(row, index)}
                className={cn(
                  'transition-colors duration-fast motion-reduce:transition-none',
                  // A selected row wears the warm `--nav-active` pill colour —
                  // the same token the sidebar's current page uses. Selection
                  // and "you are here" are the same idea, and butter is the one
                  // fill in the palette that cannot be mistaken for a status.
                  chosen ? 'bg-nav-active hover:bg-nav-active-hover' : 'hover:bg-muted',
                  onOpen && 'cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                )}
              >
                {selectable ? (
                  <td className={cn('border-t border-border px-3 align-middle', cellClass)}>
                    <input
                      type="checkbox"
                      checked={chosen}
                      onChange={() => table.toggleRow(id)}
                      // The row's own click opens the drawer; without this the
                      // checkbox would open it too.
                      onClick={(event) => event.stopPropagation()}
                      aria-label={chosen ? 'Deselect row' : 'Select row'}
                      className="size-5 cursor-pointer accent-primary"
                    />
                  </td>
                ) : null}

                {table.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'truncate border-t border-border px-3 align-middle',
                      cellClass,
                      column.numeric && 'text-right tabular-nums',
                      table.isPinned(column.key) && 'border-l border-l-border',
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {loading ? (
        <div className="flex items-center justify-center gap-2 border-t border-border py-4 text-caption text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading more…
        </div>
      ) : null}
    </div>
  );
}

/**
 * NOT sticky, and that is a correction rather than a downgrade.
 *
 * The header cells carried `sticky top-[6.5rem]` and never once stuck. Three
 * separate things each independently prevented it, which is why it survived
 * so long — fixing any one of them still left it broken:
 *
 *  1. `HeadCell` also applied `relative`. `cn` is tailwind-merge, both are
 *     `position` utilities, and the later one won.
 *  2. The table used `border-collapse`, and Chrome ignores `position: sticky`
 *     on a `<th>` inside a collapsed-border table.
 *  3. Decisively: this component's own root is `overflow-x-auto`. CSS forces
 *     the other axis to a non-visible value too, so that element — not the
 *     page — is the sticky scrollport, and it never scrolls vertically.
 *
 * (3) cannot be fixed without giving the table its own vertical scrollbar,
 * which the note at the top of this file explicitly rejects, and rightly: an
 * inner scroll box traps the wheel and breaks browser find-in-page. A wide
 * table needs horizontal scoping more than a long one needs a pinned header.
 *
 * With no scrollport to stick to, `sticky` could only ever DISPLACE the
 * header by its offset — 6.5rem down, straight through the first row of data.
 * That is the half-clipped row the console's payments table was showing above
 * its column headings.
 *
 * A pinned header on long tables is worth having; it needs the container
 * redesign above, not another offset. BACKLOG it rather than reintroduce a
 * number that only appears to work.
 *
 * `bg-sunken` rather than `bg-surface`: the one value step the light theme has
 * runs DOWNWARD, so a recessed band is the only way a header can separate from
 * a white card — and in dark, sunken is a real rung below surface, so the same
 * class reads as the same idea in both themes instead of vanishing in one.
 */
const headCellClass =
  'border-b border-border bg-sunken px-3 py-2 text-left text-caption font-medium uppercase tracking-wide text-muted-foreground';

function HeadCell<Row>({ column, table }: { column: ColumnDef<Row>; table: DataTable<Row> }) {
  const rule = table.sortFor(column.key);
  const rank = table.sortRank(column.key);
  const sortable = Boolean(column.sortValue);
  const pinned = table.isPinned(column.key);

  return (
    <th
      scope="col"
      aria-sort={rule ? (rule.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(
        headCellClass,
        // NO `relative` HERE, and that is the whole fix for the sticky header.
        //
        // `cn` is tailwind-merge: `relative` and the `sticky` in
        // `headCellClass` are both `position` utilities, so the last one wins
        // — and this one was last. The header has never actually stuck, in
        // either shell, since the resize grip was added. It looked like a
        // z-index or offset problem and was neither.
        //
        // `relative` was only ever here to anchor the absolutely-positioned
        // pin and resize controls below, and `position: sticky` establishes a
        // containing block for them exactly as `relative` does. It was
        // redundant as well as harmful.
        'group/head',
        column.numeric && 'text-right',
        // A pinned column keeps a left rule so the boundary is visible even
        // when the table is scrolled sideways past it.
        pinned && 'border-l border-l-border',
      )}
    >
      {sortable ? (
        <button
          type="button"
          // Shift appends rather than replaces — the spreadsheet convention.
          onClick={(event) => table.toggleSort(column.key, event.shiftKey)}
          title={`Sort by ${column.header}. Shift-click to add to the current sort.`}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-sm transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            // The active sort key is the one wayfinding cue in the header, so
            // it takes the accent rather than merely darkening.
            rule && 'text-primary',
          )}
        >
          <span className="truncate">{column.header}</span>
          {rule ? (
            rule.direction === 'asc' ? (
              <ArrowUp className="size-3 shrink-0" aria-hidden />
            ) : (
              <ArrowDown className="size-3 shrink-0" aria-hidden />
            )
          ) : null}
          {/* The precedence number, shown only when more than one key is
              active — a lone "1" beside a single sort is noise. */}
          {rule && table.sort.length > 1 ? (
            <span className="shrink-0 tabular-nums opacity-60">{rank + 1}</span>
          ) : null}
        </button>
      ) : (
        <span className="truncate">{column.header}</span>
      )}

      <button
        type="button"
        onClick={() => table.togglePin(column.key)}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${column.header}` : `Pin ${column.header} to the left`}
        title={pinned ? 'Unpin' : 'Pin to the left'}
        className={cn(
          'absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 transition-opacity',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          // Revealed on hover or focus rather than always visible: seven
          // permanent pin icons across a header is clutter on a control most
          // people use once.
          pinned
            ? 'text-primary opacity-100'
            : 'opacity-0 group-hover/head:opacity-60 focus-visible:opacity-100',
        )}
      >
        <Pin className="size-3" aria-hidden />
      </button>

      <ResizeHandle column={column} table={table} />
    </th>
  );
}

/**
 * The resize grip.
 *
 * Pointer events rather than mouse events, so it works with a trackpad, a pen
 * and a touchscreen from one code path; `setPointerCapture` means a fast drag
 * that leaves the 4px handle keeps resizing instead of stopping dead.
 */
function ResizeHandle<Row>({ column, table }: { column: ColumnDef<Row>; table: DataTable<Row> }) {
  const startX = React.useRef(0);
  const startWidth = React.useRef(0);

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${column.header}`}
      tabIndex={0}
      onKeyDown={(event) => {
        // Keyboard resizing, because a drag handle nobody can reach is not a
        // feature.
        const step = event.shiftKey ? 32 : 8;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          table.setWidth(column.key, table.widthFor(column) + step);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          table.setWidth(
            column.key,
            Math.max(column.minWidth ?? 64, table.widthFor(column) - step),
          );
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        startX.current = event.clientX;
        startWidth.current = table.widthFor(column);
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!(event.target as HTMLElement).hasPointerCapture?.(event.pointerId)) return;
        const next = startWidth.current + (event.clientX - startX.current);
        table.setWidth(column.key, Math.max(column.minWidth ?? 64, next));
      }}
      className={cn(
        'absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none select-none',
        'bg-transparent transition-colors hover:bg-primary group-hover/head:bg-border-strong',
        'focus-visible:bg-primary focus-visible:outline-none',
      )}
    />
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="flex flex-col gap-px p-card" aria-hidden>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3 py-2">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={column}
              className={cn('h-4', column === 0 ? 'w-1/3' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
