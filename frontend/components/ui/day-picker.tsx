'use client';

import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addDays, addMonths, formatDay, istToday, monthGrid } from '@/lib/discovery/calendar';
import { cn } from '@/lib/utils/cn';

/**
 * One day, picked from a calendar.
 *
 * ── WHY THIS AND NOT `<input type="date">` ────────────────────────────────
 *
 * The native control renders whatever the browser feels like. On Chrome
 * desktop that is a month grid with a YEAR LIST beneath it, which is what a
 * date of birth got: to reach 2003 somebody scrolled a column of years inside
 * a popup the size of a postage stamp. It also cannot be styled, so it is the
 * one control on these forms that does not look like the product around it.
 *
 * ── WHY NOT REUSE `discovery/date-picker` ─────────────────────────────────
 *
 * That one picks a RANGE — two dates, with a hover preview between them — and
 * is the browse filter. A birthday is one day, and a range picker asked for
 * one day is a control with a second half nobody can use.
 *
 * They share the arithmetic (`lib/discovery/calendar`), which is where the
 * month boundaries, leap years and IST edges are already tested. The two
 * components are the two shapes; the maths is not duplicated.
 *
 * ── THE YEAR IS A SELECT, AND THAT IS THE WHOLE POINT FOR A BIRTHDAY ──────
 *
 * Twenty-two years is 264 presses of a month arrow. The year dropdown is what
 * makes this usable for a date of birth, and it is why `yearRange` is a prop
 * rather than a constant: an event date wants this year and the next two, a
 * birthday wants the last hundred, and a picker that offers the wrong century
 * is as bad as one that offers none.
 *
 * ── THE GRID IS ONE TAB STOP ──────────────────────────────────────────────
 *
 * Roving tabindex, as the WAI-ARIA grid pattern prescribes: forty-two
 * focusable buttons would be forty-two presses of Tab to get past a calendar.
 * Arrows move within it, and the same key handling as the range picker beside
 * it — one calendar behaviour to learn, not two.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DayPicker({
  value,
  onChange,
  /** Inclusive ISO bounds. A birthday cannot be tomorrow; an event cannot be
   *  yesterday, and the calendar should say so by greying rather than by
   *  rejecting the choice after the fact. */
  min,
  max,
  /** Which years the dropdown offers. Defaults to the ten around today. */
  yearRange,
  placeholder = 'Pick a date',
  id,
  className,
}: {
  value: string | null;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
  yearRange?: { from: number; to: number };
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  const today = istToday();
  const [open, setOpen] = React.useState(false);
  // Which month the grid is showing. Opens on the chosen date when there is
  // one — a picker that opens on today while holding a 2003 birthday makes
  // somebody navigate back to what they already chose.
  const [cursor, setCursor] = React.useState(value || max || today);
  const [focused, setFocused] = React.useState(value || max || today);

  React.useEffect(() => {
    if (open) {
      const start = value || max || today;
      setCursor(start);
      setFocused(start);
    }
  }, [open, value, max, today]);

  const cells = monthGrid(cursor);
  const years = React.useMemo(() => {
    const current = Number(today.slice(0, 4));
    const from = yearRange?.from ?? current - 5;
    const to = yearRange?.to ?? current + 5;
    // Descending: a birthday picker opens near the present and the useful
    // years are the recent ones, so they are the ones you do not scroll for.
    return Array.from({ length: to - from + 1 }, (_, index) => to - index);
  }, [today, yearRange]);

  const blocked = (day: string) => Boolean((min && day < min) || (max && day > max));

  const move = (days: number) => {
    const next = addDays(focused, days);
    setFocused(next);
    if (next.slice(0, 7) !== cursor.slice(0, 7)) setCursor(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (event.key in keys) {
      event.preventDefault();
      move(keys[event.key]);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!blocked(focused)) {
        onChange(focused);
        setOpen(false);
      }
    }
  };

  const setYear = (year: number) => {
    const next = `${year}${cursor.slice(4)}`;
    setCursor(next);
    setFocused(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={cn(
            'flex h-12 w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-4 text-left text-body-sm',
            'transition-colors duration-fast hover:border-border-strong',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
            {value ? formatDay(value) : placeholder}
          </span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[19rem] p-card" align="start">
        <div className="flex items-center justify-between gap-2 pb-3">
          <NavButton
            label="Previous month"
            onClick={() => {
              const next = addMonths(cursor, -1);
              setCursor(next);
              setFocused(next);
            }}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </NavButton>

          <div className="flex items-center gap-1.5">
            <span className="text-body-sm font-semibold text-foreground">
              {new Date(`${cursor}T00:00:00`).toLocaleDateString('en-IN', { month: 'long' })}
            </span>
            {/* A native select: it is one element, it is keyboard- and
                screen-reader-native everywhere, and a hundred custom options
                is a listbox nobody needed to write. */}
            <label className="sr-only" htmlFor={`${id ?? 'day'}-year`}>
              Year
            </label>
            <select
              id={`${id ?? 'day'}-year`}
              value={Number(cursor.slice(0, 4))}
              onChange={(event) => setYear(Number(event.target.value))}
              className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-body-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <NavButton
            label="Next month"
            onClick={() => {
              const next = addMonths(cursor, 1);
              setCursor(next);
              setFocused(next);
            }}
          >
            <ChevronRight className="size-4" aria-hidden />
          </NavButton>
        </div>

        <div className="grid grid-cols-7 pb-1" aria-hidden>
          {WEEKDAYS.map((day) => (
            <span key={day} className="text-center text-caption text-foreground-subtle">
              {day.slice(0, 1)}
            </span>
          ))}
        </div>

        <div
          role="grid"
          aria-label="Choose a date"
          className="grid grid-cols-7 gap-0.5"
          onKeyDown={onKeyDown}
        >
          {cells.map((cell, position) => {
            // `iso` is null for the leading/trailing blanks that keep every
            // month six rows tall. They are spacers, not cells: rendering a
            // disabled button would put 11 unreachable gridcells in the
            // accessibility tree for no gain.
            if (!cell.iso) return <span key={`blank-${position}`} aria-hidden />;
            const iso = cell.iso;
            const isValue = value === iso;
            const isFocused = focused === iso;
            const disabled = blocked(iso);
            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                aria-selected={isValue}
                aria-disabled={disabled || undefined}
                // Roving: exactly one cell is in the tab order.
                tabIndex={isFocused ? 0 : -1}
                ref={(node) => {
                  if (isFocused && open) node?.focus({ preventScroll: true });
                }}
                onClick={() => {
                  if (disabled) return;
                  onChange(iso);
                  setOpen(false);
                }}
                className={cn(
                  'flex h-9 items-center justify-center rounded-md text-body-sm tabular-nums transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  disabled && 'cursor-not-allowed text-foreground-subtle/40',
                  isValue
                    ? 'bg-cta font-semibold text-cta-foreground'
                    : !disabled && 'hover:bg-muted',
                  iso === today && !isValue && 'font-semibold text-primary',
                )}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
