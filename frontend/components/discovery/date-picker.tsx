'use client';

import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  addDays,
  addMonths,
  isInRange,
  istToday,
  monthGrid,
  monthLabel,
  nextSelection,
  rangeLabel,
  type RangeSelection,
} from '@/lib/discovery/calendar';
import { cn } from '@/lib/utils/cn';

/**
 * Pick a day, or a span of them.
 *
 * Sits beside the quick windows (Today, This weekend) rather than replacing
 * them: those answer the overwhelmingly common question in one tap, and a
 * calendar is what you reach for when the answer is "the weekend of the 14th"
 * — a question the quick chips cannot express at all.
 *
 * ── THE GRID IS ONE TAB STOP ─────────────────────────────────────────────
 *
 * Forty-two focusable buttons would mean forty-two presses of Tab to get past
 * a calendar. This uses roving tabindex — the grid is one stop, and arrows
 * move within it — which is what the WAI-ARIA grid pattern prescribes and
 * what every native date input does.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DatePicker({
  from,
  to,
  onApply,
  className,
}: {
  from: string | null;
  to: string | null;
  onApply: (selection: RangeSelection) => void;
  className?: string;
}) {
  const today = React.useMemo(() => istToday(), []);
  const [open, setOpen] = React.useState(false);
  const [selection, setSelection] = React.useState<RangeSelection>({ from, to });
  const [month, setMonth] = React.useState(from ?? today);
  const [focused, setFocused] = React.useState(from ?? today);
  const gridRef = React.useRef<HTMLDivElement>(null);

  // Re-sync when the URL changes underneath (Back, a cleared chip elsewhere).
  React.useEffect(() => {
    setSelection({ from, to });
    if (from) setMonth(from);
  }, [from, to]);

  const label = rangeLabel(from, to);
  const cells = React.useMemo(() => monthGrid(month), [month]);

  const move = (days: number) => {
    const target = addDays(focused, days);
    setFocused(target);
    if (target.slice(0, 7) !== month.slice(0, 7)) setMonth(target);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (event.key in step) {
      event.preventDefault();
      move(step[event.key]);
      return;
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const target = addMonths(focused, event.key === 'PageUp' ? -1 : 1);
      setFocused(target);
      setMonth(target);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (focused >= today) setSelection((current) => nextSelection(current, focused));
    }
  };

  // Focus follows the roving index while the grid has focus, so arrow keys
  // actually move the caret rather than only recolouring a cell.
  React.useEffect(() => {
    if (!open) return;
    const active = gridRef.current?.querySelector<HTMLButtonElement>('[data-focused="true"]');
    if (active && gridRef.current?.contains(document.activeElement)) active.focus();
  }, [focused, open, month]);

  const apply = () => {
    onApply(selection);
    setOpen(false);
  };

  const clear = () => {
    setSelection({ from: null, to: null });
    onApply({ from: null, to: null });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ? `Dates: ${label}. Change` : 'Pick dates'}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-label shadow-sm transition duration-fast',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            // Set = the warm cream "this is on" pill, the same vocabulary the
            // toolbar's applied-filter chips use. Unset = a plain white
            // control with a hairline; the surface is opaque now because the
            // page behind it is white rather than a dark hero.
            label
              ? 'border-transparent bg-nav-active text-nav-active-foreground'
              : 'border-border bg-surface text-foreground hover:border-border-strong',
            className,
          )}
        >
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          {/* The chosen dates replace the word, so the control states its own
              value instead of needing a separate chip to report it. */}
          <span>{label ?? 'Pick dates'}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-card" align="start">
        <div className="flex items-center justify-between pb-stack">
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, -1))}
            // A month entirely in the past has nothing bookable in it.
            disabled={month.slice(0, 7) <= today.slice(0, 7)}
            aria-label="Previous month"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          {/* `aria-live` so arrowing into another month is announced. */}
          <span aria-live="polite" className="text-label">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Next month"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-7 pb-1" aria-hidden>
          {WEEKDAYS.map((day) => (
            <span key={day} className="text-center text-caption text-muted-foreground">
              {day.slice(0, 1)}
            </span>
          ))}
        </div>

        <div
          ref={gridRef}
          role="grid"
          aria-label={monthLabel(month)}
          onKeyDown={onKeyDown}
          className="grid grid-cols-7 gap-y-1"
        >
          {cells.map((cell, index) => {
            if (!cell.iso) return <span key={`blank-${index}`} aria-hidden />;
            const past = cell.iso < today;
            const isStart = cell.iso === selection.from;
            const isEnd = cell.iso === selection.to;
            const between = isInRange(cell.iso, selection.from, selection.to);
            const isFocused = cell.iso === focused;

            return (
              <button
                key={cell.iso}
                type="button"
                role="gridcell"
                // Roving tabindex: ONE stop for the whole grid.
                tabIndex={isFocused ? 0 : -1}
                data-focused={isFocused}
                disabled={past}
                aria-selected={isStart || isEnd || between}
                aria-current={cell.iso === today ? 'date' : undefined}
                onClick={() => setSelection((current) => nextSelection(current, cell.iso!))}
                onFocus={() => setFocused(cell.iso!)}
                className={cn(
                  'mx-auto flex size-9 items-center justify-center rounded-md text-body-sm tabular-nums transition duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                  past && 'cursor-not-allowed text-muted-foreground/40',
                  !past && !isStart && !isEnd && !between && 'hover:bg-muted',
                  // In-range is the quiet neutral tint; the two ENDPOINTS are
                  // the near-black action colour, so the span reads as one
                  // object with two grabbable ends rather than three violets.
                  between && 'rounded-none bg-secondary text-secondary-foreground',
                  (isStart || isEnd) && 'bg-cta text-cta-foreground',
                  // Today is marked even when it is not selected, so the grid
                  // has a reference point.
                  cell.iso === today && !isStart && !isEnd && 'ring-1 ring-inset ring-primary/40',
                )}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-block">
          <button
            type="button"
            onClick={clear}
            disabled={!selection.from && !from}
            className="rounded-md text-body-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear
          </button>
          <Button size="sm" onClick={apply} disabled={!selection.from}>
            {/* Names what will happen, rather than "OK". */}
            {selection.from && !selection.to ? 'Show this day' : 'Show these dates'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
