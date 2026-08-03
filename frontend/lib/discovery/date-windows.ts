/**
 * Date windows for the one-tap "when" chips, and the time-of-day greeting.
 *
 * Everything here is computed in a FIXED platform timezone (IST) rather than
 * the runtime's local zone. That is deliberate: these values are rendered both
 * on the server (ISR'd home rows) and in the browser (filter chips), and a
 * server in UTC disagreeing with a browser in IST would produce a hydration
 * mismatch and a "This weekend" row that means two different things. The
 * platform prices in ₹ and sends DLT-templated SMS — IST is the right anchor.
 */

/** IST is UTC+5:30 year-round (no DST), so a fixed offset is exact. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DateWindowId = 'today' | 'weekend' | 'week' | 'month';

export type DateWindow = {
  /** ISO instant, inclusive lower bound (`starts_after`). */
  from: string;
  /** ISO instant, inclusive upper bound (`starts_before`). */
  to: string;
};

/** Midnight (IST) at the start of the IST day containing `at`, as a UTC instant. */
export function istStartOfDay(at: Date): Date {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  const midnightShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(midnightShifted - IST_OFFSET_MS);
}

/** Hour of day, 0–23, in IST. */
export function istHour(at: Date): number {
  return new Date(at.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** 0 = Sunday … 6 = Saturday, in IST. */
export function istDayOfWeek(at: Date): number {
  return new Date(at.getTime() + IST_OFFSET_MS).getUTCDay();
}

const endOfDay = (start: Date) => new Date(start.getTime() + DAY_MS - 1);

/**
 * Resolve a window id to the `starts_after` / `starts_before` pair the backend
 * understands. The lower bound is never in the past — the backend already
 * floors the list at `now`, and asking for the past would just be discarded.
 */
export function dateWindow(id: DateWindowId, now: Date = new Date()): DateWindow {
  const todayStart = istStartOfDay(now);
  const clampFrom = (candidate: Date) => (candidate > now ? candidate : now);

  switch (id) {
    case 'today':
      return { from: now.toISOString(), to: endOfDay(todayStart).toISOString() };

    case 'weekend': {
      // Saturday 00:00 IST -> Sunday 23:59 IST. During a weekend, "this
      // weekend" means the one you're standing in, not the next one.
      const dow = istDayOfWeek(now);
      const daysUntilSaturday = dow === 0 ? -1 : 6 - dow;
      const saturday = new Date(todayStart.getTime() + daysUntilSaturday * DAY_MS);
      const sunday = new Date(saturday.getTime() + DAY_MS);
      return { from: clampFrom(saturday).toISOString(), to: endOfDay(sunday).toISOString() };
    }

    case 'week':
      return {
        from: now.toISOString(),
        to: endOfDay(new Date(todayStart.getTime() + 6 * DAY_MS)).toISOString(),
      };

    case 'month':
      return {
        from: now.toISOString(),
        to: endOfDay(new Date(todayStart.getTime() + 29 * DAY_MS)).toISOString(),
      };
  }
}

/** Time-of-day greeting in IST — safe to render on the server. */
export function greetingFor(now: Date = new Date()): string {
  const hour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
