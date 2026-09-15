import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendeeRow, EventAnalytics, OrganizerSettlement } from '@/lib/api/organizer';
import type { Coupon } from '@/lib/api/coupons';
import { ApiError } from '@/lib/api/errors';

/**
 * THE EVENT ANALYTICS PAGE — the claims, section by section.
 *
 * Most of what is pinned here fails SILENTLY if it regresses: a view count of
 * "0" for an event nothing was ever recorded on, a rate with no denominator
 * printed as 0%, "matched preferences" on a figure that measures saves, a
 * payout 404 drawn as an error. None of those throws.
 */

const harness = vi.hoisted(() => ({
  analytics: null as EventAnalytics | null,
  settlement: { isPending: false, isError: false, error: null as unknown, data: null as unknown },
  coupons: [] as Coupon[],
  attendees: [] as AttendeeRow[],
  attendeeCount: null as number | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/lib/organizer/queries', () => ({
  useEventAnalytics: () => ({
    data: harness.analytics,
    isPending: harness.analytics === null,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useEventSettlement: () => harness.settlement,
  useEventAttendees: () => ({
    data: {
      pages: [
        { data: harness.attendees, meta: { next: null, previous: null, count: harness.attendeeCount } },
      ],
    },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/organizer/active-organization', () => ({
  useActiveOrganization: () => ({
    organization: { id: 'org-1', name: 'Eira' },
    organizations: [{ id: 'org-1', name: 'Eira' }],
    ready: true,
    needsChoice: false,
    hasNone: false,
    choose: vi.fn(),
  }),
}));

vi.mock('@/lib/api/coupons', () => ({
  fetchCoupons: () => Promise.resolve(harness.coupons),
}));

import { AnalyticsDashboard } from './analytics-dashboard';

/** The reference screenshots' event, in this platform's shape. */
const analytics = (over: Partial<EventAnalytics> = {}): EventAnalytics => ({
  event_id: 'evt-1',
  event: {
    id: 'evt-1',
    title: 'EIRA THE BAND - September Jamming - Hyderabad',
    status: 'live',
    starts_at: '2026-09-05T11:30:00Z',
    ends_at: '2026-09-05T14:30:00Z',
    venue: 'Roast N Toast - Lounge',
    city: 'Hyderabad',
    created_at: '2026-08-31T16:30:00Z',
  },
  revenue_minor: 1_321_000,
  refunded_minor: 0,
  refunded_count: 0,
  capacity: 200,
  sold: 52,
  checkins: 34,
  sell_through_pct: 26,
  conversion_pct: 8.4,
  abandonment_pct: 91.6,
  attendance_pct: 65.4,
  bookings_by_status: [],
  scans_by_result: [{ label: 'allowed', value: 34 }],
  tiers: [
    {
      id: 'tier-1',
      name: '1 Person',
      price_minor: 29_900,
      quantity: 200,
      sold: 8,
      reserved: 0,
      revenue_minor: 239_200,
      orders: 7,
      seats: 8,
      charged_minor: 239_200,
      per_person_minor: 29_900,
      is_past: false,
      is_deleted: false,
    },
    {
      id: 'tier-0',
      name: 'Early 1 Person',
      price_minor: 24_900,
      quantity: 20,
      sold: 0,
      reserved: 0,
      revenue_minor: 0,
      orders: 0,
      seats: 0,
      charged_minor: 0,
      per_person_minor: null,
      is_past: true,
      is_deleted: false,
    },
  ],
  sales_timeline: [],
  generated_at: '2026-09-15T10:00:00Z',
  add_to_cart: 320,
  orders: 27,
  seats: 52,
  avg_per_attendee_minor: 25_404,
  no_shows: 18,
  event_ended: true,
  engagement: {
    tracked_since: '2026-08-31',
    views: 4_885,
    impressions: 285,
    feed_views: 41,
    located_views: 100,
    local_views: 4,
    view_cvr_pct: 1.06,
    ctr_pct: 14.39,
    local_pct: 4,
  },
  order_split: {
    single: { orders: 10, revenue_minor: 279_000 },
    multiple: { orders: 17, revenue_minor: 1_042_000 },
  },
  booking_insights: {
    first_booking_at: '2026-09-02T06:00:00Z',
    last_booking_at: '2026-09-05T10:00:00Z',
    period_days: 3,
    late_window_hours: 72,
    late_seats: 52,
    late_pct: 100,
  },
  booking_window: [
    { date: '2026-08-31', orders: 0, seats: 0 },
    { date: '2026-09-01', orders: 0, seats: 0 },
    { date: '2026-09-02', orders: 3, seats: 6 },
    { date: '2026-09-03', orders: 4, seats: 8 },
    { date: '2026-09-04', orders: 5, seats: 12 },
    { date: '2026-09-05', orders: 15, seats: 26 },
  ],
  price_timeline: [
    {
      tier_id: 'tier-1',
      tier_name: '1 Person',
      price_minor: 24_900,
      started_at: '2026-08-31T16:30:00Z',
      ended_at: '2026-09-04T14:38:00Z',
      seats: 23,
      revenue_minor: 557_800,
      status: 'ended',
      kind: 'created',
    },
    {
      tier_id: 'tier-1',
      tier_name: '1 Person',
      price_minor: 29_900,
      started_at: '2026-09-04T15:17:00Z',
      ended_at: null,
      seats: 29,
      revenue_minor: 763_200,
      status: 'active',
      kind: 'edited',
    },
  ],
  untracked_sales: [],
  feature_log: [
    {
      tier_id: 'tier-1',
      tier_name: '1 Person',
      feature: 'early_bird',
      enabled_at: '2026-08-31T17:11:00Z',
      disabled_at: '2026-09-04T14:38:00Z',
      seats: 23,
      status: 'disabled',
    },
    {
      tier_id: 'tier-1',
      tier_name: '1 Person',
      feature: 'group_offers',
      enabled_at: '2026-09-04T14:38:00Z',
      disabled_at: null,
      seats: 29,
      status: 'enabled',
    },
  ],
  history_truncated: false,
  group_offers: {
    enabled: true,
    orders: 17,
    seats: 29,
    revenue_minor: 763_200,
    bands: [
      { min_quantity: 2, orders: 9, seats: 18, revenue_minor: 449_100 },
      { min_quantity: 3, orders: 1, seats: 3, revenue_minor: 74_900 },
    ],
  },
  coupons: { orders: 1, pct_of_orders: 3.7, discount_minor: 14_900 },
  audience: {
    attendees: 26,
    first_time: 25,
    repeat: 1,
    first_time_pct: 96,
    repeat_pct: 4,
    savers: 10,
    saved_then_booked: 7,
    interest_conversion_pct: 70,
    located_views: 100,
    local_pct: 4,
  },
  feedback: {
    count: 1,
    average: 5,
    breakdown: [
      { rating: 5, count: 1 },
      { rating: 4, count: 0 },
      { rating: 3, count: 0 },
      { rating: 2, count: 0 },
      { rating: 1, count: 0 },
    ],
  },
  ...over,
});

const settlement = (over: Partial<OrganizerSettlement> = {}): OrganizerSettlement =>
  ({
    id: 'st-1',
    event_id: 'evt-1',
    event_title: 'EIRA',
    status: 'pending',
    gross: 1_321_000,
    platform_fee: 13_210,
    refunds: 0,
    net: 1_307_790,
    releasable_at: '2026-09-08T00:00:00Z',
    payout_at: null,
    provider_ref: '',
    ...over,
  }) as OrganizerSettlement;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyticsDashboard eventId="evt-1" />
    </QueryClientProvider>,
  );
}

function section(name: string | RegExp): HTMLElement {
  return screen.getByRole('region', { name }) as HTMLElement;
}

function card(label: string): HTMLElement {
  const node = screen.getByText(label).closest('div');
  if (!node) throw new Error(`no card for ${label}`);
  return node as HTMLElement;
}

beforeEach(() => {
  harness.analytics = analytics();
  harness.settlement = { isPending: false, isError: false, error: null, data: settlement() };
  harness.coupons = [];
  harness.attendees = [];
  harness.attendeeCount = null;
});

describe('the header', () => {
  it('names the event and offers the scanner and the settings', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: /EIRA THE BAND/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Scan Tickets/ }).getAttribute('href')).toBe(
      '/dashboard/check-in?event=evt-1',
    );
    expect(screen.getByRole('link', { name: 'Event settings' }).getAttribute('href')).toBe(
      '/dashboard/events/evt-1/edit',
    );
  });

  it('says Ended once the show is over, whatever the stored status', () => {
    mount();
    // In the HEADER: a finished price period also reads "Ended" further down.
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    expect(within(header).getByText('Ended')).toBeTruthy();
  });
});

