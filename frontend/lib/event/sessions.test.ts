import { describe, expect, it } from 'vitest';
import type { EventSlot } from '@/lib/api/event-content';
import type { TicketTier } from '@/lib/api/types';
import {
  defaultSession,
  groupSessions,
  sessionNote,
  tiersForSession,
} from '@/lib/event/sessions';

function slot(overrides: Partial<EventSlot> & { id: string; starts_at: string }): EventSlot {
  return {
    label: '',
    ends_at: null,
    position: 0,
    is_active: true,
    ...overrides,
  };
}

function tier(overrides: Partial<TicketTier> & { id: string }): TicketTier {
  return {
    event_id: 'evt',
    slot_id: null,
    name: 'GA',
    description: '',
    perks: [],
    position: 0,
    price: 50_000,
    effective_price: 50_000,
    current_phase: null,
    next_price: null,
    phases: [],
    quantity: 100,
    sold: 0,
    available: 100,
    sale_start: null,
    sale_end: null,
    max_per_order: 10,
    is_on_sale: true,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('grouping', () => {
  it('groups by the IST day, not the runner’s', () => {
    // 20:00 UTC on 13 March is 01:30 IST on 14 March. A device in London would
    // put this under the 13th; every Indian buyer means the 14th.
    const days = groupSessions([slot({ id: 's1', starts_at: '2026-03-13T20:00:00Z' })], []);
    expect(days).toHaveLength(1);
    expect(days[0]!.dayKey).toBe('2026-03-14');
  });

  it('sorts days ascending and sessions within a day by the clock', () => {
    const days = groupSessions(
      [
        slot({ id: 'late', starts_at: '2026-03-14T15:30:00Z', position: 0 }),
        slot({ id: 'early', starts_at: '2026-03-14T12:30:00Z', position: 9 }),
        slot({ id: 'nextday', starts_at: '2026-03-15T12:30:00Z' }),
      ],
      [],
    );

    expect(days.map((day) => day.dayKey)).toEqual(['2026-03-14', '2026-03-15']);
    // `position` says the late show first; the clock wins. A buyer scanning
    // showtimes is reading a clock, and 9pm above 6pm reads as a bug.
    expect(days[0]!.sessions.map((session) => session.slot.id)).toEqual(['early', 'late']);
  });

  it('omits switched-off sessions', () => {
    const days = groupSessions(
      [
        slot({ id: 'on', starts_at: '2026-03-14T12:30:00Z' }),
        slot({ id: 'off', starts_at: '2026-03-14T15:30:00Z', is_active: false }),
      ],
      [],
    );
    expect(days[0]!.sessions.map((session) => session.slot.id)).toEqual(['on']);
  });

  it('drops a slot whose timestamp cannot be parsed rather than rendering NaN', () => {
    const days = groupSessions([slot({ id: 'bad', starts_at: 'not-a-date' })], []);
    expect(days).toEqual([]);
  });

  it('returns nothing for the ordinary single-show event', () => {
    expect(groupSessions([], [tier({ id: 't1' })])).toEqual([]);
  });
});

describe('which tiers belong to a session', () => {
  const scoped = tier({ id: 'early-ga', slot_id: 'early' });
  const other = tier({ id: 'late-ga', slot_id: 'late' });
  const anySession = tier({ id: 'season', slot_id: null });

  it('takes the session’s own tiers', () => {
    expect(tiersForSession([scoped, other], 'early').map((t) => t.id)).toEqual(['early-ga']);
  });

  it('also takes the tiers tied to NO session, under every one of them', () => {
    // Not a fallback — it is what the gate does. `checkin`'s scan window falls
    // back to the EVENT's span for a ticket whose tier has no slot, so such a
    // ticket genuinely admits to any show. Hiding it here would put the picker
    // and the door in disagreement about the same ticket.
    expect(tiersForSession([scoped, other, anySession], 'early').map((t) => t.id)).toEqual([
      'early-ga',
      'season',
    ]);
  });
});

describe('availability per session', () => {
  const early = slot({ id: 'early', starts_at: '2026-03-14T12:30:00Z' });
  const late = slot({ id: 'late', starts_at: '2026-03-14T15:30:00Z' });

  it('sells out one session without touching the other', () => {
    // The load-bearing property, seen from the front end: inventory is per
    // TIER, so the late show is untouched by the early one selling out.
    const days = groupSessions(
      [early, late],
      [
        tier({ id: 'a', slot_id: 'early', available: 0 }),
        tier({ id: 'b', slot_id: 'late', available: 40 }),
      ],
    );
    const [first, second] = days[0]!.sessions;
    expect(first!.state).toBe('sold_out');
    expect(second!.state).toBe('available');
    expect(second!.available).toBe(40);
  });

  it('sums across a session’s tiers', () => {
    const days = groupSessions(
      [early],
      [
        tier({ id: 'a', slot_id: 'early', available: 3 }),
        tier({ id: 'b', slot_id: 'early', available: 4 }),
      ],
    );
    expect(days[0]!.sessions[0]!.available).toBe(7);
    expect(days[0]!.sessions[0]!.state).toBe('few_left');
  });

  it('ignores tiers that are off sale, rather than counting seats nobody can buy', () => {
    const days = groupSessions(
      [early],
      [tier({ id: 'a', slot_id: 'early', available: 12, is_on_sale: false })],
    );
    // Not "12 left": that would send someone to a panel with no button.
    expect(days[0]!.sessions[0]!.state).toBe('not_on_sale');
    expect(days[0]!.sessions[0]!.available).toBe(0);
  });

  it('treats a session with no tiers at all as not on sale', () => {
    expect(groupSessions([early], [])[0]!.sessions[0]!.state).toBe('not_on_sale');
  });
});

describe('the default selection', () => {
  const early = slot({ id: 'early', starts_at: '2026-03-14T12:30:00Z' });
  const late = slot({ id: 'late', starts_at: '2026-03-14T15:30:00Z' });

  it('skips a sold-out first show', () => {
    // Opening on it would make the whole event look sold out — the same
    // misreading the tier list avoids by defaulting to the cheapest SELLABLE
    // tier rather than the cheapest.
    const days = groupSessions(
      [early, late],
      [
        tier({ id: 'a', slot_id: 'early', available: 0 }),
        tier({ id: 'b', slot_id: 'late', available: 40 }),
      ],
    );
    expect(defaultSession(days)?.slot.id).toBe('late');
  });

  it('falls back to the earliest when nothing anywhere is buyable', () => {
    const days = groupSessions(
      [early, late],
      [
        tier({ id: 'a', slot_id: 'early', available: 0 }),
        tier({ id: 'b', slot_id: 'late', available: 0 }),
      ],
    );
    expect(defaultSession(days)?.slot.id).toBe('early');
  });

  it('is null with no sessions', () => {
    expect(defaultSession([])).toBeNull();
  });
});

describe('the note under a chip', () => {
  const days = (available: number, onSale = true) =>
    groupSessions(
      [slot({ id: 's', starts_at: '2026-03-14T12:30:00Z' })],
      [tier({ id: 't', slot_id: 's', available, is_on_sale: onSale })],
    );

  it('says nothing when a session is simply available', () => {
    // "Available" on every chip is noise, and noise is what hides "2 left".
    expect(sessionNote(days(80)[0]!.sessions[0]!)).toBeNull();
  });

  it('counts down when it is nearly gone', () => {
    expect(sessionNote(days(2)[0]!.sessions[0]!)).toBe('2 left');
  });

  it('says sold out and not on sale in their own words', () => {
    expect(sessionNote(days(0)[0]!.sessions[0]!)).toBe('Sold out');
    expect(sessionNote(days(5, false)[0]!.sessions[0]!)).toBe('Not on sale');
  });
});
