'use client';

import * as React from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { LIFECYCLE_FILTERS, STATUS_FILTERS } from '@/lib/organizer/event-status';
import { cn } from '@/lib/utils/cn';
import { TOOLBAR_CONTROL } from './data-table';
import { DATE_PRESETS, SearchField, fromDateInput, toDateInput } from './filters';

/**
 * MY EVENTS — the one filter row, and the sheet behind "Filters".
 *
 * ── ONE ROW THAT SCROLLS, NOT A TOOLBAR THAT WRAPS ───────────────────────
 *
 * `[search] [Filters] [All] [Live] [Past] [Drafts]`, as one horizontally
 * scrolling glass rail. It used to be a wrapping toolbar plus a second sticky
 * rail of lifecycle pills under it: on a phone that was three ragged lines of
 * controls before the first event, and two sticky bars eating the top of the
 * screen. The scrollbar is hidden, and the row is `touch-manipulation` rather
 * than `touch-pan-x` — `pan-x` would stop a thumb that lands on it from
 * scrolling the PAGE, which is the bug the codebase documents for every rail.
 *
 * ── "FILTERS" OPENS A SHEET, LIKE THE ATTENDEE'S ONE DOES ────────────────
 *
 * Status, city and event date used to expand INLINE on a phone, shoving the
 * deck down the screen. They are a bottom sheet now — the same `Drawer`
 * primitive, the same `side="responsive"` (a bottom sheet on a phone, a side
 * panel from `lg`), the same pinned header, and the same Clear-all / Apply
 * footer as `components/discovery/filter-drawer.tsx`. One paradigm for "narrow
 * this list" across both products.
 *
 * DRAFT-THEN-APPLY, for the same reason the attendee drawer gives: the sheet
 * covers the list, so live-applying would refetch results nobody can see, and
 * a draft is what makes Clear all mean "undo this whole session of narrowing".
 * Search is NOT in the sheet — it lives on the row — and survives Clear all,
 * because silently dropping a query you cannot see from here is a trap.
 *
 * ── THE FILTERS COUNT DOES NOT DOUBLE-REPORT ─────────────────────────────
 *
 * The badge counts what is inside the sheet and NOT already visible on the
 * row: a city, a date, and a status only when it is one the lifecycle pills
 * cannot show (Cancelled, say). "Live" is already the lit pill; counting it on
 * Filters as well would say two filters are applied when one is.
 */

export type EventFilterValues = {
  q: string;
  status: string;
  city: string;
  preset: string;
  from: string;
  to: string;
};

type SheetValues = Omit<EventFilterValues, 'q'>;

const LIFECYCLE = new Set<string>(LIFECYCLE_FILTERS.map((option) => option.value));

/** What the Filters badge counts — see the note above. */
export function sheetFilterCount(values: SheetValues): number {
  let count = 0;
  if (values.status && !LIFECYCLE.has(values.status)) count += 1;
  if (values.city) count += 1;
  if (values.preset || values.from || values.to) count += 1;
  return count;
}

