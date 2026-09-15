'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, QrCode, Users } from 'lucide-react';
import { fetchAttendance } from '@/lib/api/organizer-writes';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { GLASS_PANEL, Percent } from './primitives';
import { AttendeeCheckinsList } from './analytics/attendee-checkins-list';

/**
 * THE GATE LIST — everybody this event will admit, on a page of its own.
 *
 * ── WHY THIS EXISTS, WHEN THE SCAN DESK ALREADY DID ──────────────────────
 *
 * `check-in.tsx` resolves ONE QR token at a time, which is the right shape at
 * a door and useless for the three questions a steward actually has between
 * scans: has this person already come in, who is on the list, and can I get
 * the list onto a phone before the venue's signal goes.
 *
 * The list itself is `AttendeeCheckinsList` — the same card the analytics page
 * ends with — mounted here with its filters in the URL, so "the unchecked list"
 * is a link a steward can send to the other gate.
 *
 * ── THE COUNT IN THE HEADER IS THE AUTHORITATIVE ONE ─────────────────────
 *
 * It comes from `GET /events/{id}/attendance`, which `checkin` owns and which
 * reconciles its Redis counter against the used-ticket count in the database.
 * Counting `status === 'used'` across loaded rows would be a count of whatever
 * page happens to be in the browser, and would disagree with the scan desk.
 */
export function EventAttendees({ eventId }: { eventId: string }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link
        href="/dashboard/events"
        className="inline-flex w-fit items-center gap-2 rounded-full text-label text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>

      <LiveCount eventId={eventId} />
      <AttendeeCheckinsList eventId={eventId} mode="page" />
    </div>
  );
}

/**
 * ADMITTED vs CAPACITY, FROM THE ENDPOINT THAT OWNS IT — the same figure the
 * scan desk shows, polled while the page is open.
 */
function LiveCount({ eventId }: { eventId: string }) {
  const attendance = useQuery({
    queryKey: ['organizer', 'attendance', eventId],
    queryFn: () => fetchAttendance(eventId),
    enabled: Boolean(eventId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const admitted = attendance.data?.admitted ?? null;
  const capacity = attendance.data?.capacity ?? null;
  const rate = admitted !== null && capacity ? Math.round((admitted / capacity) * 1000) / 10 : null;

  return (
    <header className={cn(GLASS_PANEL, 'flex flex-col gap-4 rounded-2xl p-4 shadow-sm sm:p-5')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="inline-flex items-center gap-2 text-h4">
          <Users className="size-5 shrink-0 text-primary" aria-hidden />
          Attendees
        </h1>
        <div className="text-right">
          <p className="text-h3 tabular-nums leading-none text-foreground" aria-live="polite">
            {admitted === null ? '—' : admitted}
            {capacity ? <span className="text-body-sm text-muted-foreground"> / {capacity}</span> : null}
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            inside now{rate === null ? '' : ' · '}
            {rate === null ? '' : <Percent value={rate} />}
          </p>
        </div>
      </div>

      <Button asChild variant="outline" size="sm" className="w-fit">
        <Link href={`/dashboard/check-in?event=${eventId}`}>
          <QrCode className="size-3.5" aria-hidden />
          Open the scan desk
        </Link>
      </Button>
    </header>
  );
}