describe('core performance metrics', () => {
  it('prints the six figures the reference shows', () => {
    mount();
    const core = section('Core Performance Metrics');
    expect(within(core).getByText('4,885')).toBeTruthy();
    expect(within(core).getByText('52/200')).toBeTruthy();
    expect(within(core).getByText('26% filled')).toBeTruthy();
    expect(within(core).getByText('1.06%')).toBeTruthy();
    expect(within(core).getByText('285')).toBeTruthy();
    expect(within(core).getByText('14.39%')).toBeTruthy();
    expect(within(core).getByText('320')).toBeTruthy();
  });

  it('draws a dash, never a zero, where nothing was recorded', () => {
    harness.analytics = analytics({
      engagement: {
        tracked_since: null,
        views: null,
        impressions: null,
        feed_views: null,
        located_views: null,
        local_views: null,
        view_cvr_pct: null,
        ctr_pct: null,
        local_pct: null,
      },
    });
    mount();
    const views = card('Total Event Views');
    expect(within(views).getByText('—')).toBeTruthy();
    expect(within(views).queryByText('0')).toBeNull();
    expect(within(views).getByText('Not recorded for this event')).toBeTruthy();
  });

  it('says from when views were counted when that began after the event did', () => {
    harness.analytics = analytics({
      engagement: { ...analytics().engagement, tracked_since: '2026-09-03' },
    });
    mount();
    expect(within(card('Total Event Views')).getByText(/Page views since 3 Sep/)).toBeTruthy();
    expect(screen.getByText(/Earlier activity on this event was not recorded/)).toBeTruthy();
  });
});

