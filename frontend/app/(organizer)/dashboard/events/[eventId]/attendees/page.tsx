import * as React from 'react';
import type { Metadata } from 'next';
import { EventAttendees } from '@/components/organizer/attendees';
import { Skeleton } from '@/components/organizer/primitives';

/**
 * `/dashboard/events/{id}/attendees` — the gate list.
 *
 * A route per event, like the analytics page beside it and for the same
 * reason: a steward opens this on a phone at a door, keeps it open, and sends
 * the filtered URL to whoever is working the other gate.
 *
 * The title is deliberately generic — the event's name is not known until the
 * client has fetched it, and a server-rendered title would need a second
 * authenticated read on a route that is `private, no-store` anyway.
 */
export const metadata: Metadata = { title: 'Attendees' };

export default function OrganizerEventAttendeesPage({
  params,
}: {
  params: { eventId: string };
}) {
  return (
    <React.Suspense fallback={<Fallback />}>
      <EventAttendees eventId={params.eventId} />
    </React.Suspense>
  );
}

/** `EventAttendees` reads `?q=/?state=/?sort=` with `useSearchParams`, which
 *  needs a boundary or the whole route becomes client-rendered at request
 *  time. */
function Fallback() {
  return (
    <div className="flex flex-col gap-stack">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-10 w-full max-w-sm" />
      <Skeleton className="h-64 w-full" />
      <span className="sr-only">Loading attendees…</span>
    </div>
  );
}
