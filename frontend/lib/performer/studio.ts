'use client';

import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyPerformer,
  fetchMyPerformers,
  fetchPerformerLeads,
  fetchPerformerQuotes,
  fetchPerformerReadiness,
  type OpenRequest,
  type OwnerPerformer,
  type PerformerQuote,
} from '@/lib/api/performers';
import { cursorFromNextLink } from '@/lib/api/events';

/**
 * The Performer Studio's reads, and everything derived from them.
 *
 * ── THE STUDIO ADDS NO ENDPOINTS ──────────────────────────────────────────
 *
 * Every number, lane and date on these screens comes from four existing reads:
 * the act, its readiness, its leads and its quotes. Nothing is a second source
 * of truth, and nothing is estimated — where the backend has no answer the UI
 * says so rather than computing something adjacent and calling it the answer.
 *
 * ── WHAT "DERIVED" MEANS HERE, AND WHAT IT DOES NOT ───────────────────────
 *
 * A derived figure is a COMPUTATION OVER STORED ROWS: how many quotes are
 * pending, what the accepted ones total, which dates have a booking. Those are
 * facts, just ones nobody stored twice.
 *
 * It is NOT a proxy. Profile views, conversion rate, click-through and
 * impressions cannot be derived from anything here — nothing records a visit —
 * so they are absent rather than approximated from lead counts. BACKLOG
 * "Performer profile analytics".
 */

const LIVE_POLL_MS = 30_000;

export const performerKeys = {
  all: ['performer'] as const,
  list: () => ['performer', 'list'] as const,
  detail: (id: string) => ['performer', 'detail', id] as const,
  readiness: (id: string) => ['performer', 'readiness', id] as const,
  leads: (id: string) => ['performer', 'leads', id] as const,
  quotes: (id: string) => ['performer', 'quotes', id] as const,
};