describe('revenue and attendance', () => {
  it('splits revenue by orders of one ticket and of more', () => {
    mount();
    const revenue = section('Revenue Performance');
    expect(within(revenue).getByText('Multiple:')).toBeTruthy();
    expect(within(revenue).getByText(/₹10,420/)).toBeTruthy();
    expect(within(revenue).getByText('17 orders')).toBeTruthy();
    expect(within(revenue).getByText('10 orders')).toBeTruthy();
    expect(within(revenue).getByText(/₹254\.04/)).toBeTruthy();
  });

  it('counts tickets as people, and the purchases as orders', () => {
    mount();
    const attendance = section('Attendance & Show-up Quality');
    const sold = card('Tickets Sold');
    expect(within(sold).getByText('52')).toBeTruthy();
    expect(within(sold).getByText('27 orders')).toBeTruthy();
    expect(within(attendance).getByText('65.4% arrival')).toBeTruthy();
    expect(within(card('No-shows')).getByText('18')).toBeTruthy();
    expect(within(card('No-shows')).getByText('34 attended')).toBeTruthy();
  });

  it('does not call anybody a no-show before the event is over', () => {
    harness.analytics = analytics({ no_shows: null, event_ended: false });
    mount();
    expect(within(card('No-shows')).getByText('Counted once the event is over')).toBeTruthy();
  });

  it('reads a settlement 404 as "no payout yet", not as an error', () => {
    harness.settlement = {
      isPending: false,
      isError: true,
      error: new ApiError(404, 'settlement_not_found', 'Settlement not found.'),
      data: null,
    };
    mount();
    expect(screen.getByText(/No payout yet/)).toBeTruthy();
  });
});

describe('booking insights and the window', () => {
  it('names the late surge from the real share', () => {
    mount();
    expect(screen.getByText('100% bookings in last 72 hrs')).toBeTruthy();
    expect(screen.getByText('Last minute surge')).toBeTruthy();
    expect(screen.getByText('3 days')).toBeTruthy();
  });

  it('waits for the doors before measuring the last 72 hours', () => {
    harness.analytics = analytics({
      booking_insights: { ...analytics().booking_insights, late_seats: null, late_pct: null },
    });
    mount();
    expect(screen.getByText('Measured once the doors open')).toBeTruthy();
  });

  it('carries the total, the peak and the average the reference shows', () => {
    mount();
    const chart = section('Booking Window Trend');
    expect(within(chart).getByText('52 spots')).toBeTruthy();
    expect(within(chart).getByText(/Peak Booking Date/).textContent).toMatch(/5 Sep.*\(26 spots\)/);
    expect(within(chart).getByText(/Average Spots\/Day/).textContent).toMatch(
      /8\.7 spots\/day.*across 6 days/,
    );
  });

  it('opens on the peak day, with orders and spots both named', () => {
    mount();
    const chart = section('Booking Window Trend');
    const readout = within(chart).getByText(/^Date:/).closest('p') as HTMLElement;
    expect(readout.textContent).toMatch(/5 Sep/);
    expect(readout.textContent).toMatch(/Orders:\s*15/);
    expect(readout.textContent).toMatch(/Spots:\s*26/);
  });

  it('narrows to a range without asking the server again', () => {
    mount();
    const chart = section('Booking Window Trend');
    fireEvent.change(within(chart).getByLabelText('Range'), { target: { value: '7' } });
    // Six days in the fixture, so the last seven is still all of them.
    expect(within(chart).getByText('52 spots')).toBeTruthy();
  });
});

