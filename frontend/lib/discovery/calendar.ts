/**
 * Calendar arithmetic for the date picker, in IST.
 *
 * Pure and separate from the component for the same reason the search
 * panel's placement is: the failure cases here are dates, and dates are where
 * off-by-ones live — the first of a month landing on the wrong weekday, a
 * range that silently excludes its own end, "today" being yesterday because
 * the browser is in another timezone.
 *
 * Everything is `YYYY-MM-DD` in IST. The events are in India and the day a
 * user taps is the day they mean locally, so the browser's own timezone is
 * deliberately never consulted.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today in IST, as `YYYY-MM-DD`. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const target = new Date(date);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  // Clamp: 31 January + 1 month is 28/29 February, not 3 March.
  const lastDay = daysInMonth(target.toISOString().slice(0, 10));
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysInMonth(iso: string): number {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

export type CalendarCell = {
  /** `YYYY-MM-DD`, or null for a leading/trailing blank. */
  iso: string | null;
  day: number | null;
};

/**
 * Six weeks of cells for the month containing `iso`, Monday-first.
 *
 * Always 42 cells, so the grid does not change height between months — a
 * calendar that grows a row in March and shrinks in April makes the button
 * beneath it jump.
 */
export function monthGrid(iso: string): CalendarCell[] {
  const first = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  // getUTCDay is 0 = Sunday; shift so Monday is 0.
  const leading = (first.getUTCDay() + 6) % 7;
  const total = daysInMonth(iso);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < leading; i += 1) cells.push({ iso: null, day: null });
  for (let day = 1; day <= total; day += 1) {
    cells.push({ iso: `${iso.slice(0, 7)}-${String(day).padStart(2, '0')}`, day });
  }
  while (cells.length < 42) cells.push({ iso: null, day: null });
  return cells;
}

export function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** How a chosen range reads on the trigger. */
export function rangeLabel(from: string | null, to: string | null): string | null {
  if (!from) return null;
  if (!to || to === from) return formatDay(from);
  return `${formatDay(from)} – ${formatDay(to)}`;
}

export type RangeSelection = { from: string | null; to: string | null };

/**
 * What a tap on `day` does to the current selection.
 *
 * The rule people expect from every booking site: the first tap starts a new
 * range, the second completes it, and a third starts over. Tapping BEFORE the
 * start restarts rather than producing a backwards range — the alternative
 * (silently swapping) makes the highlight jump somewhere the user did not
 * touch.
 */
export function nextSelection(current: RangeSelection, day: string): RangeSelection {
  const choosingStart = !current.from || (current.from && current.to) || day < current.from;
  if (choosingStart) return { from: day, to: null };
  return { from: current.from, to: day };
}

export function isInRange(day: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return false;
  return day > from && day < to;
}
