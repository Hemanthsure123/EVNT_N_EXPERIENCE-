import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventAnalytics as EventAnalyticsData, OrganizerSettlement } from '@/lib/api/organizer';
import type { Coupon } from '@/lib/api/coupons';
import { ApiError } from '@/lib/api/errors';

/**
 * THE EVENT ANALYTICS PAGE — the claims, not the layout.
 *
 * Every property here fails SILENTLY if it regresses. A settlement 404 drawn
 * as an error makes a healthy page look broken; an org-wide coupon's total
 * shown under an event heading attributes another event's discounts to this
 * one; a null rate rendered as 0% tells an organizer their event converts
 * badly when nobody has tried to buy. None of those throws.
 */

const harness = vi.hoisted(() => ({
  analytics: null as EventAnalyticsData | null,
  settlement: { isPending: false, isError: false, error: null as unknown, data: null as unknown },
  reviews: [] as { id: string; rating: number; verified_attendee: boolean }[],
  coupons: [] as Coupon[],
  organization: { id: 'org-1', name: 'Night Owl' } as { id: string; name: string } | null,
}));

vi.mock('@/lib/organizer/queries', () => ({
  useEventAnalytics: () => ({
    data: harness.analytics,
    isPending: harness.analytics === null,
    isError: false,
    refetch: vi.fn(),
  }),
  useEventSettlement: () => harness.settlement,
  useReviews: () => ({
    data: { pages: [{ data: harness.reviews, meta: { next: null } }] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/lib/organizer/active-organization', () => ({
  useActiveOrganization: () => ({
    organization: harness.organization,
    organizations: harness.organization ? [harness.organization] : [],
    ready: true,
    needsChoice: false,
    hasNone: false,
    choose: vi.fn(),
  }),
}));

vi.mock('@/lib/api/coupons', () => ({
  fetchCoupons: () => Promise.resolve(harness.coupons),
}));

import { EventAnalytics } from './event-analytics';

const analytics = (over: Partial<EventAnalyticsData> = {}): EventAnalyticsData => ({
  event_id: 'evt-1',
  event: {
    id: 'evt-1',
    title: 'Midnight Comedy',
    status: 'live',
    starts_at: '2026-03-14T13:30:00Z',
    ends_at: null,
    venue: 'Phoenix Marketcity',
    city: 'Mumbai',
  },
  revenue_minor: 12_800_00,
  refunded_minor: 0,
  refunded_count: 0,
  capacity: 500,
  sold: 128,
  checkins: 96,
  sell_through_pct: 25.6,
  conversion_pct: 62.5,
  abandonment_pct: 37.5,
  attendance_pct: 75,
  bookings_by_status: [
    { label: 'paid', value: 100 },
    { label: 'expired', value: 60 },
  ],
  scans_by_result: [{ label: 'allowed', value: 96 }],
  tiers: [
    {
      id: 'tier-1',
      name: 'General',
      price_minor: 100_00,
      quantity: 500,
      sold: 128,
      reserved: 2,
      revenue_minor: 12_800_00,
    },
  ],
  sales_timeline: [{ date: '2026-03-01', value: 100_00 }],
  ...over,
});

const settlement = (over: Partial<OrganizerSettlement> = {}): OrganizerSettlement => ({
  id: 'st-1',
  event_id: 'evt-1',
  event_title: 'Midnight Comedy',
  status: 'pending',
  gross: 12_800_00,
  platform_fee: 128_00,
  refunds: 0,
  net: 12_672_00,
  releasable_at: '2026-03-18T00:00:00Z',
  payout_at: null,
  provider_ref: '',
  created_at: '2026-03-01T00:00:00Z',
  ...over,
});

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'c-1',
  event_id: 'evt-1',
  code: 'EARLY20',
  kind: 'percent',
  value: 20,
  max_discount_minor: null,
  starts_at: null,
  ends_at: null,
  max_redemptions: null,
  max_per_user: 1,
  visible_at_checkout: true,
  is_active: true,
  redeemed_count: 7,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventAnalytics eventId="evt-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  harness.analytics = analytics();
  harness.settlement = { isPending: false, isError: false, error: null, data: settlement() };
  harness.reviews = [];
  harness.coupons = [];
  harness.organization = { id: 'org-1', name: 'Night Owl' };
});

describe('the payout', () => {
  it('shows gross, fee, refunds and net, and says which copy of the number it is', async () => {
    mount();
    expect(await screen.findByText('Gross')).toBeTruthy();
    expect(screen.getByText('Platform fee')).toBeTruthy();
    expect(screen.getByText('Net')).toBeTruthy();
    // The sentence that stops this being read as a promise. `net` is
    // recomputed authoritatively from the payment records at release.
    expect(screen.getByText(/recomputed from the\s+payment records/i)).toBeTruthy();
  });

  it('draws a deduction as a deduction', () => {
    // A platform fee printed as a positive number in a column that sums to the
    // net is the one arithmetic an organizer will check by hand.
    mount();
    expect(screen.getByText('-₹128')).toBeTruthy();
  });

  it('reads a 404 as "nothing yet", never as an error', async () => {
    // A settlement row opens on the first confirmed payment, so every event
    // has a window where this legitimately does not exist. An error state over
    // an otherwise healthy page is how somebody concludes the money is gone.
    harness.settlement = {
      isPending: false,
      isError: true,
      error: new ApiError(404, 'settlement_not_found', 'Not found'),
      data: null,
    };
    mount();
    expect(await screen.findByText(/No payout yet/i)).toBeTruthy();
    expect(screen.queryByText(/Could not load/i)).toBeNull();
  });

  it('says a failed transfer is still owed', async () => {
    // NOT "lost", and not a bare "Failed": the money is still the
    // organizer's, and the label on their own payout must not imply otherwise.
    harness.settlement = {
      isPending: false,
      isError: false,
      error: null,
      data: settlement({ status: 'failed' }),
    };
    mount();
    expect(await screen.findByText(/still owed/i)).toBeTruthy();
  });
});

describe('coupon usage', () => {
  it('separates this event’s codes from the organisation-wide ones', async () => {
    harness.coupons = [
      coupon({ id: 'c-1', code: 'EARLY20', event_id: 'evt-1' }),
      coupon({ id: 'c-2', code: 'SEASON', event_id: null, redeemed_count: 40 }),
    ];
    mount();

    expect(await screen.findByText('EARLY20')).toBeTruthy();
    expect(screen.getByText('SEASON')).toBeTruthy();
    // The caveat is the whole point of the split: `redeemed_count` on an
    // org-wide code is its total across every event, and printing that under
    // an event heading attributes another event's discounts to this one.
    expect(screen.getByText(/not this event’s share/i)).toBeTruthy();
  });

  it('leaves out a code scoped to a DIFFERENT event', async () => {
    harness.coupons = [coupon({ id: 'c-3', code: 'OTHEREVENT', event_id: 'evt-999' })];
    mount();
    expect(await screen.findByText(/No promo code applies to this event/i)).toBeTruthy();
    expect(screen.queryByText('OTHEREVENT')).toBeNull();
  });
});

describe('feedback', () => {
  it('scopes the average to what is LOADED', async () => {
    // Cursor-paginated with no aggregate, so a mean here describes the reviews
    // on screen and nothing more. Presenting it as "your rating" would be a
    // figure that changes as somebody scrolls.
    harness.reviews = [
      { id: 'r1', rating: 5, verified_attendee: true },
      { id: 'r2', rating: 4, verified_attendee: false },
    ];
    mount();
    expect(await screen.findByText('4.5')).toBeTruthy();
    expect(screen.getByText(/over 2 reviews loaded/i)).toBeTruthy();
  });

  it('says reviews arrive after the event rather than showing an empty chart', async () => {
    harness.reviews = [];
    mount();
    expect(await screen.findByText(/No reviews yet/i)).toBeTruthy();
  });
});

describe('rates with no denominator', () => {
  it('renders an em dash, never 0%', () => {
    // The backend sends `null` for a rate whose denominator is zero. "0%
    // conversion" and "nobody has tried to buy yet" look identical to a
    // careless renderer and completely different to the person reading them.
    harness.analytics = analytics({
      conversion_pct: null,
      abandonment_pct: null,
      attendance_pct: null,
      sell_through_pct: null,
      sold: 0,
      checkins: 0,
      bookings_by_status: [],
    });
    mount();
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.getAllByTitle('Not enough data yet').length).toBeGreaterThan(0);
  });

  it('does not divide by zero for the per-ticket average', () => {
    harness.analytics = analytics({ sold: 0, revenue_minor: 0 });
    mount();
    expect(screen.getByText('Nothing sold yet')).toBeTruthy();
  });
});

