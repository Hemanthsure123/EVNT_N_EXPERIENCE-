'use client';

import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
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

/**
 * How many months the sheet shows at once.
 *
 * Three, because that is the horizon a discovery product is actually browsed
 * over — and because a scroller with one month in it is a popover with extra
 * steps. Not "every month forever": an unbounded list is a list nobody reaches
 * the end of, and the arrows in the desktop popover already handle the rare
 * booking further out.
 */
const MONTHS_IN_SHEET = 3;

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
  // Which surface to open. Read from a media query rather than rendered both
  // ways and CSS-hidden, because a popover and a sheet mounted together are
  // two focus traps. `false` on the server and the first paint; the surface is
  // only opened by a press, which is always after that.
  const [isPhone, setIsPhone] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsPhone(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // Re-sync when the URL changes underneath (Back, a cleared chip elsewhere).
  React.useEffect(() => {
    setSelection({ from, to });
    if (from) setMonth(from);
  }, [from, to]);

  const label = rangeLabel(from, to);

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

  return isPhone ? (
    // ── ON A PHONE IT IS A SHEET, NOT A POPOVER ─────────────────────────
    //
    // A 20rem popover anchored to a chip on a 390px screen is most of the
    // viewport hanging off one control, with a month you have to arrow
    // through one at a time. The sheet gives it the room to show several
    // months at once and scroll between them, which is how you actually pick
    // a date three weeks out.
    //
    // ONE surface is mounted at a time — a popover and a sheet rendered
    // together and CSS-hidden would be two focus traps, and Escape would close
    // whichever the browser reached first.
    <>
      <Trigger label={label} className={className} onClick={() => setOpen(true)} />
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent side="responsive" aria-label="Custom dates" bare>
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex shrink-0 flex-col gap-stack border-b border-border px-5 pb-card pt-card-lg">
              <DrawerTitle>Custom dates</DrawerTitle>
              <DrawerDescription>Select the dates you want to see events for.</DrawerDescription>
            </header>

            {/* The weekday row is stated ONCE and pinned, rather than repeated
                above every month — it is the same seven letters each time, and
                repeating it turns a scroll through three months into a scroll
                through three legends. */}
            <div
              className="grid shrink-0 grid-cols-7 border-b border-border bg-elevated px-5 py-2"
              aria-hidden
            >
              {WEEKDAYS.map((day) => (
                <span key={day} className="text-center text-caption text-muted-foreground">
                  {day.slice(0, 1)}
                </span>
              ))}
            </div>

            <div
              ref={gridRef}
              onKeyDown={onKeyDown}
              className="flex min-h-0 flex-1 flex-col gap-block overflow-y-auto overscroll-contain px-5 py-card"
            >
              {Array.from({ length: MONTHS_IN_SHEET }, (_, offset) => addMonths(month, offset)).map(
                (value) => (
                  <MonthGrid
                    key={value}
                    month={value}
                    today={today}
                    selection={selection}
                    focused={focused}
                    onPick={(iso) => setSelection((current) => nextSelection(current, iso))}
                    onFocus={setFocused}
                    showHeading
                  />
                ),
              )}
            </div>

            <footer
              className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-elevated px-5 pt-card"
              // Safe-area aware: on a phone with a gesture bar the last 34px
              // belong to the system, and Apply underneath it is a picker with
              // no way to commit.
              style={{ paddingBottom: 'calc(var(--space-card) + env(safe-area-inset-bottom))' }}
            >
              <button
                type="button"
                onClick={clear}
                disabled={!selection.from && !from}
                className="rounded-md text-body-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear
              </button>
              <Button onClick={apply} disabled={!selection.from}>
                Apply
              </Button>
            </footer>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  ) : (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger label={label} className={className} />
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

        <div ref={gridRef} onKeyDown={onKeyDown}>
          <MonthGrid
            month={month}
            today={today}
            selection={selection}
            focused={focused}
            onPick={(iso) => setSelection((current) => nextSelection(current, iso))}
            onFocus={setFocused}
          />
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

/** The chip that opens either surface. One control, so the two agree. */
const Trigger = React.forwardRef<
  HTMLButtonElement,
  { label: string | null; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Trigger({ label, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label ? `Dates: ${label}. Change` : 'Pick dates'}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-label shadow-sm transition duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        // Set = the warm cream "this is on" pill, the same vocabulary the
        // toolbar's applied-filter chips use. Unset = a plain white control
        // with a hairline; the surface is opaque now because the page behind
        // it is white rather than a dark hero.
        label
          ? 'border-transparent bg-nav-active text-nav-active-foreground'
          : 'border-border bg-surface text-foreground hover:border-border-strong',
        className,
      )}
      {...props}
    >
      <CalendarDays className="size-4 shrink-0" aria-hidden />
      {/* The chosen dates replace the word, so the control states its own
          value instead of needing a separate chip to report it. */}
      <span>{label ?? 'Pick dates'}</span>
    </button>
  );
});

/**
 * One month.
 *
 * Extracted so the popover can render one and the sheet can render several
 * without a second copy of the cell logic — the in-range tint, the endpoint
 * colours, the past-date guard and the roving tabindex are the fiddly part,
 * and two copies is where a range starts rendering differently in two places.
 */
function MonthGrid({
  month,
  today,
  selection,
  focused,
  onPick,
  onFocus,
  showHeading = false,
}: {
  month: string;
  today: string;
  selection: RangeSelection;
  focused: string;
  onPick: (iso: string) => void;
  onFocus: (iso: string) => void;
  showHeading?: boolean;
}) {
  const cells = React.useMemo(() => monthGrid(month), [month]);

  return (
    <section className="flex flex-col gap-2">
      {showHeading ? (
        <h3 className="text-label text-foreground" aria-hidden>
          {monthLabel(month)}
        </h3>
      ) : null}
      <div role="grid" aria-label={monthLabel(month)} className="grid grid-cols-7 gap-y-1">
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
              // Roving tabindex: ONE stop for the whole picker, across every
              // month it is showing.
              tabIndex={isFocused ? 0 : -1}
              data-focused={isFocused}
              disabled={past}
              aria-selected={isStart || isEnd || between}
              aria-current={cell.iso === today ? 'date' : undefined}
              onClick={() => onPick(cell.iso!)}
              onFocus={() => onFocus(cell.iso!)}
              className={cn(
                'mx-auto flex size-9 items-center justify-center rounded-md text-body-sm tabular-nums transition duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                past && 'cursor-not-allowed text-muted-foreground/40',
                !past && !isStart && !isEnd && !between && 'hover:bg-muted',
                // In-range is the quiet neutral tint; the two ENDPOINTS are the
                // near-black action colour, so the span reads as one object
                // with two grabbable ends rather than three violets.
                between && 'rounded-none bg-secondary text-secondary-foreground',
                (isStart || isEnd) && 'bg-cta text-cta-foreground',
                // Today is marked even when it is not selected, so the grid has
                // a reference point.
                cell.iso === today && !isStart && !isEnd && 'ring-1 ring-inset ring-primary/40',
              )}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </section>
  );
}