describe('the pricing tables', () => {
  it('marks the current price active and the earlier one ended', () => {
    mount();
    const timeline = section('Price Change Timeline');
    expect(within(timeline).getByText('Active')).toBeTruthy();
    expect(within(timeline).getByText('Ended')).toBeTruthy();
    expect(within(timeline).getByText('→ Now')).toBeTruthy();
  });

  it('says sales before price history began, rather than inventing a period', () => {
    harness.analytics = analytics({
      untracked_sales: [
        { tier_id: 'tier-1', tier_name: '1 Person', until: null, seats: 5, revenue_minor: 124_500 },
      ],
    });
    mount();
    expect(screen.getByText('Before price history began')).toBeTruthy();
  });

  it('totals the spots each feature priced, and flags the one still on', () => {
    mount();
    const log = section('Pricing Feature Change Log');
    expect(within(log).getByText('Total Spots Booked')).toBeTruthy();
    expect(within(log).getByText('52')).toBeTruthy();
    expect(within(log).getByText('Current')).toBeTruthy();
    expect(within(log).getByText('Disabled')).toBeTruthy();
  });

  it('draws group offers as off, not as zeros, when nobody offered them', () => {
    harness.analytics = analytics({
      group_offers: { enabled: false, orders: 0, seats: 0, revenue_minor: 0, bands: [] },
    });
    mount();
    const offers = section('Group Offers');
    expect(within(offers).getByText('Off')).toBeTruthy();
    expect(within(offers).getByText(/No tier on this event offers a group price/)).toBeTruthy();
  });

  it('badges a tier whose sale is over as a past tier', () => {
    mount();
    const tiers = section('Tier Sales');
    const past = within(tiers).getByText('Early 1 Person').closest('tr') as HTMLElement;
    expect(within(past).getByText('Past Tier')).toBeTruthy();
    // Nothing sold: no per-person price, not ₹0.
    expect(within(past).getByText('—')).toBeTruthy();
  });

  it('shows coupon use as a share of this event’s bookings', () => {
    mount();
    const coupons = section('Coupon Usage Statistics');
    expect(within(coupons).getByText('3.7% of bookings')).toBeTruthy();
    expect(within(coupons).getByText(/₹149/)).toBeTruthy();
  });

  it('warns that an organization-wide code’s count is not this event’s', async () => {
    harness.coupons = [
      {
        id: 'c-1',
        code: 'ALLNIGHT',
        kind: 'percent',
        value: 10,
        max_discount_minor: null,
        max_redemptions: null,
        redeemed_count: 40,
        event_id: null,
        is_active: true,
      } as unknown as Coupon,
    ];
    mount();
    expect(await screen.findByText(/not this event’s share/)).toBeTruthy();
  });
});

describe('audience and feedback', () => {
  it('labels interest conversion as what it measures — saves, not preferences', () => {
    mount();
    const interest = card('Interest Conversion');
    expect(within(interest).getByText('70%')).toBeTruthy();
    expect(within(interest).getByText('Saved it, then booked (7 of 10)')).toBeTruthy();
    expect(screen.queryByText(/Matched preferences/i)).toBeNull();
  });

  it('names the city local distribution is measured against', () => {
    mount();
    expect(within(card('Local Distribution')).getByText('Viewers browsing Hyderabad')).toBeTruthy();
  });

  it('prints the rating over every review, with all five buckets', () => {
    mount();
    const feedback = section('Event Outcome & Feedback');
    expect(within(feedback).getByText('Based on 1 review')).toBeTruthy();
    expect(within(feedback).getByRole('list', { name: 'Ratings by stars' }).children).toHaveLength(5);
  });
});

describe('the attendee list at the foot of the page', () => {
  it('says how many of how many are showing', () => {
    harness.attendeeCount = 52;
    harness.attendees = [
      {
        ticket_id: 't-1',
        holder_name: 'Pravalika Pasham',
        holder_email: 'pravalika@example.com',
        is_reassigned: false,
        buyer_name: 'Pravalika Pasham',
        buyer_email: 'pravalika@example.com',
        phone: '+918074569434',
        ticket_type_id: 'tier-1',
        ticket_type: '1 Person',
        status: 'active',
        used_at: null,
        gate: '',
        booking_id: 'b-1',
        created_at: '2026-09-02T06:00:00Z',
      },
    ];
    mount();
    const list = section('Attendee Check-ins');
    expect(within(list).getByText('Showing 1 of 52 attendees')).toBeTruthy();
    expect(within(list).getByRole('link', { name: 'pravalika@example.com' }).getAttribute('href')).toBe(
      'mailto:pravalika@example.com',
    );
  });
});

describe('what is gone', () => {
  it('no longer ends with a list of things it cannot measure', () => {
    mount();
    expect(screen.queryByText('Not measured yet')).toBeNull();
  });
});