export function useMyActs() {
  return useInfiniteQuery({
    queryKey: performerKeys.list(),
    queryFn: ({ pageParam }) => fetchMyPerformers({ cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

export function useAct(performerId: string | null) {
  return useQuery({
    queryKey: performerKeys.detail(performerId ?? ''),
    queryFn: () => fetchMyPerformer(performerId as string),
    enabled: Boolean(performerId),
    staleTime: 0,
  });
}

export function useReadiness(performerId: string | null) {
  return useQuery({
    queryKey: performerKeys.readiness(performerId ?? ''),
    queryFn: () => fetchPerformerReadiness(performerId as string),
    enabled: Boolean(performerId),
    staleTime: 0,
  });
}

/**
 * Open briefs this act can serve.
 *
 * Polls, because a lead is worth answering fast and this is the screen a
 * performer leaves open. It stops in a background tab — a studio left open
 * overnight should not keep hitting the API.
 */
export function useLeads(performerId: string | null) {
  return useInfiniteQuery({
    queryKey: performerKeys.leads(performerId ?? ''),
    queryFn: ({ pageParam }) =>
      fetchPerformerLeads(performerId as string, { cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    enabled: Boolean(performerId),
    staleTime: 0,
    refetchInterval: LIVE_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useQuotes(performerId: string | null) {
  return useQuery({
    queryKey: performerKeys.quotes(performerId ?? ''),
    queryFn: () => fetchPerformerQuotes(performerId as string),
    enabled: Boolean(performerId),
    staleTime: 0,
    refetchInterval: LIVE_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** Invalidate everything one write could have moved. Coarse on purpose. */
export function useInvalidatePerformer() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: performerKeys.all });
}

/* ------------------------------------------------------------- pipeline */

/**
 * The booking pipeline, as the data actually supports it.
 *
 * The brief asked for seven lanes: New Lead, Quoted, Negotiation, Accepted,
 * Booked, Completed, Cancelled. Five are real; two are not, and inventing them
 * would mean lanes nothing can ever enter:
 *
 * - **Negotiation** has no state. A quote is pending or decided — there is no
 *   counter-offer object, and no way to edit a quote once sent. BACKLOG
 *   "Quote revisions and counter-offers".
 * - **Accepted vs Booked** are the same event here. Accepting a quote closes
 *   the brief and books the act in one transaction, so two lanes would always
 *   hold identical rows.
 *
 * **Completed IS real**, and derived honestly: an accepted quote whose event
 * date has passed. That is a fact about a stored date, not a status somebody
 * forgot to set.
 *
 * **Cancelled** shows declined and withdrawn quotes — both stored states —
 * under one heading, because from the performer's side "we did not get it" is
 * the fact that matters.
 */
export type PipelineLane = 'leads' | 'quoted' | 'accepted' | 'performed' | 'lost';

export const LANES: { id: PipelineLane; label: string; blurb: string }[] = [
  { id: 'leads', label: 'New leads', blurb: 'Briefs you can answer' },
  { id: 'quoted', label: 'Quoted', blurb: 'Waiting on the customer' },
  { id: 'accepted', label: 'Booked', blurb: 'Confirmed, still to play' },
  { id: 'performed', label: 'Performed', blurb: 'The date has passed' },
  { id: 'lost', label: 'Not won', blurb: 'Declined or withdrawn' },
];

export type Pipeline = {
  leads: OpenRequest[];
  quoted: PerformerQuote[];
  accepted: PerformerQuote[];
  performed: PerformerQuote[];
  lost: PerformerQuote[];
};

/**
 * Today, as the calendar date the performer is standing in.
 *
 * A gig date is a plain `YYYY-MM-DD` — a DAY, not a moment — so the comparison
 * has to be date-to-date. Parsing one with `Date.parse` gives UTC midnight,
 * which west of UTC is BEFORE the local day began: a gig happening tonight
 * would have been filed under "performed". Comparing the strings sidesteps the
 * timezone entirely, and ISO dates already sort lexicographically.
 */
export function todayLocal(now = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** A gig is over only once its DAY is. Today still counts as upcoming. */
export function isPastDay(date: string, today: string = todayLocal()): boolean {
  return date.slice(0, 10) < today;
}

/**
 * A `YYYY-MM-DD` as a local Date, for display.
 *
 * `new Date('2026-07-29')` is UTC midnight, so anywhere west of UTC it renders
 * as the 28th — a gig shown on the wrong day. Building from the parts pins it
 * to the local calendar, which is the only calendar the performer has.
 */
export function parseDayLocal(date: string): Date {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/**
 * The lane rules, as a pure function so they can be tested without React.
 *
 * Three of them are load-bearing and none is obvious from the API:
 *
 * 1. A brief this act has ALREADY quoted on is not a lead any more. `/leads`
 *    returns it regardless — verified against live Django — so this filter is
 *    the only thing stopping one job appearing in two lanes at once.
 * 2. `performed` is an accepted quote whose DAY has passed. Nothing stores
 *    "played"; this is derived from a real date rather than a status somebody
 *    forgot to set.
 * 3. `lost` is declined OR withdrawn. Both are decided and neither was won.
 */
export function classifyPipeline(
  openLeads: OpenRequest[],
  rows: PerformerQuote[],
  today: string = todayLocal(),
): Pipeline {
  const quotedRequestIds = new Set(rows.map((quote) => quote.request_id));
  const past = (date: string) => isPastDay(date, today);

  return {
    leads: openLeads.filter((lead) => !quotedRequestIds.has(lead.id)),
    quoted: rows.filter((quote) => quote.status === 'pending'),
    accepted: rows.filter(
      (quote) => quote.status === 'accepted' && !past(quote.request_event_date),
    ),
    performed: rows.filter(
      (quote) => quote.status === 'accepted' && past(quote.request_event_date),
    ),
    lost: rows.filter((quote) => quote.status === 'declined' || quote.status === 'withdrawn'),
  };
}

export function usePipeline(performerId: string | null) {
  const leads = useLeads(performerId);
  const quotes = useQuotes(performerId);

  return useMemo(() => {
    const pipeline = classifyPipeline(
      leads.data?.pages.flatMap((page) => page.data) ?? [],
      quotes.data?.data ?? [],
    );

    return {
      pipeline,
      isPending: leads.isPending || quotes.isPending,
      isError: leads.isError && quotes.isError,
      refetch: () => {
        void leads.refetch();
        void quotes.refetch();
      },
    };
  }, [leads, quotes]);
}

/* ---------------------------------------------------------------- stats */

/**
 * The numbers a performer can act on, and ONLY those.
 *
 * Every one is a count or a sum over rows this act owns:
 *
 * - `bookedValueMinor` is the total of ACCEPTED quote amounts. It is labelled
 *   "booked value", never "revenue" or "earnings" — the platform does not
 *   process this money, so it is what was agreed, not what has arrived.
 * - `winRate` is accepted ÷ decided. **Pending quotes are excluded from the
 *   denominator**: counting a quote nobody has answered yet as a loss makes a
 *   performer's rate drop every time they bid, which is the opposite of true.
 *   It is `null` until at least one quote has actually been decided, because a
 *   rate over zero decisions is not 0%, it is unknown.
 */
export type StudioStats = {
  openLeads: number;
  pendingQuotes: number;
  upcomingBookings: number;
  bookedValueMinor: number;
  averageQuoteMinor: number | null;
  winRate: number | null;
  decidedQuotes: number;
};

/** Pure, so the win-rate rule can be tested without React. */
export function deriveStats(pipeline: Pipeline): StudioStats {
  const decided = [...pipeline.accepted, ...pipeline.performed, ...pipeline.lost];
  const won = pipeline.accepted.length + pipeline.performed.length;
  const allQuotes = [...pipeline.quoted, ...decided];

  return {
    openLeads: pipeline.leads.length,
    pendingQuotes: pipeline.quoted.length,
    upcomingBookings: pipeline.accepted.length,
    bookedValueMinor: [...pipeline.accepted, ...pipeline.performed].reduce(
      (total, quote) => total + quote.amount_minor,
      0,
    ),
    averageQuoteMinor: allQuotes.length
      ? Math.round(
          allQuotes.reduce((total, quote) => total + quote.amount_minor, 0) / allQuotes.length,
        )
      : null,
    // Null, not zero, until something has been decided.
    winRate: decided.length ? Math.round((won / decided.length) * 100) : null,
    decidedQuotes: decided.length,
  };
}

export function useStudioStats(performerId: string | null): StudioStats & { isPending: boolean } {
  const { pipeline, isPending } = usePipeline(performerId);
  return useMemo(() => ({ ...deriveStats(pipeline), isPending }), [pipeline, isPending]);
}

/* -------------------------------------------------------------- calendar */

/**
 * What is actually on the calendar.
 *
 * ONLY real dates: confirmed bookings (accepted quotes) and briefs this act
 * has been invited to answer. There are **no blocked dates**, because nothing
 * stores one — a blackout calendar needs its own model, and drawing an empty
 * "available" grid would be inventing availability the platform cannot
 * promise. BACKLOG "Performer availability calendar".
 */
export type CalendarEntry = {
  date: string;
  kind: 'booked' | 'lead';
  title: string;
  city: string;
  amountMinor: number | null;
  href: string;
};

export function useCalendar(performerId: string | null) {
  const { pipeline, isPending } = usePipeline(performerId);

  return useMemo(() => {
    const entries: CalendarEntry[] = [
      ...[...pipeline.accepted, ...pipeline.performed].map((quote) => ({
        date: quote.request_event_date,
        kind: 'booked' as const,
        title: `${quote.request_occasion.replace('_', ' ')} in ${quote.request_city}`,
        city: quote.request_city,
        amountMinor: quote.amount_minor,
        href: `/studio/${performerId}/pipeline`,
      })),
      ...pipeline.leads.map((lead) => ({
        date: lead.event_date,
        kind: 'lead' as const,
        title: `${lead.occasion.replace('_', ' ')} enquiry`,
        city: lead.city,
        amountMinor: null,
        href: `/studio/${performerId}/leads`,
      })),
    ];

    entries.sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
    return { entries, isPending };
  }, [pipeline, isPending, performerId]);
}

/* --------------------------------------------------------- profile state */

/**
 * What the studio should say about where this profile stands.
 *
 * Six states, all stored — the moderation workflow the marketplace already
 * runs, surfaced in the owner's own words rather than as an enum.
 */
export type ProfileState = {
  label: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  detail: string;
  /** What the owner should do next, if anything. */
  action: string | null;
};

export function profileState(act: OwnerPerformer): ProfileState {
  switch (act.status) {
    case 'draft':
      return {
        label: 'Draft',
        tone: 'neutral',
        detail: 'Only you can see this. It is not in the marketplace and cannot receive briefs.',
        action: 'Finish it and submit for review',
      };
    case 'pending_review':
      return {
        label: 'In review',
        tone: 'info',
        detail:
          'Someone at Curatix is looking at it. Nothing is needed from you — we will email when there is a decision.',
        action: null,
      };
    case 'rejected':
      return {
        label: 'Changes needed',
        tone: 'danger',
        detail: act.moderation_note || 'No reason was recorded. Contact support if this looks wrong.',
        action: 'Make the changes and resubmit',
      };
    case 'live':
      return {
        label: 'Live',
        tone: 'success',
        detail: 'Listed in the marketplace and receiving briefs.',
        action: null,
      };
    case 'paused':
      return {
        label: 'Paused',
        tone: 'warning',
        detail:
          'Hidden from the marketplace and not receiving new briefs. Bookings you already have are unaffected.',
        action: 'Resume when you are taking work again',
      };
    default:
      return {
        label: 'Archived',
        tone: 'neutral',
        detail: 'Retired. It is not listed and cannot be resumed from here.',
        action: null,
      };
  }
}

/**
 * The public profile, built from the OWNER's payload.
 *
 * This is what makes the preview a real preview rather than a second
 * implementation: the same `PerformerProfile` component the marketplace
 * renders, fed the same shape, from data the owner can see before anyone else
 * can. The public endpoint 404s for a draft, so mapping here is the only way
 * to preview one at all.
 */
export function toPublicShape(act: OwnerPerformer) {
  return {
    id: act.id,
    stage_name: act.stage_name,
    performer_type: act.performer_type,
    tagline: act.tagline,
    city: act.city,
    travel_radius_km: act.travel_radius_km,
    base_price_minor: act.base_price_minor,
    genres: act.genres,
    languages: act.languages,
    experience_years: act.experience_years,
    is_featured: act.is_featured,
    organization_id: act.organization_id,
    organization_name: act.organization_name,
    verified_level: act.verified_level,
    photo_url: act.photos[0]?.url ?? '',
    photo_alt: act.photos[0]?.alt_text ?? '',
    bio: act.bio,
    occasions: act.occasions,
    typical_set_minutes: act.typical_set_minutes,
    website_url: act.website_url,
    instagram_url: act.instagram_url,
    youtube_url: act.youtube_url,
    created_at: act.created_at,
    photos: act.photos,
  };
}
