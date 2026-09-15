'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronLeft,
  Clock,
  Eye,
  MapPin,
  MousePointerClick,
  QrCode,
  RefreshCw,
  ScanEye,
  Settings,
  Target,
  Ticket,
  TrendingUp,
} from 'lucide-react';
import type { EventAnalytics, EventStatus } from '@/lib/api/organizer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { Meter } from '../charts';
import { StatusPill } from '../primitives';
import { StatusBadge } from '../status-badge';
import {
  CARD,
  CARD_PAD,
  Section,
  StatCard,
  formatCount,
  formatDate,
  formatDateTime,
  formatDay,
  formatPct,
  formatTime,
  istDay,
} from './parts';

/**
 * The head of the page and its six core figures.
 *
 * ── THE HEADER IS FOR ACTING, THE GRID IS FOR READING ────────────────────
 *
 * Settings, refresh and the scanner are the only pressable things above the
 * fold, and they sit where the reference puts them. The status pill says
 * "Ended" once the show is over even though the stored status may still be
 * `live`: a finished event is the fact an organizer reading figures needs, and
 * the stored enum does not have a word for it.
 *
 * ── A FIGURE NOTHING RECORDED IS A DASH, WITH THE REASON ──────────────────
 *
 * Views, impressions and click-through are counted by the browser, and only
 * since that counting shipped. An event that ended before then has no views
 * recorded — which is NOT zero views, and a "0" in that card would tell an
 * organizer nobody looked at a show they sold out. So those cards print a dash
 * and say why, and when counting began part-way through an event's sale the
 * caption says from when.
 */

export function EventHeader({
  data,
  eventId,
  onRefresh,
  refreshing,
}: {
  data: EventAnalytics;
  eventId: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const event = data.event;

  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="All events">
          <Link href="/dashboard/events">
            <ChevronLeft className="size-6" aria-hidden />
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label="Event settings">
            <Link href={`/dashboard/events/${eventId}/edit`}>
              <Settings className="size-5" aria-hidden />
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={refreshing}
            // The figures are cached server-side for a minute, so the label
            // says how old they are rather than implying a press makes them live.
            aria-label={`Refresh figures (computed at ${formatTime(data.generated_at)})`}
            title={`Figures computed at ${formatTime(data.generated_at)}`}
          >
            <RefreshCw
              className={cn('size-5', refreshing && 'animate-spin motion-reduce:animate-none')}
              aria-hidden
            />
          </Button>
          {event ? <EventStatePill ended={data.event_ended} status={event.status} /> : null}
        </div>
      </div>

      {event ? (
        <>
          <h1 className="text-h2 font-bold leading-tight text-foreground">{event.title}</h1>
          <div className="flex flex-col gap-1.5 text-body-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{when(event.starts_at, event.ends_at)}</span>
            </p>
            {event.venue ? (
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {event.venue}
                  {event.city ? `, ${event.city}` : ''}
                </span>
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <p className={cn(CARD, CARD_PAD, 'text-body-sm text-muted-foreground')}>
          This event has been deleted. The figures below are what was recorded before it went.
        </p>
      )}

      <Button asChild variant="outline" size="lg" className="w-fit">
        <Link href={`/dashboard/check-in?event=${eventId}`}>
          <QrCode className="size-4 text-primary" aria-hidden />
          Scan Tickets
        </Link>
      </Button>
    </header>
  );
}

function EventStatePill({ ended, status }: { ended: boolean; status: string }) {
  if (ended) {
    return (
      <StatusPill tone="neutral" className="gap-1.5 px-3 py-1.5">
        <Clock className="size-3.5" aria-hidden />
        Ended
      </StatusPill>
    );
  }
  return <StatusBadge status={status as EventStatus} />;
}

/** "5 Sept 2026 at 05:00 pm - 08:00 pm", naming the end date only when it differs. */
function when(startsAt: string, endsAt: string | null): string {
  if (!endsAt) return formatDateTime(startsAt);
  const sameDay = istDay(startsAt) === istDay(endsAt);
  return sameDay
    ? `${formatDate(startsAt)} at ${formatTime(startsAt)} - ${formatTime(endsAt)}`
    : `${formatDateTime(startsAt)} - ${formatDateTime(endsAt)}`;
}

export function CoreMetricsGrid({ data }: { data: EventAnalytics }) {
  const engagement = data.engagement;
  const recorded = engagement.views !== null;
  const createdDay = istDay(data.event?.created_at);
  // Counting began after the event was created, so part of its sale is unseen.
  const partial = Boolean(
    recorded && engagement.tracked_since && createdDay && engagement.tracked_since > createdDay,
  );
  const since = formatDay(engagement.tracked_since);
  const notRecordedCaption = data.event_ended ? 'Not recorded for this event' : 'None recorded yet';

  return (
    <Section icon={TrendingUp} title="Core Performance Metrics">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard
          icon={Eye}
          label="Total Event Views"
          value={formatCount(engagement.views)}
          caption={recorded ? (partial ? `Page views since ${since}` : 'Total page views') : notRecordedCaption}
        />
        <StatCard
          icon={Target}
          label="Bookings"
          value={data.capacity ? `${formatCount(data.sold)}/${formatCount(data.capacity)}` : formatCount(data.sold)}
          caption={data.capacity ? `${formatPct(data.sell_through_pct)} filled` : 'No ticket types yet'}
        >
          {typeof data.sell_through_pct === 'number' ? (
            <Meter value={data.sell_through_pct / 100} />
          ) : null}
        </StatCard>
        <StatCard
          icon={TrendingUp}
          label="Total View CVR"
          value={formatPct(engagement.view_cvr_pct)}
          caption={recorded ? 'Bookings / total event views' : notRecordedCaption}
        />
        <StatCard
          icon={ScanEye}
          label="Impressions"
          value={formatCount(engagement.impressions)}
          caption={recorded ? 'Times shown in feeds' : notRecordedCaption}
        />
        <StatCard
          icon={MousePointerClick}
          label="Click-Through Rate"
          value={formatPct(engagement.ctr_pct)}
          caption={recorded ? 'Feed impressions to views' : notRecordedCaption}
        />
        <StatCard
          icon={Ticket}
          label="Add to Cart"
          value={formatCount(data.add_to_cart)}
          // A hold taken at checkout IS the cart, and the lapsed ones are the
          // abandonment this figure exists to show.
          caption="Billing cart entries"
        />
      </div>

      {/* Absent unless something is actually missing — a permanent footnote is
          read as boilerplate and then not read at all. */}
      {!recorded || partial ? (
        <p className="text-caption text-muted-foreground">
          {recorded
            ? `Views, impressions and click-through are counted from ${since}. Earlier activity on this event was not recorded, and conversion is measured over the same window.`
            : 'Views, impressions and click-through are counted by the page itself, and none have been recorded for this event.'}
        </p>
      ) : null}
    </Section>
  );
}
