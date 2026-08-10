'use client';

import * as React from 'react';
import {
  DATE_PRESETS,
  DateRangeFilter,
  presetRange,
  type DateRange,
} from '@/components/organizer/filters';

/**
 * The date window every console list shares.
 *
 * ── WHY THIS IS A HOOK AND NOT FOUR COPIES ────────────────────────────────
 *
 * Five surfaces ask the same question of different tables — bookings,
 * payments, refunds, users, events. A window that means "last 30 days" on one
 * screen and "last 30 days ending yesterday" on the next is the kind of drift
 * an operator only discovers by reconciling two numbers that should have
 * matched, so the arithmetic lives once.
 *
 * ── THE WINDOW IS SENT AS AN INSTANT, NOT A DATE ──────────────────────────
 *
 * `toISOString()`, with its `Z`. An unencoded `+05:30` arrives at the server
 * as a space and is repaired there, but only because that slip is so common —
 * this side does not rely on the repair.
 *
 * ── IT REUSES THE ORGANIZER'S CONTROL DELIBERATELY ────────────────────────
 *
 * `components/organizer/filters.tsx` already owns the presets, the popover and
 * the applied-state pill. A second date picker with its own idea of "Last 7
 * days" would be a second thing to keep correct, and the console is the screen
 * where a wrong window is most expensive.
 */

export type ConsoleWindow = {
  /** ISO instant, or undefined for an open end. Ready to spread into a fetch. */
  created_after?: string;
  created_before?: string;
};

export function useConsoleDateWindow() {
  const [preset, setPreset] = React.useState('');
  const [custom, setCustom] = React.useState<DateRange>({ from: '', to: '' });

  const range: DateRange = React.useMemo(
    () => (preset ? presetRange(Number(preset)) : custom),
    [preset, custom],
  );

  const clear = React.useCallback(() => {
    setPreset('');
    // BOTH ends. It is one filter with two fields, and dropping only `from`
    // leaves a dangling `to` the picker cannot represent — the same rule the
    // public browse page's date range follows.
    setCustom({ from: '', to: '' });
  }, []);

  const label = preset
    ? (DATE_PRESETS.find((option) => option.value === preset)?.label ?? 'Custom dates')
    : custom.from || custom.to
      ? 'Custom dates'
      : null;

  return {
    /** Spread straight into a console fetcher. */
    window: {
      created_after: range.from || undefined,
      created_before: range.to || undefined,
    } as ConsoleWindow,
    /** Stable across renders, so it is safe in a react-query key. */
    key: `${range.from}|${range.to}`,
    label,
    clear,
    control: (
      <DateRangeFilter
        preset={preset}
        onPreset={setPreset}
        custom={custom}
        onCustom={setCustom}
        label="Any time"
      />
    ),
  };
}

/**
 * The same window, but reported to the caller as `starts_after`/`starts_before`.
 *
 * The All-events queue filters on when an event RUNS, not when its draft was
 * typed: an operator narrowing that list is asking "what is on this weekend".
 * Every other console list filters on creation, which is why the two names
 * exist rather than one generic pair.
 */
export function useConsoleEventDateWindow() {
  const base = useConsoleDateWindow();
  return {
    ...base,
    window: {
      starts_after: base.window.created_after,
      starts_before: base.window.created_before,
    },
  };
}
