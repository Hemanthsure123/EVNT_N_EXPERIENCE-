import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  isInRange,
  istToday,
  monthGrid,
  nextSelection,
  rangeLabel,
} from './calendar';

/**
 * Date arithmetic is where off-by-ones live. Each case here is one that
 * produces a plausible-looking calendar that is quietly wrong — a month
 * starting on the wrong weekday, "today" being yesterday, a range that
 * excludes its own end.
 */

describe('istToday', () => {
  it('is still today late in the UTC evening', () => {
    // 20:00 UTC is 01:30 IST the NEXT day. A browser-timezone calculation
    // would highlight the wrong "today" for every Indian user every evening.
    expect(istToday(new Date('2026-03-10T20:00:00Z'))).toBe('2026-03-11');
  });

  it('is the same day mid-afternoon UTC', () => {
    expect(istToday(new Date('2026-03-10T09:00:00Z'))).toBe('2026-03-10');
  });
});

describe('monthGrid', () => {
  it('always returns six weeks so the grid never changes height', () => {
    // Otherwise the button beneath the calendar jumps between months.
    expect(monthGrid('2026-02-01')).toHaveLength(42);
    expect(monthGrid('2026-08-15')).toHaveLength(42);
  });

  it('is Monday-first', () => {
    // 1 March 2026 is a Sunday, so it sits in the SEVENTH column.
    const cells = monthGrid('2026-03-01');
    expect(cells.slice(0, 6).every((cell) => cell.iso === null)).toBe(true);
    expect(cells[6].iso).toBe('2026-03-01');
  });

  it('covers every day of the month exactly once', () => {
    const days = monthGrid('2026-02-10')
      .map((cell) => cell.iso)
      .filter(Boolean);
    expect(days).toHaveLength(28); // 2026 is not a leap year
    expect(new Set(days).size).toBe(28);
  });

  it('handles a leap February', () => {
    expect(monthGrid('2028-02-01').filter((cell) => cell.iso).length).toBe(29);
  });
});

describe('addMonths', () => {
  it('clamps rather than overflowing into the next month', () => {
    // 31 January + 1 month is February, not 3 March.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('steps backwards across a year boundary', () => {
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
  });

  it('steps backwards across a year boundary', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('nextSelection', () => {
  it('starts a range on the first tap', () => {
    expect(nextSelection({ from: null, to: null }, '2026-04-10')).toEqual({
      from: '2026-04-10',
      to: null,
    });
  });

  it('completes the range on the second', () => {
    expect(nextSelection({ from: '2026-04-10', to: null }, '2026-04-14')).toEqual({
      from: '2026-04-10',
      to: '2026-04-14',
    });
  });

  it('starts over on the third', () => {
    expect(nextSelection({ from: '2026-04-10', to: '2026-04-14' }, '2026-05-01')).toEqual({
      from: '2026-05-01',
      to: null,
    });
  });

  it('restarts rather than building a backwards range', () => {
    // Silently swapping would move the highlight somewhere the user did not
    // touch.
    expect(nextSelection({ from: '2026-04-10', to: null }, '2026-04-02')).toEqual({
      from: '2026-04-02',
      to: null,
    });
  });
});

describe('isInRange', () => {
  it('covers the days strictly between the ends', () => {
    expect(isInRange('2026-04-12', '2026-04-10', '2026-04-14')).toBe(true);
    // The ends themselves are drawn as endpoints, not as "in between".
    expect(isInRange('2026-04-10', '2026-04-10', '2026-04-14')).toBe(false);
  });

  it('is false while a range is half-chosen', () => {
    expect(isInRange('2026-04-12', '2026-04-10', null)).toBe(false);
  });
});

describe('rangeLabel', () => {
  it('reads as one day when both ends match', () => {
    expect(rangeLabel('2026-04-10', '2026-04-10')).toBe('10 Apr');
  });

  it('reads as a span otherwise', () => {
    expect(rangeLabel('2026-04-10', '2026-04-14')).toBe('10 Apr – 14 Apr');
  });

  it('is absent when nothing is chosen', () => {
    expect(rangeLabel(null, null)).toBeNull();
  });
});
