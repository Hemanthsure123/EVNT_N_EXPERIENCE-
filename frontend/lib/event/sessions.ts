/**
 * Sessions — the arithmetic behind the showtime picker.
 *
 * An event that runs more than once ("a comedy night at 18:00 and 21:00") has
 * one `EventSlot` per show, and every ticket tier belongs to one of them. This
 * module turns those two lists into what the picker renders: dates, times, and
 * whether each is still buyable.
 *
 * It is a PURE module, separate from the component, for the same reason the
 * search panel's placement arithmetic is: its failure cases are date
 * boundaries, timezone edges and empty sets, none of which are visible by
 * looking at a picker that renders. Everything is IST — the events are in
 * India and the day someone taps is the day they mean locally, so the
 * browser's own timezone is deliberately never consulted (a device in London
 * would otherwise group a 00:30 Sunday show under Saturday).
 *
 * ── THE RULE FOR A TIER WITH NO SESSION ───────────────────────────────────
 *
 * It appears under EVERY session, and that is not a fallback — it is what the
 * gate does. `checkin`'s scan window falls back to the EVENT's span when a
 * ticket's tier has no slot, so such a ticket genuinely admits to any show.
 * Showing it under one session, or hiding it, would put the picker and the
 * door in disagreement about the same ticket.
 */

import type { EventSlot } from '@/lib/api/event-content';
import type { TicketTier } from '@/lib/api/types';

const TIME_ZONE = 'Asia/Kolkata';
const LOCALE = 'en-IN';

/** "2026-03-14" in IST — the grouping key, and never a rendered string. */
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dayLabelFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export type SessionAvailability = 'available' | 'few_left' | 'sold_out' | 'not_on_sale';

export type Session = {
  slot: EventSlot;
  /** Grouping key, "YYYY-MM-DD" in IST. Never shown to anyone. */
  dayKey: string;
  /** "Sat, 14 Mar" */
  dayLabel: string;
  /** "6:30 pm" */
  timeLabel: string;
  /** The organiser's name for it, when they gave one. */
  label: string;
  /** Seats left across every tier that sells this session. */
  available: number;
  state: SessionAvailability;
};

export type SessionDay = {
  dayKey: string;
  dayLabel: string;
  sessions: Session[];
};

/** How few is "few" — the same threshold the tier rows use, so one session and
 *  its tiers never disagree about urgency. */
const FEW_LEFT = 10;

/**
 * The tiers a given session sells.
 *
 * Includes the event-wide ones (`slot_id === null`) per the module header —
 * they admit to every show, so they are on sale at every show.
 */
export function tiersForSession(tiers: TicketTier[], slotId: string | null): TicketTier[] {
  if (slotId === null) return tiers;
  return tiers.filter((tier) => tier.slot_id === slotId || tier.slot_id === null);
}

function stateFor(tiers: TicketTier[]): { available: number; state: SessionAvailability } {
  if (!tiers.length) return { available: 0, state: 'not_on_sale' };
  // Only tiers actually ON SALE contribute. A session whose tiers all sit
  // outside their sale window has seats but nothing buyable, and calling that
  // "12 left" would send someone to a panel with no button.
  const sellable = tiers.filter((tier) => tier.is_on_sale);
  if (!sellable.length) return { available: 0, state: 'not_on_sale' };

  const available = sellable.reduce((total, tier) => total + Math.max(tier.available, 0), 0);
  if (available <= 0) return { available: 0, state: 'sold_out' };
  if (available <= FEW_LEFT) return { available, state: 'few_left' };
  return { available, state: 'available' };
}

/**
 * Slots + tiers → the picker's model, grouped by IST day and sorted in time
 * order within each day.
 *
 * The organiser's `position` is deliberately NOT the sort here, unlike the
 * ticket panel's tier order. A buyer scanning showtimes is reading a clock:
 * 21:00 above 18:00 reads as a mistake no matter which one the organiser wants
 * to push. `position` still decides the tier order INSIDE a session, where it
 * is a merchandising choice rather than a chronology.
 */
export function groupSessions(slots: EventSlot[], tiers: TicketTier[]): SessionDay[] {
  const days = new Map<string, SessionDay>();

  for (const slot of slots) {
    if (!slot.is_active) continue;
    const at = new Date(slot.starts_at);
    if (Number.isNaN(at.getTime())) continue;

    const dayKey = dayKeyFormatter.format(at);
    const { available, state } = stateFor(tiersForSession(tiers, slot.id));
    const session: Session = {
      slot,
      dayKey,
      dayLabel: dayLabelFormatter.format(at),
      timeLabel: timeFormatter.format(at),
      label: slot.label,
      available,
      state,
    };

    const day = days.get(dayKey);
    if (day) day.sessions.push(session);
    else days.set(dayKey, { dayKey, dayLabel: session.dayLabel, sessions: [session] });
  }

  return [...days.values()]
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .map((day) => ({
      ...day,
      sessions: [...day.sessions].sort(
        (a, b) => new Date(a.slot.starts_at).getTime() - new Date(b.slot.starts_at).getTime(),
      ),
    }));
}

/**
 * Which session to open on: the first one somebody can actually buy.
 *
 * Not simply the earliest. Opening a sold-out first show would make the event
 * look sold out — the exact misreading the tier list already avoids by
 * defaulting to the cheapest SELLABLE tier. With nothing buyable anywhere the
 * earliest is the right answer: it is the honest picture of the event.
 */
export function defaultSession(days: SessionDay[]): Session | null {
  const all = days.flatMap((day) => day.sessions);
  if (!all.length) return null;
  return all.find((session) => session.state === 'available' || session.state === 'few_left')
    ?? all[0]!;
}

/** The short line under a session chip. Null when there is nothing worth saying —
 *  "Available" on every chip is noise, and noise is what hides "2 left". */
export function sessionNote(session: Session): string | null {
  switch (session.state) {
    case 'sold_out':
      return 'Sold out';
    case 'not_on_sale':
      return 'Not on sale';
    case 'few_left':
      return `${session.available} left`;
    default:
      return null;
  }
}
