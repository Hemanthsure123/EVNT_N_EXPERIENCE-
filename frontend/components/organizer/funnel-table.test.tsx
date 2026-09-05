import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OrganizerFunnelRow } from '@/lib/api/organizer';
import type { OrganizerEarnings } from '@/lib/api/organizer';

/**
 * THE ONE PROPERTY WORTH PINNING ON THESE TWO SURFACES.
 *
 * This codebase's hardest rule is that the UI never shows a number the backend
 * does not maintain. Both of these components take fields that are DELIBERATELY
 * nullable for that reason — a conversion rate with no bookings, a quota fill
 * with no tiers, a revenue-per-attendee with no attendees — and the whole point
 * of the null is that it must not render as `0`.
 *
 * `0%` and "nothing to measure" look identical to a careless renderer and
 * completely different to an organizer: one says their event is converting
 * badly, the other says nobody has tried to buy yet. This is the regression
 * that would be invisible in review and expensive on screen, so it is the one
 * with a test.
 *
 * Presentation is deliberately NOT tested here — no snapshots, no class
 * assertions. Only the claim the numbers make.
 */

const funnelState = vi.hoisted(() => ({ rows: [] as OrganizerFunnelRow[] }));
const earningsState = vi.hoisted(() => ({ data: null as OrganizerEarnings | null }));

vi.mock('@/lib/organizer/queries', () => ({
  useOrganizerFunnel: () => ({
    data: { pages: [{ data: funnelState.rows, meta: { next: null } }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  }),
  useOrganizerEarnings: () => ({
    data: earningsState.data,
    isPending: earningsState.data === null,
    isError: false,
    refetch: vi.fn(),
  }),
  useOrganizerInsights: () => ({ data: [], isPending: false, isError: false }),
}));

const { FunnelTable } = await import('./funnel-table');
const { EarningsStrip } = await import('./earnings');

const row = (over: Partial<OrganizerFunnelRow> = {}): OrganizerFunnelRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Sunday Jazz',
  status: 'live',
  starts_at: '2026-10-01T12:00:00Z',
  bookings_started: 0,
  bookings_paid: 0,
  conversion_pct: null,
  capacity: 0,
  tickets_sold: 0,
  quota_fill_pct: null,
  revenue_minor: 0,
  paying_attendees: 0,
  repeat_attendee_pct: null,
  ...over,
});

beforeEach(() => {
  funnelState.rows = [];
  earningsState.data = null;
});

describe('the funnel table never invents a measurement', () => {
  it('renders an unmeasured conversion as a blank, not 0%', () => {
    funnelState.rows = [row({ conversion_pct: null })];
    render(<FunnelTable />);

    expect(screen.queryByText('0.0%')).toBeNull();
    expect(screen.getAllByText(/nothing to measure yet/i).length).toBeGreaterThan(0);
  });

  it('renders a real conversion as a percentage', () => {
    funnelState.rows = [row({ bookings_started: 8, bookings_paid: 6, conversion_pct: 75 })];
    render(<FunnelTable />);

    expect(screen.getByText('75.0%')).toBeTruthy();
  });

  it('says an event has no tickets set up rather than drawing a 0% ring', () => {
    funnelState.rows = [row({ capacity: 0, quota_fill_pct: null })];
    render(<FunnelTable />);

    expect(screen.getByText(/no tickets set up/i)).toBeTruthy();
  });

  it('does not carry an impressions, views, cart or CTR column', () => {
    // The brief asked for all four. The platform measures none of them, so
    // they must not appear — not as data, and not as an empty column header
    // that reads to an organizer as "nobody saw your event".
    funnelState.rows = [row()];
    render(<FunnelTable />);

    for (const banned of [/impression/i, /detail view/i, /add to cart/i, /\bCTR\b/]) {
      expect(screen.queryByText(banned)).toBeNull();
    }
  });
});

describe('the earnings cards never invent a measurement', () => {
  const earnings = (over: Partial<OrganizerEarnings> = {}): OrganizerEarnings => ({
    lifetime_revenue_minor: 0,
    lifetime_tickets: 0,
    lifetime_attendees: 0,
    avg_revenue_per_attendee_minor: null,
    month_revenue_minor: 0,
    month_change_pct: null,
    comparison_days: 5,
    generated_at: '2026-09-05T00:00:00Z',
    ...over,
  });

  it('shows no revenue-per-attendee figure when nobody has paid', () => {
    earningsState.data = earnings({ avg_revenue_per_attendee_minor: null });
    render(<EarningsStrip />);

    expect(screen.getByText(/no paid attendees yet/i)).toBeTruthy();
  });

  it('states the span the month was compared against, not just a percentage', () => {
    // A tile reading "+240%" on the 2nd — two days measured against
    // thirty-one — is a number somebody might act on.
    earningsState.data = earnings({ month_change_pct: 12.5, comparison_days: 5 });
    render(<EarningsStrip />);

    expect(screen.getByText(/first 5 days of last month/i)).toBeTruthy();
  });

  it('says there was no comparable period rather than showing a change of zero', () => {
    earningsState.data = earnings({ month_change_pct: null });
    render(<EarningsStrip />);

    expect(screen.getByText(/no comparable period last month/i)).toBeTruthy();
  });
});
