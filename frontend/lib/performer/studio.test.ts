import { describe, expect, it } from 'vitest';
import type { OpenRequest, OwnerPerformer, PerformerQuote } from '@/lib/api/performers';
import {
  classifyPipeline,
  deriveStats,
  isPastDay,
  parseDayLocal,
  profileState,
  todayLocal,
  toPublicShape,
} from './studio';

/**
 * The studio's derivation layer.
 *
 * These four rules are the ones a reader would not guess from the API, and each
 * would be silently wrong rather than visibly broken:
 *
 * - a quoted brief still comes back from `/leads` (verified against live
 *   Django), so without the filter one job sits in two lanes;
 * - "performed" is derived from a date, because nothing stores it;
 * - win rate must exclude pending quotes, or bidding lowers your own rate;
 * - the preview is only a real preview while `toPublicShape` stays total.
 */

const lead = (id: string, date = '2027-01-01'): OpenRequest => ({
  id,
  performer_type: 'band',
  occasion: 'wedding',
  city: 'Hyderabad',
  event_date: date,
  budget_min_minor: 100000,
  budget_max_minor: 500000,
  guests: 200,
  notes: 'A sangeet.',
  quote_count: 0,
  created_at: '2026-07-01T00:00:00Z',
});

const quote = (
  id: string,
  requestId: string,
  status: PerformerQuote['status'],
  date: string,
  amount = 100000,
): PerformerQuote => ({
  id,
  request_id: requestId,
  amount_minor: amount,
  message: '',
  status,
  created_at: '2026-07-01T00:00:00Z',
  request_city: 'Hyderabad',
  request_occasion: 'wedding',
  request_event_date: date,
  request_status: 'open',
});

// Fixed calendar dates, so none of this depends on the day the suite runs —
// or, more importantly, on the timezone it runs in.
const TODAY = '2026-07-29';
const FUTURE = '2026-12-25';
const PAST = '2026-01-15';

describe('classifyPipeline', () => {
  it('drops a brief this act has already quoted on from the leads lane', () => {
    const pipeline = classifyPipeline(
      [lead('req-1'), lead('req-2')],
      [quote('q-1', 'req-1', 'pending', FUTURE)],
      TODAY,
    );

    expect(pipeline.leads.map((row) => row.id)).toEqual(['req-2']);
    expect(pipeline.quoted.map((row) => row.id)).toEqual(['q-1']);
  });

  it('never shows the same job in two lanes', () => {
    const pipeline = classifyPipeline(
      [lead('req-1')],
      [quote('q-1', 'req-1', 'pending', FUTURE)],
      TODAY,
    );

    const everywhere = [
      ...pipeline.leads.map((row) => row.id),
      ...pipeline.quoted.map((row) => row.request_id),
      ...pipeline.accepted.map((row) => row.request_id),
      ...pipeline.performed.map((row) => row.request_id),
      ...pipeline.lost.map((row) => row.request_id),
    ];
    expect(new Set(everywhere).size).toBe(everywhere.length);
  });

  it('splits accepted quotes into booked and performed by the event date', () => {
    const pipeline = classifyPipeline(
      [],
      [quote('q-1', 'r-1', 'accepted', FUTURE), quote('q-2', 'r-2', 'accepted', PAST)],
      TODAY,
    );

    expect(pipeline.accepted.map((row) => row.id)).toEqual(['q-1']);
    expect(pipeline.performed.map((row) => row.id)).toEqual(['q-2']);
  });

  it('treats a booking TODAY as still upcoming — a gig is for a day, not a moment', () => {
    const pipeline = classifyPipeline([], [quote('q-1', 'r-1', 'accepted', TODAY)], TODAY);

    expect(pipeline.accepted).toHaveLength(1);
    expect(pipeline.performed).toHaveLength(0);
  });

  it('compares calendar dates, not parsed timestamps', () => {
    // `Date.parse('2026-07-29')` is UTC midnight. West of UTC that is BEFORE
    // the local day began, so a timestamp comparison files tonight's gig under
    // "performed" — the regression this rule exists to prevent.
    expect(isPastDay(TODAY, TODAY)).toBe(false);
    expect(isPastDay(PAST, TODAY)).toBe(true);
    expect(isPastDay(FUTURE, TODAY)).toBe(false);
  });

  it('puts both declined and withdrawn quotes in the not-won lane', () => {
    const pipeline = classifyPipeline(
      [],
      [quote('q-1', 'r-1', 'declined', FUTURE), quote('q-2', 'r-2', 'withdrawn', FUTURE)],
      TODAY,
    );

    expect(pipeline.lost.map((row) => row.id)).toEqual(['q-1', 'q-2']);
  });
});

