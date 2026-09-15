'use client';

import * as React from 'react';
import Link from 'next/link';
import { Award, Heart, MapPin, MessageSquare, Repeat, Star, UserPlus } from 'lucide-react';
import type { EventAnalytics } from '@/lib/api/organizer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { CARD, CARD_PAD, Section, StatCard, formatPct, plural } from './parts';

/**
 * WHO came, and what they said afterwards.
 *
 * ── EVERY FIGURE HERE IS THIS EVENT'S, AND SAYS WHAT IT MEASURES ─────────
 *
 * - First-time and repeat are asked of this event's paying buyers: a
 *   "returning member" had a paid booking for ANOTHER event before this one.
 * - "Interest conversion" is people who SAVED the event and then booked it.
 *   The reference labels this card "matched preferences"; nothing on this
 *   platform records a preference to match, and a save is the one statement of
 *   interest it does keep — so that is the measure, and the caption says so.
 * - "Local distribution" is from VIEWS that carried a city: nothing stores
 *   where a buyer lives, and the city a visitor chose in the header is theirs
 *   to have chosen. The caption names the city and the basis.
 *
 * ── THE RATING IS OVER EVERY REVIEW ──────────────────────────────────────
 *
 * The server aggregates it. The previous version averaged whichever reviews
 * happened to be loaded and had to label itself that way; that is no longer
 * the best this page can do.
 */

export function AudienceAndFeedback({ data, eventId }: { data: EventAnalytics; eventId: string }) {
  return (
    <>
      <AudienceSnapshot data={data} />
      <Feedback data={data} eventId={eventId} />
    </>
  );
}

function AudienceSnapshot({ data }: { data: EventAnalytics }) {
  const audience = data.audience;
  const city = data.event?.city;
  return (
    <Section icon={Award} title="Audience Quality Snapshot">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          icon={UserPlus}
          label="First-Time Attendees"
          value={formatPct(audience.first_time_pct)}
          caption={audience.attendees ? 'New to platform' : 'Nobody has booked yet'}
        />
        <StatCard
          icon={Repeat}
          label="Repeat Attendees"
          value={formatPct(audience.repeat_pct)}
          caption="Returning members"
        />
        <StatCard
          icon={Heart}
          label="Interest Conversion"
          value={formatPct(audience.interest_conversion_pct)}
          caption={
            audience.savers
              ? `Saved it, then booked (${audience.saved_then_booked} of ${audience.savers})`
              : 'Nobody has saved it yet'
          }
        />
        <StatCard
          icon={MapPin}
          label="Local Distribution"
          value={formatPct(audience.local_pct)}
          caption={
            audience.local_pct === null
              ? 'No located views recorded'
              : `Viewers browsing ${city || 'its city'}`
          }
        />
      </div>
    </Section>
  );
}

function Feedback({ data, eventId }: { data: EventAnalytics; eventId: string }) {
  const feedback = data.feedback;
  const top = Math.max(1, ...feedback.breakdown.map((bucket) => bucket.count));

  return (
    <Section
      icon={MessageSquare}
      title="Event Outcome & Feedback"
      trailing={
        feedback.count ? (
          <Button asChild variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
            <Link href={`/dashboard/reviews?event=${eventId}`}>Read them</Link>
          </Button>
        ) : null
      }
    >
      {/* `scroll-px-4`: without it the snap aligns the first card to the
          scroller's EDGE, eating the padding that lines it up with the page.

          `relative`, and it is load-bearing: the rating rows carry `sr-only`
          labels, which are `position: absolute`. With no positioned ancestor
          their containing block is the page, so they ESCAPE this scroller's
          clipping — sitting in the off-screen second card, they widened the
          whole page to 552px at a 390px viewport and a phone zoomed out to
          fit it. Measured, then fixed here. */}
      <div className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 touch-manipulation [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        <div className={cn(CARD, CARD_PAD, 'flex w-[75%] shrink-0 snap-start flex-col gap-3 sm:w-auto')}>
          <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <Star className="size-5 shrink-0 text-warning" aria-hidden />
            Average Rating
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-h1 font-bold leading-none tabular-nums text-foreground">
              {feedback.average === null ? '—' : feedback.average}
            </span>
            <span className="text-h4 text-muted-foreground">/5.0</span>
          </span>
          <span className="text-body-sm text-muted-foreground">
            {feedback.count
              ? `Based on ${plural(feedback.count, 'review')}`
              : 'No reviews yet. Only somebody who held a ticket can write one, so they arrive after the event.'}
          </span>
        </div>

        <div className={cn(CARD, CARD_PAD, 'flex w-[75%] shrink-0 snap-start flex-col gap-3 sm:w-auto')}>
          <span className="text-body-sm text-muted-foreground">Rating Breakdown</span>
          {/* Always all five: "no 1-stars" is a fact about the event, and a
              breakdown that dropped empty buckets would hide it. */}
          <ul className="flex flex-col gap-2.5" aria-label="Ratings by stars">
            {feedback.breakdown.map((bucket) => (
              <li key={bucket.rating} className="flex items-center gap-3">
                <span className="flex w-9 shrink-0 items-center gap-1 text-body-sm tabular-nums text-foreground">
                  {bucket.rating}
                  <Star className="size-3.5 fill-warning text-warning" aria-hidden />
                </span>
                <span className="block h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-warning"
                    style={{ width: `${bucket.count ? Math.max((bucket.count / top) * 100, 4) : 0}%` }}
                  />
                </span>
                <span className="w-7 shrink-0 text-right text-caption tabular-nums text-muted-foreground">
                  {bucket.count}
                  <span className="sr-only"> {bucket.count === 1 ? 'review' : 'reviews'}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
