import { describe, expect, it } from 'vitest';

/** Mirrors the two pure helpers in components/organizer/analytics.tsx. */
function inclusiveDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

describe('analytics custom range', () => {
  it('counts BOTH ends, because a picker says "1 to 7 March" and means seven days', () => {
    expect(inclusiveDays('2026-03-01', '2026-03-07')).toBe(7);
    expect(inclusiveDays('2026-03-01', '2026-03-01')).toBe(1);
  });

  it('spans month and year boundaries', () => {
    expect(inclusiveDays('2026-02-27', '2026-03-02')).toBe(4);
    expect(inclusiveDays('2025-12-30', '2026-01-02')).toBe(4);
  });

  it('counts a leap day', () => {
    // 2028 is a leap year: 27, 28, 29 Feb, 1 Mar.
    expect(inclusiveDays('2028-02-27', '2028-03-01')).toBe(4);
  });

  it('is unaffected by daylight saving in the runner’s zone', () => {
    // Parsed as UTC on purpose. A local-time subtraction returns 30.958… days
    // across a DST boundary, which floors to the wrong window length.
    expect(inclusiveDays('2026-03-01', '2026-03-31')).toBe(31);
    expect(inclusiveDays('2026-10-01', '2026-10-31')).toBe(31);
  });
});