describe('deriveStats', () => {
  const empty = classifyPipeline([], [], TODAY);

  it('reports an unknown win rate as null, not 0%', () => {
    expect(deriveStats(empty).winRate).toBeNull();
    expect(
      deriveStats(classifyPipeline([], [quote('q-1', 'r-1', 'pending', FUTURE)], TODAY))
        .winRate,
    ).toBeNull();
  });

  it('excludes pending quotes from the win-rate denominator', () => {
    const pipeline = classifyPipeline(
      [],
      [
        quote('q-1', 'r-1', 'accepted', FUTURE),
        quote('q-2', 'r-2', 'declined', FUTURE),
        // Three unanswered bids must not drag the rate down to 25%.
        quote('q-3', 'r-3', 'pending', FUTURE),
        quote('q-4', 'r-4', 'pending', FUTURE),
        quote('q-5', 'r-5', 'pending', FUTURE),
      ],
      TODAY,
    );

    const stats = deriveStats(pipeline);
    expect(stats.winRate).toBe(50);
    expect(stats.decidedQuotes).toBe(2);
    expect(stats.pendingQuotes).toBe(3);
  });

  it('counts a performed gig as a win, not a loss', () => {
    const stats = deriveStats(
      classifyPipeline([], [quote('q-1', 'r-1', 'accepted', PAST)], TODAY),
    );
    expect(stats.winRate).toBe(100);
  });

  it('sums booked value over accepted AND performed, and nothing else', () => {
    const stats = deriveStats(
      classifyPipeline(
        [],
        [
          quote('q-1', 'r-1', 'accepted', FUTURE, 500000),
          quote('q-2', 'r-2', 'accepted', PAST, 300000),
          quote('q-3', 'r-3', 'pending', FUTURE, 999999),
          quote('q-4', 'r-4', 'declined', FUTURE, 999999),
        ],
        TODAY,
      ),
    );

    expect(stats.bookedValueMinor).toBe(800000);
  });

  it('averages every quote sent, whatever became of it', () => {
    const stats = deriveStats(
      classifyPipeline(
        [],
        [
          quote('q-1', 'r-1', 'accepted', FUTURE, 100000),
          quote('q-2', 'r-2', 'pending', FUTURE, 200000),
          quote('q-3', 'r-3', 'declined', FUTURE, 300000),
        ],
        TODAY,
      ),
    );

    expect(stats.averageQuoteMinor).toBe(200000);
  });

  it('has no average until a quote exists', () => {
    expect(deriveStats(empty).averageQuoteMinor).toBeNull();
  });
});

const act = (overrides: Partial<OwnerPerformer> = {}): OwnerPerformer => ({
  id: 'act-1',
  stage_name: 'The Quartet',
  performer_type: 'band',
  tagline: 'Four people, one tight set',
  bio: 'Weddings and college fests.',
  city: 'Hyderabad',
  travel_radius_km: 200,
  base_price_minor: 450000,
  genres: ['jazz'],
  languages: ['English'],
  occasions: ['wedding'],
  experience_years: 8,
  typical_set_minutes: 90,
  website_url: '',
  instagram_url: '',
  youtube_url: '',
  status: 'draft',
  is_featured: false,
  version: 3,
  submitted_at: null,
  moderated_at: null,
  moderation_note: '',
  organization_id: 'org-1',
  organization_name: 'Quartet Music LLP',
  verified_level: 'unverified',
  created_at: '2026-07-01T00:00:00Z',
  photos: [],
  ...overrides,
});

describe('profileState', () => {
  it('gives a rejected act the operator note as its detail', () => {
    const state = profileState(act({ status: 'rejected', moderation_note: 'Photos are blurry.' }));
    expect(state.detail).toBe('Photos are blurry.');
    expect(state.action).toBeTruthy();
  });

  it('never leaves a rejected act with an empty explanation', () => {
    expect(profileState(act({ status: 'rejected', moderation_note: '' })).detail).not.toBe('');
  });

  it('asks for nothing while an act is in review', () => {
    expect(profileState(act({ status: 'pending_review' })).action).toBeNull();
    expect(profileState(act({ status: 'live' })).action).toBeNull();
  });
});

describe('toPublicShape', () => {
  it('carries every field the public card and profile read', () => {
    const shape = toPublicShape(
      act({ photos: [{ id: 'p1', url: '/a.jpg', alt_text: 'On stage', caption: '', position: 1 }] }),
    );

    // The exact key set the marketplace components destructure. If the public
    // type grows a field, this fails here rather than rendering `undefined` on
    // the screen a performer uses to decide their profile is finished.
    for (const key of [
      'id',
      'stage_name',
      'performer_type',
      'tagline',
      'city',
      'travel_radius_km',
      'base_price_minor',
      'genres',
      'languages',
      'experience_years',
      'is_featured',
      'organization_id',
      'organization_name',
      'verified_level',
      'photo_url',
      'photo_alt',
      'bio',
      'occasions',
      'typical_set_minutes',
      'website_url',
      'instagram_url',
      'youtube_url',
      'created_at',
      'photos',
    ]) {
      expect(shape).toHaveProperty(key);
    }
  });

  it('derives the card image from the first photo', () => {
    const shape = toPublicShape(
      act({
        photos: [
          { id: 'p1', url: '/first.jpg', alt_text: 'First', caption: '', position: 1 },
          { id: 'p2', url: '/second.jpg', alt_text: 'Second', caption: '', position: 2 },
        ],
      }),
    );

    expect(shape.photo_url).toBe('/first.jpg');
    expect(shape.photo_alt).toBe('First');
  });

  it('survives an act with no photos at all — the state a draft starts in', () => {
    const shape = toPublicShape(act());
    expect(shape.photo_url).toBe('');
    expect(shape.photos).toEqual([]);
  });
});

describe('local calendar dates', () => {
  it('renders a plain date on the day it says, whatever the timezone', () => {
    // `new Date('2026-07-29')` is UTC midnight and displays as the 28th west
    // of UTC. Building from the parts pins it to the local calendar.
    const day = parseDayLocal('2026-07-29');
    expect(day.getFullYear()).toBe(2026);
    expect(day.getMonth()).toBe(6);
    expect(day.getDate()).toBe(29);
  });

  it('reads today off the local clock, not off a UTC conversion', () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(todayLocal(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});
