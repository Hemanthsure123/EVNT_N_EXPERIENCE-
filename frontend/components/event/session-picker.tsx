'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import {
  type Session,
  type SessionDay,
  sessionNote,
} from '@/lib/event/sessions';

/**
 * Pick a showtime, for an event that runs more than once.
 *
 * Two rows: the dates, then the times on the chosen date. That split is not
 * decoration — a four-day run at three shows a day is twelve chips, and twelve
 * times in one wrapped row is a wall a buyer has to parse before they can find
 * their evening. With every session on ONE day the date row is omitted
 * entirely: a single chip reading "Sat, 14 Mar" above times that are all on
 * Saturday is a control that cannot be used for anything.
 *
 * A SOLD-OUT SESSION STAYS ON SCREEN, disabled. Same reasoning as the sold-out
 * ticket tier below it: knowing the 6pm show is gone is what makes the 9pm one
 * make sense, and silently dropping it looks like the event simply has fewer
 * shows than the poster said.
 *
 * THE CHIPS ARE RADIOS, not buttons. One choice out of a set, and exactly one
 * is always made — so a screen reader announces "2 of 5" and the arrow keys
 * move between them, which is what `role="radiogroup"` buys for free and a row
 * of `aria-pressed` buttons does not.
 */

export function SessionPicker({
  days,
  selected,
  onSelect,
  className,
}: {
  days: SessionDay[];
  selected: Session | null;
  onSelect: (session: Session) => void;
  className?: string;
}) {
  const multiDay = days.length > 1;
  const [openDayKey, setOpenDayKey] = React.useState<string | null>(null);

  // The visible day follows the SELECTION rather than being held apart from
  // it: when the default lands on tomorrow's show because today's sold out,
  // the date row must already be showing tomorrow. Local state only overrides
  // it once someone taps a date themselves.
  const activeDayKey = openDayKey ?? selected?.dayKey ?? days[0]?.dayKey ?? null;
  const activeDay = days.find((day) => day.dayKey === activeDayKey) ?? days[0] ?? null;

  if (!days.length || !activeDay) return null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold text-foreground">Select a session</h3>
        {multiDay ? (
          <span className="text-caption text-foreground-subtle">
            {days.length} dates
          </span>
        ) : null}
      </div>

      {multiDay ? (
        <div
          role="radiogroup"
          aria-label="Date"
          // Scrolls rather than wraps: a run of dates is a strip people swipe,
          // and wrapping turns a two-line control into four on a phone.
          className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1"
        >
          {days.map((day) => {
            const active = day.dayKey === activeDay.dayKey;
            const anySellable = day.sessions.some(
              (session) => session.state === 'available' || session.state === 'few_left',
            );
            return (
              <button
                key={day.dayKey}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setOpenDayKey(day.dayKey)}
                className={cn(
                  'inline-flex h-control shrink-0 snap-start items-center rounded-full border px-4',
                  'text-body-sm font-medium transition duration-fast ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  active
                    ? 'border-primary bg-primary-subtle text-primary-subtle-foreground'
                    : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
                  // Not disabled — a day with nothing left is still a day the
                  // event runs, and a buyer looking for it must be able to open
                  // it and see why. Only dimmed.
                  !anySellable && !active && 'opacity-60',
                )}
              >
                {day.dayLabel}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* ── A WRAPPING ROW, NOT A GRID ─────────────────────────────────────
          `grid-cols-2` inside a 22rem panel gives each chip ~150px, so
          "11:31 am" and its label both truncated — the picker rendered
          "11:31 …" over "FIRST DA…", which is two ellipses where the two facts
          that distinguish one showtime from another should be.

          A wrapping flex row lets each chip size to its own content: a time
          never truncates, a long stage name wraps the row instead of being
          cut, and twelve showtimes become more rows rather than narrower
          chips. The panel body scrolls, so more rows cost nothing. */}
      <div role="radiogroup" aria-label="Session" className="flex flex-wrap gap-2">
        {activeDay.sessions.map((session) => (
          <SessionChip
            key={session.slot.id}
            session={session}
            selected={selected?.slot.id === session.slot.id}
            onSelect={() => onSelect(session)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionChip({
  session,
  selected,
  onSelect,
}: {
  session: Session;
  selected: boolean;
  onSelect: () => void;
}) {
  const note = sessionNote(session);
  const disabled = session.state === 'sold_out' || session.state === 'not_on_sale';

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        // A chip sits inside the ticket card, so its radius is one rung below
        // the card's — nesting the same radius twice reads as a mistake.
        'flex min-h-control flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-left',
        'transition duration-fast ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected && !disabled
          ? 'border-primary bg-primary-subtle ring-2 ring-primary/30'
          : 'border-border hover:border-border-strong',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span className="text-body font-semibold tabular-nums text-foreground">
        {session.timeLabel}
      </span>
      {/* The organiser's name for the show, when they gave one — "Main stage"
          is what tells two 8pm sessions apart, and two chips reading the same
          time with nothing between them is the one arrangement a picker must
          not produce. */}
      {session.label ? (
        <span className="text-caption text-muted-foreground">{session.label}</span>
      ) : null}
      {note ? (
        <span
          className={cn(
            'text-caption',
            session.state === 'few_left'
              ? 'text-warning-subtle-foreground'
              : 'text-foreground-subtle',
          )}
        >
          {note}
        </span>
      ) : null}
    </button>
  );
}
