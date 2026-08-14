'use client';

import * as React from 'react';
import { Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { TOOLBAR_CONTROL } from './data-table';

/**
 * The filter controls every list surface shares.
 *
 * ── FILTER STATE LIVES IN THE URL ─────────────────────────────────────────
 *
 * Not in component state. A filtered view an organizer can send to a colleague
 * — or return to from the browser's back button — is the difference between a
 * tool and a toy, and it costs nothing: each surface reads and writes
 * `useSearchParams`, and these components are the dumb controls over it.
 *
 * ── SEARCH IS DEBOUNCED, THE URL IS NOT ───────────────────────────────────
 *
 * Typing writes local state immediately (so the field never lags a keystroke)
 * and pushes to the URL after a pause. Writing the URL per keystroke would put
 * thirty entries in the history stack for one search and fire thirty requests.
 *
 * ── AN APPLIED FILTER WEARS THE BUTTER PILL ───────────────────────────────
 *
 * Active select, active date range and every chip below use `--nav-active` —
 * the same warm fill the sidebar's current page wears. "You are here" and
 * "this is narrowing your rows" are the same message, and a filter that looks
 * identical whether or not it is filtering is how somebody spends five minutes
 * wondering where their rows went. It is deliberately not the accent violet:
 * that now means a link or a marker, not a state.
 */

/** Applied: warm butter fill, dark ink. Idle: a quiet outlined control. */
const filterStateClass = (active: boolean) =>
  active
    ? 'border-nav-active bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
    : 'border-input bg-surface text-muted-foreground hover:bg-muted hover:text-foreground';

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  suggestions,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  /**
   * Optional autocomplete, via a native `<datalist>`.
   *
   * A SUGGESTION, never a constraint: typing a value that is not in the list
   * still filters. That distinction is the whole reason this is not a
   * `<select>` — the city options are derived from the rows currently loaded,
   * which is a real subset and not a complete index, and a select built from
   * a subset silently makes the missing cities unreachable.
   */
  suggestions?: string[];
}) {
  const [draft, setDraft] = React.useState(value);
  const id = React.useId();
  const listId = `${id}-options`;

  // The URL is the source of truth — a back/forward navigation or a cleared
  // filter chip has to move the input, not just the query.
  React.useEffect(() => setDraft(value), [value]);

  React.useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => onChange(draft), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-primary"
        aria-hidden
      />
      <input
        id={id}
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        list={suggestions?.length ? listId : undefined}
        // A pill, like every other control in the language, and `border-input`
        // rather than `border-border` because a field's edge is its only
        // affordance and has to clear 3:1 in both themes.
        className={cn(
          'h-control w-full rounded-full border border-input bg-surface pl-10 pr-10 text-body-sm text-foreground outline-none transition-colors',
          'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring',
          TOOLBAR_CONTROL,
        )}
      />
      {draft ? (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {suggestions?.length ? (
        <datalist id={listId}>
          {suggestions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

/**
 * The secondary filters, as one group rather than as loose controls.
 *
 * ── THE PROBLEM WAS GROUPING, NOT THE CONTROLS ────────────────────────────
 *
 * The toolbar was a single `flex-wrap` row holding search, status, city, dates,
 * a view toggle, a column chooser, an export button and the primary action —
 * eight pills at one weight with nothing saying which three of them narrow the
 * rows. On a phone they wrapped into four ragged lines of 44px controls and the
 * table started below the fold.
 *
 * So: search stays visible because it is how people actually filter, the
 * primary action stays visible because it is why they came, and the rest
 * collapse behind one button under `sm`. Above `sm` they are always inline and
 * the button is not rendered at all.
 *
 * ── ONE INSTANCE OF THE CHILDREN, NEVER TWO ───────────────────────────────
 *
 * The obvious build — render inline on desktop, render again inside a popover
 * on mobile — duplicates every control, which means duplicate `id`s, duplicate
 * `datalist`s and two inputs racing to own the same URL parameter. This shows
 * and hides ONE instance with CSS, so the desktop layout is not conditional on
 * JavaScript state and there is nothing to keep in sync.
 *
 * `open` starts false and renders identically on server and client, so the
 * collapse costs no hydration risk.
 */
export function FilterCluster({
  children,
  count,
}: {
  children: React.ReactNode;
  /** How many of the contained filters are applied — drives the badge. */
  count: number;
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        className={cn(TOOLBAR_CONTROL, 'sm:hidden', filterStateClass(count > 0))}
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filters
        {count > 0 ? <span className="tabular-nums">({count})</span> : null}
      </Button>

      <div
        id={id}
        className={cn(
          'w-full flex-wrap items-center gap-2 sm:flex sm:w-auto',
          open ? 'flex' : 'hidden',
        )}
      >
        {children}
      </div>
    </>
  );
}

export type SelectOption = { value: string; label: string };

export function SelectFilter({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label: string;
}) {
  const id = React.useId();
  const active = Boolean(value);
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-control appearance-none rounded-full border pl-4 pr-9 text-label outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-ring',
          TOOLBAR_CONTROL,
          filterStateClass(active),
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className={cn(
          'pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2',
          active ? 'text-nav-active-foreground' : 'text-muted-foreground',
        )}
        aria-hidden
      />
    </div>
  );
}

/**
 * The date-range control.
 *
 * ── PRESETS FIRST, CUSTOM SECOND ──────────────────────────────────────────
 *
 * "Last 7 days" is what people actually want nine times out of ten, and two
 * date pickers to express it is four interactions instead of one. The custom
 * pair is there for the tenth time.
 *
 * ── BOUNDS ARE ISO, AND GO TO THE SERVER ──────────────────────────────────
 *
 * `toISOString()` (which ends in `Z`) rather than a local-offset string: an
 * unencoded `+05:30` arrives at the API as a space and the filter silently
 * does nothing. These lists are cursor-paginated, so the window MUST be
 * applied server-side — see `lib/api/organizer.ts`.
 */
export type DateRange = { from: string; to: string };

export const DATE_PRESETS: { value: string; label: string; days: number | null }[] = [
  { value: '', label: 'Any time', days: null },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
];

/** `days` back from local midnight, as an instant. */
export function presetRange(days: number): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  return { from: start.toISOString(), to: '' };
}

export function DateRangeFilter({
  preset,
  onPreset,
  custom,
  onCustom,
  label,
}: {
  preset: string;
  onPreset: (value: string) => void;
  custom: DateRange;
  onCustom: (range: DateRange) => void;
  label: string;
}) {
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

  const active = Boolean(preset || custom.from || custom.to);
  const summary = preset
    ? (DATE_PRESETS.find((option) => option.value === preset)?.label ?? 'Custom')
    : custom.from || custom.to
      ? 'Custom range'
      : label;

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(TOOLBAR_CONTROL, filterStateClass(active))}
      >
        {summary}
        <ChevronDown className="size-3.5" aria-hidden />
      </Button>

      {open ? (
        <div className="absolute left-0 top-full z-popover mt-1 w-64 rounded-xl border border-border bg-elevated p-2 shadow-lg animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none">
          <ul>
            {DATE_PRESETS.map((option) => (
              <li key={option.value || 'any'}>
                <button
                  type="button"
                  onClick={() => {
                    onPreset(option.value);
                    onCustom({ from: '', to: '' });
                    setOpen(false);
                  }}
                  className="flex min-h-control-sm w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="inline-flex size-4 shrink-0 items-center justify-center text-primary" aria-hidden>
                    {preset === option.value && !custom.from ? <Check className="size-3.5" /> : null}
                  </span>
                  {option.label}
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
            <span className="px-2 text-caption text-muted-foreground">Custom</span>
            <label className="flex items-center gap-2 px-2 text-caption">
              <span className="w-8 shrink-0 text-muted-foreground">From</span>
              <input
                type="date"
                value={toDateInput(custom.from)}
                onChange={(event) => {
                  onPreset('');
                  onCustom({ ...custom, from: fromDateInput(event.target.value, 'start') });
                }}
                className="h-control-sm min-w-0 flex-1 rounded-full border border-input bg-surface px-3 text-caption text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex items-center gap-2 px-2 text-caption">
              <span className="w-8 shrink-0 text-muted-foreground">To</span>
              <input
                type="date"
                value={toDateInput(custom.to)}
                onChange={(event) => {
                  onPreset('');
                  onCustom({ ...custom, to: fromDateInput(event.target.value, 'end') });
                }}
                className="h-control-sm min-w-0 flex-1 rounded-full border border-input bg-surface px-3 text-caption text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>

          {active ? (
            <button
              type="button"
              onClick={() => {
                onPreset('');
                onCustom({ from: '', to: '' });
                setOpen(false);
              }}
              className="mt-1 flex min-h-control-sm w-full items-center rounded-md px-2 py-1.5 text-left text-caption text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              Clear date filter
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function toDateInput(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 10);
}

/**
 * A `yyyy-mm-dd` from the picker, as an instant.
 *
 * The `end` bound becomes the START of the next day, because the API compares
 * with `<`. Without that, "to 14 March" would exclude everything that happened
 * ON 14 March — the classic off-by-one-day that makes a report quietly wrong.
 */
function fromDateInput(value: string, edge: 'start' | 'end'): string {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, edge === 'end' ? day + 1 : day);
  return date.toISOString();
}

/**
 * The active-filter chips.
 *
 * They exist so that "why am I seeing four rows" is answerable at a glance and
 * dismissible in one click. A filter you cannot see is a filter you forget you
 * set, and then the table looks broken.
 *
 * Butter, not the neutral tint they used to wear: these ARE the applied
 * filters, so they carry the same colour as the applied controls above them
 * and an organizer scanning for "why" finds one colour, not two.
 */
export function FilterChips({
  chips,
  onClearAll,
}: {
  chips: { key: string; label: string; onClear: () => void }[];
  onClearAll?: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-control-sm items-center gap-1 rounded-full bg-nav-active pl-3 pr-1 text-caption font-medium text-nav-active-foreground animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none sm:h-8"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onClear}
            aria-label={`Remove filter: ${chip.label}`}
            className="inline-flex size-7 items-center justify-center rounded-full transition-colors hover:bg-nav-active-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-6"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {chips.length > 1 && onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex h-control-sm items-center rounded-full px-2 text-caption text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}

/**
 * The URL as filter state.
 *
 * `replace` rather than `push`: a filter change is a refinement of the same
 * view, not a new page. Pushing would mean the back button walks backwards
 * through every keystroke of a search instead of leaving the section.
 */
export function useUrlFilters<T extends Record<string, string>>(
  defaults: T,
  searchParams: URLSearchParams,
  replace: (query: string) => void,
) {
  const values = React.useMemo(() => {
    const next = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const found = searchParams.get(String(key));
      if (found !== null) next[key] = found as T[keyof T];
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const set = React.useCallback(
    (patch: Partial<T>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, String(value));
        else next.delete(key);
      }
      replace(next.toString());
    },
    [searchParams, replace],
  );

  const clearAll = React.useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of Object.keys(defaults)) next.delete(key);
    replace(next.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, replace]);

  return { values, set, clearAll };
}