export function EventsFilterBar({
  values,
  onChange,
  cityOptions,
  trailing,
}: {
  values: EventFilterValues;
  onChange: (patch: Partial<EventFilterValues>) => void;
  cityOptions: string[];
  /** Desktop-only controls that ride at the end of the row. */
  trailing?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const count = sheetFilterCount(values);

  return (
    <>
      <div
        className={cn(
          // The REAL glass: this is chrome the deck scrolls under. `z-[999]`
          // is one below the shell header's `z-sticky`, so it pins beneath the
          // header instead of sliding over its edge; `top-14` is that header.
          'glass sticky top-14 z-[999] border-b lg:rounded-t-xl',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 overflow-x-auto px-card py-2.5 touch-manipulation',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          <SearchField
            value={values.q}
            onChange={(q) => onChange({ q })}
            placeholder="Search title or venue"
            label="Search your events"
            className="w-56 flex-none sm:w-64 sm:max-w-none"
          />

          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label={count ? `Filters, ${count} applied` : 'Filters'}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 text-label',
              'transition-colors duration-fast motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              TOOLBAR_CONTROL,
              count
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-surface text-foreground hover:bg-muted',
            )}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filters
            {count ? (
              <span
                aria-hidden
                className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-caption tabular-nums text-primary-foreground"
              >
                {count}
              </span>
            ) : null}
          </button>

          {LIFECYCLE_FILTERS.map((option) => (
            <Chip
              key={option.value || 'all'}
              selected={values.status === option.value}
              onClick={() => onChange({ status: option.value })}
              className={cn('shrink-0', TOOLBAR_CONTROL)}
            >
              {option.label}
            </Chip>
          ))}

          {trailing ? (
            <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">{trailing}</div>
          ) : null}
        </div>
      </div>

      <EventFiltersSheet
        open={open}
        onOpenChange={setOpen}
        values={values}
        onApply={onChange}
        cityOptions={cityOptions}
      />
    </>
  );
}

function pick(values: EventFilterValues): SheetValues {
  return {
    status: values.status,
    city: values.city,
    preset: values.preset,
    from: values.from,
    to: values.to,
  };
}

const EMPTY: SheetValues = { status: '', city: '', preset: '', from: '', to: '' };

export function EventFiltersSheet({
  open,
  onOpenChange,
  values,
  onApply,
  cityOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  values: EventFilterValues;
  onApply: (next: SheetValues) => void;
  cityOptions: string[];
}) {
  const applied = React.useMemo(() => pick(values), [values]);
  const [draft, setDraft] = React.useState<SheetValues>(applied);
  const cityListId = React.useId();

  // Re-seeded on every open: a pill pressed on the row while the sheet was
  // shut must be reflected, and a discarded draft must not come back.
  React.useEffect(() => {
    if (open) setDraft(applied);
  }, [open, applied]);

  const changed = JSON.stringify(draft) !== JSON.stringify(applied);
  const count =
    (draft.status ? 1 : 0) + (draft.city ? 1 : 0) + (draft.preset || draft.from || draft.to ? 1 : 0);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="responsive" bare aria-describedby={undefined}>
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 flex-col gap-stack border-b border-border px-6 pb-card pt-card-lg">
            <DrawerTitle>Filter events</DrawerTitle>
            <DrawerDescription>
              {count ? `${count} applied` : 'Narrow the list to the events you need'}
            </DrawerDescription>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-block overflow-y-auto overscroll-contain px-6 py-card">
            <Group title="Status">
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((option) => (
                  <Chip
                    key={option.value || 'any'}
                    selected={draft.status === option.value}
                    onClick={() => setDraft((current) => ({ ...current, status: option.value }))}
                  >
                    {option.value ? option.label : 'Any status'}
                  </Chip>
                ))}
              </div>
            </Group>

            <Group title="City">
              {/* A SUGGESTION list, never a constraint — the options are the
                  cities on the rows loaded so far, which is a real subset and
                  not a complete index. */}
              <label htmlFor={`${cityListId}-input`} className="sr-only">
                City
              </label>
              <input
                id={`${cityListId}-input`}
                list={cityOptions.length ? cityListId : undefined}
                value={draft.city}
                onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))}
                placeholder="Any city"
                className={cn(
                  'h-control w-full rounded-full border border-input bg-surface px-4 text-body-sm text-foreground outline-none',
                  'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring',
                )}
              />
              {cityOptions.length ? (
                <datalist id={cityListId}>
                  {cityOptions.map((city) => (
                    <option key={city} value={city} />
                  ))}
                </datalist>
              ) : null}
            </Group>

            <Group title="Event date">
              <div className="flex flex-wrap gap-2">
                {DATE_PRESETS.map((option) => (
                  <Chip
                    key={option.value || 'any'}
                    selected={
                      option.value
                        ? draft.preset === option.value
                        : !draft.preset && !draft.from && !draft.to
                    }
                    onClick={() =>
                      setDraft((current) => ({ ...current, preset: option.value, from: '', to: '' }))
                    }
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>

              {/* A custom range CLEARS the preset, and a preset clears the
                  range: they are one filter with two ways in, and both set at
                  once would leave the list answering a question nobody asked. */}
              <div className="mt-stack grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-caption text-muted-foreground">From</span>
                  <input
                    type="date"
                    value={toDateInput(draft.from)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        preset: '',
                        from: fromDateInput(event.target.value, 'start'),
                      }))
                    }
                    className="h-control rounded-xl border border-input bg-surface px-3 text-body-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-caption text-muted-foreground">To</span>
                  <input
                    type="date"
                    value={toDateInput(draft.to)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        preset: '',
                        to: fromDateInput(event.target.value, 'end'),
                      }))
                    }
                    className="h-control rounded-xl border border-input bg-surface px-3 text-body-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              </div>
            </Group>
          </div>

          <footer
            className="flex shrink-0 items-center gap-3 border-t border-border bg-elevated px-6 pt-card"
            // Safe-area aware: on a phone with a gesture bar the last 34px of
            // the viewport belongs to the system, and Apply sitting under it is
            // a sheet with no way to commit.
            style={{ paddingBottom: 'calc(var(--space-card) + env(safe-area-inset-bottom))' }}
          >
            <Button
              variant="ghost"
              className="h-control"
              onClick={() => setDraft(EMPTY)}
              disabled={!count}
            >
              <RotateCcw className="size-4" aria-hidden />
              Clear all
            </Button>
            {/* NO second Close button — `DrawerContent` already draws the one
                X, and two ways to dismiss one surface is a duplicate control. */}
            <Button
              className="ml-auto h-control"
              onClick={() => {
                onApply(draft);
                onOpenChange(false);
              }}
              disabled={!changed}
            >
              Apply
            </Button>
          </footer>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-stack">
      <h3 id={id} className="text-body-sm font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