describe('what the page refuses to invent', () => {
  it('names the six things nothing backs, on the page', () => {
    // Named rather than approximated, and named where an organizer looking for
    // them will read it — the same rule the performer studio's analytics
    // follows. Each of these was asked for; each needs a real backend change.
    mount();
    expect(screen.getByText('Not measured yet')).toBeTruthy();
    for (const missing of [
      'Booking window trend',
      'Tickets per day',
      'Price change timeline',
      'Pricing change log',
      'Group offer uptake',
      'Audience quality',
    ]) {
      expect(screen.getByText(missing)).toBeTruthy();
    }
  });

  it('keeps the sales chart honestly single-series', () => {
    // The brief asks for a Spots/Tickets switch. `sales_timeline` is a sum of
    // payment amounts and there is no per-day ticket count behind it, so a
    // switch could only redraw the same line under a different name.
    mount();
    expect(screen.getByText('Paid revenue per day')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /spots/i })).toBeNull();
  });
});

describe('the sections are named', () => {
  it('gives an organizer the seven questions as headings', () => {
    // The page was four unlabelled regions. Somebody arriving with one
    // question had to read all of them to find out which was theirs.
    mount();
    for (const heading of [
      'Revenue performance',
      'Sales over time',
      'Booking insights',
      'Attendance',
      'Tier sales',
      'Coupon usage',
      'Feedback',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });
});
