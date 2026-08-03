import * as React from 'react';
import type { Metadata } from 'next';
import { EventsTable } from '@/components/organizer/events-table';
import { Skeleton } from '@/components/organizer/primitives';

export const metadata: Metadata = { title: 'Events' };

/**
 * `EventsTable` reads `?q=`/`?status=`/`?event=` with `useSearchParams`, which
 * needs a Suspense boundary or the whole route becomes client-rendered at
 * request time. The boundary keeps the shell static and defers only the table.
 */
export default function OrganizerEventsPage() {
  return (
    <React.Suspense fallback={<TableFallback />}>
      <EventsTable />
    </React.Suspense>
  );
}

function TableFallback() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-9 w-full max-w-xs" />
      <Skeleton className="h-96 w-full" />
      <span className="sr-only">Loading your events…</span>
    </div>
  );
}
