'use client';

import * as React from 'react';
import { useEventAnalytics } from '@/lib/organizer/queries';
import { ErrorState, Skeleton } from '../primitives';
import { AttendeeCheckinsList } from './attendee-checkins-list';
import { AudienceAndFeedback } from './audience-and-feedback';
import { AuditLogsTables } from './audit-logs-tables';
import { BookingTrendsChart } from './booking-trends-chart';
import { CoreMetricsGrid, EventHeader } from './core-metrics-grid';
import { RevenueAndAttendance } from './revenue-and-attendance';

/**
 * One event, everything known about it — a vertical stack of cards.
 *
 * ── THE ORDER IS THE REFERENCE'S, AND IT IS THE ORDER QUESTIONS ARRIVE ────
 *
 *   1. The event, and its six core figures      is anybody looking, and buying
 *   2. Revenue, then attendance                 what came in, who came
 *   3. Booking insights and the window chart    when they bought
 *   4. Price timeline, feature log, tiers,      how the PRICE did
 *      group offers, coupons
 *   5. Audience and feedback                    who they were, what they said
 *   6. The attendee list                        every one of them, by name
 *
 * ── NOTHING ON THIS PAGE IS A NUMBER THE SERVER DID NOT SEND ─────────────
 *
 * The one division here is the booking-window average, taken over the days the
 * range shows. Everything else — every rate, every share — comes computed from
 * real rows, and is `null` rather than 0 when it has no denominator. The page
 * used to end with a "Not measured yet" list; each thing on it is measured now,
 * and the few the reference shows that this platform cannot know are labelled
 * for what they actually measure rather than faked (see each section).
 */
export function AnalyticsDashboard({ eventId }: { eventId: string }) {
  const analytics = useEventAnalytics(eventId);

  if (analytics.isError) {
    return (
      <ErrorState
        message="Could not load this event's analytics."
        onRetry={() => void analytics.refetch()}
      />
    );
  }

  if (analytics.isPending) return <LoadingShape />;

  const data = analytics.data;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 pb-8">
      <EventHeader
        data={data}
        eventId={eventId}
        onRefresh={() => void analytics.refetch()}
        refreshing={analytics.isFetching}
      />
      <CoreMetricsGrid data={data} />
      <RevenueAndAttendance data={data} eventId={eventId} />
      <BookingTrendsChart data={data} />
      <AuditLogsTables data={data} eventId={eventId} />
      <AudienceAndFeedback data={data} eventId={eventId} />
      <AttendeeCheckinsList eventId={eventId} mode="embedded" />
    </div>
  );
}

function LoadingShape() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading analytics…</span>
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
